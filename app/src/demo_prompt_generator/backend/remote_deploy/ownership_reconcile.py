"""Cross-workspace ownership reconcile: hand SP-created demo resources to the user.

WHY THIS EXISTS
---------------
In cross-workspace deploy (Option A), the deployer service principal (SP)
creates every demo resource in the user's TARGET workspace — so the SP owns
everything and the user who built the demo can't read their own data. This
module deterministically re-homes ownership to the user: OWNERSHIP where the
resource type supports a transfer, CAN_MANAGE (the ceiling) where it doesn't.
The catalog stays SP-owned (needed for redeploys + USE_SCHEMA recovery).

WHY A SEPARATE CLASSIFIER (not the LLM extractor)
-------------------------------------------------
`services/resources_extractor.py` normalizes resources.json into a FLAT,
SINGULAR-per-type canonical dict for the UI's resource tiles (one "Genie
Agent" tile even when a demo built two Genie spaces). That is lossy BY DESIGN
and correct for the UI. The reconcile must be LOSSLESS — every instance of
every type, or the user silently loses access to real resources. A demo can
legitimately carry two `*_genie_space_id` keys, two `*_job_id` keys, a KA that
is BOTH an object (share) and a serving endpoint (CAN_MANAGE), etc. So the
reconcile reads the RAW created_resources and classifies each key with a
deterministic key-suffix + value-shape ruleset (no LLM, no agent creativity).

Two lossless sources, combined:
  1. UC schema CHILDREN (tables/views/volumes/functions) are enumerated LIVE
     from information_schema against the target — independent of the manifest,
     so nothing is missed even if resources.json omits them.
  2. Everything else (jobs, pipelines, dashboards, genie, KA, MAS, apps,
     lakebase, models, metric views) comes from the raw created_resources via
     the classifier — per-instance, arbitrary counts.

Idempotent by construction: ALTER OWNER to the current owner is a no-op, and
re-granting an existing CAN_MANAGE is a no-op — so running it twice (or ten
times, across both trigger gates) is harmless.

The per-resource-type ownership-transfer mechanisms were verified live.
Everything runs AS THE DEPLOYER SP against the TARGET workspace.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)


# --- value-shape vocabulary (lowercased match) -----------------------------
# Many resource types collide on value shape (four UUIDs: pipeline/KA/MAS/
# lakebase; two 32-hex: genie+dashboard; two dotted-3-part: model+metric-view;
# two *_endpoint: KA+MAS). So value shape is only ever a GUARD — the key suffix
# is the primary discriminator. See classify() precedence below.
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_ID32_RE = re.compile(r"^[0-9a-f]{32}$")
_ID16_RE = re.compile(r"^[0-9a-f]{16}$")
_UC3_RE = re.compile(r"^[^./\s]+\.[^./\s]+\.[^./\s]+$")  # exactly two dots, no slash
_WSPATH_RE = re.compile(r"^/(Workspace|Shared)/", re.IGNORECASE)
_VOLPATH_RE = re.compile(r"^/Volumes/", re.IGNORECASE)
_ENDPOINT_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$", re.IGNORECASE)  # kebab token


def _is_placeholder(v: str) -> bool:
    """Reference/template manifests carry tokens like <your-warehouse-id> or
    'built-live-in-the-workshop' instead of real values. These aren't real
    resources — never try to transfer them."""
    if not v:
        return True
    lv = v.strip().lower()
    return (
        lv.startswith("<")
        or "your-" in lv
        or "built-live" in lv
        or lv in {"", "none", "null", "tbd", "n/a"}
    )


# --- mechanisms -------------------------------------------------------------
# How to give the user access to one resource. UC objects transfer OWNERSHIP
# via SQL; workspace objects get IS_OWNER or (where owner can't move) CAN_MANAGE
# via the permissions REST API; KA/MAS have a bespoke share endpoint.
MECH_SKIP = "skip"                    # never touch (catalog, shared warehouse)
MECH_NOTE = "note"                    # record only, no ACL/owner change
MECH_UC_OWNER = "uc_alter_owner"      # ALTER <TABLE|VIEW|VOLUME|FUNCTION> OWNER TO
MECH_UC_SCHEMA = "uc_alter_schema"    # ALTER SCHEMA OWNER TO — MUST run last
MECH_UC_METRIC = "uc_metric_owner"    # ALTER VIEW (fallback ALTER TABLE) OWNER TO
MECH_UC_MODEL = "uc_model_owner"      # PATCH /unity-catalog/models/{fqn} {owner}
MECH_JOB = "job_is_owner"             # PATCH /permissions/jobs/{id} IS_OWNER
MECH_PIPELINE = "pipeline_is_owner"   # PATCH /permissions/pipelines/{id} IS_OWNER
MECH_GENIE = "genie_can_manage"       # PATCH /permissions/genie/{id} CAN_MANAGE
MECH_DASHBOARD = "dashboard_can_manage"  # PATCH /permissions/dashboards/{id}
MECH_ENDPOINT = "endpoint_can_manage"    # PATCH /permissions/serving-endpoints/{id}
MECH_APP = "app_can_manage"           # PATCH /permissions/apps/{name} CAN_MANAGE
MECH_LAKEBASE = "lakebase_can_manage"    # PATCH /permissions/database-projects/{slug}
# Lakebase DATA-plane grant (distinct from MECH_LAKEBASE's control-plane CAN_MANAGE
# on the database-PROJECT). The SP that deployed the demo owns the `dbgen_<name>`
# Postgres database + its objects, so CAN_MANAGE alone still leaves the builder with
# "Permission denied — ask the owner to create a PostgreSQL role for your Databricks
# identity". This creates a USER Postgres role for the builder AS the SP and GRANTs it
# CONNECT + schema/table/sequence privileges (the USER analogue of the app-SP grant in
# app_template/scripts/lakebase_grant_app_credential.sh).
MECH_LAKEBASE_PGROLE = "lakebase_pgrole_grant"
MECH_KA_SHARE = "ka_share"            # POST /knowledge-assistants/{id}/share
MECH_MAS_SHARE = "mas_share"          # POST /multi-agent-supervisors/{id}/share
# Post-transfer: re-arm the deployer SP's write access to the now-user-owned
# schema + tables so FUTURE SP-run redeploys (the "iterate on my demo" flow —
# change customer / change architecture) still work. Without these, once the
# schema+tables move to the user the SP loses USE_SCHEMA and its CREATE OR
# REPLACE / DROP / new-table DDL fails PERMISSION_DENIED (verified live). The SP
# can issue these because it still owns the CATALOG.
MECH_SP_SCHEMA_WRITEBACK = "sp_schema_writeback"   # GRANT USE SCHEMA,CREATE*,MODIFY ON SCHEMA -> SP
MECH_SP_TABLE_WRITEBACK = "sp_table_writeback"     # GRANT SELECT,MODIFY ON TABLE -> SP (per table)
# Mid-build grant-only variants (CUJ1): give the user READ access to a resource
# WITHOUT transferring ownership, so a user who clicks a resource tile mid-build
# can see it — but the SP keeps USE_SCHEMA and the build isn't broken. These
# replace the ALTER-OWNER mechanisms when grant_only=True.
MECH_UC_GRANT = "uc_grant_read"       # GRANT ALL PRIVILEGES ON <obj> -> user (no transfer)
MECH_SCHEMA_GRANT = "schema_grant_use"  # GRANT USE SCHEMA ON SCHEMA -> user (no transfer)

# Execution ordering. UC children MUST be re-owned before the schema (else the
# SP loses USE_SCHEMA on the parent and later ALTERs fail — reproduced live).
# The SP write-back grants run LAST (after the schema transfer) so they re-arm
# the SP's write access to the now-user-owned schema for future redeploys.
_ORDER_NONUC = 0
_ORDER_CATALOG_GRANT = 5
_ORDER_UC_CHILD = 10
_ORDER_SCHEMA = 20
_ORDER_SP_WRITEBACK = 30


@dataclass
class OwnershipAction:
    """One unit of work: give `user` access to one resource via `mechanism`."""
    key: str          # the manifest key it came from (or "<live>" for enumerated)
    value: str        # the id / name / fully-qualified name / slug
    rtype: str        # human resource-type label (for logs / dry-run)
    mechanism: str
    order: int = _ORDER_NONUC


@dataclass
class ReconcileResult:
    ran: bool = False
    skipped_reason: Optional[str] = None
    actions_planned: int = 0
    succeeded: int = 0
    failed: int = 0
    # Best-effort actions (e.g. the Lakebase data-plane grant) that failed. Tracked
    # SEPARATELY from `failed` so a transient Lakebase blip does NOT block the
    # ownership-hash latch and storm the whole reconcile on every fetch — those
    # actions self-heal via the manual grant tool / a later reconcile trigger.
    best_effort_failed: int = 0
    errors: list[str] = field(default_factory=list)
    # human-readable plan (rtype: value -> mechanism), useful for dry-run review
    plan: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Manifest access
# ---------------------------------------------------------------------------

def _created_resources(manifest: dict[str, Any]) -> dict[str, Any]:
    """The resource map lives under `created_resources`; some early manifests
    are flat at the top level. Prefer the wrapper when present."""
    cr = manifest.get("created_resources")
    if isinstance(cr, dict):
        return cr
    # Flat fallback: strip the non-resource envelope keys.
    return {k: v for k, v in manifest.items()
            if k not in ("capabilities", "created_resources", "state", "lineage")}


def parse_manifest(created_resources_text: str) -> Optional[dict[str, Any]]:
    """Parse resources.json text. Returns None on any JSON error (caller treats
    as 'nothing to reconcile' and does NOT mark the hash → self-heals later)."""
    if not created_resources_text or not created_resources_text.strip():
        return None
    try:
        obj = json.loads(created_resources_text)
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


# ---------------------------------------------------------------------------
# The deterministic, lossless classifier
# ---------------------------------------------------------------------------

def classify(created: dict[str, Any]) -> list[OwnershipAction]:
    """Map every key in `created_resources` to an OwnershipAction, LOSSLESSLY.

    Rules are evaluated TOP-DOWN, first match wins (per key). Value shape is a
    GUARD only — the key SUFFIX is the discriminator (four types share the UUID
    shape, two share 32-hex, etc.). Multiple keys of the same type are all
    emitted (two `*_genie_space_id` → two actions; two `*_job_id` → two).
    SKIP/NOTE actions are recorded but do no work.
    """
    actions: list[OwnershipAction] = []

    for raw_key, raw_val in created.items():
        # The nested `app` object is expanded to synthetic app_name / app_id.
        if raw_key == "app" and isinstance(raw_val, dict):
            name = raw_val.get("name")
            if isinstance(name, str) and not _is_placeholder(name):
                actions.append(OwnershipAction("app.name", name, "app", MECH_APP))
            # app.id folds into the same app — not a standalone resource.
            continue

        if not isinstance(raw_val, (str, int, float)):
            continue  # nested arrays/objects other than `app` aren't resource ids
        key = raw_key.lower()
        val = str(raw_val).strip()
        placeholder = _is_placeholder(val)

        # R1 catalog — SKIP (stays SP-owned)
        if key == "catalog" or key.endswith("_catalog"):
            actions.append(OwnershipAction(raw_key, val, "catalog", MECH_SKIP))
            continue
        # R2 warehouse — SKIP (shared serverless starter warehouse)
        if key == "warehouse_id" or key.endswith("warehouse_id"):
            actions.append(OwnershipAction(raw_key, val, "warehouse", MECH_SKIP))
            continue
        # R3 workspace folder / mlflow experiment path — NOTE only
        if key == "workspace_folder" or key.endswith("_folder") \
                or "experiment_path" in key or (not placeholder and _WSPATH_RE.match(val)):
            actions.append(OwnershipAction(raw_key, val, "workspace-path", MECH_NOTE))
            continue
        # R4 jobs — OWNERSHIP (IS_OWNER)
        if key.endswith("_job_id") or key == "job_id":
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "job", MECH_JOB))
            continue
        # R5 pipelines — OWNERSHIP (IS_OWNER). Before any generic *_id handling.
        if key.endswith("pipeline_id"):
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "pipeline", MECH_PIPELINE))
            continue
        # R6 genie space — CAN_MANAGE
        if key.endswith("genie_space_id"):
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "genie-space", MECH_GENIE))
            continue
        # R7 KA object — share. Before R11 endpoint + generic id.
        if key.endswith("knowledge_assistant_id") or key in ("ka_id", "assistant_id"):
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "knowledge-assistant", MECH_KA_SHARE))
            continue
        # R8 MAS object — share. Before R11 endpoint.
        if key.endswith("multi_agent_supervisor_id") or key in ("supervisor_agent_id", "mas_id"):
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "multi-agent-supervisor", MECH_MAS_SHARE))
            continue
        # R9 dashboard — CAN_MANAGE (32-hex, or placeholder by suffix)
        if key.endswith("dashboard_id"):
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "dashboard", MECH_DASHBOARD))
            continue
        # R10 lakebase project — CAN_MANAGE via slug; id/database are children.
        if key.endswith("lakebase_project_slug"):
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "database-project", MECH_LAKEBASE))
            continue
        if key.endswith("lakebase_project_id") or key.endswith("lakebase_database"):
            actions.append(OwnershipAction(raw_key, val, "database-project-child", MECH_SKIP))
            continue
        # R11 serving endpoint — CAN_MANAGE. AFTER KA/MAS *_id so the object is
        # claimed first; a KA/MAS therefore yields TWO actions (share + endpoint).
        # Matches both `*_endpoint` (KA/MAS backing endpoints) and the standalone
        # `serving_endpoint_name` (ml-training-serving capability); both are the
        # endpoint NAME, keyed into the permissions API by that name.
        if key.endswith("_endpoint") or key.endswith("serving_endpoint_name"):
            if not placeholder and _ENDPOINT_RE.match(val):
                actions.append(OwnershipAction(raw_key, val, "serving-endpoint", MECH_ENDPOINT))
            continue
        # R12 ML model — OWNERSHIP via models API (dotted 3-part name)
        if key.endswith("ml_model_name") or key in ("model_name", "uc_model_name"):
            if not placeholder and _UC3_RE.match(val):
                actions.append(OwnershipAction(raw_key, val, "uc-model", MECH_UC_MODEL, _ORDER_UC_CHILD))
            continue
        # R13 metric view — OWNERSHIP via ALTER (dotted 3-part name)
        if "metric_view" in key:
            if not placeholder and _UC3_RE.match(val):
                actions.append(OwnershipAction(raw_key, val, "uc-metric-view", MECH_UC_METRIC, _ORDER_UC_CHILD))
            continue
        # R14 UC volume — OWNERSHIP via ALTER VOLUME (/Volumes path or *_volume)
        if key.endswith("_volume") or (not placeholder and _VOLPATH_RE.match(val)):
            actions.append(OwnershipAction(raw_key, val, "uc-volume", MECH_NOTE))
            # Volume ownership is transferred by live schema-child enumeration
            # (by name), not by its /Volumes path — record as NOTE here.
            continue
        # R15 schema — OWNERSHIP, but ORDER LAST (after all children).
        if key == "schema" or key.endswith("_schema"):
            actions.append(OwnershipAction(raw_key, val, "schema", MECH_UC_SCHEMA, _ORDER_SCHEMA))
            continue
        # R16 generic dotted 3-part UC object (remaining *_name) — ALTER OWNER
        if key.endswith("_name") and not placeholder and _UC3_RE.match(val):
            actions.append(OwnershipAction(raw_key, val, "uc-object", MECH_UC_OWNER, _ORDER_UC_CHILD))
            continue
        # R17 app name (flat form)
        if key == "app_name" or key.endswith("_app_name"):
            if not placeholder:
                actions.append(OwnershipAction(raw_key, val, "app", MECH_APP))
            continue
        # Everything else (bad_lot_id, urls, notes, app_id, misc) → ignore.

    return actions


# ---------------------------------------------------------------------------
# Hash gate
# ---------------------------------------------------------------------------

def reconcile_hash(manifest: dict[str, Any], user_email: str) -> str:
    """A stable fingerprint of (the resource set to re-home, the target user).

    Gates re-runs: if it equals the project's stored `ownership_reconciled_hash`
    the reconcile is skipped with zero API calls. Changes when resources.json
    gains/loses a resource OR the target user changes — either warrants a re-run.
    Whitespace-insensitive (hashes the classified set, not the raw text)."""
    created = _created_resources(manifest)
    acts = classify(created)
    # Only actions that DO work matter to the fingerprint.
    material = sorted(
        (a.rtype, a.value) for a in acts if a.mechanism not in (MECH_SKIP, MECH_NOTE)
    )
    payload = json.dumps({"user": user_email, "resources": material}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Executor (runs as the deployer SP against the target)
# ---------------------------------------------------------------------------

def _run_sql(sp_ws: "WorkspaceClient", warehouse_id: str, statement: str) -> tuple[bool, Optional[str]]:
    """Execute one SQL statement on the target warehouse as the SP. Returns
    (ok, error_message). Polls briefly if the statement is still running."""
    try:
        resp = sp_ws.statement_execution.execute_statement(
            warehouse_id=warehouse_id, statement=statement, wait_timeout="30s"
        )
        # Poll to a terminal state (ALTER OWNER is fast; guard slow warehouses).
        for _ in range(15):
            state = str(getattr(resp.status, "state", "") or "").upper()
            if state.endswith("SUCCEEDED"):
                return True, None
            if state.endswith(("FAILED", "CANCELED", "CLOSED")):
                err = getattr(getattr(resp.status, "error", None), "message", None)
                return False, err or f"statement {state}"
            time.sleep(2)
            resp = sp_ws.statement_execution.get_statement(resp.statement_id)
        return False, "statement did not reach a terminal state"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _schema_owned_by(sp_ws: "WorkspaceClient", warehouse_id: Optional[str],
                     catalog: str, schema: str, owner: str) -> bool:
    """True if `catalog.schema`'s owner is already `owner`. Used for idempotency:
    on a re-reconcile the schema may already belong to the user, so the SP's
    ALTER fails — but that's success, not failure. Best-effort (owner unknown on
    error → False, so we don't falsely latch)."""
    try:
        info = sp_ws.schemas.get(full_name=f"{catalog}.{schema}")
        return getattr(info, "owner", None) == owner
    except Exception:  # noqa: BLE001
        return False


