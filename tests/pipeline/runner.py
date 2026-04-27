"""Drive a single scenario end-to-end and snapshot artifacts.

One drive_project() coroutine per scenario. The harness fans out N of these
inside an asyncio.gather() against a single backend on :9000.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .api_client import AppClient, StreamOutcome
from .assertions import (
    Issue,
    no_error_messages,
    required_artifacts_present,
    stage_at_least,
)
from .scenarios import Scenario, stage_index

log = logging.getLogger(__name__)


@dataclass
class TurnResult:
    message_idx: int
    prompt: str
    execution_id: str | None = None
    stage_after: str = "DRAFTING"
    elapsed_seconds: float = 0.0
    is_error: bool = False
    is_cancelled: bool = False
    sse_event_count: int = 0
    error_text: str | None = None


@dataclass
class ScenarioResult:
    slug: str
    project_id: str | None
    final_stage: str = "DRAFTING"
    target_stage: str = "BUILT"
    elapsed_seconds: float = 0.0
    turns: list[TurnResult] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    fatal_error: str | None = None

    @property
    def passed(self) -> bool:
        return self.fatal_error is None and not self.issues


def _safe_path_segment(rel_path: str) -> str:
    # Don't allow .. and absolute paths to escape; preserve subdirs.
    return rel_path.replace("..", "_").lstrip("/")


async def drive_project(
    scenario: Scenario,
    base_url: str,
    output_dir: Path,
) -> ScenarioResult:
    """Run one scenario end-to-end. Always returns a ScenarioResult, even on
    failure — the harness writes per-scenario artifacts before re-raising
    nothing."""
    scen_dir = output_dir / scenario.slug
    scen_dir.mkdir(parents=True, exist_ok=True)
    events_file = scen_dir / "execution-events.jsonl"

    result = ScenarioResult(
        slug=scenario.slug,
        project_id=None,
        target_stage=scenario.target_stage,
    )
    started_at = time.monotonic()

    try:
        async with AppClient(base_url) as client:
            # 1. Create the project.
            log.info("[%s] creating project", scenario.slug)
            project = await client.create_project(
                description=scenario.description,
                capabilities=scenario.capabilities,
                initial_prompt=scenario.initial_prompt,
            )
            project_id = project["id"]
            result.project_id = project_id
            log.info("[%s] project_id=%s", scenario.slug, project_id)

            # 2. Drive each prompt: invoke_agent → stream → check stage.
            prompts = [scenario.initial_prompt, *scenario.drive_messages]
            for idx, prompt in enumerate(prompts):
                # First prompt was persisted by create_project (initial_prompt) —
                # we still POST /invoke_agent so the agent actually runs against it.
                deadline = started_at + scenario.timeout_seconds
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    result.fatal_error = "scenario timeout exceeded before turn dispatched"
                    break

                turn = TurnResult(message_idx=idx, prompt=prompt)
                turn_started = time.monotonic()
                try:
                    execution_id = await client.invoke_agent(project_id, prompt)
                    turn.execution_id = execution_id
                    log.info(
                        "[%s] turn %d execution_id=%s", scenario.slug, idx, execution_id
                    )

                    outcome = await _stream_with_timeout(
                        client, execution_id, remaining, events_file, scenario.slug, idx
                    )
                    turn.sse_event_count = len(outcome.events)
                    turn.is_error = outcome.is_error
                    turn.is_cancelled = outcome.is_cancelled
                except asyncio.TimeoutError:
                    turn.is_error = True
                    turn.error_text = "stream timed out"
                    # Best-effort cancel so backend doesn't keep burning tokens.
                    if turn.execution_id:
                        await client.stop_stream(turn.execution_id)
                except httpx.HTTPError as e:
                    turn.is_error = True
                    turn.error_text = f"http error: {e!r}"
                except Exception as e:  # noqa: BLE001
                    turn.is_error = True
                    turn.error_text = f"unexpected: {e!r}\n{traceback.format_exc()}"

                turn.elapsed_seconds = time.monotonic() - turn_started

                # Refresh stage after each turn.
                try:
                    proj = await client.get_project(project_id)
                    turn.stage_after = proj.get("stage", "DRAFTING")
                except httpx.HTTPError as e:
                    turn.error_text = (turn.error_text or "") + f"; get_project failed: {e!r}"

                result.turns.append(turn)

                # Early-exit if we've already hit the target stage.
                if stage_index(turn.stage_after) >= stage_index(scenario.target_stage):
                    log.info(
                        "[%s] reached target stage %s after turn %d",
                        scenario.slug, turn.stage_after, idx,
                    )
                    break
                if turn.is_error:
                    log.warning(
                        "[%s] turn %d errored — bailing out", scenario.slug, idx
                    )
                    break

            # 3. Snapshot.
            await _snapshot(client, project_id, scen_dir, result)

    except Exception as e:  # noqa: BLE001
        result.fatal_error = f"{e!r}\n{traceback.format_exc()}"

    result.elapsed_seconds = time.monotonic() - started_at

    # 4. Compute pass/fail and write the per-scenario summary on the way out.
    _finalize(scenario, result, scen_dir)
    return result


async def _stream_with_timeout(
    client: AppClient,
    execution_id: str,
    timeout: float,
    events_file: Path,
    slug: str,
    turn_idx: int,
) -> StreamOutcome:
    outcome = await asyncio.wait_for(
        client.stream_until_done(execution_id, overall_timeout=timeout),
        timeout=timeout,
    )
    # Persist events incrementally per turn so the developer can inspect
    # partial state if a later turn crashes.
    with events_file.open("a", encoding="utf-8") as f:
        for evt in outcome.events:
            f.write(
                json.dumps({"_slug": slug, "_turn": turn_idx, "_execution_id": execution_id, **evt})
                + "\n"
            )
    return outcome


async def _snapshot(
    client: AppClient,
    project_id: str,
    scen_dir: Path,
    result: ScenarioResult,
) -> None:
    """Pull project state, files, and messages — write to disk."""
    files_dir = scen_dir / "files"
    files_dir.mkdir(exist_ok=True)

    try:
        proj = await client.get_project(project_id)
        result.final_stage = proj.get("stage", "DRAFTING")
        (scen_dir / "project.json").write_text(
            json.dumps(proj, indent=2, default=str), encoding="utf-8"
        )
    except httpx.HTTPError as e:
        result.issues.append(Issue("snapshot_project_failed", f"{e!r}"))

    try:
        files = await client.list_files(project_id)
        (scen_dir / "files-index.json").write_text(
            json.dumps(files, indent=2, default=str), encoding="utf-8"
        )
        for f in files:
            try:
                rel = _safe_path_segment(f["path"])
                content = await client.get_file(project_id, f["path"])
                target = files_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content.get("content", ""), encoding="utf-8")
            except httpx.HTTPError as e:
                result.issues.append(
                    Issue("file_dump_failed", f"{f.get('path')!r}: {e!r}")
                )
    except httpx.HTTPError as e:
        result.issues.append(Issue("snapshot_files_failed", f"{e!r}"))

    try:
        messages = await client.list_messages(project_id, limit=500)
        with (scen_dir / "messages.jsonl").open("w", encoding="utf-8") as f:
            for m in messages:
                f.write(json.dumps(m, default=str) + "\n")
    except httpx.HTTPError as e:
        result.issues.append(Issue("snapshot_messages_failed", f"{e!r}"))


def _finalize(scenario: Scenario, result: ScenarioResult, scen_dir: Path) -> None:
    """Run assertions and persist result.json + per-scenario README.md."""
    if result.fatal_error is None:
        result.issues += stage_at_least(result.final_stage, scenario.target_stage)

        try:
            messages = [
                json.loads(line)
                for line in (scen_dir / "messages.jsonl").read_text("utf-8").splitlines()
                if line.strip()
            ]
            result.issues += no_error_messages(messages)
        except FileNotFoundError:
            pass

        try:
            file_paths = [
                f["path"]
                for f in json.loads((scen_dir / "files-index.json").read_text("utf-8"))
            ]
            result.issues += required_artifacts_present(file_paths, scenario.target_stage)
        except FileNotFoundError:
            pass

    (scen_dir / "result.json").write_text(
        json.dumps(_result_to_dict(result), indent=2, default=str),
        encoding="utf-8",
    )

    _write_scenario_readme(scenario, result, scen_dir)


def _result_to_dict(r: ScenarioResult) -> dict[str, Any]:
    d = asdict(r)
    d["passed"] = r.passed
    return d


def _write_scenario_readme(
    scenario: Scenario, result: ScenarioResult, scen_dir: Path
) -> None:
    status = "PASS" if result.passed else "FAIL"
    lines = [
        f"# {scenario.slug} — {status}",
        "",
        f"- final_stage: **{result.final_stage}** (target: {result.target_stage})",
        f"- elapsed: {result.elapsed_seconds:.1f}s",
        f"- project_id: `{result.project_id}`",
        f"- turns: {len(result.turns)}",
        "",
    ]
    if result.fatal_error:
        lines += ["## Fatal error", "```", result.fatal_error, "```", ""]

    if result.issues:
        lines.append("## Issues")
        for iss in result.issues:
            lines.append(f"- **{iss.code}**: {iss.detail}")
        lines.append("")

    lines.append("## Turns")
    for t in result.turns:
        lines.append(
            f"- turn {t.message_idx}: stage={t.stage_after} "
            f"events={t.sse_event_count} elapsed={t.elapsed_seconds:.1f}s "
            f"err={t.is_error} cancelled={t.is_cancelled}"
        )
        if t.error_text:
            lines.append(f"  - error: `{t.error_text}`")
    lines.append("")
    lines.append("## Artifacts")
    lines.append("- `project.json` — final ProjectOut snapshot")
    lines.append("- `files/` — full file tree dumped from the project")
    lines.append("- `files-index.json` — file listing as returned by the API")
    lines.append("- `messages.jsonl` — chat history")
    lines.append("- `execution-events.jsonl` — raw SSE event stream (one row per event)")

    (scen_dir / "README.md").write_text("\n".join(lines), encoding="utf-8")
