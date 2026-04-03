const APP_CONFIG = window.CLAWLOCK_RANK_CONFIG || {};
const API_BASE = String(APP_CONFIG.apiBase || "").replace(/\/+$/, "");
const REFRESH_INTERVAL = 10000;
const USE_DEMO = new URLSearchParams(window.location.search).get("demo") === "1";
const ENABLE_SSE = Boolean(APP_CONFIG.enableSSE);
const AUTO_SCROLL_INTERVAL_MS = 40;
const AUTO_SCROLL_STEP_PX = 1;
const AUTO_SCROLL_INITIAL_DELAY_MS = 6000;
const AUTO_SCROLL_TOP_PAUSE_MS = 2800;
const AUTO_SCROLL_BOTTOM_PAUSE_MS = 1500;
let autoScrollInterval = null;
let isAutoScrolling = true;
const lastScoreMap = new Map();
const THREAT_LEVEL_META = {
  critical: { chip: "CRITICAL", label: "严重", weight: 4 },
  high: { chip: "HIGH", label: "高危", weight: 3 },
  medium: { chip: "MEDIUM", label: "中危", weight: 2 },
  info: { chip: "INFO", label: "提示", weight: 1 }
};

const DEMO_PAYLOAD = {
  leaderboard: [
    { rank: 1, nickname: "MiSec-Lab", avatar_seed: "MiSec-Lab", score: 98, grade: "S", adapter_version: "1.2.0" },
    { rank: 2, nickname: "ClawShield", avatar_seed: "ClawShield", score: 95, grade: "A", adapter_version: "1.1.9" },
    { rank: 3, nickname: "RedNode", avatar_seed: "RedNode", score: 93, grade: "A", adapter_version: "1.1.8" },
    { rank: 4, nickname: "OrangeAudit", avatar_seed: "OrangeAudit", score: 90, grade: "A", adapter_version: "1.1.8" },
    { rank: 5, nickname: "AgentWall", avatar_seed: "AgentWall", score: 88, grade: "B", adapter_version: "1.1.7" },
    { rank: 6, nickname: "BlueGuard", avatar_seed: "BlueGuard", score: 86, grade: "B", adapter_version: "1.1.7" },
    { rank: 7, nickname: "ZeroLeak", avatar_seed: "ZeroLeak", score: 83, grade: "B", adapter_version: "1.1.6" },
    { rank: 8, nickname: "SandboxOps", avatar_seed: "SandboxOps", score: 81, grade: "B", adapter_version: "1.1.5" }
  ],
  top_vulnerabilities: [
    { name: "Gateway 鉴权未开启", count: 42, level: "critical" },
    { name: "服务暴露 0.0.0.0", count: 31, level: "high" },
    { name: "MCP 远程端点未收敛", count: 24, level: "medium" },
    { name: "凭证目录权限过宽", count: 19, level: "medium" },
    { name: "TLS 未启用", count: 15, level: "info" }
  ]
};

function applyViewScale() {
  const baseWidth = 1760;
  const baseHeight = 1000;
  const container = document.querySelector(".main-container");
  if (!container) return;
  const finalScale = Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight);
  container.style.transform = `scale(${finalScale})`;
}

function avatarUrl(seed) {
  const safeSeed = seed || "default";
  return "https://api.dicebear.com/7.x/bottts/svg?seed=" + encodeURIComponent(safeSeed) + "&backgroundColor=transparent&scale=85&translateY=5";
}

function versionLabel(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.startsWith("v") ? text : `v${text}`;
}

function entryName(entry) {
  return entry.nickname || entry.username || "Anonymous";
}

function normalizeThreats(data) {
  const root = Array.isArray(data.top_vulnerabilities) ? data.top_vulnerabilities : [];
  const stats = Array.isArray(data.stats?.top_vulnerabilities) ? data.stats.top_vulnerabilities : [];
  const source = root.length ? root : stats;

  return source
    .map((item, index) => {
      const rawLevel = String(item.level || item.severity || "medium").toLowerCase();
      const normalizedLevel = rawLevel === "warn" ? "medium" : rawLevel === "low" ? "info" : rawLevel;
      const levelMeta = THREAT_LEVEL_META[normalizedLevel] || THREAT_LEVEL_META.medium;

      return {
        originalRank: index + 1,
        name: item.name || item.title || item.key || item.id || `漏洞热点 ${index + 1}`,
        count: item.count || item.users || item.occurrences || 0,
        level: normalizedLevel,
        chip: levelMeta.chip,
        label: levelMeta.label,
        weight: levelMeta.weight
      };
    })
    .sort((left, right) => (right.count - left.count) || (right.weight - left.weight) || (left.originalRank - right.originalRank))
    .slice(0, 5)
    .map((item, index) => ({
      rank: index + 1,
      name: item.name,
      count: item.count,
      level: item.level,
      chip: item.chip,
      label: item.label
    }));
}