def _already_user_owned(sp_ws: "WorkspaceClient", warehouse_id: Optional[str],
                        a: OwnershipAction, owner: str) -> bool:
    """True if the UC object in `a` (dotted cat.sch.name) is already owned by
    `owner`. Idempotency guard for a re-reconcile where the SP can no longer
    ALTER because ownership already moved. Best-effort via the tables API (covers
    tables/views/metric-views — the classes that hit the transfer restriction);
    unknown/other types → False."""
    parts = a.value.split(".")
    if len(parts) != 3:
        return False
    try:
        info = sp_ws.tables.get(full_name=a.value)
        return getattr(info, "owner", None) == owner
    except Exception:  # noqa: BLE001
        return False


def _patch_permissions(sp_ws: "WorkspaceClient", object_type: str, object_id: str,
                       user_email: str, level: str) -> tuple[bool, Optional[str]]:
    """PATCH (merge) one CAN_MANAGE/IS_OWNER grant onto a workspace object.
    PATCH (not PUT) so the SP's own ACL is preserved."""
    path = f"/api/2.0/permissions/{object_type}/{object_id}"
    body = {"access_control_list": [{"user_name": user_email, "permission_level": level}]}
    try:
        sp_ws.api_client.do("PATCH", path, body=body)
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _share_agent(sp_ws: "WorkspaceClient", kind: str, tile_id: str,
                 user_email: str) -> tuple[bool, Optional[str]]:
    """Share a KA / MAS tile with the user (creator stays immutable owner)."""
    path = f"/api/2.0/{kind}/{tile_id}/share"
    body = {"principal": f"users:{user_email}"}
    try:
        sp_ws.api_client.do("POST", path, body=body)
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _set_model_owner(sp_ws: "WorkspaceClient", fqn: str,
                     user_email: str) -> tuple[bool, Optional[str]]:
    try:
        sp_ws.api_client.do("PATCH", f"/api/2.1/unity-catalog/models/{fqn}",
                            body={"owner": user_email})
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _q(ident: str) -> str:
    """Backtick-quote a SQL identifier / principal, escaping embedded backticks."""
    return "`" + ident.replace("`", "``") + "`"


