# ClawLockRank Upload Skill

[中文版本](./SKILL.zh-CN.md)

Use this skill when the user wants to run a local ClawLock scan and optionally upload the result to the ClawLockRank leaderboard.

## Goal

1. Run `clawlock scan --format json` locally.
2. Build a minimal allowlisted upload payload from the scan output.
3. Show the summary to the user.
4. Upload only after the user explicitly confirms.

## Required behavior

- Do not upload anything without explicit user confirmation.
- Do not modify the upstream `ClawLock` project.
- Do not use `~/.clawlock/scan_history.json`.
- Use `clawlock scan --format json` as the only scan data source.
- Do not upload raw configs, remediation details, file paths, environment variables, or the full raw report.
- The raw device fingerprint may be sent only to the Worker for dedupe and must be hashed server-side before storage.

## Recommended workflow

Use the one-shot helper whenever possible:

```bash
python scripts/submit_score.py --api-base "<worker-url>"
```

It runs the scan, trims the payload to the public allowlist, prompts for a nickname, previews the upload, and only then submits it.
It also respects `CLAWLOCK_RANK_API_BASE`.

Advanced two-step mode:

1. Generate a normalized payload:

```bash
python scripts/run_scan.py --adapter openclaw --output ./clawlock-rank-payload.json
```

2. Read the generated payload and summarize:

- score
- grade
- adapter and adapter version
- finding count
- public fields that will be shown on the leaderboard
- a reminder that sensitive local information is not uploaded

3. Ask the user whether they want to upload the score.

4. If the user agrees, upload the payload:

```bash
python scripts/upload.py --input ./clawlock-rank-payload.json --api-base "<worker-url>" --nickname "<nickname>" --yes
```

If no nickname is provided, use `Anonymous`.

## Allowlisted upload fields

- `tool`
- `clawlock_version`
- `adapter`
- `adapter_version`
- `device_fingerprint`
- `score`
- `grade`
- `nickname`
- `findings[].scanner`
- `findings[].level`
- `findings[].title`
- `timestamp`

## Failure handling

- If `clawlock` is not installed, tell the user to install ClawLock first.
- If the scan fails, surface the command error clearly.
- If the upload fails, show the Worker error response clearly.
