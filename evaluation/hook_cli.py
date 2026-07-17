"""Generic SkillForge lifecycle hook entrypoint (JSON stdin/stdout)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from evaluation.live import (
    DatabricksCliCleaner,
    LiveNamespace,
    LivePolicy,
    ResourceCleaner,
    reconcile_resources,
    resources_from_manifest,
    resources_from_tracked,
    write_leak_report,
)


def _read_context() -> dict[str, Any]:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("lifecycle context must be a JSON object")
    required = {"run_id", "case_id", "side", "cwd", "project_dir", "tracked_resources"}
    missing = sorted(required - payload.keys())
    if missing:
        raise ValueError(f"lifecycle context missing: {', '.join(missing)}")
    return payload


def setup(context: dict[str, Any]) -> dict[str, Any]:
    prefix = os.environ.get("SB_EVAL_PREFIX", "sb_eval_")
    policy = LivePolicy.from_env(prefix)
    namespace = LiveNamespace.allocate(
        run_id=str(context["run_id"]),
        case_id=str(context["case_id"]),
        side=str(context["side"]),
        evaluation_prefix=prefix,
    )
    policy.validate_namespace(namespace)
    run_context = {
        **context,
        "namespace": namespace.__dict__,
        "profile": policy.profile,
        "host": policy.host,
    }
    context_path = Path(context["cwd"]) / ".skillforge" / "run-context.json"
    context_path.parent.mkdir(parents=True, exist_ok=True)
    context_path.write_text(json.dumps(run_context, indent=2), encoding="utf-8")
    return {
        "run_context_file": str(context_path),
        "environment": namespace.environment(policy.profile, policy.host),
    }


def cleanup(context: dict[str, Any]) -> dict[str, Any]:
    prefix = os.environ.get("SB_EVAL_PREFIX", "sb_eval_")
    policy = LivePolicy.from_env(prefix)
    manifest_resources = resources_from_manifest(
        Path(context["cwd"]) / "resources.json", side=str(context["side"])
    )
    tracked_resources = resources_from_tracked(context.get("tracked_resources") or [])
    resources = reconcile_resources(manifest_resources, tracked_resources)
    backend = DatabricksCliCleaner(policy)
    report = ResourceCleaner(
        backend.delete, backend.exists, retries=3, retry_delay=1
    ).cleanup(resources)
    leak_path = Path(context["cwd"]) / ".skillforge" / "leak-report.json"
    write_leak_report(leak_path, report, resources)
    result = {
        "complete": report.complete,
        "deleted": report.deleted,
        "remaining": report.remaining,
        "errors": report.errors,
        "leak_report": str(leak_path),
    }
    if not report.complete:
        print(json.dumps(result))
        raise SystemExit(1)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("setup", "cleanup"))
    args = parser.parse_args(argv)
    context = _read_context()
    result = setup(context) if args.action == "setup" else cleanup(context)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