def _fqn(catalog: str, schema: str, name: str) -> str:
    return f"{_q(catalog)}.{_q(schema)}.{_q(name)}"


def _enumerate_uc_children(sp_ws: "WorkspaceClient", warehouse_id: str,
                           catalog: str, schema: str) -> list[OwnershipAction]:
    """Enumerate the schema's tables/views/volumes/functions LIVE via
    information_schema — the lossless, manifest-independent source of truth for
    UC children. Best-effort: returns [] if the schema can't be read."""
    acts: list[OwnershipAction] = []
    cat_q = _q(catalog)
    sch = schema.replace("'", "''")

    def _rows(stmt: str) -> list[list[Any]]:
        try:
            resp = sp_ws.statement_execution.execute_statement(
                warehouse_id=warehouse_id, statement=stmt, wait_timeout="30s")
            for _ in range(15):
                state = str(getattr(resp.status, "state", "") or "").upper()
                if state.endswith("SUCCEEDED"):
                    data = getattr(getattr(resp, "result", None), "data_array", None)
                    return data or []
                if state.endswith(("FAILED", "CANCELED", "CLOSED")):
                    return []
                time.sleep(2)
                resp = sp_ws.statement_execution.get_statement(resp.statement_id)
            return []
        except Exception:  # noqa: BLE001 — schema unreadable ⇒ no children
            return []

    # Tables + views (table_type distinguishes VIEW / MATERIALIZED_VIEW / table).
    for row in _rows(
        f"SELECT table_name, table_type FROM {cat_q}.information_schema.tables "
        f"WHERE table_schema = '{sch}'"
    ):
        name, ttype = (row[0], (row[1] or "").upper())
        if not name:
            continue
        acts.append(OwnershipAction("<live>", f"{catalog}.{schema}.{name}",
                                    f"uc-{ttype.lower() or 'table'}", MECH_UC_OWNER, _ORDER_UC_CHILD))
    # Volumes
    for row in _rows(
        f"SELECT volume_name FROM {cat_q}.information_schema.volumes "
        f"WHERE volume_schema = '{sch}'"
    ):
        if row and row[0]:
            acts.append(OwnershipAction("<live>", f"{catalog}.{schema}.{row[0]}",
                                        "uc-volume", MECH_UC_OWNER, _ORDER_UC_CHILD))
    # Functions
    for row in _rows(
        f"SELECT routine_name FROM {cat_q}.information_schema.routines "
        f"WHERE routine_schema = '{sch}'"
    ):
        if row and row[0]:
            acts.append(OwnershipAction("<live>", f"{catalog}.{schema}.{row[0]}",
                                        "uc-function", MECH_UC_OWNER, _ORDER_UC_CHILD))
    return acts


