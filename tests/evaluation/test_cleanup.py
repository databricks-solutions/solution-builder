from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from evaluation.live import (
    DatabricksCliCleaner,
    LivePolicy,
    ResourceCleaner,
    ResourceRecord,
    expected_resource_kinds,
    reconcile_resources,
    resources_from_manifest,
    resources_from_tracked,
)


def _policy() -> LivePolicy:
    return LivePolicy(
        profile="solution-builder-eval",
        host="https://eval.example.com",
        allowed_hosts=("https://eval.example.com",),
        evaluation_prefix="sb_eval_",
    )


def _completed(
    args: list[str],
    *,
    returncode: int = 0,
    stdout: str = "{}",
    stderr: str = "",
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args, returncode, stdout, stderr)


def _set_live_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_EVAL_DATABRICKS_PROFILE", "solution-builder-eval")
    monkeypatch.setenv("SB_EVAL_ALLOWED_PROFILES", "solution-builder-eval")
    monkeypatch.setenv("SB_EVAL_ALLOWED_HOSTS", " https://eval.example.com/ ")
    monkeypatch.setenv("DATABRICKS_HOST", "https://eval.example.com")


def test_reconcile_deduplicates_and_prefers_skillforge() -> None:
    manifest = ResourceRecord("pipeline", "p1", source="resources.json")
    tracked = ResourceRecord("pipeline", "p1", name="tracked", source="skillforge")
    assert reconcile_resources([manifest], [tracked]) == [tracked]


def test_cleanup_uses_reverse_dependency_order_and_deduplicates() -> None:
    seen: list[str] = []
    existing = {"app:a", "table:t", "catalog:c"}

    def delete(resource: ResourceRecord) -> None:
        seen.append(resource.key)
        existing.remove(resource.key)

    cleaner = ResourceCleaner(delete, lambda resource: resource.key in existing)
    report = cleaner.cleanup(
        [
            ResourceRecord("catalog", "c"),
            ResourceRecord("table", "t"),
            ResourceRecord("app", "a"),
            ResourceRecord("app", "a"),
        ]
    )
    assert report.complete
    assert seen == ["app:a", "table:t", "catalog:c"]


def test_cleanup_retries_then_succeeds() -> None:
    attempts = 0
    exists = True

    def delete(resource: ResourceRecord) -> None:
        nonlocal attempts, exists
        attempts += 1
        if attempts < 3:
            raise RuntimeError("transient")
        exists = False

    report = ResourceCleaner(delete, lambda _: exists, retries=3).cleanup(
        [ResourceRecord("pipeline", "p1")]
    )
    assert report.complete
    assert attempts == 3


def test_partial_deletion_emits_remaining_and_error() -> None:
    def delete(resource: ResourceRecord) -> None:
        raise RuntimeError("permission denied")

    report = ResourceCleaner(delete, lambda _: True, retries=2).cleanup(
        [ResourceRecord("dashboard", "d1")]
    )
    assert not report.complete
    assert report.remaining == ["dashboard:d1"]
    assert "permission denied" in report.errors[0]


def test_cleanup_is_idempotent_when_resource_is_already_absent() -> None:
    calls = 0

    def delete(resource: ResourceRecord) -> None:
        nonlocal calls
        calls += 1

    report = ResourceCleaner(delete, lambda _: False).cleanup(
        [ResourceRecord("pipeline", "gone")]
    )
    assert report.complete
    assert calls == 0


def test_live_policy_requires_allowlisted_service_principal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_live_env(monkeypatch)
    monkeypatch.setattr(
        "evaluation.live.subprocess.run",
        lambda args, **kwargs: _completed(
            args, stdout=json.dumps({"application_id": "service-principal-id"})
        ),
    )
    policy = LivePolicy.from_env()
    assert policy.profile == "solution-builder-eval"
    assert policy.host == "https://eval.example.com"


def test_live_policy_rejects_human_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_live_env(monkeypatch)
    monkeypatch.setattr(
        "evaluation.live.subprocess.run",
        lambda args, **kwargs: _completed(
            args, stdout=json.dumps({"user_name": "maintainer@example.com"})
        ),
    )
    with pytest.raises(ValueError, match="service principal"):
        LivePolicy.from_env()


