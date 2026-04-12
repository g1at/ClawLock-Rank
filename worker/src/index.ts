interface Env {
  DB: D1Database;
  DEVICE_HASH_SALT: string;
  SUBMIT_COOLDOWN_HOURS?: string;
  TIMESTAMP_MAX_AGE_MINUTES?: string;
  TIMESTAMP_MAX_FUTURE_MINUTES?: string;
  IP_RATE_LIMIT_WINDOW_MINUTES?: string;
  IP_RATE_LIMIT_MAX_SUBMISSIONS?: string;
  PUBLIC_ORIGIN?: string;
}

type ThreatLevel = "critical" | "high" | "medium" | "info";

interface NormalizedFinding {
  findingKey: string;
  scanner: string;
  level: ThreatLevel;
  title: string;
}

interface NormalizedSubmission {
  tool: string;
  clawlockVersion: string;
  adapter: string;
  adapterVersion: string;
  score: number;
  grade: string;
  nickname: string;
  deviceFingerprint: string;
  evidenceHash: string;
  clientTimestamp: string;
  findings: NormalizedFinding[];
  source: string;
  skillVersion: string;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const VALID_GRADES = new Set(["S", "A", "B", "C", "D", "F"]);
const VALID_LEVELS = new Set<ThreatLevel>(["critical", "high", "medium", "info"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, service: "clawlock-rank-worker", now: new Date().toISOString() }, 200, request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/scores") {
        return handleScores(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/submit") {
        return handleSubmit(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/scores/stream") {
        return json(
          { ok: false, error: "SSE is not implemented in this starter. Use polling or add a Durable Object stream." },
          501,
          request,
          env,
        );
      }

      return json({ ok: false, error: "Not found" }, 404, request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      return json({ ok: false, error: message }, 500, request, env);
    }
  },
};

async function handleSubmit(request: Request, env: Env): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Request body must be valid JSON." }, 400, request, env);
  }

  let submission: NormalizedSubmission;
  try {
    submission = normalizeSubmission(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid submission payload.";
    return json({ ok: false, error: message }, 400, request, env);
  }

  const submittedAt = new Date().toISOString();
  const timestampError = validateTimestampFreshness(submission.clientTimestamp, env);
  if (timestampError) {
    return json({ ok: false, accepted: false, error: timestampError }, 400, request, env);
  }

  const salt = env.DEVICE_HASH_SALT || "clawlock-rank";
  const deviceHash = await hashWithSalt(submission.deviceFingerprint, salt);
  const avatarSeed = deviceHash.slice(0, 12);
  const ipAddress = extractIp(request);
  const ipHash = ipAddress ? await hashWithSalt(ipAddress, salt) : "";

  const cooldownHours = Number(env.SUBMIT_COOLDOWN_HOURS || "4");
  const cooldownMs = Number.isFinite(cooldownHours) && cooldownHours > 0 ? cooldownHours * 60 * 60 * 1000 : 0;
  const lastSubmit = await env.DB.prepare("SELECT last_submit_at FROM rate_limits WHERE device_hash = ?")
    .bind(deviceHash)
    .first<{ last_submit_at: string }>();

  if (lastSubmit?.last_submit_at && cooldownMs > 0) {
    const lastAt = Date.parse(lastSubmit.last_submit_at);
    const nextAllowedAt = lastAt + cooldownMs;
    if (Number.isFinite(lastAt) && nextAllowedAt > Date.now()) {
      return json(
        {
          ok: false,
          accepted: false,
          error: "This device is still in cooldown.",
          cooldown_until: new Date(nextAllowedAt).toISOString(),
        },
        429,
        request,
        env,
      );
    }
  }

  const ipRateLimitError = await checkIpRateLimit(env, ipHash);
  if (ipRateLimitError) {
    return json({ ok: false, accepted: false, error: ipRateLimitError }, 429, request, env);
  }

  const submissionId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `
        INSERT INTO submissions (
          id, submitted_at, client_timestamp, device_hash, nickname, avatar_seed,
          tool, clawlock_version, adapter, adapter_version, platform,
          score, grade, domain_scores_json, domain_grades_json,
          source, skill_version, ip_hash, evidence_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      submissionId,
      submittedAt,
      submission.clientTimestamp,
      deviceHash,
      submission.nickname,
      avatarSeed,
      submission.tool,
      submission.clawlockVersion,
      submission.adapter,
      submission.adapterVersion,
      "",
      submission.score,
      submission.grade,
      JSON.stringify({}),
      JSON.stringify({}),
      submission.source,
      submission.skillVersion,
      ipHash,
      submission.evidenceHash,
    ),
    env.DB.prepare(
      `
        INSERT INTO rate_limits (device_hash, last_submit_at, ip_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(device_hash) DO UPDATE SET
          last_submit_at = excluded.last_submit_at,
          ip_hash = excluded.ip_hash
      `,
    ).bind(deviceHash, submittedAt, ipHash),
  ];

  for (const finding of submission.findings) {
    statements.push(
      env.DB.prepare(
        `
          INSERT INTO submission_findings (
            id, submission_id, finding_key, scanner, level, title, location
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        crypto.randomUUID(),
        submissionId,
        finding.findingKey,
        finding.scanner,
        finding.level,
        finding.title,
        "",
      ),
    );
  }

  await env.DB.batch(statements);

  const rank = await getRankForDevice(env, deviceHash);
  const cooldownUntil = cooldownMs > 0 ? new Date(Date.now() + cooldownMs).toISOString() : null;

  return json(
    {
      ok: true,
      accepted: true,
      rank,
      score: submission.score,
      grade: submission.grade,
      avatar_seed: avatarSeed,
      cooldown_until: cooldownUntil,
    },
    201,
    request,
    env,
  );
}