def _alter_target_fqn(action: OwnershipAction) -> Optional[str]:
    """Backtick-quoted `cat`.`sch`.`name` for a dotted-3-part UC action, else None."""
    parts = action.value.split(".")
    if len(parts) != 3:
        return None
    return ".".join(_q(p) for p in parts)


def _uc_object_kw(action: OwnershipAction) -> str:
    """The SQL object keyword for this UC action (TABLE / VIEW / VOLUME / …).
    Used by both `ALTER <kw> … OWNER TO` and the `GRANT … ON <kw> …` fallback so
    they always agree on the object type."""
    rt = action.rtype
    if action.mechanism == MECH_UC_METRIC:
        return "VIEW"  # metric views resolve as views in most runtimes
    if "view" in rt:
        return "MATERIALIZED VIEW" if "materialized" in rt else "VIEW"
    if "volume" in rt:
        return "VOLUME"
    if "function" in rt:
        return "FUNCTION"
    return "TABLE"


def _alter_owner_sql(action: OwnershipAction, user_email: str) -> Optional[str]:
    """Build the ALTER … OWNER TO statement for a UC action. `value` is a
    fully-qualified `catalog.schema.name` (dotted) for children; the bare
    schema is handled by the caller (schema uses catalog/schema args)."""
    fqn = _alter_target_fqn(action)
    if not fqn:
        return None
    return f"ALTER {_uc_object_kw(action)} {fqn} OWNER TO {_q(user_email)}"


def _is_owner_transfer_denied(err: Optional[str]) -> bool:
    """True when an ALTER … OWNER TO failed because the caller can't transfer
    ownership (esp. views → arbitrary user needs a METASTORE admin, which a
    workspace-admin SP is not). Matches the specific view message + the generic
    permission-denied so the GRANT-ALL fallback kicks in for any such block."""
    if not err:
        return False
    e = err.lower()
    return (
        "can only transfer ownership" in e
        or ("permission_denied" in e and "owner" in e)
        or "insufficient" in e and "owner" in e
    )


