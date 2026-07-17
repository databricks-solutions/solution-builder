"""Pipeline compatibility view over canonical evaluation scenarios.

The durable scenario contract lives in ``evaluation/cases/*.yaml``. This
module keeps the pipeline runner's small dataclass interface while preventing
the E2E harness and SkillForge adapter from drifting onto separate prompts.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from evaluation.cases import load_cases
from evaluation.models import STAGE_ORDER


def stage_index(stage: str) -> int:
    try:
        return STAGE_ORDER.index(stage)
    except ValueError:
        return -1


@dataclass
class Scenario:
    slug: str
    description: str
    capabilities: list[str]
    initial_prompt: str
    drive_messages: list[str] = field(default_factory=list)
    target_stage: str = "BUILT"
    timeout_seconds: int = 60 * 60

    def __post_init__(self) -> None:
        if stage_index(self.target_stage) < 0:
            raise ValueError(f"unknown target_stage: {self.target_stage}")


def _pipeline_scenario(case) -> Scenario:
    return Scenario(
        slug=case.id,
        description=case.description,
        capabilities=list(case.capabilities),
        initial_prompt=case.initial_prompt,
        drive_messages=list(case.drive_messages),
        target_stage=case.target_stage.value,
        timeout_seconds=case.timeout_seconds,
    )


SCENARIOS: list[Scenario] = [_pipeline_scenario(case) for case in load_cases()]


def get_scenarios(slugs: list[str] | None) -> list[Scenario]:
    by_slug = {scenario.slug: scenario for scenario in SCENARIOS}
    selected = list(by_slug) if not slugs else slugs
    unknown = [slug for slug in selected if slug not in by_slug]
    if unknown:
        raise SystemExit(
            f"unknown scenario slug: {unknown[0]!r}. available: {', '.join(by_slug)}"
        )
    # Fixtures override target/timeout in-place, so return independent copies.
    return [
        replace(
            by_slug[slug],
            capabilities=list(by_slug[slug].capabilities),
            drive_messages=list(by_slug[slug].drive_messages),
        )
        for slug in selected
    ]
