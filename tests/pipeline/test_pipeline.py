"""Pytest entry point: run all selected scenarios in parallel and write summary.md.

There is exactly one test, parametrize-free. The fan-out is via asyncio.gather()
inside the test body — pytest-xdist would give us multiple processes against
one backend, which is harder to debug than one event loop driving N projects.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from .runner import ScenarioResult, drive_project
from .scenarios import Scenario


def test_pipeline_e2e(
    selected_scenarios: list[Scenario],
    base_url: str,
    output_dir: Path,
) -> None:
    print(f"\n[pipeline] base_url={base_url}")
    print(f"[pipeline] output_dir={output_dir}")
    print(f"[pipeline] running {len(selected_scenarios)} scenario(s):")
    for s in selected_scenarios:
        print(
            f"  - {s.slug} target={s.target_stage} "
            f"timeout={s.timeout_seconds}s caps={s.capabilities}"
        )

    results = asyncio.run(_run_all(selected_scenarios, base_url, output_dir))
    _write_summary(results, output_dir)

    print(f"\n[pipeline] summary: {output_dir / 'summary.md'}")
    failures = [r for r in results if not r.passed]
    if failures:
        # We still want pytest to report failure, but the harness has already
        # written full per-scenario artifacts so the message stays terse.
        slugs = ", ".join(r.slug for r in failures)
        pytest.fail(
            f"{len(failures)}/{len(results)} scenarios failed: {slugs}. "
            f"see {output_dir / 'summary.md'}",
            pytrace=False,
        )


async def _run_all(
    scenarios: list[Scenario],
    base_url: str,
    output_dir: Path,
) -> list[ScenarioResult]:
    return await asyncio.gather(
        *(drive_project(s, base_url, output_dir) for s in scenarios)
    )


def _write_summary(results: list[ScenarioResult], output_dir: Path) -> None:
    rows = []
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        issues = ", ".join(i.code for i in r.issues) or "—"
        if r.fatal_error:
            issues = f"FATAL: {issues}"
        rows.append(
            f"| {status} | `{r.slug}` | {r.final_stage} | {r.target_stage} | "
            f"{r.elapsed_seconds:.0f}s | {len(r.turns)} | {issues} |"
        )

    header = [
        "# Pipeline test run",
        "",
        f"- output: `{output_dir}`",
        f"- scenarios: {len(results)}",
        f"- passed: {sum(1 for r in results if r.passed)}",
        f"- failed: {sum(1 for r in results if not r.passed)}",
        "",
        "## Results",
        "",
        "| Status | Scenario | Final stage | Target | Elapsed | Turns | Issues |",
        "|---|---|---|---|---|---|---|",
        *rows,
        "",
        "## Per-scenario artifacts",
        "",
    ]
    for r in results:
        header.append(f"- [`{r.slug}/`](./{r.slug}/README.md)")

    (output_dir / "summary.md").write_text("\n".join(header) + "\n", encoding="utf-8")

    # Machine-readable companion for any future tooling.
    (output_dir / "summary.json").write_text(
        json.dumps(
            {
                "passed": sum(1 for r in results if r.passed),
                "failed": sum(1 for r in results if not r.passed),
                "scenarios": [
                    {
                        "slug": r.slug,
                        "passed": r.passed,
                        "final_stage": r.final_stage,
                        "target_stage": r.target_stage,
                        "elapsed_seconds": r.elapsed_seconds,
                        "issues": [i.code for i in r.issues],
                        "fatal": r.fatal_error,
                    }
                    for r in results
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