def test_live_policy_accepts_oauth_m2m_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_live_env(monkeypatch)
    client_id = "f8854bec-358f-40d8-bd30-ea315cc43411"

    def fake_subprocess_run(args, **kwargs):
        if args[1:3] == ["auth", "env"]:
            return _completed(
                args,
                stdout=json.dumps(
                    {
                        "env": {
                            "DATABRICKS_HOST": "https://eval.example.com",
                            "DATABRICKS_AUTH_TYPE": "oauth-m2m",
                            "DATABRICKS_CLIENT_ID": client_id,
                        }
                    }
                ),
            )
        return _completed(args, stdout=json.dumps({"userName": client_id}))

    monkeypatch.setattr("evaluation.live.subprocess.run", fake_subprocess_run)
    assert LivePolicy.from_env().profile == "solution-builder-eval"


def test_manifest_normalizes_schema_and_lakebase_slug(tmp_path: Path) -> None:
    path = tmp_path / "resources.json"
    path.write_text(
        json.dumps(
            {
                "created_resources": {
                    "catalog": "sb_eval_catalog",
                    "schema": "sb_eval_schema",
                    "warehouse_id": "shared-warehouse",
                    "lakebase_project_id": "opaque-uid",
                    "lakebase_project_slug": "sb_eval_lakebase",
                }
            }
        )
    )
    resources = resources_from_manifest(path)
    assert {resource.key for resource in resources} == {
        "catalog:sb_eval_catalog",
        "schema:sb_eval_catalog.sb_eval_schema",
        "lakebase:projects/sb_eval_lakebase",
    }


def test_tracked_comparison_sides_are_normalized() -> None:
    resources = resources_from_tracked(
        [
            {"asset_type": "pipeline", "asset_id": "p1", "side": "A-with"},
            {"asset_type": "pipeline", "asset_id": "p2", "side": "B-without"},
            {
                "asset_type": "lakebase",
                "asset_id": "opaque-uid",
                "name": "sb_eval_lakebase",
                "side": "A-with",
            },
            {"asset_type": "pipeline_run", "asset_id": "update-id"},
        ]
    )
    assert [resource.side for resource in resources] == [
        "with",
        "without",
        "with",
    ]
    assert resources[-1].key == "lakebase:projects/sb_eval_lakebase"


def test_capabilities_derive_resource_kinds_with_overrides() -> None:
    assert expected_resource_kinds(
        ["sdp", "ml-training-serving", "vector-search"], overrides=["volume"]
    ) == [
        "mlflow_experiment",
        "model",
        "pipeline",
        "serving_endpoint",
        "vector_endpoint",
        "vector_index",
        "volume",
    ]