async function handleScores(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = clampNumber(url.searchParams.get("limit"), 1, 100, 50);
  const topLimit = clampNumber(url.searchParams.get("top_limit"), 1, 20, 5);

  const leaderboardRows = await env.DB.prepare(
    `
      WITH latest AS (
        SELECT *
        FROM (
          SELECT
            s.*,
            ROW_NUMBER() OVER (
              PARTITION BY s.device_hash
              ORDER BY s.submitted_at DESC, s.id DESC
            ) AS device_row
          FROM submissions s
        )
        WHERE device_row = 1
      ),
      ranked AS (
        SELECT
          nickname,
          avatar_seed,
          score,
          grade,
          adapter_version,
          ROW_NUMBER() OVER (
            ORDER BY score DESC, submitted_at DESC, nickname ASC
          ) AS rank
        FROM latest
      )
      SELECT rank, nickname, avatar_seed, score, grade, adapter_version
      FROM ranked
      ORDER BY rank
      LIMIT ?
    `,
  )
    .bind(limit)
    .all<{
      rank: number;
      nickname: string;
      avatar_seed: string;
      score: number;
      grade: string;
      adapter_version: string;
    }>();

  const vulnerabilityRows = await env.DB.prepare(
    `
      WITH latest AS (
        SELECT *
        FROM (
          SELECT
            s.*,
            ROW_NUMBER() OVER (
              PARTITION BY s.device_hash
              ORDER BY s.submitted_at DESC, s.id DESC
            ) AS device_row
          FROM submissions s
        )
        WHERE device_row = 1
      ),
      dedup AS (
        SELECT DISTINCT
          latest.device_hash,
          submission_findings.finding_key,
          submission_findings.title,
          submission_findings.level
        FROM submission_findings
        INNER JOIN latest ON latest.id = submission_findings.submission_id
      )
      SELECT
        title AS name,
        level,
        COUNT(*) AS count
      FROM dedup
      WHERE level IN ('critical', 'high', 'medium')
      GROUP BY finding_key, title, level
      ORDER BY
        count DESC,
        CASE level
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END DESC,
        title ASC
      LIMIT ?
    `,
  )
    .bind(topLimit)
    .all<{ name: string; count: number; level: ThreatLevel }>();

  return json(
    {
      leaderboard: leaderboardRows.results || [],
      top_vulnerabilities: vulnerabilityRows.results || [],
      stats: {
        top_vulnerabilities: vulnerabilityRows.results || [],
      },
    },
    200,
    request,
    env,
  );
}

function normalizeSubmission(raw: unknown): NormalizedSubmission {
  if (!isRecord(raw) || !isRecord(raw.submission)) {
    throw new Error("Request body must include a submission object.");
  }

  const submission = raw.submission;
  const meta = isRecord(raw.meta) ? raw.meta : {};

  const tool = cleanText(submission.tool, 32) || "ClawLock";
  const clawlockVersion = cleanText(submission.clawlock_version ?? submission.version, 32);
  const adapter = cleanText(submission.adapter, 64);
  const adapterVersion = cleanText(submission.adapter_version, 32);
  const deviceFingerprint = cleanText(
    submission.device_fingerprint ?? submission.device,
    128,
  );
  const timestamp = cleanText(submission.timestamp ?? submission.time, 64);
  const nickname = cleanText(submission.nickname, 24) || "Anonymous";
  const evidenceHash = cleanHash(submission.evidence_hash);
  const grade = cleanText(submission.grade, 2).toUpperCase();
  const score = Number(submission.score);

  if (!clawlockVersion) throw new Error("submission.clawlock_version is required.");
  if (!adapter) throw new Error("submission.adapter is required.");
  if (!deviceFingerprint) throw new Error("submission.device_fingerprint is required.");
  if (deviceFingerprint.length < 8) throw new Error("submission.device_fingerprint is too short.");
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new Error("submission.timestamp must be a valid ISO date.");
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("submission.score must be between 0 and 100.");
  if (!VALID_GRADES.has(grade)) throw new Error("submission.grade must be one of S/A/B/C/D/F.");
  if (submission.evidence_hash != null && !evidenceHash) {
    throw new Error("submission.evidence_hash must be a 64-character lowercase hex string.");
  }

  const findings = normalizeFindings(submission.findings);

  return {
    tool,
    clawlockVersion,
    adapter,
    adapterVersion,
    score: Math.round(score),
    grade,
    nickname,
    deviceFingerprint,
    evidenceHash,
    clientTimestamp: new Date(timestamp).toISOString(),
    findings,
    source: cleanText(meta.source, 64) || "clawlock-rank-skill",
    skillVersion: cleanText(meta.skill_version, 32) || "0.1.0",
  };
}

