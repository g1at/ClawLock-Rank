#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import run_scan
import upload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a local ClawLock scan, preview the safe upload payload, and optionally submit it.",
    )
    parser.add_argument(
        "--api-base",
        default="",
        help="Optional Worker origin override. Defaults to CLAWLOCK_RANK_API_BASE or skill/config.json.",
    )
    parser.add_argument("--nickname", default="", help="Optional public nickname override.")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive confirmation prompt.")
    parser.add_argument("--dry-run", action="store_true", help="Print the sanitized payload and exit.")
    parser.add_argument("--output", default="", help="Optional path to save the sanitized payload JSON.")
    parser.add_argument("--adapter", default="openclaw", help="Adapter passed to clawlock scan.")
    parser.add_argument("--clawlock-bin", default="clawlock", help="Path to the clawlock executable.")
    parser.add_argument(
        "--adapter-bin",
        default="",
        help="Optional adapter executable used to detect adapter version. Defaults to the adapter name.",
    )
    parser.add_argument(
        "--scan-arg",
        action="append",
        default=[],
        help="Extra argument forwarded to clawlock scan. Can be used multiple times.",
    )
    parser.add_argument("--timeout", type=int, default=180, help="Scan timeout in seconds.")
    parser.add_argument("--upload-timeout", type=int, default=15, help="Upload timeout in seconds.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    scan_args = argparse.Namespace(
        adapter=args.adapter,
        output="",
        clawlock_bin=args.clawlock_bin,
        adapter_bin=args.adapter_bin,
        scan_arg=args.scan_arg,
        timeout=args.timeout,
    )
    raw_payload = run_scan.generate_payload(scan_args)

    nickname = args.nickname.strip()
    if not nickname and not args.yes:
        nickname = input("Public nickname [Anonymous]: ").strip()

    sanitized_payload = upload.sanitize_payload(raw_payload, nickname_override=nickname)
    print(json.dumps(upload.build_public_summary(sanitized_payload), ensure_ascii=False, indent=2))
    print(
        "This upload excludes local configuration details, remediation text, file paths, environment variables, "
        "and the full raw report.",
    )

    if args.output:
        write_payload(Path(args.output).expanduser().resolve(), sanitized_payload)

    if args.dry_run:
        print(json.dumps(sanitized_payload, ensure_ascii=False, indent=2))
        return 0

    if not args.yes:
        confirm = input("Upload this score to ClawLockRank? [y/N]: ").strip().lower()
        if confirm not in {"y", "yes"}:
            print(json.dumps({"ok": False, "accepted": False, "message": "Upload cancelled."}, indent=2))
            return 0

    api_base = upload.resolve_api_base(args.api_base)
    if not api_base:
        raise SystemExit("Missing Worker origin. Pass --api-base, set CLAWLOCK_RANK_API_BASE, or add skill/config.json.")

    response = upload.post_payload(
        sanitized_payload,
        api_base=api_base,
        timeout=args.upload_timeout,
    )
    stream = sys.stdout if response["ok"] else sys.stderr
    print(json.dumps(response["body"], ensure_ascii=False, indent=2), file=stream)
    return 0 if response["ok"] else 1


def write_payload(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
