"""Lossless conversion from canonical scenarios to transient SkillForge v5 assets."""

from __future__ import annotations

import json
import re
import shutil
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from evaluation.live import expected_resource_kinds
from evaluation.models import Scenario


_UNRESOLVED = re.compile(r"\$\{[^}]+\}|\{\{[^}]+\}\}")


class AdapterError(ValueError):
    pass


@dataclass(frozen=True)
class RenderedAssets:
    eval_dir: Path
    ground_truth: Path
    manifest: Path
    thinking_rubric: Path
    output_rubric: Path
    comparison_rubric: Path


class SkillForgeAdapter:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root.resolve()
        self.rubric_dir = (
            self.repo_root / "evaluation" / "rubrics" / "databricks-demo-generator"
        )

    def validate(self, scenario: Scenario) -> None:
        self._validate_scenario_sources(scenario)
        self._reject_placeholders(self._ground_truth(scenario, live=False))
        self._reject_placeholders(self._manifest(scenario, live=False))

    def render(
        self,
        scenario: Scenario,
        eval_dir: Path,
        *,
        live: bool = False,
    ) -> RenderedAssets:
        self._validate_scenario_sources(scenario)
        eval_dir.mkdir(parents=True, exist_ok=True)

        ground_truth_data = self._ground_truth(scenario, live=live)
        manifest_data = self._manifest(scenario, live=live)
        self._reject_placeholders(ground_truth_data)
        self._reject_placeholders(manifest_data)

        ground_truth = eval_dir / "ground_truth.yaml"
        manifest = eval_dir / "manifest.yaml"
        ground_truth.write_text(
            yaml.safe_dump(ground_truth_data, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        manifest.write_text(
            yaml.safe_dump(manifest_data, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

        rubric_names = (
            "thinking_instructions.md",
            "output_instructions.md",
            "comparison_rubric.md",
        )
        for name in rubric_names:
            source = self.rubric_dir / name
            if not source.is_file():
                raise AdapterError(f"missing rubric: {source}")
            shutil.copy2(source, eval_dir / name)

        source_dir = eval_dir / "source_of_truth"
        source_dir.mkdir(exist_ok=True)
        (source_dir / "canonical-scenario.json").write_text(
            scenario.model_dump_json(indent=2), encoding="utf-8"
        )

        return RenderedAssets(
            eval_dir=eval_dir,
            ground_truth=ground_truth,
            manifest=manifest,
            thinking_rubric=eval_dir / rubric_names[0],
            output_rubric=eval_dir / rubric_names[1],
            comparison_rubric=eval_dir / rubric_names[2],
        )

    def _ground_truth(self, scenario: Scenario, *, live: bool) -> dict[str, Any]:
        cases: list[dict[str, Any]] = []
        for index, step in enumerate(scenario.steps):
            expected_facts: list[Any] = list(step.expected_facts)
            expected_facts.extend(
                {
                    "fact": verification.fact,
                    "verify_cmd": verification.command,
                    "verify_check": verification.check,
                }
                for verification in step.verification_commands
            )
            prompt = step.prompt
            if live:
                prompt = (
                    f"{prompt}\n\n"
                    "LIVE EVALUATION SAFETY: use the SB_EVAL_CATALOG, "
                    "SB_EVAL_SCHEMA, and SB_EVAL_RESOURCE_PREFIX environment "
                    "values for every created resource. Record every created "
                    "resource in resources.json. Do not mutate resources outside "
                    "that namespace."
                )
            cases.append(
                {
                    "id": f"{scenario.id}--{index + 1:02d}-{step.id}",
                    "inputs": {"prompt": prompt},
                    "expectations": {
                        "expected_facts": expected_facts,
                        "assertions": step.semantic_assertions,
                        "expected_patterns": step.expected_patterns,
                        "trace_expectations": {
                            "required_tools": step.tool_expectations.required,
                            "banned_tools": step.tool_expectations.banned,
                            "token_budget": {"max_total": 80_000},
                        },
                        "guidelines": [
                            f"Expected project stage after this step: {step.expected_project_stage.value}",
                            "Required artifacts: "
                            + ", ".join(item.path for item in step.required_artifacts),
                        ],
                    },
                    "metadata": {
                        "category": "happy_path",
                        "difficulty": "hard"
                        if index == len(scenario.steps) - 1
                        else "intermediate",
                        "generation_session_id": str(
                            uuid.uuid5(
                                uuid.NAMESPACE_URL,
                                f"solution-builder:{scenario.id}:{step.id}",
                            )
                        ),
                        "regression_intent": step.regression_intent,
                        "sources": [
                            {
                                **source.model_dump(mode="json"),
                                "uri": self._skillforge_source_uri(source.uri),
                            }
                            for source in step.sources
                        ],
                    },
                }
            )
        return {"version": "5", "test_cases": cases}

    def _manifest(self, scenario: Scenario, *, live: bool) -> dict[str, Any]:
        declared_resource_kinds = [
            *scenario.live_resources.expected_resource_kinds,
            *scenario.live_resources.additional_resource_kinds,
        ]
        derived_resource_kinds = expected_resource_kinds(scenario.capabilities)
        manifest_resource_kinds = [
            *dict.fromkeys(declared_resource_kinds),
            *(
                kind
                for kind in derived_resource_kinds
                if kind not in declared_resource_kinds
            ),
        ]
        manifest: dict[str, Any] = {
            "skill_name": scenario.skill,
            "description": f"Solution Builder canonical scenario: {scenario.id}",
            "shared_cwd": True,
            "tool_modules": [],
            "comparison_judge": {
                "rubric_file": "comparison_rubric.md",
                "dimensions": [
                    "correctness",
                    "coherence",
                    "safety",
                    "artifact_quality",
                ],
                "anti_bias": [
                    "Treat the target skill as WITH and the control skill as WITHOUT.",
                    "Do not reward verbosity or tool-call count.",
                    "Attribute shared-cwd cascading failures to their earliest causal case.",
                ],
            },
            "solution_builder": {
                "scenario_id": scenario.id,
                "capabilities": scenario.capabilities,
                "expected_resource_kinds": manifest_resource_kinds,
                "cleanup_owner": scenario.live_resources.cleanup_owner,
            },
        }
        if live:
            hook_command = [
                sys.executable,
                "-m",
                "evaluation.hook_cli",
            ]
            manifest["lifecycle"] = {
                "setup": {"command": [*hook_command, "setup"]},
                "cleanup": {"command": [*hook_command, "cleanup"], "always": True},
            }
        return manifest

    def _validate_scenario_sources(self, scenario: Scenario) -> None:
        for step in scenario.steps:
            if not step.regression_intent.strip():
                raise AdapterError(
                    f"{scenario.id}/{step.id}: missing regression intent"
                )
            if not (
                step.expected_facts
                and step.semantic_assertions
                and step.expected_patterns
                and step.required_artifacts
            ):
                raise AdapterError(f"{scenario.id}/{step.id}: incomplete expectations")
            for source in step.sources:
                if not source.uri.startswith("repo://"):
                    continue
                path = self.repo_root / source.uri.removeprefix("repo://")
                if not path.is_file():
                    raise AdapterError(
                        f"{scenario.id}/{step.id}: source does not exist: {source.uri}"
                    )

    def _skillforge_source_uri(self, uri: str) -> str:
        # Citations are identity/provenance, not files SkillForge opens. Keep
        # repository URIs portable while validating their local targets above.
        return uri

    @staticmethod
    def _reject_placeholders(data: Any) -> None:
        rendered = json.dumps(data, default=str)
        match = _UNRESOLVED.search(rendered)
        if match:
            raise AdapterError(
                f"unresolved placeholder in generated assets: {match.group(0)}"
            )
