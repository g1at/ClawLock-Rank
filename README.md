# ClawLockRank

[中文说明](./README.zh-CN.md)

ClawLockRank is a leaderboard project built from ClawLock inspection results, with a GitHub Pages frontend, a lightweight Cloudflare Worker backend, and a local upload skill.

## Architecture

```mermaid
flowchart LR
  A["OpenClaw user"] --> B["skill/scripts/submit_score.py"]
  B --> C["clawlock scan --format json"]
  C --> B
  B --> D["Cloudflare Worker"]
  D --> E["Cloudflare D1"]
  F["GitHub Pages UI"] --> D
```

## Repo layout

```text
.
|- index.html
|- app.js
|- styles.css
|- config.js
|- assets/
|- skill/
|  |- SKILL.md
|  |- SKILL.zh-CN.md
|  `- scripts/
|     |- run_scan.py
|     |- upload.py
|     `- submit_score.py
`- worker/
   |- schema.sql
   |- wrangler.toml
   `- src/index.ts
```

## Frontend

The static dashboard is wired to call `GET /api/scores`.
This repository also includes a GitHub Pages workflow at `.github/workflows/deploy-pages.yml`.

Edit [config.js](./config.js) before publishing:

```js
window.CLAWLOCK_RANK_CONFIG = {
  apiBase: "https://your-worker-domain.workers.dev",
  enableSSE: false
};
```

Notes:

- `enableSSE` is off by default because the starter Worker only supports polling.
- The page already polls every 10 seconds.
- The Pages workflow publishes only the static frontend files and `assets/`.

## Worker setup

1. Install Worker dependencies:

```bash
cd worker
npm install
```

2. Create a D1 database.
3. Copy `.dev.vars.example` to `.dev.vars` if you want to use `wrangler dev`.
4. Apply `worker/schema.sql`.
5. Update `worker/wrangler.toml`:
   - set `database_id`
   - set `PUBLIC_ORIGIN` to your site origin, for example `https://g1at.github.io`
6. Set a real salt:

```bash
cd worker
wrangler secret put DEVICE_HASH_SALT
```

7. Deploy:

```bash
cd worker
wrangler d1 execute clawlock-rank --file=./schema.sql
wrangler deploy
```

If `wrangler deploy` asks for a `workers.dev` subdomain, complete the onboarding in the Cloudflare dashboard first, then rerun the deploy command.

## Local Worker development

```bash
cd worker
npm run dev
```

## Worker API

### `POST /api/submit`

Accepts:

```json
{
  "submission": {
    "tool": "ClawLock",
    "clawlock_version": "1.3.0",
    "adapter": "OpenClaw",
    "adapter_version": "1.1.9",
    "device_fingerprint": "device-fingerprint-from-scan",
    "score": 95,
    "grade": "A",
    "nickname": "MiSec-Lab",
    "findings": [
      {
        "scanner": "config",
        "level": "critical",
        "title": "Gateway auth disabled"
      }
    ],
    "timestamp": "2026-04-03T12:00:00Z"
  },
  "meta": {
    "source": "clawlock-rank-skill",
    "skill_version": "0.1.0"
  }
}
```

Returns the accepted score plus the current rank for the device.

### `GET /api/scores`

Returns:

```json
{
  "leaderboard": [],
  "top_vulnerabilities": [],
  "stats": {
    "top_vulnerabilities": []
  }
}
```

Aggregation rules:

- leaderboard keeps the latest valid submission per device
- ranking sorts by `score desc`, then newest submission
- Top 5 vulnerabilities count unique devices from their latest submission

## Skill usage

This project does not depend on `~/.clawlock/scan_history.json`.

Recommended one-shot workflow:

```bash
python skill/scripts/submit_score.py --api-base https://your-worker-domain.workers.dev
```

This command:

- runs the scan locally
- strips the payload down to the fields the leaderboard actually needs
- shows the user a preview of the public upload data
- uploads only after explicit confirmation

Advanced two-step workflow:

```bash
python skill/scripts/run_scan.py --adapter openclaw --output ./clawlock-rank-payload.json
python skill/scripts/upload.py --input ./clawlock-rank-payload.json --api-base https://your-worker-domain.workers.dev
```

You can also set `CLAWLOCK_RANK_API_BASE` to avoid repeating the Worker origin.

## Data handling

- The client sends the raw device fingerprint only to the Worker.
- The Worker hashes the fingerprint with a server salt before storage.
- The upload scripts whitelist only the fields needed for ranking and vulnerability aggregation.
- The frontend only displays the nickname, derived avatar seed, score, and aggregated vulnerability stats.
- Raw configs, remediation text, file paths, environment variables, and the full raw report are not uploaded.
- `scan_history.json` is intentionally not used because it does not preserve the full findings list.