function normalizeFindings(raw: unknown): NormalizedFinding[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const deduped = raw
    .slice(0, 200)
    .map((item) => {
      if (!isRecord(item)) return null;
      const scanner = cleanText(item.scanner, 64);
      const title = cleanText(item.title, 160);
      const rawLevel = cleanText(item.level, 16).toLowerCase();
      const level = rawLevel === "warn" ? "medium" : rawLevel === "low" ? "info" : rawLevel;

      if (!scanner || !title || !VALID_LEVELS.has(level as ThreatLevel)) {
        return null;
      }

      return {
        findingKey: buildFindingKey(scanner, title),
        scanner,
        level: level as ThreatLevel,
        title,
      };
    })
    .filter((item): item is NormalizedFinding => Boolean(item));

  const seen = new Set<string>();
  return deduped.filter((item) => {
    if (seen.has(item.findingKey)) {
      return false;
    }
    seen.add(item.findingKey);
    return true;
  });
}

function buildFindingKey(scanner: string, title: string): string {
  const cveMatch = title.match(/CVE-\d{4}-\d+/i);
  if (cveMatch) {
    return `cve:${cveMatch[0].toUpperCase()}`;
  }
  return `${scanner}:${slug(title) || unicodeFallback(title)}`;
}

async function getRankForDevice(env: Env, deviceHash: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `
      WITH latest AS (
        SELECT *
        FROM (
          SELECT
            s.*,
            ROW_NUMBER() OVER (
              PARTITION BY s.device_hash
              ORDER BY s.submitted_at DESC, s.id DESC
            ) AS device_row
          FROM submissions s
        )
        WHERE device_row = 1
      ),
      ranked AS (
        SELECT
          device_hash,
          ROW_NUMBER() OVER (
            ORDER BY score DESC, submitted_at DESC, nickname ASC
          ) AS rank
        FROM latest
      )
      SELECT rank
      FROM ranked
      WHERE device_hash = ?
      LIMIT 1
    `,
  )
    .bind(deviceHash)
    .first<{ rank: number }>();

  return row?.rank ?? null;
}

async function checkIpRateLimit(env: Env, ipHash: string): Promise<string | null> {
  if (!ipHash) {
    return null;
  }

  const windowMinutes = readPositiveNumber(env.IP_RATE_LIMIT_WINDOW_MINUTES, 60);
  const maxSubmissions = readPositiveNumber(env.IP_RATE_LIMIT_MAX_SUBMISSIONS, 30);
  if (windowMinutes <= 0 || maxSubmissions <= 0) {
    return null;
  }

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const recent = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM submissions
      WHERE ip_hash = ? AND submitted_at >= ?
    `,
  )
    .bind(ipHash, windowStart)
    .first<{ count: number | string }>();

  const count = Number(recent?.count || 0);
  if (Number.isFinite(count) && count >= maxSubmissions) {
    return "This IP has uploaded too many scores recently. Please try again later.";
  }
  return null;
}

function validateTimestampFreshness(timestamp: string, env: Env): string | null {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return "submission.timestamp must be a valid ISO date.";
  }

  const maxAgeMinutes = readPositiveNumber(env.TIMESTAMP_MAX_AGE_MINUTES, 720);
  const maxFutureMinutes = readPositiveNumber(env.TIMESTAMP_MAX_FUTURE_MINUTES, 10);
  const ageMs = Date.now() - timestampMs;

  if (maxAgeMinutes > 0 && ageMs > maxAgeMinutes * 60 * 1000) {
    return "submission.timestamp is too old. Please upload soon after the scan finishes.";
  }
  if (maxFutureMinutes > 0 && ageMs < -maxFutureMinutes * 60 * 1000) {
    return "submission.timestamp is too far in the future.";
  }
  return null;
}

function json(body: unknown, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request, env),
    },
  });
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const configuredOrigin = normalizeOrigin(env.PUBLIC_ORIGIN || "");
  const requestOrigin = request.headers.get("Origin");
  const allowOrigin = configuredOrigin
    ? requestOrigin === configuredOrigin
      ? requestOrigin
      : configuredOrigin
    : requestOrigin || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return Array.from(normalized).slice(0, maxLength).join("");
}

function cleanHash(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : "";
}

function clampNumber(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function unicodeFallback(value: string): string {
  return Array.from(value.normalize("NFKC"))
    .slice(0, 16)
    .map((char) => char.codePointAt(0)?.toString(16).padStart(4, "0") || "")
    .join("")
    .slice(0, 80) || "item";
}

function extractIp(request: Request): string {
  const header = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  return header.split(",")[0]?.trim() || "";
}

async function hashWithSalt(value: string, salt: string): Promise<string> {
  const input = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
