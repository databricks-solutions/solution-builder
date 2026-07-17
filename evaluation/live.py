"""Live-evaluation isolation, resource reconciliation, and cleanup."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import quote


CAPABILITY_RESOURCE_KINDS: dict[str, set[str]] = {
    "aibi-dashboards": {"dashboard"},
    "databricks-apps": {"app"},
    "genie": {"genie_space"},
    "knowledge-assistant": {"knowledge_assistant", "serving_endpoint"},
    "lakebase": {"lakebase"},
    "metric-views": {"metric_view"},
    "ml-training-serving": {"model", "serving_endpoint", "mlflow_experiment"},
    "sdp": {"pipeline"},
    "supervisor-agent": {"multi_agent_supervisor", "serving_endpoint"},
    "synthetic-data-gen": {"catalog", "schema", "table"},
    "vector-search": {"vector_endpoint", "vector_index"},
}

ACTIVITY_RESOURCE_KINDS = frozenset(
    {
        "bundle",
        "bundle_run",
        "dashboard_published",
        "job_run",
        "pipeline_run",
    }
)


def expected_resource_kinds(
    capabilities: Iterable[str],
    *,
    overrides: Iterable[str] = (),
) -> list[str]:
    kinds: set[str] = set(overrides)
    for capability in capabilities:
        kinds.update(CAPABILITY_RESOURCE_KINDS.get(capability, set()))
    return sorted(kinds)


def _slug(value: str, limit: int = 24) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return (cleaned or "case")[:limit]


@dataclass(frozen=True)
class LiveNamespace:
    run_id: str
    case_id: str
    side: str
    prefix: str
    catalog: str
    schema: str
    resource_prefix: str

    @classmethod
    def allocate(
        cls,
        *,
        run_id: str,
        case_id: str,
        side: str,
        evaluation_prefix: str,
    ) -> "LiveNamespace":
        digest = hashlib.sha256(
            f"{run_id}:{case_id}:{side}".encode("utf-8")
        ).hexdigest()[:8]
        stem = f"{evaluation_prefix}{_slug(run_id, 12)}_{_slug(case_id, 16)}_{_slug(side, 8)}_{digest}"
        return cls(
            run_id=run_id,
            case_id=case_id,
            side=side,
            prefix=evaluation_prefix,
            catalog=stem,
            schema=f"{evaluation_prefix}{_slug(case_id, 12)}_{_slug(side, 8)}_{digest}",
            resource_prefix=f"{stem}_",
        )

    def environment(self, profile: str, host: str) -> dict[str, str]:
        return {
            "SB_EVAL_RUN_ID": self.run_id,
            "SB_EVAL_CASE_ID": self.case_id,
            "SB_EVAL_SIDE": self.side,
            "SB_EVAL_CATALOG": self.catalog,
            "SB_EVAL_SCHEMA": self.schema,
            "SB_EVAL_RESOURCE_PREFIX": self.resource_prefix,
            "DATABRICKS_CONFIG_PROFILE": profile,
            "DATABRICKS_HOST": host,
        }


@dataclass(frozen=True)
class LivePolicy:
    profile: str
    host: str
    allowed_hosts: tuple[str, ...]
    evaluation_prefix: str

    @classmethod
    def from_env(cls, evaluation_prefix: str = "sb_eval_") -> "LivePolicy":
        profile = os.environ.get("SB_EVAL_DATABRICKS_PROFILE", "").strip()
        if not profile or profile.lower() in {"default", "prod", "production"}:
            raise ValueError(
                "--live requires a dedicated non-production SB_EVAL_DATABRICKS_PROFILE"
            )
        allowed_profiles = {
            item.strip()
            for item in os.environ.get("SB_EVAL_ALLOWED_PROFILES", "").split(",")
            if item.strip()
        }
        if profile not in allowed_profiles:
            raise ValueError("live profile is not listed in SB_EVAL_ALLOWED_PROFILES")
        allowed_hosts = tuple(
            item.strip().rstrip("/")
            for item in os.environ.get("SB_EVAL_ALLOWED_HOSTS", "").split(",")
            if item.strip()
        )
        if not allowed_hosts:
            raise ValueError("--live requires SB_EVAL_ALLOWED_HOSTS")
        auth_context = subprocess.run(
            ["databricks", "auth", "env", "--profile", profile],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if auth_context.returncode != 0:
            raise ValueError("could not resolve the live evaluation profile")
        try:
            auth_payload = json.loads(auth_context.stdout)
            profile_env = auth_payload.get("env", {})
        except json.JSONDecodeError as exc:
            raise ValueError("databricks auth env returned invalid JSON") from exc
        if not isinstance(profile_env, dict):
            raise ValueError("databricks auth env returned an invalid environment")
        host = (
            os.environ.get("DATABRICKS_HOST", "")
            or str(profile_env.get("DATABRICKS_HOST", ""))
        ).rstrip("/")
        if not host:
            raise ValueError("could not resolve host for the live evaluation profile")
        if host not in allowed_hosts:
            raise ValueError(f"workspace host {host!r} is not allowlisted")
        identity = subprocess.run(
            [
                "databricks",
                "current-user",
                "me",
                "--profile",
                profile,
                "-o",
                "json",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if identity.returncode != 0:
            raise ValueError("could not verify the live evaluation service principal")
        try:
            identity_payload = json.loads(identity.stdout)
        except json.JSONDecodeError as exc:
            raise ValueError("current-user me returned invalid JSON") from exc
        application_id = (
            identity_payload.get("application_id")
            or identity_payload.get("applicationId")
            if isinstance(identity_payload, dict)
            else None
        )
        user_name = (
            identity_payload.get("user_name") or identity_payload.get("userName")
            if isinstance(identity_payload, dict)
            else None
        )
        profile_client_id = profile_env.get("DATABRICKS_CLIENT_ID")
        is_service_principal = bool(application_id) or bool(
            profile_client_id and user_name == profile_client_id
        )
        if (
            not is_service_principal
            and isinstance(user_name, str)
            and re.fullmatch(
                r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
                user_name,
            )
        ):
            lookup = subprocess.run(
                [
                    "databricks",
                    "service-principals",
                    "list",
                    "--profile",
                    profile,
                    "--filter",
                    f'applicationId eq "{user_name}"',
                    "-o",
                    "json",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=20,
            )
            if lookup.returncode == 0:
                try:
                    principals = json.loads(lookup.stdout)
                except json.JSONDecodeError:
                    principals = []
                if isinstance(principals, list):
                    is_service_principal = any(
                        isinstance(item, dict)
                        and (item.get("application_id") or item.get("applicationId"))
                        == user_name
                        and item.get("active", True)
                        for item in principals
                    )
        if not is_service_principal:
            raise ValueError(
                "--live requires credentials for a dedicated Databricks service principal"
            )
        if not re.fullmatch(r"[a-z][a-z0-9_]*_", evaluation_prefix):
            raise ValueError(
                "evaluation prefix must be lowercase and end in underscore"
            )
        return cls(
            profile=profile,
            host=host,
            allowed_hosts=allowed_hosts,
            evaluation_prefix=evaluation_prefix,
        )

    def validate_namespace(self, namespace: LiveNamespace) -> None:
        for label, value in (
            ("catalog", namespace.catalog),
            ("schema", namespace.schema),
            ("resource prefix", namespace.resource_prefix),
        ):
            if not value.startswith(self.evaluation_prefix):
                raise ValueError(f"{label} {value!r} is outside the evaluation prefix")


@dataclass(frozen=True)
class ResourceRecord:
    resource_type: str
    resource_id: str
    name: str = ""
    parent_id: str | None = None
    side: str | None = None
    source: str = "resources.json"

    @property
    def key(self) -> str:
        return f"{self.resource_type}:{self.resource_id}"


RESOURCE_KEYS: dict[str, str] = {
    "catalog": "catalog",
    "schema": "schema",
    "pipeline_id": "pipeline",
    "metric_view_name": "metric_view",
    "dashboard_id": "dashboard",
    "genie_space_id": "genie_space",
    "knowledge_assistant_id": "knowledge_assistant",
    "knowledge_assistant_endpoint": "serving_endpoint",
    "multi_agent_supervisor_id": "multi_agent_supervisor",
    "multi_agent_supervisor_endpoint": "serving_endpoint",
    "ml_model_name": "model",
    "mlflow_experiment_path": "mlflow_experiment",
}

RESOURCE_NAME_KEYS: dict[str, str] = {
    "pipeline_id": "pipeline_name",
    "dashboard_id": "dashboard_name",
    "genie_space_id": "genie_space_name",
    "knowledge_assistant_id": "knowledge_assistant_name",
    "knowledge_assistant_endpoint": "knowledge_assistant_endpoint",
    "multi_agent_supervisor_id": "multi_agent_supervisor_name",
    "multi_agent_supervisor_endpoint": "multi_agent_supervisor_endpoint",
}


def resources_from_manifest(
    path: Path, *, side: str | None = None
) -> list[ResourceRecord]:
    if not path.is_file():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    created = raw.get("created_resources", raw) if isinstance(raw, dict) else {}
    if not isinstance(created, dict):
        return []
    records: list[ResourceRecord] = []
    for key, resource_type in RESOURCE_KEYS.items():
        value = created.get(key)
        if isinstance(value, (str, int)) and str(value):
            resource_id = str(value)
            if key == "schema" and created.get("catalog") and "." not in resource_id:
                resource_id = f"{created['catalog']}.{resource_id}"
            resource_name = str(
                created.get(RESOURCE_NAME_KEYS.get(key, "")) or resource_id
            )
            records.append(
                ResourceRecord(
                    resource_type=resource_type,
                    resource_id=resource_id,
                    name=resource_name,
                    side=side,
                )
            )
    lakebase_name = created.get("lakebase_project_slug") or created.get(
        "lakebase_project_id"
    )
    if isinstance(lakebase_name, (str, int)) and str(lakebase_name):
        resource_id = str(lakebase_name)
        if not resource_id.startswith("projects/"):
            resource_id = f"projects/{resource_id}"
        records.append(
            ResourceRecord(
                resource_type="lakebase",
                resource_id=resource_id,
                name=str(created.get("lakebase_project_slug") or resource_id),
                side=side,
            )
        )
    app = created.get("app")
    if isinstance(app, dict):
        app_id = app.get("name") or app.get("id")
        if app_id:
            records.append(
                ResourceRecord(
                    resource_type="app",
                    resource_id=str(app_id),
                    name=str(app.get("name") or app_id),
                    side=side,
                )
            )
    return records


def resources_from_tracked(rows: Iterable[dict[str, Any]]) -> list[ResourceRecord]:
    records: list[ResourceRecord] = []
    for row in rows:
        if row.get("removed"):
            continue
        resource_type = row.get("resource_type") or row.get("asset_type")
        resource_id = row.get("resource_id") or row.get("asset_id")
        if (
            not resource_type
            or not resource_id
            or resource_type == "pending"
            or resource_type in ACTIVITY_RESOURCE_KINDS
            or row.get("ephemeral")
        ):
            continue
        resource_type = str(resource_type)
        resource_id = str(resource_id)
        if resource_id.strip().lower() in {"unknown", "none", "null"}:
            # SkillForge may emit medium-confidence activity detections before
            # a CLI response contains an actual identifier. They are useful
            # diagnostics but are not actionable resources and must not count
            # toward expected-kind checks or cleanup.
            continue
        resource_name = str(row.get("name") or resource_id)
        if resource_type == "lakebase":
            # Lakebase APIs delete by projects/{slug}; tool results may expose
            # an opaque uid while the request name retains the deletable slug.
            resource_id = resource_name if resource_name != "unknown" else resource_id
            if not resource_id.startswith("projects/"):
                resource_id = f"projects/{resource_id}"
        side = row.get("side")
        if isinstance(side, str) and (side == "A" or side.startswith("A-")):
            side = "with"
        elif isinstance(side, str) and (side == "B" or side.startswith("B-")):
            side = "without"
        records.append(
            ResourceRecord(
                resource_type=resource_type,
                resource_id=resource_id,
                name=resource_name,
                parent_id=str(row["parent_id"]) if row.get("parent_id") else None,
                side=side,
                source="skillforge",
            )
        )
    return records


def reconcile_resources(*groups: Iterable[ResourceRecord]) -> list[ResourceRecord]:
    by_key: dict[str, ResourceRecord] = {}
    for record in (record for group in groups for record in group):
        existing = by_key.get(record.key)
        if existing is None or (
            record.source == "skillforge" and existing.source != "skillforge"
        ):
            by_key[record.key] = record
    return list(by_key.values())


DELETE_PRIORITY: dict[str, int] = {
    "app": 100,
    "multi_agent_supervisor": 95,
    "knowledge_assistant": 94,
    "serving_endpoint": 90,
    "genie_space": 85,
    "dashboard": 84,
    "vector_index": 80,
    "vector_endpoint": 79,
    "model": 75,
    "metric_view": 70,
    "materialized_view": 69,
    "streaming_table": 68,
    "function": 67,
    "view": 65,
    "table": 60,
    "pipeline": 72,
    "job": 50,
    "cluster": 49,
    "mlflow_experiment": 45,
    "notebook": 44,
    "volume": 40,
    "schema": 20,
    "catalog": 10,
    "warehouse": 5,
    "lakebase": 4,
}


@dataclass
class CleanupReport:
    deleted: list[str] = field(default_factory=list)
    remaining: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.remaining and not self.errors


class ResourceCleaner:
    def __init__(
        self,
        delete: Callable[[ResourceRecord], None],
        exists: Callable[[ResourceRecord], bool],
        *,
        retries: int = 3,
        retry_delay: float = 0.0,
    ) -> None:
        self.delete = delete
        self.exists = exists
        self.retries = retries
        self.retry_delay = retry_delay

    def cleanup(self, resources: Iterable[ResourceRecord]) -> CleanupReport:
        report = CleanupReport()
        ordered = sorted(
            reconcile_resources(resources),
            key=lambda resource: DELETE_PRIORITY.get(resource.resource_type, 50),
            reverse=True,
        )
        for resource in ordered:
            try:
                if not self.exists(resource):
                    report.deleted.append(resource.key)
                    continue
            except Exception:  # noqa: BLE001 - attempt deletion on uncertain state
                pass
            last_error: Exception | None = None
            for attempt in range(self.retries):
                try:
                    self.delete(resource)
                    last_error = None
                    if not self.exists(resource):
                        report.deleted.append(resource.key)
                        break
                except Exception as exc:  # noqa: BLE001 - retries are intentional
                    last_error = exc
                if attempt + 1 < self.retries and self.retry_delay:
                    time.sleep(self.retry_delay)
            else:
                report.remaining.append(resource.key)
                if last_error is not None:
                    report.errors.append(f"{resource.key}: {last_error}")
        return report


class DatabricksCliCleaner:
    """Delete/verify resources through the external Databricks CLI."""

    def __init__(self, policy: LivePolicy) -> None:
        self.policy = policy

    @staticmethod
    def _is_not_found(completed: subprocess.CompletedProcess[str]) -> bool:
        combined = (completed.stdout + completed.stderr).lower()
        markers = (
            "not found",
            "not_found",
            "does not exist",
            "resource_does_not_exist",
            '"status_code":404',
            '"status_code": 404',
            "status code 404",
        )
        return any(marker in combined for marker in markers)

    def _run(
        self, args: list[str], *, allow_not_found: bool = False
    ) -> subprocess.CompletedProcess[str]:
        completed = subprocess.run(
            [*args, "--profile", self.policy.profile],
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if completed.returncode and not (
            allow_not_found and self._is_not_found(completed)
        ):
            raise RuntimeError((completed.stderr or completed.stdout).strip())
        return completed

    def _require_evaluation_scope(self, resource: ResourceRecord) -> None:
        """Refuse destructive named-resource operations outside the eval prefix."""
        prefix = self.policy.evaluation_prefix
        rid = resource.resource_id
        scoped_parts: tuple[str, ...] | None = None
        minimum_parts = 0
        if resource.resource_type == "catalog":
            scoped_parts = (rid,)
            minimum_parts = 1
        elif resource.resource_type == "schema":
            parts = tuple(rid.split("."))
            scoped_parts = parts[:2]
            minimum_parts = 2
        elif resource.resource_type in {
            "metric_view",
            "view",
            "table",
            "streaming_table",
            "materialized_view",
            "volume",
            "model",
            "function",
            "vector_index",
        }:
            parts = tuple(rid.split("."))
            scoped_parts = parts[:2]
            minimum_parts = 3
        elif resource.resource_type == "lakebase":
            scoped_parts = (rid.removeprefix("projects/"),)
            minimum_parts = 1
        elif resource.resource_type in {"cluster", "warehouse", "vector_endpoint"}:
            scoped_parts = (resource.name or rid,)
            minimum_parts = 1
        elif resource.resource_type in {
            "app",
            "serving_endpoint",
            "pipeline",
            "job",
            "dashboard",
            "genie_space",
            "knowledge_assistant",
            "multi_agent_supervisor",
        }:
            name = (resource.name or "").strip()
            if not name.startswith(prefix):
                raise RuntimeError(
                    f"refusing to delete {resource.key}: outside evaluation prefix {prefix!r}"
                )
            return
        elif resource.resource_type in {"notebook", "mlflow_experiment"}:
            path_parts = tuple(
                part for part in (resource.name or rid).split("/") if part
            )
            if not any(part.startswith(prefix) for part in path_parts):
                raise RuntimeError(
                    f"refusing to delete {resource.key}: outside evaluation prefix {prefix!r}"
                )
            return
        if scoped_parts is None:
            return
        normalized = tuple(part.strip("`") for part in scoped_parts)
        actual_parts = len(tuple(rid.split(".")))
        if (
            actual_parts < minimum_parts
            or not normalized
            or any(not part.startswith(prefix) for part in normalized)
        ):
            raise RuntimeError(
                f"refusing to delete {resource.key}: outside evaluation prefix {prefix!r}"
            )

    @staticmethod
    def _active_payload(completed: subprocess.CompletedProcess[str]) -> bool:
        if completed.returncode != 0:
            return False
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return True
        if not isinstance(payload, dict):
            return True
        item = payload.get("experiment", payload)
        if not isinstance(item, dict):
            return True
        lifecycle = str(
            item.get("lifecycle_stage") or item.get("lifecycle_state") or ""
        ).upper()
        return lifecycle not in {"DELETED", "TRASHED"}

    def _experiment(self, resource_id: str) -> tuple[str | None, bool]:
        command = (
            [
                "databricks",
                "experiments",
                "get-experiment",
                resource_id,
                "-o",
                "json",
            ]
            if resource_id.isdigit()
            else [
                "databricks",
                "experiments",
                "get-by-name",
                resource_id,
                "-o",
                "json",
            ]
        )
        completed = self._run(command, allow_not_found=True)
        if self._is_not_found(completed) or completed.returncode != 0:
            return None, False
        try:
            payload = json.loads(completed.stdout)
            item = payload.get("experiment", payload)
            experiment_id = str(item["experiment_id"])
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            raise RuntimeError(
                f"could not resolve MLflow experiment {resource_id!r}"
            ) from exc
        return experiment_id, self._active_payload(completed)

    def delete(self, resource: ResourceRecord) -> None:
        self._require_evaluation_scope(resource)
        rid = resource.resource_id
        commands: dict[str, list[str]] = {
            "app": ["databricks", "apps", "delete", rid],
            "serving_endpoint": ["databricks", "serving-endpoints", "delete", rid],
            "pipeline": ["databricks", "pipelines", "delete", rid],
            "job": ["databricks", "jobs", "delete", rid],
            "warehouse": ["databricks", "warehouses", "delete", rid],
            "cluster": ["databricks", "clusters", "permanent-delete", rid],
            "lakebase": ["databricks", "postgres", "delete-project", rid],
            "vector_index": [
                "databricks",
                "vector-search-indexes",
                "delete-index",
                rid,
            ],
            "vector_endpoint": [
                "databricks",
                "vector-search-endpoints",
                "delete-endpoint",
                rid,
            ],
            "dashboard": ["databricks", "lakeview", "trash", rid],
            "genie_space": ["databricks", "genie", "trash-space", rid],
            "knowledge_assistant": [
                "databricks",
                "knowledge-assistants",
                "delete-knowledge-assistant",
                rid
                if rid.startswith("knowledge-assistants/")
                else f"knowledge-assistants/{rid}",
            ],
            "multi_agent_supervisor": [
                "databricks",
                "api",
                "delete",
                f"/api/2.0/tiles/{quote(rid, safe='')}",
            ],
            "metric_view": ["databricks", "tables", "delete", rid],
            "view": ["databricks", "tables", "delete", rid],
            "table": ["databricks", "tables", "delete", rid],
            "streaming_table": ["databricks", "tables", "delete", rid],
            "materialized_view": ["databricks", "tables", "delete", rid],
            "volume": ["databricks", "volumes", "delete", rid],
            "function": ["databricks", "functions", "delete", rid, "--force"],
            "notebook": ["databricks", "workspace", "delete", rid],
            "schema": ["databricks", "schemas", "delete", rid, "--force"],
            "catalog": ["databricks", "catalogs", "delete", rid, "--force"],
            "model": ["databricks", "registered-models", "delete", rid],
        }
        if resource.resource_type == "mlflow_experiment":
            experiment_id, active = self._experiment(rid)
            if not active or experiment_id is None:
                return
            self._run(
                [
                    "databricks",
                    "experiments",
                    "delete-experiment",
                    experiment_id,
                ],
                allow_not_found=True,
            )
            return
        if resource.resource_type in commands:
            self._run(commands[resource.resource_type], allow_not_found=True)
            return
        raise RuntimeError(f"no cleanup command for {resource.resource_type}")

    def exists(self, resource: ResourceRecord) -> bool:
        rid = resource.resource_id
        commands: dict[str, list[str]] = {
            "app": ["databricks", "apps", "get", rid, "-o", "json"],
            "serving_endpoint": [
                "databricks",
                "serving-endpoints",
                "get",
                rid,
                "-o",
                "json",
            ],
            "pipeline": ["databricks", "pipelines", "get", rid, "-o", "json"],
            "job": ["databricks", "jobs", "get", rid, "-o", "json"],
            "warehouse": ["databricks", "warehouses", "get", rid, "-o", "json"],
            "cluster": ["databricks", "clusters", "get", rid, "-o", "json"],
            "lakebase": [
                "databricks",
                "postgres",
                "get-project",
                rid,
                "-o",
                "json",
            ],
            "vector_index": [
                "databricks",
                "vector-search-indexes",
                "get-index",
                rid,
                "-o",
                "json",
            ],
            "vector_endpoint": [
                "databricks",
                "vector-search-endpoints",
                "get-endpoint",
                rid,
                "-o",
                "json",
            ],
            "dashboard": ["databricks", "lakeview", "get", rid, "-o", "json"],
            "genie_space": [
                "databricks",
                "genie",
                "get-space",
                rid,
                "-o",
                "json",
            ],
            "knowledge_assistant": [
                "databricks",
                "knowledge-assistants",
                "get-knowledge-assistant",
                rid
                if rid.startswith("knowledge-assistants/")
                else f"knowledge-assistants/{rid}",
                "-o",
                "json",
            ],
            "multi_agent_supervisor": [
                "databricks",
                "api",
                "get",
                f"/api/2.0/multi-agent-supervisors/{quote(rid, safe='')}",
                "-o",
                "json",
            ],
            "metric_view": ["databricks", "tables", "get", rid, "-o", "json"],
            "view": ["databricks", "tables", "get", rid, "-o", "json"],
            "table": ["databricks", "tables", "get", rid, "-o", "json"],
            "streaming_table": [
                "databricks",
                "tables",
                "get",
                rid,
                "-o",
                "json",
            ],
            "materialized_view": [
                "databricks",
                "tables",
                "get",
                rid,
                "-o",
                "json",
            ],
            "volume": ["databricks", "volumes", "read", rid, "-o", "json"],
            "function": ["databricks", "functions", "get", rid, "-o", "json"],
            "notebook": [
                "databricks",
                "workspace",
                "get-status",
                rid,
                "-o",
                "json",
            ],
            "schema": ["databricks", "schemas", "get", rid, "-o", "json"],
            "catalog": ["databricks", "catalogs", "get", rid, "-o", "json"],
            "model": [
                "databricks",
                "registered-models",
                "get",
                rid,
                "-o",
                "json",
            ],
        }
        if resource.resource_type == "mlflow_experiment":
            _, active = self._experiment(rid)
            return active
        command = commands.get(resource.resource_type)
        if command:
            completed = self._run(command, allow_not_found=True)
            if self._is_not_found(completed):
                return False
            return self._active_payload(completed)
        return True


def write_leak_report(
    path: Path, report: CleanupReport, resources: Iterable[ResourceRecord]
) -> None:
    payload = {
        "complete": report.complete,
        "deleted": report.deleted,
        "remaining": report.remaining,
        "errors": report.errors,
        "resources": [resource.__dict__ for resource in resources],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