function renderThreats(threats) {
  const container = document.getElementById("threats");
  if (!container) return;
  if (!threats.length) {
    container.innerHTML = '<div class="state-container short state-card-empty"><div>安全热点正在汇聚中</div></div>';
    return;
  }

  container.innerHTML = threats.map((item) => `
    <article class="threat-card level-${item.level}">
      <div class="threat-rank">TOP ${item.rank}</div>
      <div class="threat-signal">
        <span class="threat-dot"></span>
        <span class="threat-label">${item.label}</span>
      </div>
      <div class="threat-name">${item.name}</div>
      <div class="threat-meta">
        <div class="threat-impact">
          <span class="threat-count">${item.count}</span>
        </div>
        <span class="threat-level level-${item.level}">${item.chip}</span>
      </div>
    </article>
  `).join("");
}

function fitPodiumNames() {
  document.querySelectorAll(".pb-name").forEach((element) => {
    const maxFont = 32;
    const minFont = 16;
    let fontSize = maxFont;

    element.style.fontSize = `${fontSize}px`;
    element.style.transform = "scaleX(1)";

    while (element.scrollWidth > element.clientWidth && fontSize > minFont) {
      fontSize -= 1;
      element.style.fontSize = `${fontSize}px`;
    }

    if (element.scrollWidth > element.clientWidth) {
      const scale = Math.max(0.72, element.clientWidth / element.scrollWidth);
      element.style.transform = `scaleX(${scale})`;
    }
  });
}

function renderLeaderboard(entries) {
  const podium = document.getElementById("podium");
  const rows = document.getElementById("rows");
  if (!podium || !rows) return;

  if (!entries.length) {
    podium.innerHTML = '<div class="state-container"><div style="font-size:3rem;margin-bottom:10px;opacity:.5">🏆</div><div>还没有体检成绩，去做一次安全体检与加固吧</div></div>';
    rows.innerHTML = '<div class="state-container short state-card-empty"><div>更多成绩正在汇聚中</div></div>';
    return;
  }

  const arrangedTop3 = entries.length >= 3 ? [entries[1], entries[0], entries[2]] : entries;
  const isInitialRender = lastScoreMap.size === 0;
  const rankInfo = (entry) => entry.rank === 1
    ? { className: "rank-1", crown: "👑" }
    : entry.rank === 2
      ? { className: "rank-2", crown: "" }
      : { className: "rank-3", crown: "" };

  podium.innerHTML = arrangedTop3.map((entry) => {
    const meta = rankInfo(entry);
    const name = entryName(entry);
    return `
      <div class="podium-block ${meta.className}">
        <div class="pb-avatar-wrap">
          ${meta.crown ? `<div class="pb-crown">${meta.crown}</div>` : ""}
          <img class="pb-avatar" src="${avatarUrl(entry.avatar_seed || name)}" alt="${name}" title="${name}">
        </div>
        <div class="pb-pillar">
          <div class="pb-name">${name}</div>
          <div class="pb-score">${entry.score}</div>
        </div>
      </div>
    `;
  }).join("");

  rows.innerHTML = entries.map((entry) => {
    const name = entryName(entry);
    const version = versionLabel(entry.adapter_version || entry.version);
    const previousScore = lastScoreMap.get(name);
    const isUpdated = !isInitialRender && previousScore !== undefined && previousScore !== entry.score;
    return `
      <div class="list-row ${isUpdated ? "score-updated" : ""}" data-user="${name}">
        <div class="lb-rank">${entry.rank}</div>
        <div class="lb-userinfo">
          <img class="lb-avatar" src="${avatarUrl(entry.avatar_seed || name)}" alt="${name}">
          <div class="lb-meta">
            <div class="lb-name">${name}</div>
            <div class="lb-subline">
              ${version ? `<span class="version-tag">${version}</span>` : ""}
            </div>
          </div>
        </div>
        <div class="lb-score-wrap">
          <div class="lb-score ${isUpdated ? "score-updated" : ""}">${entry.score}</div>
          <div class="lb-grade grade-${entry.grade || "B"}">等级 ${entry.grade || "B"}</div>
        </div>
      </div>
    `;
  }).join("");

  lastScoreMap.clear();
  entries.forEach((entry) => lastScoreMap.set(entryName(entry), entry.score));

  requestAnimationFrame(fitPodiumNames);
}

function showError(message) {
  const podium = document.getElementById("podium");
  const rows = document.getElementById("rows");
  const threats = document.getElementById("threats");
  if (podium) podium.innerHTML = '<div class="state-container"><div>⚠️ 无法加载数据</div></div>';
  if (rows) rows.innerHTML = `<div class="state-container short"><div>⚠️ ${message}</div></div>`;
  if (threats) threats.innerHTML = `<div class="state-container short"><div>⚠️ ${message}</div></div>`;
}

