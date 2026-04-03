CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  submitted_at TEXT NOT NULL,
  client_timestamp TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  tool TEXT NOT NULL,
  clawlock_version TEXT NOT NULL,
  adapter TEXT NOT NULL,
  adapter_version TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  domain_scores_json TEXT NOT NULL,
  domain_grades_json TEXT NOT NULL,
  source TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  evidence_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_device_time
  ON submissions (device_hash, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_score_time
  ON submissions (score DESC, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_ip_time
  ON submissions (ip_hash, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_evidence_time
  ON submissions (evidence_hash, submitted_at DESC);

CREATE TABLE IF NOT EXISTS submission_findings (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  scanner TEXT NOT NULL,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_findings_submission
  ON submission_findings (submission_id);

CREATE INDEX IF NOT EXISTS idx_submission_findings_key
  ON submission_findings (finding_key, level);

CREATE TABLE IF NOT EXISTS rate_limits (
  device_hash TEXT PRIMARY KEY,
  last_submit_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL
);
