---
name: clawlock-rank
description: >
  A leaderboard upload skill built from ClawLock inspection results.
  Trigger only when the user explicitly wants to upload a security score or submit an inspection result:
  "upload security score", "submit leaderboard score", "upload inspection result", "sync score to ClawLockRank".
  Do NOT trigger for general security scans, debugging, normal Claw usage, or leaderboard browsing without upload intent.
version: 0.1.0
metadata:
  openclaw:
    emoji: "📊"
    homepage: "https://github.com/g1at/ClawLock-Rank"
    skillKey: "clawlock-rank"
    os: [linux, macos, windows]
    requires:
      bins:
        - clawlock
        - python
      anyBins:
        - python3
        - python
      config:
        - config.json
---

# ClawLockRank

A leaderboard upload skill built from ClawLock inspection results. It is meant for the "run locally, then optionally upload the score" flow.

[中文版本 → SKILL.md](SKILL.md)

---

## Install and use

```bash
python scripts/submit_score.py
```

As a Claw Skill, copy this file into the skills directory and then say:

- "upload security score"
- "submit leaderboard score"
- "upload this inspection result"
- "sync my ClawLock score to ClawLockRank"

---

## Privacy statement

This skill runs `clawlock scan --format json` **locally first** and only uploads after explicit user confirmation.

| Scenario | Uploaded fields | Never uploaded |
|----------|-----------------|----------------|
| Leaderboard score upload | `tool`, `clawlock_version`, `adapter`, `adapter_version`, `device_fingerprint`, `score`, `grade`, `nickname`, `findings[].scanner`, `findings[].level`, `findings[].title`, `timestamp` | Raw configs, remediation text, file paths / location, environment variables, the full raw report, `scan_history.json` |

Device fingerprint notes:

- The raw `device_fingerprint` is sent only to the leaderboard Worker
- The Worker hashes it server-side with a salt before storage
- The frontend never shows the raw fingerprint publicly

---

## Trigger boundary

Trigger only when the user explicitly wants to upload a leaderboard result:

| User intent | Trigger? |
|------------|----------|
| Upload score / submit inspection result / sync leaderboard rank | Yes |
| Run a local security inspection without upload intent | No |
| View the leaderboard page | No |
| General Claw debugging / coding / installation work | No |

If the user only asks for a security inspection, prefer the main ClawLock skill. This upload skill should activate only when "upload", "leaderboard", or "submit score" intent is explicit.

---

## Workflow

Once triggered, follow this flow:

1. Run `clawlock scan --format json` locally
2. Trim the result down to the minimal allowlisted payload
3. Show the public preview:
   - score
   - grade
   - adapter and version
   - finding count
   - exact fields that would be uploaded
4. Ask whether the user wants to upload
5. Upload to ClawLockRank only if the user confirms

Default entrypoint:

```bash
python scripts/submit_score.py
```

It reads the default backend URL from `skill/config.json`, and also respects `CLAWLOCK_RANK_API_BASE`.

Advanced two-step mode:

```bash
python scripts/run_scan.py --adapter openclaw --output ./clawlock-rank-payload.json
python scripts/upload.py --input ./clawlock-rank-payload.json
```

---

## Start message

Before starting, print:

```text
📊 ClawLockRank is running a local inspection and preparing a leaderboard upload...
```

---

## Failure handling

- If `clawlock` is not installed, tell the user to install ClawLock first
- If the scan fails, show the command error clearly
- If the user declines the upload, clearly state that the upload was cancelled and nothing was sent
- If the upload fails, show the Worker response clearly