def reconcile_ownership(
    *,
    sp_ws: "WorkspaceClient",
    warehouse_id: Optional[str],
    user_email: str,
    manifest: dict[str, Any],
    catalog: Optional[str],
    schema: Optional[str],
    sp_client_id: Optional[str] = None,
    grant_only: bool = False,
    dry_run: bool = False,
) -> ReconcileResult:
    """Re-home every SP-created resource in `manifest` to `user_email`, running
    AS the deployer SP against its target workspace (`sp_ws`).

    Two modes:
    - `grant_only=False` (default, build-complete): transfer OWNERSHIP to the
      user (UC ALTER OWNER; jobs/pipelines IS_OWNER; CAN_MANAGE/share for the
      rest), then GRANT the SP write-back on the schema+tables so future
      SP-driven redeploys (the iterate flow) still work.
    - `grant_only=True` (mid-build, CUJ1): give the user READ access WITHOUT
      transferring ownership — GRANT USE CATALOG/USE SCHEMA/ALL PRIVILEGES on UC
      objects (SP stays owner so the in-flight build keeps USE_SCHEMA and doesn't
      break) + the already-additive CAN_MANAGE/IS_OWNER/share for non-UC. No
      ALTER OWNER at all in this mode.

    `sp_client_id` (the deployer SP's application id) is required for the
    write-back grants; if absent they're skipped (with a logged warning).
    Ordering: non-UC → GRANT USE CATALOG → UC children → schema → SP write-back.
    `dry_run=True` plans without executing. Best-effort + idempotent; per-resource
    failures are collected, never raised."""
    result = ReconcileResult()
    created = _created_resources(manifest)

    # Manifest-derived actions (lossless, per-instance).
    actions = classify(created)

    # Resolve the catalog/schema for UC work: prefer the manifest's own values
    # (that's where the resources actually landed), fall back to the args.
    cat = created.get("catalog") or catalog
    sch = created.get("schema") or schema

    # Live UC children (manifest-independent, lossless) — only if we can run SQL.
    have_uc = bool(cat and sch and warehouse_id
                   and not _is_placeholder(str(cat)) and not _is_placeholder(str(sch)))
    if have_uc:
        actions.extend(_enumerate_uc_children(sp_ws, warehouse_id, str(cat), str(sch)))
        # The user needs USE CATALOG to traverse to their (soon-to-be-owned)
        # schema; the catalog itself stays SP-owned.
        actions.append(OwnershipAction("catalog", str(cat), "catalog-use-grant",
                                       "catalog_use_grant", _ORDER_CATALOG_GRANT))

    # Lakebase DATA-plane grant. classify() maps the lakebase trio to a
    # CAN_MANAGE on the database-PROJECT (slug, control plane) + SKIPs the id +
    # database children. But Postgres has its OWN permission model: the SP that
    # deployed the demo owns the `dbgen_<name>` database, so the builder can't
    # even connect. Assemble ONE action here — where the whole trio is visible —
    # that (AS the SP) creates a USER Postgres role for the builder and GRANTs it
    # usage of the db. Carries the project slug + db name; the builder email is
    # the grant target (`user_email`). The branch isn't in the manifest — the
    # executor resolves it. Additive + idempotent, so it also passes through the
    # grant_only (mid-build) transform below unchanged, like MECH_LAKEBASE.
    # Prefer the EXACT canonical keys (how the app writes the trio) so we never
    # cross-pair a `lakebase_project_slug` with a *different* resource's prefixed
    # `..._lakebase_database` — that mispair would target a db that isn't on the
    # resolved branch. Fall back to suffix-matching only when an exact key is
    # absent (older/prefixed-only manifests).
    def _exact_or_suffix(exact: str, suffix: str) -> Optional[str]:
        v = created.get(exact)
        if isinstance(v, (str, int, float)) and str(v).strip() and not _is_placeholder(str(v).strip()):
            return str(v).strip()
        return _first_value_by_suffix(created, suffix)

    lb_slug = _exact_or_suffix("lakebase_project_slug", "lakebase_project_slug")
    lb_db = _exact_or_suffix("lakebase_database", "lakebase_database")
    if lb_slug and lb_db:
        actions.append(OwnershipAction(
            "lakebase_project_slug", f"{lb_slug}/{lb_db}",
            "database-pgrole", MECH_LAKEBASE_PGROLE))

    if grant_only:
        # MID-BUILD: turn every ownership TRANSFER into an additive GRANT so the
        # user can read the resource but the SP keeps owning it (build unbroken).
        actions = [_as_grant_only(a, str(sch) if sch else None) for a in actions]
        # The user also needs USE SCHEMA to traverse into the (SP-owned) schema.
        if have_uc:
            actions.append(OwnershipAction(str(sch), f"{cat}.{sch}", "schema-use-grant",
                                           MECH_SCHEMA_GRANT, _ORDER_CATALOG_GRANT))
    elif have_uc and sp_client_id:
        # BUILD-COMPLETE: after transferring the schema + tables to the user,
        # re-arm the SP's write access so future redeploys (iterate flow) work.
        # Runs LAST (order 30). The SP can grant these as catalog owner.
        actions.append(OwnershipAction(sp_client_id, f"{cat}.{sch}", "sp-schema-writeback",
                                       MECH_SP_SCHEMA_WRITEBACK, _ORDER_SP_WRITEBACK))
        for child in _enumerate_uc_children(sp_ws, warehouse_id, str(cat), str(sch)):
            # CREATE OR REPLACE of a user-owned TABLE needs SELECT+MODIFY on it
            # (schema-level MODIFY alone isn't enough — verified live). VIEWS take
            # SELECT only (MODIFY is not applicable to a view — verified live).
            # Volumes/functions are re-owned but not rewritten by redeploys, skip.
            # NOTE: information_schema table_type is MANAGED/EXTERNAL/VIEW/
            # MATERIALIZED_VIEW → rtype uc-managed / uc-external / uc-view / etc.
            rt = child.rtype
            is_view = "view" in rt
            is_table = rt in ("uc-managed", "uc-external", "uc-table") or "table" in rt
            if is_table or is_view:
                # carry the object type on the action so the executor picks the
                # right privilege set (a.rtype).
                actions.append(OwnershipAction(sp_client_id, child.value, rt,
                                               MECH_SP_TABLE_WRITEBACK, _ORDER_SP_WRITEBACK))
    elif have_uc and not sp_client_id:
        logger.warning("[reconcile] sp_client_id not provided — skipping SP "
                       "write-back grants; future redeploys of this project may "
                       "fail PERMISSION_DENIED on the user-owned schema")

    # De-dup identical (mechanism, value) actions (manifest + live can overlap;
    # idempotency makes overlap harmless, but dedup keeps the plan clean).
    seen: set[tuple[str, str]] = set()
    deduped: list[OwnershipAction] = []
    for a in sorted(actions, key=lambda x: x.order):
        sig = (a.mechanism, a.value)
        if sig in seen:
            continue
        seen.add(sig)
        deduped.append(a)

    work = [a for a in deduped if a.mechanism not in (MECH_SKIP, MECH_NOTE)]
    result.actions_planned = len(work)
    result.plan = [f"{a.rtype}: {a.value} → {a.mechanism}" for a in work]

    if dry_run:
        result.ran = False
        result.skipped_reason = "dry_run"
        return result

    if not work:
        result.ran = True
        result.skipped_reason = "nothing to reconcile"
        return result

    result.ran = True
    for a in work:  # ordered: non-UC → USE CATALOG → children → schema → SP writeback
        ok, err = _execute(sp_ws, warehouse_id, user_email, a,
                           str(cat) if cat else None, str(sch) if sch else None,
                           sp_client_id=sp_client_id)
        if ok:
            result.succeeded += 1
        elif a.mechanism == MECH_LAKEBASE_PGROLE:
            # Best-effort data-plane grant: a failure must NOT block the latch
            # (which gates on `failed == 0`). Otherwise a transient Lakebase
            # blip re-runs the ENTIRE reconcile on every deployed-resources
            # fetch. It self-heals via the manual grant tool or a later trigger.
            result.best_effort_failed += 1
            result.errors.append(f"{a.rtype} {a.value} (best-effort): {err}")
            logger.warning("[reconcile] best-effort %s %s failed (non-blocking): %s",
                           a.rtype, a.value, err)
        else:
            result.failed += 1
            result.errors.append(f"{a.rtype} {a.value}: {err}")
            logger.warning("[reconcile] %s %s failed: %s", a.rtype, a.value, err)

    return result


