"""Canonical, runner-neutral evaluation contracts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


STAGE_ORDER = (
    "DRAFTING",
    "SUMMARIZED",
    "ARCHITECTED",
    "SPECIFICATION",
    "BUILT",
    "BUNDLED",
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectStage(StrEnum):
    DRAFTING = "DRAFTING"
    SUMMARIZED = "SUMMARIZED"
    ARCHITECTED = "ARCHITECTED"
    SPECIFICATION = "SPECIFICATION"
    BUILT = "BUILT"
    BUNDLED = "BUNDLED"


class SourceCitation(StrictModel):
    type: Literal["docs", "blog", "glean", "confluence", "slack", "github", "manual"]
    uri: str = Field(min_length=1)
    title: str = Field(min_length=1)
    retrieved_at: datetime
    snippet: str = Field(min_length=1, max_length=280)


class ArtifactExpectation(StrictModel):
    path: str = Field(min_length=1)
    description: str = Field(min_length=1)
    required: bool = True


class VerificationCommand(StrictModel):
    fact: str = Field(min_length=1)
    command: str = Field(min_length=1)
    check: str = Field(min_length=1)


class ToolExpectations(StrictModel):
    required: list[str] = Field(default_factory=list)
    banned: list[str] = Field(default_factory=list)


class ScenarioStep(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    prompt: str = Field(min_length=1)
    expected_project_stage: ProjectStage
    required_artifacts: list[ArtifactExpectation] = Field(min_length=1)
    semantic_assertions: list[str] = Field(min_length=1)
    expected_facts: list[str] = Field(min_length=1)
    expected_patterns: list[str] = Field(min_length=1)
    tool_expectations: ToolExpectations
    verification_commands: list[VerificationCommand] = Field(default_factory=list)
    regression_intent: str = Field(min_length=1)
    sources: list[SourceCitation] = Field(min_length=1)


class LiveResourceExpectations(StrictModel):
    cleanup_owner: Literal["solution-builder"] = "solution-builder"
    expected_resource_kinds: list[str] = Field(default_factory=list)
    additional_resource_kinds: list[str] = Field(default_factory=list)
    evaluation_prefix: str = Field(default="sb_eval_", pattern=r"^[a-z][a-z0-9_]*_$")


class Scenario(StrictModel):
    schema_version: Literal[1] = 1
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    skill: str = Field(min_length=1)
    description: str = Field(min_length=1)
    capabilities: list[str] = Field(min_length=1)
    timeout_seconds: int = Field(ge=60, le=14_400)
    target_stage: ProjectStage
    steps: list[ScenarioStep] = Field(min_length=1)
    live_resources: LiveResourceExpectations

    @model_validator(mode="after")
    def validate_workflow(self) -> "Scenario":
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("step ids must be unique")
        stages = [
            STAGE_ORDER.index(step.expected_project_stage.value) for step in self.steps
        ]
        if stages != sorted(stages):
            raise ValueError("step stages must be ordered monotonically")
        if self.steps[-1].expected_project_stage != self.target_stage:
            raise ValueError("the final step stage must equal target_stage")
        return self

    @property
    def initial_prompt(self) -> str:
        return self.steps[0].prompt

    @property
    def drive_messages(self) -> list[str]:
        return [step.prompt for step in self.steps[1:]]


class EvalModels(StrictModel):
    agent: str | None = None
    judge: str | None = None


class EvalScore(StrictModel):
    name: str
    value: float | None = None
    side: Literal["with", "without", "comparison"] = "comparison"


class EvalGap(StrictModel):
    code: str
    message: str
    level: str | None = None
    side: Literal["with", "without", "comparison"] = "comparison"


class EvalResource(StrictModel):
    resource_type: str
    resource_id: str
    name: str | None = None
    side: Literal["with", "without"] | None = None
    source: str
    removed: bool = False


class CleanupStatus(StrictModel):
    attempted: bool = False
    complete: bool = False
    deleted: list[str] = Field(default_factory=list)
    remaining: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    leak_report: str | None = None


class MlflowIdentity(StrictModel):
    experiment_id: str | None = None
    run_ids: list[str] = Field(default_factory=list)
    trace_ids: list[str] = Field(default_factory=list)


class EvalRun(StrictModel):
    schema_version: Literal[1] = 1
    run_id: str
    runner: Literal["skillforge"] = "skillforge"
    scenario_id: str
    git_sha: str
    skill_hash: str
    skillforge_version: str
    skillforge_revision: str
    levels: list[str]
    models: EvalModels
    scores: list[EvalScore] = Field(default_factory=list)
    gaps: list[EvalGap] = Field(default_factory=list)
    resources: list[EvalResource] = Field(default_factory=list)
    cleanup: CleanupStatus = Field(default_factory=CleanupStatus)
    mlflow: MlflowIdentity = Field(default_factory=MlflowIdentity)
    reports: dict[str, str] = Field(default_factory=dict)
    status: Literal["passed", "failed", "invalid_eval", "leaked"]
    started_at: datetime
    completed_at: datetime
    raw_result: dict[str, Any] = Field(default_factory=dict)