async function fetchLeaderboard() {
  if (USE_DEMO) {
    renderLeaderboard(DEMO_PAYLOAD.leaderboard);
    renderThreats(normalizeThreats(DEMO_PAYLOAD));
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/scores`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rows = document.getElementById("rows");
    const oldScrollTop = rows.scrollTop;
    renderLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
    renderThreats(normalizeThreats(data));
    rows.scrollTop = oldScrollTop;
  } catch (error) {
    console.error("排行榜加载失败:", error);
    showError(error.message);
  }
}

function connectSSE() {
  if (!ENABLE_SSE) return;
  try {
    const es = new EventSource(`${API_BASE}/api/scores/stream`);
    es.addEventListener("update", () => fetchLeaderboard());
    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 3000);
    };
  } catch {}
}

function startAutoScroll() {
  const container = document.getElementById("rows");
  if (!container) return;
  container.scrollTop = 0;
  isAutoScrolling = false;
  if (autoScrollInterval) clearInterval(autoScrollInterval);
  autoScrollInterval = setInterval(() => {
    if (!isAutoScrolling) return;
    container.scrollTop += AUTO_SCROLL_STEP_PX;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1) {
      isAutoScrolling = false;
      setTimeout(() => {
        container.scrollTop = 0;
        setTimeout(() => { isAutoScrolling = true; }, AUTO_SCROLL_TOP_PAUSE_MS);
      }, AUTO_SCROLL_BOTTOM_PAUSE_MS);
    }
  }, AUTO_SCROLL_INTERVAL_MS);

  setTimeout(() => {
    isAutoScrolling = true;
  }, AUTO_SCROLL_INITIAL_DELAY_MS);

  container.addEventListener("mouseenter", () => { isAutoScrolling = false; });
  container.addEventListener("mouseleave", () => { isAutoScrolling = true; });
  container.addEventListener("touchstart", () => { isAutoScrolling = false; });
  container.addEventListener("touchend", () => { isAutoScrolling = true; });
}

function initBackgroundCanvas() {
  const canvas = document.getElementById("wave-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let width;
  let height;
  let nodes = [];

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    nodes = [];
    for (let y = 0; y < height; y += 92) {
      for (let x = 0; x < width; x += 96) {
        nodes.push({
          x,
          y,
          baseX: x + rand(-20, 20),
          baseY: y + rand(-16, 16),
          phase: rand(0, Math.PI * 2),
          size: rand(0.8, 2.4)
        });
      }
    }
  }

  function drawMesh(time) {
    ctx.fillStyle = "rgba(3, 8, 14, 0.34)";
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < nodes.length; i += 1) {
      const nodeA = nodes[i];
      const ax = nodeA.baseX + Math.sin(time + nodeA.phase) * 10;
      const ay = nodeA.baseY + Math.cos(time * 0.8 + nodeA.phase) * 8;

      for (let j = i + 1; j < nodes.length; j += 1) {
        const nodeB = nodes[j];
        if (Math.abs(nodeA.x - nodeB.x) > 110 || Math.abs(nodeA.y - nodeB.y) > 110) continue;
        const bx = nodeB.baseX + Math.sin(time + nodeB.phase) * 10;
        const by = nodeB.baseY + Math.cos(time * 0.8 + nodeB.phase) * 8;
        const dx = bx - ax;
        const dy = by - ay;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 118) continue;
        const alpha = Math.max(0, 0.16 - dist / 900);
        ctx.strokeStyle = `rgba(54, 214, 255, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(ax, ay, nodeA.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(54, 214, 255, ${0.45 + nodeA.size * 0.08})`;
      ctx.fill();
    }

    const sweepX = (time * 130) % (width + 260) - 180;
    const gradient = ctx.createLinearGradient(sweepX - 140, 0, sweepX + 140, 0);
    gradient.addColorStop(0, "rgba(54,214,255,0)");
    gradient.addColorStop(0.5, "rgba(54,214,255,0.08)");
    gradient.addColorStop(1, "rgba(54,214,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(sweepX - 140, 0, 280, height);
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    drawMesh(time);
    requestAnimationFrame(() => draw(performance.now() * 0.001));
  }

  resize();
  window.addEventListener("resize", resize);
  draw(0);
}

window.addEventListener("resize", applyViewScale);
window.addEventListener("resize", () => {
  requestAnimationFrame(fitPodiumNames);
});
applyViewScale();
initBackgroundCanvas();
fetchLeaderboard();
setInterval(fetchLeaderboard, REFRESH_INTERVAL);
connectSSE();
setTimeout(startAutoScroll, 600);