def _as_grant_only(a: OwnershipAction, schema: Optional[str]) -> OwnershipAction:
    """Mid-build (CUJ1): rewrite an ownership-TRANSFER action into an additive
    GRANT that gives the user read access WITHOUT changing the owner, so the SP
    keeps USE_SCHEMA and the in-flight build isn't broken. Non-transfer actions
    (CAN_MANAGE / IS_OWNER / share / catalog-use-grant) are already additive and
    pass through unchanged."""
    if a.mechanism in (MECH_UC_OWNER, MECH_UC_METRIC):
        # GRANT ALL PRIVILEGES on the object (keeps order = UC child).
        return OwnershipAction(a.key, a.value, a.rtype, MECH_UC_GRANT, _ORDER_UC_CHILD)
    if a.mechanism == MECH_UC_SCHEMA:
        # Don't transfer the schema mid-build — GRANT USE SCHEMA instead.
        return OwnershipAction(a.key, a.value, a.rtype, MECH_SCHEMA_GRANT, _ORDER_CATALOG_GRANT)
    if a.mechanism == MECH_UC_MODEL:
        # No mid-build model transfer; models are rarely opened mid-build and the
        # models API has no simple additive grant here — leave as NOTE (skip).
        return OwnershipAction(a.key, a.value, a.rtype, MECH_NOTE, a.order)
    return a


# ---------------------------------------------------------------------------
# Lakebase data-plane grant (MECH_LAKEBASE_PGROLE)
#
# Mirrors app_template/scripts/lakebase_grant_app_credential.sh — but grants a
# USER (the builder) instead of the app SP. Runs AS the deployer SP (`sp_ws`),
# which owns the `dbgen_<name>` database, so it can create the role and GRANT.
# Reuses the OAuth primitives + psycopg connect pattern from core/lakebase.py.
# ---------------------------------------------------------------------------

# The db is created on the `production` branch by default (lakebase_setup_db.sh),
# and the trio in resources.json carries no branch — so default here and let the
# executor prefer the branch actually carrying the db when it can determine it.
_LAKEBASE_DEFAULT_BRANCH = "production"


def _first_value_by_suffix(created: dict[str, Any], suffix: str) -> Optional[str]:
    """First non-placeholder scalar value whose key ends with `suffix` (case-
    insensitive). Mirrors classify()'s suffix matching so a prefixed key
    (`foo_lakebase_database`) is still found."""
    for k, v in created.items():
        if isinstance(v, (str, int, float)) and str(k).lower().endswith(suffix):
            s = str(v).strip()
            if s and not _is_placeholder(s):
                return s
    return None


def _pgrole_id_for_user(email: str) -> str:
    """A valid Lakebase role *resource id* (must match ^[a-z]([a-z0-9-]*)$) derived
    from a user email. This is only the resource-path slug — the role's
    `postgres_role` (the actual Postgres role NAME) stays the bare email. Mirrors
    the app-SP script's `sp-<uuid>` convention with a `user-` prefix.

    A short hash of the email is appended so two distinct emails that slugify to
    the same string (e.g. `a.b@x.com` and `a-b@x.com` both → `a-b-x-com`) get
    DISTINCT resource ids on the shared branch — otherwise the second create-role
    would collide and be swallowed as ALREADY_EXISTS, and that builder's role
    would never be created."""
    import hashlib
    norm = email.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", norm).strip("-")[:40] or "x"
    h = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:8]
    return f"user-{slug}-{h}"


def _pg_quote(ident: str) -> str:
    """Double-quote a Postgres identifier / role name, escaping embedded quotes."""
    return '"' + ident.replace('"', '""') + '"'


def _pgrole_grant_sql(db_name: str, email: str) -> list[str]:
    """The idempotent data-plane GRANTs letting `email` use the SP-owned
    `dbgen_<name>` database (Postgres no-ops repeated GRANTs). The USER-scoped
    analogue of the app-SP recipe in lakebase_grant_app_credential.sh — which is
    why it must cover the app's OWN schemas (`app`/`appkit`/`drizzle`), NOT just
    `public`: the demo's tables are created under `pgSchema('app')` (the Delta→
    Lakebase mirror), so a public-only grant leaves the builder unable to read
    their own data even though the reconcile reports success."""
    d, u = _pg_quote(db_name), _pg_quote(email)
    lit = "'" + email.replace("'", "''") + "'"  # email as a SQL string literal (for format() args)
    return [
        f"GRANT CONNECT ON DATABASE {d} TO {u}",
        # public — the default landing schema.
        f"GRANT USAGE, CREATE ON SCHEMA public TO {u}",
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {u}",
        f"GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO {u}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {u}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO {u}",
        # app/appkit/drizzle — where the demo's data actually lives. Best-effort
        # per schema (skip one that isn't present yet, or that the SP can't grant
        # on) so a partial layout never fails the whole reconcile. Mirrors the
        # app/appkit/drizzle block in lakebase_grant_app_credential.sh.
        f"""DO $do$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['app','appkit','drizzle'] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
      BEGIN
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, {lit});
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', s, {lit});
        EXECUTE format('GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA %I TO %I', s, {lit});
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', s, {lit});
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, USAGE ON SEQUENCES TO %I', s, {lit});
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'reconcile: cannot grant on schema % (not owner) — skipping', s;
      END;
    END IF;
  END LOOP;
END $do$;""",
    ]


def _lakebase_role_exists(sp_ws: "WorkspaceClient", branch_path: str, email: str) -> bool:
    """True if a Postgres role for this USER identity already exists on the branch
    (idempotency guard for create-role). Best-effort: unknown → False."""
    try:
        resp = sp_ws.api_client.do("GET", f"/api/2.0/postgres/{branch_path}/roles")
        for r in (resp.get("roles", []) if isinstance(resp, dict) else []):
            if not isinstance(r, dict):
                continue
            st = r.get("status") or {}
            sp = r.get("spec") or {}
            if st.get("postgres_role") == email or sp.get("postgres_role") == email:
                return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _ensure_lakebase_user_role(sp_ws: "WorkspaceClient", branch_path: str, email: str) -> None:
    """Create a USER Postgres role for `email` on the branch if absent — the USER
    analogue of the app-SP create-role in lakebase_grant_app_credential.sh.
    Idempotent: guarded by list-roles; tolerates an ALREADY_EXISTS race."""
    if _lakebase_role_exists(sp_ws, branch_path, email):
        return
    try:
        sp_ws.api_client.do(
            "POST", f"/api/2.0/postgres/{branch_path}/roles",
            query={"role_id": _pgrole_id_for_user(email)},
            body={"spec": {"identity_type": "USER", "postgres_role": email,
                           "auth_method": "LAKEBASE_OAUTH_V1"}},
        )
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "already" in msg or "exists" in msg:
            logger.info("[reconcile] lakebase role for %s already exists on %s", email, branch_path)
            return
        raise


