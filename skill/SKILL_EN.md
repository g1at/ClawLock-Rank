---
name: clawlock-rank
description: >
  A leaderboard upload skill built from ClawLock inspection results.
  Trigger only when the user explicitly wants to upload a security score or submit an inspection result to ClawLockRank.
  Do not trigger for general local inspections, normal Claw usage, debugging, or leaderboard browsing without upload intent.
version: 1.0.0
metadata:
  openclaw:
    emoji: "🦞"
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

A leaderboard upload skill built from ClawLock inspection results. It is intended for the “run locally, then optionally upload the result” workflow.

[中文版本 → SKILL.md](SKILL.md)

## Trigger boundary

Trigger this skill only when the user explicitly wants to upload a leaderboard result, for example:

- upload security score
- upload inspection result
- submit leaderboard score
- sync my score to ClawLockRank

Do not trigger this skill when the user only wants to:

- run a local security inspection
- browse the leaderboard
- use Claw normally
- debug, develop, or install dependencies

If the user only asks to start a security inspection, prefer the main ClawLock skill.

## Privacy and upload scope

This skill runs `clawlock scan --format json` **locally first** and uploads only after explicit confirmation.

The upload allowlist is limited to:

- `tool`
- `clawlock_version`
- `adapter`
- `adapter_version`
- `device_fingerprint`
- `evidence_hash`
- `score`
- `grade`
- `nickname`
- `findings[].scanner`
- `findings[].level`
- `findings[].title`
- `timestamp`

It does **not** upload:

- raw configuration files
- remediation text
- local file paths / `location`
- environment variables
- the full raw scan report
- `scan_history.json`

Device fingerprint notes:

- the raw `device_fingerprint` is sent only to the leaderboard Worker
- the Worker hashes it server-side with a salt before storage
- the frontend never shows the raw fingerprint publicly

## Recommended workflow

In Claw / ClawHub usage, treat the scripts as backend executors and let the model handle the conversation. Do not rely on the scripts themselves to ask the user questions.

Recommended order:

1. Run the preview command first:

```bash
python scripts/submit_score.py --preview-only
```

2. Read the preview JSON and explain to the user:
   - score
   - grade
   - adapter and version
   - finding count
   - exact fields that would be uploaded
3. Tell the user that the leaderboard will publicly show a nickname, then ask which nickname to display
   - use `Anonymous` if blank
4. Ask whether the user wants to upload
5. Upload only after explicit confirmation:

```bash
python scripts/upload.py --input <payload_path> --nickname "<nickname>" --yes
```

Use the `payload_path` returned by the preview step.

For direct terminal usage, this one-shot entrypoint still works:

```bash
python scripts/submit_score.py
```

It reads the default backend URL from `skill/config.json`, and also respects `CLAWLOCK_RANK_API_BASE`.

## Server-side anti-abuse rules

The backend additionally enforces:

- a default 24-hour device cooldown
- upload timestamp freshness checks
- a separate IP-based rate limit
- leaderboard and vulnerability stats based on the latest valid result per device

## Failure handling

- If `clawlock` is not installed, tell the user to install ClawLock first
- If the scan fails, show the scan error clearly
- If the user declines the upload, clearly state that nothing was sent
- If the upload fails, show the Worker response clearly