@pytest.mark.parametrize(
    ("resource", "expected_command"),
    [
        (
            ResourceRecord("catalog", "sb_eval_catalog"),
            ["databricks", "catalogs", "delete", "sb_eval_catalog", "--force"],
        ),
        (
            ResourceRecord("schema", "sb_eval_catalog.sb_eval_schema"),
            [
                "databricks",
                "schemas",
                "delete",
                "sb_eval_catalog.sb_eval_schema",
                "--force",
            ],
        ),
        (
            ResourceRecord("table", "sb_eval_catalog.sb_eval_schema.table"),
            [
                "databricks",
                "tables",
                "delete",
                "sb_eval_catalog.sb_eval_schema.table",
            ],
        ),
        (
            ResourceRecord("model", "sb_eval_catalog.sb_eval_schema.model"),
            [
                "databricks",
                "registered-models",
                "delete",
                "sb_eval_catalog.sb_eval_schema.model",
            ],
        ),
        (
            ResourceRecord("vector_index", "sb_eval_catalog.sb_eval_schema.index"),
            [
                "databricks",
                "vector-search-indexes",
                "delete-index",
                "sb_eval_catalog.sb_eval_schema.index",
            ],
        ),
        (
            ResourceRecord(
                "vector_endpoint", "sb_eval_endpoint", name="sb_eval_endpoint"
            ),
            [
                "databricks",
                "vector-search-endpoints",
                "delete-endpoint",
                "sb_eval_endpoint",
            ],
        ),
        (
            ResourceRecord("cluster", "cluster-id", name="sb_eval_cluster"),
            ["databricks", "clusters", "permanent-delete", "cluster-id"],
        ),
        (
            ResourceRecord("function", "sb_eval_catalog.sb_eval_schema.function"),
            [
                "databricks",
                "functions",
                "delete",
                "sb_eval_catalog.sb_eval_schema.function",
                "--force",
            ],
        ),
        (
            ResourceRecord("notebook", "/Shared/sb_eval_notebook"),
            [
                "databricks",
                "workspace",
                "delete",
                "/Shared/sb_eval_notebook",
            ],
        ),
        (
            ResourceRecord("lakebase", "projects/sb_eval_project"),
            [
                "databricks",
                "postgres",
                "delete-project",
                "projects/sb_eval_project",
            ],
        ),
        (
            ResourceRecord("dashboard", "dashboard-id"),
            ["databricks", "lakeview", "trash", "dashboard-id"],
        ),
        (
            ResourceRecord("genie_space", "space-id"),
            ["databricks", "genie", "trash-space", "space-id"],
        ),
        (
            ResourceRecord("knowledge_assistant", "ka-id"),
            [
                "databricks",
                "knowledge-assistants",
                "delete-knowledge-assistant",
                "knowledge-assistants/ka-id",
            ],
        ),
        (
            ResourceRecord("multi_agent_supervisor", "mas-id"),
            [
                "databricks",
                "api",
                "delete",
                "/api/2.0/tiles/mas-id",
            ],
        ),
    ],
)
def test_databricks_cleaner_uses_supported_delete_commands(
    resource: ResourceRecord,
    expected_command: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cleaner = DatabricksCliCleaner(_policy())
    calls: list[list[str]] = []

    def fake_run(args: list[str], *, allow_not_found: bool = False):
        calls.append(args)
        return _completed(args)

    monkeypatch.setattr(cleaner, "_run", fake_run)
    cleaner.delete(resource)
    assert calls == [expected_command]


def test_databricks_cleaner_verifies_absence_after_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = True
    calls: list[list[str]] = []

    def fake_subprocess_run(args, **kwargs):
        nonlocal existing
        calls.append(args)
        if args[1:3] == ["pipelines", "delete"]:
            existing = False
            return _completed(args)
        if existing:
            return _completed(args)
        return _completed(
            args,
            returncode=1,
            stdout="",
            stderr="RESOURCE_DOES_NOT_EXIST: pipeline not found",
        )

    monkeypatch.setattr("evaluation.live.subprocess.run", fake_subprocess_run)
    backend = DatabricksCliCleaner(_policy())
    report = ResourceCleaner(backend.delete, backend.exists, retries=1).cleanup(
        [ResourceRecord("pipeline", "pipeline-id")]
    )
    assert report.complete
    assert [call[1:3] for call in calls] == [
        ["pipelines", "get"],
        ["pipelines", "delete"],
        ["pipelines", "get"],
    ]


def test_mlflow_experiment_cleanup_resolves_id_and_checks_lifecycle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted = False
    calls: list[list[str]] = []

    def fake_subprocess_run(args, **kwargs):
        nonlocal deleted
        calls.append(args)
        if args[1:3] == ["experiments", "delete-experiment"]:
            deleted = True
            return _completed(args)
        lifecycle = "DELETED" if deleted else "ACTIVE"
        return _completed(
            args,
            stdout=json.dumps(
                {
                    "experiment": {
                        "experiment_id": "42",
                        "lifecycle_stage": lifecycle,
                    }
                }
            ),
        )

    monkeypatch.setattr("evaluation.live.subprocess.run", fake_subprocess_run)
    backend = DatabricksCliCleaner(_policy())
    report = ResourceCleaner(backend.delete, backend.exists, retries=1).cleanup(
        [ResourceRecord("mlflow_experiment", "/Shared/sb_eval_experiment")]
    )
    assert report.complete
    assert any(call[1:3] == ["experiments", "delete-experiment"] for call in calls)


def test_destructive_uc_cleanup_refuses_out_of_scope_name() -> None:
    backend = DatabricksCliCleaner(_policy())
    with pytest.raises(RuntimeError, match="outside evaluation prefix"):
        backend.delete(ResourceRecord("table", "production.default.customers"))
    with pytest.raises(RuntimeError, match="outside evaluation prefix"):
        backend.delete(ResourceRecord("mlflow_experiment", "/Shared/production"))