def _resolve_lakebase_branch(sp_ws: "WorkspaceClient", slug: str, db_name: str,
                             default: str = _LAKEBASE_DEFAULT_BRANCH) -> str:
    """Best-effort: return the branch whose database set contains `db_name`, else
    `default` (`production`). The manifest carries no branch, and the db lives on
    the branch it was created on. Never raises — falls back to `default`."""
    try:
        resp = sp_ws.api_client.do("GET", f"/api/2.0/postgres/projects/{slug}/branches")
        branches = resp.get("branches", []) if isinstance(resp, dict) else []
        ids: list[str] = []
        for b in branches:
            name = (b.get("name") or "") if isinstance(b, dict) else ""
            bid = name.rstrip("/").split("/")[-1] if name else ""
            if bid:
                ids.append(bid)
        # Check the default branch first, then any others.
        ordered = ([default] if default in ids else []) + [b for b in ids if b != default]
        for bid in (ordered or [default]):
            try:
                dbs = sp_ws.api_client.do(
                    "GET", f"/api/2.0/postgres/projects/{slug}/branches/{bid}/databases")
                for d in (dbs.get("databases", []) if isinstance(dbs, dict) else []):
                    if not isinstance(d, dict):
                        continue
                    spec = d.get("spec") or {}
                    nm = (d.get("name") or "").rstrip("/").split("/")[-1]
                    if spec.get("postgres_database") == db_name or nm == db_name:
                        return bid
            except Exception:  # noqa: BLE001
                continue
    except Exception:  # noqa: BLE001
        pass
    return default


def _lakebase_oauth(sp_ws: "WorkspaceClient", branch_path: str,
                    db_name: str) -> tuple[str, str, str]:
    """Resolve the branch READ_WRITE endpoint + mint an SP OAuth token, reusing
    core.lakebase's primitives. Returns (host, pg_user, token) — pg_user is the
    SP identity (the db owner). A thin seam so tests stub the whole Lakebase-
    client interaction without importing psycopg / the SDK.

    We hand `_resolve_endpoint` a path whose last segment is the Postgres db NAME
    (`dbgen_<name>`); it only uses that segment for the connect dbname, which is
    exactly what we want (we connect to the db, not to its resource id)."""
    from ..core import lakebase as lb  # local: keep psycopg/SDK off the import path
    endpoint = lb._resolve_endpoint(sp_ws, f"{branch_path}/databases/{db_name}")
    cred = lb._mint_token(sp_ws, endpoint.endpoint_path)
    return endpoint.host, lb._user_from_token(cred.token), cred.token


def _pg_connect(host: str, dbname: str, user: str, password: str):
    """Open a psycopg connection to a Lakebase db (autocommit — each idempotent
    GRANT commits independently). A thin seam so tests stub it without psycopg."""
    import psycopg  # local: only needed on the actual execution path
    return psycopg.connect(host=host, port=5432, dbname=dbname, user=user,
                           password=password, sslmode="require", autocommit=True)


def _grant_lakebase_pgrole(sp_ws: "WorkspaceClient", slug_and_db: str,
                           user_email: str) -> tuple[bool, Optional[str]]:
    """Data-plane Lakebase grant for the builder: create a USER Postgres role for
    `user_email` and GRANT it usage of the SP-owned `dbgen_<name>` database, AS
    the deployer SP (`sp_ws`, the db owner). Best-effort + idempotent. Failures are
    logged loudly and returned as (False, err) — never raised — so the rest of the
    reconcile continues. `slug_and_db` is "<project-slug>/<db-name>"."""
    slug, _, db_name = slug_and_db.partition("/")
    if not slug or not db_name:
        return False, f"malformed lakebase pgrole target {slug_and_db!r}"

    branch = _resolve_lakebase_branch(sp_ws, slug, db_name)
    branch_path = f"projects/{slug}/branches/{branch}"

    # 1. Ensure the builder's USER Postgres role exists (create AS the SP).
    try:
        _ensure_lakebase_user_role(sp_ws, branch_path, user_email)
    except Exception as e:  # noqa: BLE001
        logger.warning("[reconcile] lakebase create-role for %s on %s failed: %s",
                       user_email, branch_path, e)
        return False, f"create-role failed: {type(e).__name__}: {e}"

    # 2. Resolve the RW endpoint + mint an SP token, then connect to the db AS the
    #    SP (the owner) and run the idempotent GRANTs.
    try:
        host, pg_user, token = _lakebase_oauth(sp_ws, branch_path, db_name)
        with _pg_connect(host, db_name, pg_user, token) as conn:
            with conn.cursor() as cur:
                for stmt in _pgrole_grant_sql(db_name, user_email):
                    cur.execute(stmt)
    except Exception as e:  # noqa: BLE001
        logger.warning("[reconcile] lakebase GRANTs on %s for %s failed: %s",
                       db_name, user_email, e)
        return False, f"grant failed: {type(e).__name__}: {e}"

    logger.info("[reconcile] lakebase pgrole granted: db=%s user=%s branch=%s",
                db_name, user_email, branch)
    return True, None


def _execute(sp_ws: "WorkspaceClient", warehouse_id: Optional[str], user_email: str,
             a: OwnershipAction, catalog: Optional[str], schema: Optional[str],
             sp_client_id: Optional[str] = None) -> tuple[bool, Optional[str]]:
    """Dispatch one OwnershipAction to its verified mechanism."""
    m = a.mechanism

    # --- SP write-back grants (grantee = the SP, from a.key) ---
    if m == MECH_SP_SCHEMA_WRITEBACK:
        if not (warehouse_id and catalog and schema):
            return False, "no warehouse/catalog/schema for SP schema write-back"
        # GRANT ALL PRIVILEGES ON SCHEMA — the SP needs to re-run arbitrary
        # deploy DDL into a user-owned schema (create/replace tables, views,
        # functions, volumes, models; MODIFY existing). Enumerating individual
        # privileges is brittle: `CREATE VIEW` is NOT a valid schema privilege in
        # UC (privilege version 1.0 — verified live; views are created under
        # CREATE TABLE), and the set evolves. ALL PRIVILEGES is valid, covers
        # every object type the agent may emit, and matches the accepted design
        # decision that the SP retains write-back to the schema. Idempotent.
        return _run_sql(
            sp_ws, warehouse_id,
            f"GRANT ALL PRIVILEGES ON SCHEMA {_q(catalog)}.{_q(schema)} TO {_q(a.key)}")
    if m == MECH_SP_TABLE_WRITEBACK:
        if not warehouse_id:
            return False, "no warehouse for SP table write-back"
        fqn = _alter_target_fqn(a)
        if not fqn:
            return True, None  # non-3-part → nothing to grant
        # Views take SELECT only (MODIFY is not applicable to a view — a
        # user-owned view is rebuilt via CREATE OR REPLACE VIEW, which needs
        # SELECT on it + CREATE VIEW at the schema level, not table MODIFY).
        # Tables take SELECT + MODIFY (for CREATE OR REPLACE / MERGE / writes).
        kw = _uc_object_kw(a)  # VIEW / MATERIALIZED VIEW / TABLE
        privs = "SELECT" if "VIEW" in kw else "SELECT, MODIFY"
        return _run_sql(sp_ws, warehouse_id,
                        f"GRANT {privs} ON {kw} {fqn} TO {_q(a.key)}")

    # --- mid-build grant-only (grantee = user; no ownership change) ---
    if m == MECH_UC_GRANT:
        if not warehouse_id:
            return False, "no warehouse for UC grant"
        fqn = _alter_target_fqn(a)
        if not fqn:
            return False, f"unclassifiable UC value {a.value!r}"
        return _run_sql(sp_ws, warehouse_id,
                        f"GRANT ALL PRIVILEGES ON {_uc_object_kw(a)} {fqn} TO {_q(user_email)}")
    if m == MECH_SCHEMA_GRANT:
        if not (warehouse_id and catalog and schema):
            return False, "no warehouse/catalog/schema for schema-use grant"
        return _run_sql(sp_ws, warehouse_id,
                        f"GRANT USE SCHEMA ON SCHEMA {_q(catalog)}.{_q(schema)} TO {_q(user_email)}")

    # --- UC (SQL) ---
    if m in (MECH_UC_OWNER, MECH_UC_METRIC):
        if not warehouse_id:
            return False, "no warehouse for UC ALTER"
        stmt = _alter_owner_sql(a, user_email)
        if not stmt:
            return False, f"unclassifiable UC value {a.value!r}"
        ok, err = _run_sql(sp_ws, warehouse_id, stmt)
        # Metric views sometimes resolve as tables — retry once as ALTER TABLE.
        if not ok and m == MECH_UC_METRIC:
            parts = a.value.split(".")
            if len(parts) == 3:
                fqn = ".".join(_q(p) for p in parts)
                ok, err = _run_sql(sp_ws, warehouse_id, f"ALTER TABLE {fqn} OWNER TO {_q(user_email)}")
        # OWNERSHIP-TRANSFER FALLBACK. Databricks blocks `ALTER VIEW … OWNER TO
        # <user>` unless the caller is a METASTORE admin (a workspace-admin SP is
        # NOT enough) — non-admins "can only transfer ownership for views to
        # groups the owner is a member of". Tables have no such rule, so this
        # only ever bites views / metric views. When the transfer is denied,
        # give the user the highest access we CAN (verified: GRANT ALL
        # PRIVILEGES succeeds as the owning SP), so the resource is still fully
        # usable even though the SP stays the nominal owner. Consistent with the
        # non-UC "CAN_MANAGE where we can't set owner" policy.
        if not ok and _is_owner_transfer_denied(err):
            g_ok, g_err = _run_sql(
                sp_ws, warehouse_id,
                f"GRANT ALL PRIVILEGES ON {_uc_object_kw(a)} {_alter_target_fqn(a)} TO {_q(user_email)}",
            )
            if g_ok:
                return True, None
            # IDEMPOTENCY: on a re-reconcile the schema may already be user-owned,
            # so the SP (no longer owner, only write-back grants) can neither
            # ALTER nor GRANT. If the object is ALREADY owned by the user, that's
            # success, not failure — don't block the hash from latching.
            if _already_user_owned(sp_ws, warehouse_id, a, user_email):
                return True, None
            return False, f"owner-transfer denied ({err}); grant fallback also failed: {g_err}"
        if not ok and _already_user_owned(sp_ws, warehouse_id, a, user_email):
            return True, None
        return ok, err
    if m == MECH_UC_SCHEMA:
        if not (warehouse_id and catalog and schema):
            return False, "no warehouse/catalog/schema for schema ALTER"
        ok, err = _run_sql(sp_ws, warehouse_id,
                           f"ALTER SCHEMA {_q(catalog)}.{_q(schema)} OWNER TO {_q(user_email)}")
        # IDEMPOTENCY: already user-owned (re-reconcile) → success, not failure.
        if not ok and _schema_owned_by(sp_ws, warehouse_id, catalog, schema, user_email):
            return True, None
        return ok, err
    if m == MECH_UC_MODEL:
        return _set_model_owner(sp_ws, a.value, user_email)
    if m == "catalog_use_grant":
        if not warehouse_id:
            return False, "no warehouse for catalog grant"
        return _run_sql(sp_ws, warehouse_id,
                        f"GRANT USE CATALOG ON CATALOG {_q(a.value)} TO {_q(user_email)}")

    # --- workspace objects (permissions REST) ---
    if m == MECH_JOB:
        return _patch_permissions(sp_ws, "jobs", a.value, user_email, "IS_OWNER")
    if m == MECH_PIPELINE:
        return _patch_permissions(sp_ws, "pipelines", a.value, user_email, "IS_OWNER")
    if m == MECH_GENIE:
        return _patch_permissions(sp_ws, "genie", a.value, user_email, "CAN_MANAGE")
    if m == MECH_DASHBOARD:
        return _patch_permissions(sp_ws, "dashboards", a.value, user_email, "CAN_MANAGE")
    if m == MECH_ENDPOINT:
        return _patch_permissions(sp_ws, "serving-endpoints", a.value, user_email, "CAN_MANAGE")
    if m == MECH_APP:
        return _patch_permissions(sp_ws, "apps", a.value, user_email, "CAN_MANAGE")
    if m == MECH_LAKEBASE:
        return _patch_permissions(sp_ws, "database-projects", a.value, user_email, "CAN_MANAGE")
    if m == MECH_LAKEBASE_PGROLE:
        # a.value is "<project-slug>/<db-name>"; the grant target is `user_email`.
        return _grant_lakebase_pgrole(sp_ws, a.value, user_email)

    # --- KA / MAS bespoke share ---
    if m == MECH_KA_SHARE:
        return _share_agent(sp_ws, "knowledge-assistants", a.value, user_email)
    if m == MECH_MAS_SHARE:
        return _share_agent(sp_ws, "multi-agent-supervisors", a.value, user_email)

    return False, f"unknown mechanism {m}"
