"""
Database models and Pydantic schemas for the Databricks Asset Generator.

Clean break from previous generation/block/collection system.
New project-based architecture with file sync and Claude Code integration.
"""

from __future__ import annotations

import json
import uuid
import zlib
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field
from sqlalchemy import Column, Index, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSON
from sqlmodel import Field as SQLField, SQLModel

from .. import __version__


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------


def generate_uuid() -> str:
    """Generate a UUID string for project/execution IDs."""
    return str(uuid.uuid4())


# Length of the per-project resource suffix (see `resource_suffix`).
RESOURCE_SUFFIX_LEN = 6


def resource_suffix(project_id: str) -> str:
    """The short per-project identifier stamped onto every Databricks resource a
    project creates — the schema tail (`demo_<slug>_<suffix>`) and the suffix the
    build agent appends to workspace-level resource names (pipeline, dashboard,
    Genie space, job, endpoint; legacy KA/MAS…).

    It's the first `RESOURCE_SUFFIX_LEN` hex chars of the project's uuid4 id, so
    it's stable, needs no round-trip, and matches the id prefix visible in the
    project URL — you can eyeball a schema/resource name and know which project it
    belongs to. Project ids are always uuid4 (`generate_uuid`); we lowercase +
    keep only hex to stay a valid SQL/UC identifier fragment even if a non-uuid id
    ever slips in.

    The point is cross-fork isolation: two SAs forking the SAME template generate
    the same descriptive base name, so without a per-project suffix they collide
    into one shared schema (pipeline-ownership war). The suffix makes that collision
    astronomically unlikely — two same-template forks would have to share a 6-hex
    prefix (~1 in 16.7M). The SCHEMA also gets `_resolve_unique_schema_name` as a
    hard backstop; the peripheral resource names the build agent derives from the
    suffix (pipeline, dashboard, Genie, job, endpoint) rely on the suffix's
    uniqueness alone, which is fine at this scale.
    """
    hexchars = "".join(c for c in (project_id or "").lower() if c in "0123456789abcdef")
    return hexchars[:RESOURCE_SUFFIX_LEN]


def utc_now() -> datetime:
    """Get current UTC timestamp."""
    return datetime.now(timezone.utc)


def compress_reasoning(data: dict | None) -> bytes | None:
    """Compress reasoning data using zlib (fast compression). Returns raw bytes."""
    if not data:
        return None
    json_bytes = json.dumps(data).encode("utf-8")
    return zlib.compress(json_bytes, level=1)  # level 1 = fastest


def decompress_reasoning(data: bytes | None) -> dict | None:
    """Decompress reasoning data from bytes."""
    if not data:
        return None
    try:
        json_bytes = zlib.decompress(data)
        return json.loads(json_bytes.decode("utf-8"))
    except Exception:
        return None  # Corrupted or invalid data


# ---------------------------------------------------------------------------
# Version endpoint model
# ---------------------------------------------------------------------------


class VersionOut(BaseModel):
    version: str

    @classmethod
    def from_metadata(cls):
        return cls(version=__version__)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ProjectType(str, Enum):
    DATABRICKS_DEMO = "DATABRICKS_DEMO"


class ProjectStage(str, Enum):
    """Lifecycle stages for a project build pipeline.

    DRAFTING → SUMMARIZED → ARCHITECTED (optional) → SPECIFICATION → BUILT → BUNDLED
    """
    DRAFTING = "DRAFTING"
    SUMMARIZED = "SUMMARIZED"        # README.md exists
    ARCHITECTED = "ARCHITECTED"      # architecture.md exists (optional)
    SPECIFICATION = "SPECIFICATION"  # specifications/*.md files exist
    BUILT = "BUILT"                  # .py/.sql files + resources.json with IDs
    BUNDLED = "BUNDLED"              # databricks.yml exists (DAB)


# Buildable capability -> canonical keys in resources.json that indicate
# it has been deployed. A capability is satisfied if AT LEAST ONE matching
# key has a non-empty value anywhere in the resources.json tree.
# Capabilities not listed (or listed with []) don't require a deployed ID.
_CAPABILITY_RESOURCE_KEYS: dict[str, list[str]] = {
    "sdp": ["pipeline_id"],
    # Synthetic data is "built" once data has landed in a target — either via an
    # SDP pipeline (pipeline_id) OR, for a simple no-SDP demo, directly into a
    # catalog/schema (the data-gen script writes tables there, no pipeline). A
    # simple demo records catalog+schema but no pipeline_id, so keying only on
    # pipeline_id wrongly showed "Not built yet" for every no-SDP demo.
    "synthetic-data-gen": ["pipeline_id", "catalog", "schema"],
    "lakeflow-connect": ["pipeline_id"],
    # Surface the demo's catalog/schema as a first-class "Unity Catalog" tile
    # (the frontend maps deployed_type=catalog_explorer → a TARGET-host Catalog
    # Explorer link that _build_deployed_links already produces). Without this,
    # catalog+schema were present in resources.json but rendered only as a small
    # footer button, never a resource tile — so "the data doesn't show up".
    "unity-catalog": ["catalog", "schema"],
    "aibi-dashboards": ["dashboard_id"],
    "genie": ["genie_space_id"],
    # Documents answered by the Genie agent (the replacement for KA). Built once the
    # PDFs' UC volume is recorded; the index-SUCCEEDED wait happens in the build.
    "unstructured-documents": ["documents_volume"],
    # Legacy: existing demos still carry KA/MAS in their buildable list, so keep the
    # keys to keep their BUILT meter honest. New projects never select these.
    "knowledge-assistant": ["knowledge_assistant_id", "knowledge_assistant_endpoint"],
    "supervisor-agent": ["multi_agent_supervisor_id", "multi_agent_supervisor_endpoint"],
    "databricks-apps": ["app_id", "app_name", "app_url"],
    "lakebase": ["lakebase_project_id", "lakebase_project_slug", "lakebase_database"],
    "metric-views": ["metric_view_name"],
    "ml-training-serving": ["mlflow_experiment_path", "serving_endpoint_name"],
    "vector-search": ["vector_index_full_name"],
}


def _iter_string_values(node: object):
    """Walk an arbitrarily nested JSON tree, yielding (key, value) pairs
    where value is a non-empty string. Used to scan resources.json without
    being sensitive to whether the agent emitted flat or nested shapes."""
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str) and v.strip():
                yield k, v
            else:
                yield from _iter_string_values(v)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_string_values(item)


def capability_build_status(resources_json_text: str) -> list["CapabilityBuildStatus"]:
    """Per-capability build status derived from resources.json — the single
    source of truth for the UI's live "N of N ready" meter AND the BUILT gate.

    Returns one entry per `capabilities.buildable` slug that maps to a
    deployable resource (has an entry in `_CAPABILITY_RESOURCE_KEYS`); each is
    `built=True` once ANY of its required keys is present + non-empty anywhere
    in the JSON tree. Slugs with no required keys (talking-track, unknown-to-us)
    are OMITTED — they aren't buildable resources, so they never count toward the
    meter (this is what the frontend used to express via its `HIDDEN_SLUGS` set).
    NOTE: `unity-catalog` + `synthetic-data-gen` now key off catalog+schema so the
    demo's data surfaces as a built tile (the target-host Catalog Explorer link).
    NOT streaming-gated, so it's valid to read live as keys land during a build.

    Conservative on parse failure / missing manifest: returns [] (no basis to
    report per-capability status).
    """
    import json
    try:
        data = json.loads(resources_json_text)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, dict):
        return []

    caps_section = data.get("capabilities") or {}
    buildable = caps_section.get("buildable") if isinstance(caps_section, dict) else None
    if not isinstance(buildable, list) or not buildable:
        return []

    populated_keys: set[str] = {k for k, _ in _iter_string_values(data)}
    # The app block is conventionally NESTED (`app: {name, id, url}`) — see
    # SKILL.md + resources_extractor's flattening rule. The tree-walk above
    # yields its sub-keys as bare `name`/`id`/`url`, which don't match the
    # canonical `app_name`/`app_id`/`app_url` in _CAPABILITY_RESOURCE_KEYS. Map
    # them here so a nested (and preview-only, id-less) app still registers as
    # built via `app_name`. Mirrors the extractor so the meter + BUILT gate
    # agree with the extracted flat shape the UI links off.
    created = data.get("created_resources")
    app_obj = created.get("app") if isinstance(created, dict) else None
    if isinstance(app_obj, dict):
        for nested, canonical in (("name", "app_name"), ("id", "app_id"), ("url", "app_url")):
            v = app_obj.get(nested)
            if isinstance(v, str) and v.strip():
                populated_keys.add(canonical)

    out: list[CapabilityBuildStatus] = []
    seen: set[str] = set()
    for slug in buildable:
        if not isinstance(slug, str) or slug in seen:
            continue
        required = _CAPABILITY_RESOURCE_KEYS.get(slug)
        if not required:
            # No deployable resource (e.g. unity-catalog) or unknown slug —
            # not part of the buildable meter.
            continue
        seen.add(slug)
        out.append(
            CapabilityBuildStatus(
                slug=slug,
                built=any(k in populated_keys for k in required),
            )
        )
    return out


def _all_buildable_capabilities_built(resources_json_text: str) -> bool:
    """True when every buildable, deployable `capabilities.buildable` entry has
    a matching deployed-resource key populated. Shares its per-capability logic
    with `capability_build_status` so the boolean gate and the UI meter can
    never disagree. Conservative on parse failure (returns False so we don't
    claim BUILT on broken JSON).

    When there's no usable capability manifest, `capability_build_status`
    returns [] — we treat that as "all built" (True) to preserve the prior
    file-based heuristic: the agent hasn't populated the structured manifest
    yet, so there's no basis to gate on."""
    import json
    try:
        data = json.loads(resources_json_text)
    except (ValueError, TypeError):
        return False
    if not isinstance(data, dict):
        return False

    statuses = capability_build_status(resources_json_text)
    # No per-capability basis (missing/empty manifest) → don't block BUILT.
    if not statuses:
        return True
    return all(s.built for s in statuses)


def compute_project_stage(
    file_paths: list[str],
    resources_json_text: str | None = None,
    is_streaming: bool = False,
) -> str:
    """Derive the project stage from its file paths.

    Checks from highest stage downward so the first match wins.

    When `resources_json_text` is provided, BUILT additionally requires
    that every `capabilities.buildable` entry has a matching deployed
    resource key in `created_resources`. Otherwise the heuristic stays
    file-only — a `.py`/`.sql` + `resources.json` was enough, which made
    BUILT trigger before the supervisor/app capabilities were actually
    deployed.

    `is_streaming`: while the agent is actively working, a demo is NOT
    considered BUILT even if all resources are already deployed — the agent
    typically keeps going in the background (app bug-fixes, follow-up files).
    We only settle on BUILT once resources are ready AND the conversation is
    idle. (Callers apply this monotonically — see routes: once BUILT, a later
    streaming turn never demotes it back.)
    """
    path_set = {p.lower() for p in file_paths}
    names = {p.rsplit("/", 1)[-1] for p in path_set}

    if "databricks.yml" in names:
        return ProjectStage.BUNDLED.value

    has_code = any(p.endswith(".py") or p.endswith(".sql") for p in path_set)
    has_resources = "resources.json" in names
    if has_code and has_resources and not is_streaming:
        if resources_json_text is None or _all_buildable_capabilities_built(resources_json_text):
            return ProjectStage.BUILT.value
        # File-level signals match BUILT but a requested buildable capability
        # has no deployed resource yet — stay at SPECIFICATION so the UI
        # doesn't suggest "package as DAB" prematurely.

    has_specifications = any(p.startswith("specifications/") and p.endswith(".md") for p in path_set)
    if has_specifications:
        return ProjectStage.SPECIFICATION.value

    if "architecture.md" in names:
        return ProjectStage.ARCHITECTED.value

    if "readme.md" in names:
        return ProjectStage.SUMMARIZED.value

    return ProjectStage.DRAFTING.value


_STAGE_ORDER = [
    ProjectStage.DRAFTING.value,
    ProjectStage.SUMMARIZED.value,
    ProjectStage.ARCHITECTED.value,
    ProjectStage.SPECIFICATION.value,
    ProjectStage.BUILT.value,
    ProjectStage.BUNDLED.value,
]


def merge_project_stage(new_stage: str, current_stage: str | None) -> str:
    """Monotonic stage: never go backwards. Once a demo reaches BUILT, a later
    streaming follow-up (which recomputes to SPECIFICATION while the agent works)
    must NOT demote it — the build already happened. Returns the more-advanced of
    the two. ARCHITECTED is 'optional' and off the main path, so treat an unknown
    stage as order 0 (never blocks an advance)."""
    def rank(s: str | None) -> int:
        try:
            return _STAGE_ORDER.index(s) if s else -1
        except ValueError:
            return -1
    return new_stage if rank(new_stage) >= rank(current_stage) else (current_stage or new_stage)


class ExecutionStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ERROR = "error"


class TemplateStatus(str, Enum):
    REVIEW_REQUESTED = "REVIEW_REQUESTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class TemplateType(str, Enum):
    """What KIND of template this is — drives gallery treatment + filtering.

    - SOLUTION: a full, ready-to-deploy demo (the default; every user-published
      template and every non-workshop seed).
    - WORKSHOP: a training starting point — data generator + specs + a bootstrap
      app the trainee builds out. NOT everything is pre-implemented.
    - GENIE_WORKSHOP: a Genie-Code workshop — the trainee builds the resources
      live in notebooks via Genie Code prompts.
    - ARCHITECTURE: an architecture diagram only (no build), for the arch-first flow.
    """
    SOLUTION = "SOLUTION"
    WORKSHOP = "WORKSHOP"
    GENIE_WORKSHOP = "GENIE_WORKSHOP"
    ARCHITECTURE = "ARCHITECTURE"


# ---------------------------------------------------------------------------
# SQLModel tables
# ---------------------------------------------------------------------------


class User(SQLModel, table=True):
    """
    User configuration for the application.

    Stores the user's email (auto-detected from Databricks CLI) and their
    preferred Databricks profile for workspace connections.
    """
    __tablename__ = "users"

    id: str = SQLField(
        default_factory=generate_uuid,
        primary_key=True,
        max_length=50,
    )
    email: str = SQLField(unique=True, index=True, max_length=255)
    databricks_profile: str = SQLField(default="DEFAULT", max_length=100)
    created_at: datetime = SQLField(default_factory=utc_now)
    updated_at: datetime = SQLField(default_factory=utc_now)


class Project(SQLModel, table=True):
    """
    A project - top-level container for files, messages, and agent sessions.

    Each project has a local directory at projects/{id}/ with files synced to DB.
    Single conversation per project (session_id used for Claude Code resumption).
    """
    __tablename__ = "projects"

    id: str = SQLField(
        default_factory=generate_uuid,
        primary_key=True,
        max_length=50,
    )
    user_email: str = SQLField(index=True, max_length=255)
    name: str = SQLField(max_length=255)
    description: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    # The real company this demo is being built FOR / personalized to. Seeded by
    # the project-metadata LLM at creation (best-effort guess from the prompt) and
    # confirmed when the user runs the brand search (which also writes
    # <project>/brand.json). User-editable. Null = not yet known.
    customer: Optional[str] = SQLField(default=None, max_length=255)
    # LLM-generated 1-2 paragraph storytelling summary of the demo, distinct
    # from `description` (which is the short one-liner the user can edit).
    # Regenerated when the README changes — see /projects/{id}/narrative.
    narrative: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    # Hash of the README content the narrative was generated from. Lets the
    # frontend decide whether to auto-regenerate when the README drifts.
    narrative_readme_hash: Optional[str] = SQLField(default=None, max_length=64)
    project_type: str = SQLField(default=ProjectType.DATABRICKS_DEMO.value, max_length=50)
    stage: str = SQLField(default=ProjectStage.DRAFTING.value, max_length=20)
    # Architecture-first lifecycle: created from the home page's "Describe your
    # architecture" mode. While True the workspace opens on the Architecture tab
    # and shows the "Build the solution" CTA; flipped to False when the user
    # kicks off the build from the architecture.
    architecture_first: bool = SQLField(default=False)
    # Home-page entry mode: "story" (default build flow), "architecture"
    # (lead-with-diagram — see architecture_first), or "workshop" (Genie Code
    # workshop: the agent writes the workshop HTML + data-gen + context instead
    # of provisioning resources). Drives which Build fork the agent takes.
    mode: str = SQLField(default="story", max_length=20)

    # Cross-workspace deploy (Option A): the TARGET workspace this
    # project's Databricks resources deploy INTO (an https workspace URL).
    # Null = deploy to the app's OWN
    # host workspace via the classic OBO path (unchanged behavior). When set
    # (and the deployer SP is configured), the agent's .databrickscfg points at
    # this host with the deployer-SP OAuth-M2M creds. See core/auth.py
    # write_project_sp_auth_file + AUTH.md.
    target_workspace_host: Optional[str] = SQLField(default=None, max_length=255)

    # Cross-workspace ownership reconcile (Option A): SHA-256 of the resource
    # set the last SP→user ownership-reconcile pass ran against (keyed to the
    # target user). Lets the reconcile skip re-running when nothing changed —
    # steady-state project opens cost one hash comparison, zero Databricks API
    # calls. Null = never reconciled. See remote_deploy/ownership_reconcile.py.
    ownership_reconciled_hash: Optional[str] = SQLField(default=None, max_length=64)
    # Companion to the above for the MID-BUILD grant-only pass (CUJ1): the hash
    # of the resource set the last grant-only reconcile ran against. Separate
    # latch so the mid-build grants and the build-complete ownership transfer
    # don't shadow each other's hash gate. Null = no mid-build grants yet.
    ownership_granted_hash: Optional[str] = SQLField(default=None, max_length=64)

    # Skills config (JSON array of skill names)
    skills: str = SQLField(default="[]", sa_column=Column(Text))

    # Claude Code session fields (1:1 conversation per project)
    session_id: Optional[str] = SQLField(default=None, max_length=100)
    active_execution_id: Optional[str] = SQLField(default=None, max_length=50)
    # Boot-time resume crash-loop guard (SP mode). Incremented each time an
    # interrupted conversation is auto-resumed on boot; reset to 0 on a clean
    # turn completion. The resume scan STOPS auto-resuming a project once this
    # reaches RESUME_MAX_ATTEMPTS (3) — a turn that reliably crashes the app is
    # then left interrupted for a human instead of resume-crash-looping across
    # deploys. See services/resume_agent. NULL is treated as 0.
    resume_attempts: Optional[int] = SQLField(default=0)
    # The current "driver" of the conversation — the user whose PAT the agent's
    # Databricks CLI runs as. STICKY: starts null (owner claims on first send) and
    # stays whoever last drove, even when idle. Only the driver's requests refresh
    # <project>/.databrickscfg + run the agent; another editor must explicitly take
    # over (POST /projects/{id}/take-over) to become driver. See AUTH.md.
    active_driver_email: Optional[str] = SQLField(default=None, max_length=255)
    # When the driver's PAT was last written to <project>/.databrickscfg. The
    # forwarded token lives ~60min; a non-driver may still RUN the agent on the
    # driver's token while it's fresh (<50min old), but is blocked once it's
    # stale (only the driver's own browser can mint a new one). NULL = never
    # written (unclaimed / local mode).
    active_driver_token_refreshed_at: Optional[datetime] = SQLField(default=None)
    # Set when a take-over happens; consumed (cleared) on the next agent turn,
    # which folds a one-line "operator changed to X" notice into the query so
    # CLAUDE learns the identity handoff — exactly once, no duplicate message.
    driver_handoff_pending: bool = SQLField(default=False)
    cluster_id: Optional[str] = SQLField(default=None, max_length=100)
    cluster_name: Optional[str] = SQLField(default=None, max_length=255)
    warehouse_id: Optional[str] = SQLField(default=None, max_length=100)
    warehouse_name: Optional[str] = SQLField(default=None, max_length=255)

    # Default Unity Catalog context
    default_catalog: Optional[str] = SQLField(default=None, max_length=255)
    default_schema: Optional[str] = SQLField(default=None, max_length=255)

    # Template lineage
    source_template_id: Optional[str] = SQLField(default=None, max_length=50)

    # Link access — "anyone with the link" sharing. "none" (default) = link
    # sharing off, access only via owner/admin/accepted-share. "viewer"/"editor"
    # = ANY signed-in user who opens the project URL gets that role without an
    # explicit email invite. Owner-only to change (see PATCH /link-access). Note
    # this grants access to authenticated app users with the link — not the
    # public internet (the Databricks App still requires workspace auth).
    link_access: str = SQLField(default="none", max_length=20)

    # Timestamps
    created_at: datetime = SQLField(default_factory=utc_now)
    updated_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_projects_user_created", "user_email", "created_at"),
        Index("ix_projects_source_template", "source_template_id"),
    )


class ProjectStar(SQLModel, table=True):
    """
    Tracks which projects a user has starred/favorited.

    Composite unique constraint on (user_email, project_id).
    """
    __tablename__ = "project_stars"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    user_email: str = SQLField(max_length=255)
    project_id: str = SQLField(max_length=50)
    created_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_project_stars_user_project", "user_email", "project_id", unique=True),
        Index("ix_project_stars_user", "user_email"),
    )


class ShareRole(str, Enum):
    """Access level a share grants to the recipient."""
    VIEWER = "viewer"   # read-only: view + clone, cannot mutate the original
    EDITOR = "editor"   # can modify (agent/files), but not delete or manage shares


class ShareStatus(str, Enum):
    """Where a share sits in the accept/decline handshake."""
    PENDING = "pending"     # awaiting the recipient's response — grants no access yet
    ACCEPTED = "accepted"   # recipient accepted — grants access at the share's role
    DECLINED = "declined"   # recipient declined — grants nothing


class ProjectShare(SQLModel, table=True):
    """
    Tracks project sharing between users.

    The owner shares a project with another user via email at a given ``role``
    (viewer = read-only, editor = can modify). The recipient must accept the
    share (``status`` transitions pending -> accepted) before it grants any
    access; a declined share grants nothing. Enforcement lives in
    ``routes/projects.py`` (_get_project_access / _require_write_access /
    _require_owner).
    """
    __tablename__ = "project_shares"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    project_id: str = SQLField(max_length=50)
    owner_email: str = SQLField(max_length=255)
    shared_with_email: str = SQLField(max_length=255)
    message: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    # Safe-by-default: a new share is a pending viewer grant until the owner
    # picks otherwise and the recipient accepts. See migration v8 for backfill.
    role: str = SQLField(default=ShareRole.VIEWER.value, max_length=20)
    status: str = SQLField(default=ShareStatus.PENDING.value, max_length=20)
    created_at: datetime = SQLField(default_factory=utc_now)
    responded_at: Optional[datetime] = SQLField(default=None)

    __table_args__ = (
        Index("ix_project_shares_unique", "project_id", "shared_with_email", unique=True),
        Index("ix_project_shares_recipient", "shared_with_email"),
        Index("ix_project_shares_project", "project_id"),
    )


class ProjectFile(SQLModel, table=True):
    """
    Individual file tracked in a project.

    Files are stored compressed (zlib) for efficiency.
    SHA-256 hash used for change detection during sync.
    """
    __tablename__ = "project_files"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    project_id: str = SQLField(
        sa_column=Column(
            String(50),
            index=True,
            nullable=False,
        )
    )
    relative_path: str = SQLField(max_length=500)

    # Compressed content (zlib)
    content_compressed: bytes = SQLField(sa_column=Column(LargeBinary, nullable=False))
    content_hash: str = SQLField(max_length=64)  # SHA-256
    file_size: int = SQLField(default=0)  # Uncompressed size

    # Timestamps
    last_modified: datetime = SQLField(default_factory=utc_now)
    synced_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_project_files_project_path", "project_id", "relative_path", unique=True),
    )


class ArchitectureHistory(SQLModel, table=True):
    """One versioned snapshot of a project's `architecture.md`.

    Every change to `architecture.md` (via the save route OR the file watcher)
    records a snapshot of the full file, compressed with zstd (see
    file_sync.compress_content). Writes are DEBOUNCED (1 min) and old entries are
    COMPACTED to one per 5-min bucket (see services/architecture_history.py). The
    history panel lists these top-to-bottom and can restore a version.

    RESTORE entries (`is_restore=True`) are special: a restore always INSERTS a
    fresh row (never debounce-upserts) and compaction NEVER deletes a restore row
    NOR the row it was restored from (`restored_from_id`) — so a restore is always
    undoable and nothing around a restore point is ever lost.
    """
    __tablename__ = "architecture_history"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    project_id: str = SQLField(
        sa_column=Column(
            String(50),
            index=True,
            nullable=False,
        )
    )
    # Full architecture.md content, compressed (zstd; decompress_content auto-detects).
    content_compressed: bytes = SQLField(sa_column=Column(LargeBinary, nullable=False))
    created_at: datetime = SQLField(default_factory=utc_now)
    # True when this snapshot was created by RESTORING an earlier version (a
    # protected entry — never compacted away).
    is_restore: bool = SQLField(default=False, nullable=False)
    # When is_restore, the id of the snapshot that was restored from (also
    # protected from compaction, so both ends of a restore survive).
    restored_from_id: Optional[int] = SQLField(default=None)

    __table_args__ = (
        Index("ix_architecture_history_project_created", "project_id", "created_at"),
    )


class BrandCacheEntry(SQLModel, table=True):
    """One resolved company brand, keyed by its canonical domain. Holds the
    expensive artifacts (palette + logo bytes + site screenshot) so a repeat
    lookup for the same company skips the whole resolve. Deduped by domain: many
    typed queries (see BrandQueryAlias) point at ONE entry. Survives restart
    (Lakebase); 30-day TTL applied at read time."""
    __tablename__ = "brand_cache"

    domain: str = SQLField(sa_column=Column(String(255), primary_key=True))
    company: str = SQLField(default="", max_length=255)
    # ordered palette hexes, stored as a JSON array
    palette: list = SQLField(default_factory=list, sa_column=Column(JSON, nullable=False))
    website: Optional[str] = SQLField(default=None, max_length=500)
    # logo bytes + its content-type (svg/png/…), null when no logo resolved
    logo_bytes: Optional[bytes] = SQLField(default=None, sa_column=Column(LargeBinary, nullable=True))
    logo_content_type: Optional[str] = SQLField(default=None, max_length=100)
    # official-site screenshot (JPEG bytes), null when capture failed/blocked
    screenshot_bytes: Optional[bytes] = SQLField(default=None, sa_column=Column(LargeBinary, nullable=True))
    resolved_at: datetime = SQLField(default_factory=utc_now)


class BrandQueryAlias(SQLModel, table=True):
    """Maps a NORMALIZED user query ("databricks data ai") to the domain of the
    brand it resolved to. The cheap alias layer: different phrasings each add a
    row here but share the one BrandCacheEntry keyed by that domain."""
    __tablename__ = "brand_query_alias"

    query_norm: str = SQLField(sa_column=Column(String(255), primary_key=True))
    domain: str = SQLField(index=True, max_length=255)
    created_at: datetime = SQLField(default_factory=utc_now)


class Message(SQLModel, table=True):
    """
    Chat message within a project's conversation.

    Since each project has exactly one conversation, messages link directly to project.
    Reasoning data stored as compressed bytes (zlib) for space efficiency.
    """
    __tablename__ = "messages"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    project_id: str = SQLField(
        sa_column=Column(
            String(50),
            index=True,
            nullable=False,
        )
    )
    role: str = SQLField(max_length=20)  # "user" | "assistant" | "system"
    content: str = SQLField(sa_column=Column(Text, nullable=False))
    # What the user had open in the UI when they sent this message (e.g. "the
    # architecture diagram", "the file `README.md`"). Prepended to the agent
    # query as a context hint; stored so the UI can show it on refresh. Null for
    # messages sent with no active context (overview/story) and for non-user roles.
    context_hint: Optional[str] = SQLField(default=None, sa_column=Column(Text, nullable=True))
    is_error: bool = SQLField(default=False)
    is_cancelled: bool = SQLField(default=False)
    # Reasoning data for assistant messages - zlib compressed bytes
    reasoning_data: Optional[bytes] = SQLField(default=None, sa_column=Column(LargeBinary, nullable=True))
    created_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_messages_project_created", "project_id", "created_at"),
    )


class AgentUsage(SQLModel, table=True):
    """
    Token usage of ONE model response, read from the project's Claude Code
    transcripts (main conversation + every subagent). Keyed by the API message id
    so re-ingesting a transcript is an idempotent upsert. Cost is NOT stored — it's
    priced at read time (`services/agent_usage.py`) so a price-table fix applies
    retroactively. Survives "clear chat" (cost is per project, not per chat).
    """
    __tablename__ = "agent_usage"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    project_id: str = SQLField(sa_column=Column(String(50), index=True, nullable=False))
    session_id: str = SQLField(max_length=64)  # the conversation (Claude session id)
    message_id: str = SQLField(max_length=200)
    agent_id: Optional[str] = SQLField(default=None, max_length=64)  # NULL = main agent
    agent_type: Optional[str] = SQLField(default=None, max_length=100)
    agent_description: Optional[str] = SQLField(default=None, sa_column=Column(Text, nullable=True))
    model: str = SQLField(max_length=200)
    input_tokens: int = SQLField(default=0)
    output_tokens: int = SQLField(default=0)
    cache_read_tokens: int = SQLField(default=0)
    cache_write_5m_tokens: int = SQLField(default=0)
    cache_write_1h_tokens: int = SQLField(default=0)
    web_search_requests: int = SQLField(default=0)
    inference_geo: Optional[str] = SQLField(default=None, max_length=32)
    created_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_agent_usage_project_message", "project_id", "message_id", unique=True),
    )


class Execution(SQLModel, table=True):
    """
    Stores execution state for Claude Code agent sessions.

    Enables session independence - users can reconnect after page refresh.
    Events stored as JSON array for replay/streaming continuation.
    session_id enables conversation resumption across invocations.
    """
    __tablename__ = "executions"

    id: str = SQLField(
        default_factory=generate_uuid,
        primary_key=True,
        max_length=50,
    )
    project_id: str = SQLField(
        sa_column=Column(
            String(50),
            index=True,
            nullable=False,
        )
    )
    status: str = SQLField(default=ExecutionStatus.RUNNING.value, max_length=20)
    session_id: Optional[str] = SQLField(default=None, max_length=100)  # Claude Code session for resumption
    events_json: str = SQLField(default="[]", sa_column=Column(Text))
    error: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    created_at: datetime = SQLField(default_factory=utc_now)
    updated_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_executions_project_status", "project_id", "status"),
        Index("ix_executions_project_created", "project_id", "created_at"),
    )


class Template(SQLModel, table=True):
    """
    A reusable template that can be used to create new projects.

    Templates are submitted from projects and go through admin review.
    Contains pgvector embedding for semantic search.
    """
    __tablename__ = "templates"

    id: str = SQLField(
        default_factory=generate_uuid,
        primary_key=True,
        max_length=50,
    )
    name: str = SQLField(max_length=255)
    status: str = SQLField(default=TemplateStatus.REVIEW_REQUESTED.value, max_length=20)
    owner_email: str = SQLField(max_length=255, index=True)
    industry: Optional[str] = SQLField(default=None, max_length=100)
    description: Optional[str] = SQLField(default=None, sa_column=Column(Text))  # Short summary
    # LLM-style 1-2 paragraph storytelling summary shown at the TOP of the gallery
    # sheet. NOT generated on the template side: authored in the seed folder's
    # resources.json, or copied from the source project's `narrative` on publish.
    narrative: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    full_description: Optional[str] = SQLField(default=None, sa_column=Column(Text))  # Full README
    capabilities: Optional[str] = SQLField(default=None, sa_column=Column(Text))  # JSON array
    customer: Optional[str] = SQLField(default=None, max_length=255)  # Inherited from source project

    # Curated "official" templates (seeded from initial_templates/). Shown with a
    # featured treatment + surfaced on the internal /internal-demos gallery.
    official: bool = SQLField(default=False, index=True)
    # What kind of template: SOLUTION (default, full demo) / WORKSHOP /
    # GENIE_WORKSHOP / ARCHITECTURE. Read from the seed manifest.json
    # (`template_type`); user-published templates default to SOLUTION (or derive
    # from the source project's `mode`). Drives the gallery tag + the ?type= filter.
    template_type: str = SQLField(default=TemplateType.SOLUTION.value, max_length=20, index=True)
    # Optional hero screenshot (PNG bytes) for the gallery tile + slide-over.
    screenshot: Optional[bytes] = SQLField(default=None, sa_column=Column(LargeBinary))
    # Hash of the seeded folder's file-set — lets the startup seeder skip unchanged
    # templates and diff-update only changed ones (see seed_templates.py).
    content_checksum: Optional[str] = SQLField(default=None, max_length=64)
    # Live-demo links (JSON: {"assets": [{kind, label, url}], "demo_questions": [...]}) for a
    # seeded template whose manifest `live_demo` points at THIS app's workspace. NULL on any
    # other workspace, so a deployment never shows links into someone else's workspace.
    # Recomputed by the startup seeder (see services/live_demo.py).
    live_demo: Optional[str] = SQLField(default=None, sa_column=Column(Text))

    # Note: embedding column is created via migration (vector type not supported in SQLModel)

    submitted_at: datetime = SQLField(default_factory=utc_now)
    reviewed_at: Optional[datetime] = SQLField(default=None)
    reviewed_by: Optional[str] = SQLField(default=None, max_length=255)
    source_project_id: Optional[str] = SQLField(default=None, max_length=50)

    __table_args__ = (
        Index("ix_templates_status", "status"),
        Index("ix_templates_industry", "industry"),
        Index("ix_templates_official", "official"),
    )


class TemplateScreenshot(SQLModel, table=True):
    """An EXTRA gallery screenshot for a template (beyond the hero, which stays
    on `Template.screenshot`). `ordinal` is 1-based (1 = template_screenshot_1.png)
    so the sheet can render a small carousel: hero first, then these in order."""
    __tablename__ = "template_screenshots"

    id: str = SQLField(default_factory=generate_uuid, primary_key=True, max_length=50)
    template_id: str = SQLField(
        sa_column=Column(String(50), index=True, nullable=False)
    )
    ordinal: int = SQLField()  # 1-based; the hero (Template.screenshot) is 0
    image: bytes = SQLField(sa_column=Column(LargeBinary, nullable=False))


class TemplateContent(SQLModel, table=True):
    """
    Individual file stored in a template.

    Files are stored compressed (zlib) like project files.
    """
    __tablename__ = "template_content"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    template_id: str = SQLField(
        sa_column=Column(
            String(50),
            index=True,
            nullable=False,
        )
    )
    relative_path: str = SQLField(max_length=500)
    content_compressed: bytes = SQLField(sa_column=Column(LargeBinary, nullable=False))
    content_hash: str = SQLField(max_length=64)
    file_size: int = SQLField(default=0)
    created_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_template_content_unique_path", "template_id", "relative_path", unique=True),
    )


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------


class ArchitectureHistoryOut(BaseModel):
    """One architecture-history snapshot (metadata only — no content blob).

    Powers the arch-tab History panel list. Content is fetched lazily per entry
    via the /content endpoint so the list stays cheap.
    """
    id: int
    created_at: datetime
    is_restore: bool = False


class ArchitectureHistoryContentOut(BaseModel):
    """The decompressed `architecture.md` markdown for one history snapshot."""
    id: int
    created_at: datetime
    content: str


class UploadedFile(BaseModel):
    """One file uploaded via the home-page widget.

    Produced by `POST /api/uploads/extract` and round-tripped through the
    frontend back to `POST /api/projects` so the originals + extracted
    text land in the new project's `context/uploads/` dir.
    """
    filename: str
    content_type: str = "application/octet-stream"
    size_bytes: int = 0
    text: str = Field(..., description="Extracted plain text (already truncated to per-file cap).")
    truncated: bool = Field(False, description="True if the original was larger than the per-file cap.")
    original_b64: Optional[str] = Field(
        None,
        description=(
            "Base64 of the raw bytes. Optional — when present, written verbatim "
            "to context/uploads/<filename> on project create so the user can "
            "re-open the original."
        ),
    )


class DiscoveryFit(BaseModel):
    """Per-idea data-fit rating the grounded suggest LLM produced (how well the
    user's REAL selected tables support the idea)."""

    tier: str = Field(..., description="Great | Good | Possible")
    reason: str = Field("", description="One clause naming the real cols/joins the idea uses (or its limitation).")


class DiscoveryIdea(BaseModel):
    """A use-case idea the discovery step surfaced (the chosen one, or an
    alternative the user set aside)."""

    title: str
    hook: str = ""
    why: Optional[str] = Field(None, description="Business-value rationale shown when the idea is expanded.")
    fit: Optional[DiscoveryFit] = None


class DiscoveryAnalysis(BaseModel):
    """What the "Use existing data" discovery step LEARNED before the project
    existed — the chosen use-case + its data-fit rationale, the alternatives it
    surfaced, and the capability reasoning. Persisted verbatim to
    specifications/data-discovery.md so the build agent INHERITS the analysis
    instead of re-deriving (and possibly contradicting) it, and so it survives
    context compaction. Same durability pattern as context/source-brief.md."""

    chosen: Optional[DiscoveryIdea] = Field(None, description="The use-case the user picked to build.")
    alternatives: list[DiscoveryIdea] = Field(
        default_factory=list,
        description="Other ideas the LLM proposed but the user did NOT pick — recorded so the agent won't re-explore them.",
    )
    reasoning: Optional[str] = Field(None, description="The LLM's summary of how the real tables flow through the selected capabilities.")


class ProjectCreateRequest(BaseModel):
    """Request to create a new project."""
    description: str = Field(..., description="Project description - name and schema will be generated from this")
    context_document: Optional[str] = Field(
        None,
        description=(
            "[DEPRECATED — use context_files] Single source-document text. "
            "Kept for backwards compatibility; if context_files is empty and "
            "this is set, it lands at context/source-document.md."
        ),
    )
    context_files: list[UploadedFile] = Field(
        default_factory=list,
        description=(
            "Files uploaded via the home-page widget. Each is written to "
            "context/uploads/<name> (original) + context/uploads/<name>.extracted.md "
            "(text the agent can grep)."
        ),
    )
    capabilities: list[str] = Field(
        default_factory=list,
        description="Selected capability IDs — used to scope which DAS skills get copied into the project.",
    )
    initial_prompt: Optional[str] = Field(
        None,
        description="Opening chat message. Persisted as a user Message on the new project so it survives refresh and renders before the agent replies.",
    )
    source_brief: Optional[str] = Field(
        None,
        description=(
            "The user's RAW typed/pasted brief, verbatim and unwrapped (no "
            "'Help me build…' framing, no capability line, no brand/kickoff "
            "appendix). When it's substantial (a real pasted specification, "
            "not a one-line topic) it's written verbatim to "
            "context/source-brief.md so the build agent has a durable, "
            "lossless copy of the user's intent that survives context "
            "compaction — the skill treats it as the authoritative source "
            "rather than re-grounding on its own compressed README."
        ),
    )
    architecture_first: bool = Field(
        False,
        description="Architecture-first project: opens on the Architecture tab and shows the 'Build the solution' CTA until the build is kicked off.",
    )
    blank_architecture: bool = Field(
        False,
        description=(
            "Architecture-first with NO prompt: the user clicked 'Start with a blank "
            "architecture'. Seeds an empty architecture.md (one empty tab) so the "
            "canvas opens blank instead of the agent drawing a full end-to-end diagram. "
            "Only meaningful when architecture_first is true."
        ),
    )
    mode: Literal["story", "architecture", "workshop"] = Field(
        "story",
        description="Home-page entry mode: 'story', 'architecture', or 'workshop' (Genie Code workshop — agent writes a workshop HTML page instead of provisioning resources).",
    )
    grounding_tables: list[str] = Field(
        default_factory=list,
        description=(
            "\"Use existing data\": fully-qualified real Unity Catalog tables "
            "(catalog.schema.table) the user picked to build the demo on, "
            "READ-ONLY. Every component (dashboards, Genie, metric views) queries "
            "these exact tables in place — no synthetic data is generated, the "
            "tables are not copied, and they are never written to or modified. "
            "When non-empty, the create handler writes these tables' schema + "
            "stats/sample rows to specifications/source-tables.md — the durable "
            "record the build agent uses to derive a use case and point every "
            "component at the real tables. Only meaningful for mode='story'."
        ),
    )
    allow_data_write: bool = Field(
        False,
        description=(
            "\"Use existing data\" opt-in: when False (default) the grounded demo "
            "is READ-ONLY analytics on the real tables — write-needing capabilities "
            "(synthetic-data-gen, sdp/ingest, apps, lakebase, ml training) are "
            "dropped. When True the demo MAY create its OWN auxiliary tables (in the "
            "demo's own catalog/schema) so those capabilities work; the user's real "
            "tables in grounding_tables stay strictly read-only either way. Only "
            "meaningful when grounding_tables is non-empty."
        ),
    )
    discovery: Optional[DiscoveryAnalysis] = Field(
        None,
        description=(
            "\"Use existing data\": the analysis the discovery step (scan + "
            "grounded suggest) produced — the chosen use-case + its data-fit "
            "rationale, the alternatives it surfaced, and the capability "
            "reasoning. When present (and grounding_tables is non-empty) the "
            "create handler writes it to specifications/data-discovery.md so the "
            "build agent inherits what the LLM already learned instead of "
            "re-deriving it. Only meaningful for a grounded mode='story' project."
        ),
    )


class GroundingScanRequest(BaseModel):
    """Request to scan real UC tables (schema + light stats + sample rows).

    Warms the process-level stats cache the suggest endpoint reads from, so the
    proposed story can be grounded in the actual tables.
    """

    tables: list[str] = Field(
        default_factory=list,
        description="Fully-qualified tables (catalog.schema.table) to scan.",
    )


class GroundingScannedTable(BaseModel):
    """Light per-table result of a scan (no data leaves in this summary)."""

    full_name: str
    row_count: Optional[int] = None
    column_count: int = 0
    sampled: int = 0
    error: Optional[str] = None


class GroundingScanResult(BaseModel):
    """Summary the UI shows after a scan — the full stats live server-side."""

    scanned: list[GroundingScannedTable] = []
    warehouse_id: Optional[str] = None
    warehouse_name: Optional[str] = None


class ProjectUpdateRequest(BaseModel):
    """Request to update a project."""
    name: Optional[str] = None
    description: Optional[str] = None
    # Manual override of the chat-inferred customer/account (correct a bad guess).
    customer: Optional[str] = None
    # Flipped to False when the user builds the solution from the architecture.
    architecture_first: Optional[bool] = None
    # Cross-workspace deploy target (Option A): the workspace URL this
    # project's resources deploy INTO. "" or null clears it (→ deploy to the
    # app's own host workspace). Only takes effect when the deployer SP is
    # configured server-side (DEPLOYER_SP_CLIENT_ID/SECRET).
    target_workspace_host: Optional[str] = None


class TargetValidateRequest(BaseModel):
    """Request to validate a cross-workspace deploy target (v1). The host is a
    workspace URL the user pasted / picked; validation runs as the deployer SP."""
    target_workspace_host: str


class TargetValidateResponse(BaseModel):
    """Verdict for a candidate deploy target, rendered by the UI. `status` is
    one of: ready | out_of_account | needs_admin | region_unsupported |
    region_unknown. See remote_deploy/probe.py."""
    host: str
    reachable: bool
    is_admin: bool
    region: Optional[str] = None
    catalog: Optional[str] = None
    status: str
    can_deploy: bool
    message: str
    # When status == needs_admin, everything the user needs to add the deployer
    # SP as a workspace admin themselves: its display name + application (client)
    # ID (the value the workspace "Add service principal" UI asks for) + a deep
    # link to that workspace's Identity settings. `admin_instructions` is a
    # ready-to-show step list (includes the "you must already be a workspace
    # admin on this workspace" prerequisite).
    deployer_sp_name: Optional[str] = None
    deployer_sp_application_id: Optional[str] = None
    admin_settings_url: Optional[str] = None
    admin_instructions: Optional[str] = None



class ProjectProvisionRequest(BaseModel):
    """Request to provision the remote assets an architecture-first project
    skipped at creation (LLM name/schema generation, warehouse discovery,
    CREATE SCHEMA). Idempotent — called by the "Build the solution" dialog
    right before the build prompt is sent."""
    description: Optional[str] = Field(
        None,
        description="The build story/topic. When set, the project name + description are regenerated from it (richer input than the original architecture prompt).",
    )
    capabilities: Optional[list[str]] = Field(
        None,
        description="Final capability selection from the build dialog — re-seeds resources.json (only while no resources have been created yet).",
    )


class DescriptionAiEditRequest(BaseModel):
    """Ask the LLM to rewrite a project description per a free-form instruction."""
    current_description: Optional[str] = None
    instruction: str = Field(..., description="What the user wants changed (e.g. 'make it shorter', 'add ROI angle').")


class DescriptionAiEditResponse(BaseModel):
    """Suggested description from the LLM. Caller decides whether to save it."""
    description: str


class ProjectResourcesUpdateRequest(BaseModel):
    """Request to update project resource settings."""
    cluster_id: Optional[str] = None
    cluster_name: Optional[str] = None
    warehouse_id: Optional[str] = None
    warehouse_name: Optional[str] = None
    default_catalog: Optional[str] = None
    default_schema: Optional[str] = None


class ProjectBrand(BaseModel):
    """The company brand a demo is personalized to — persisted as
    `<project>/brand.json` and read by the skill/app to theme the demo. Kept
    deliberately tiny (this is the on-disk contract the skill reads): the full
    resolver output (logos, trace) is NOT saved here."""
    company: str = ""
    palette: list[str] = []
    website: Optional[str] = None
    # Bare filename (relative to the brand/ folder) of the company logo
    # (company_logo.<ext>) — only present when a logo was resolved.
    company_logo: Optional[str] = None
    # Bare filename (relative to the brand/ folder) of the official-site
    # screenshot (website.png) — only present when the capture succeeded. The
    # app builder uses it as visual inspiration when theming.
    company_official_website_screenshot: Optional[str] = None


class ProjectBrandRequest(BaseModel):
    """Body for setting a project's brand. Either resolve from a company name
    (search=True → run the brand service) or save an explicit edit (palette/website
    the user tweaked in the UI)."""
    company: str = Field(..., min_length=1, description="Company/brand name")
    search: bool = Field(True, description="Run the brand service to resolve palette/website; False = save the provided values as-is")
    palette: Optional[list[str]] = Field(None, description="Manual palette override (used when search=False, or to override the resolved one)")
    website: Optional[str] = Field(None, description="Manual website override")
    no_cache: bool = Field(False, description="When searching, bypass + invalidate the brand cache and re-resolve fresh")


class ProjectOut(BaseModel):
    """Project details response."""
    id: str
    name: str
    user_email: str
    description: Optional[str]
    # The company this demo is personalized to (seeded from the prompt, confirmed
    # by the brand search). Null → UI shows the "customize for a real company" CTA.
    customer: Optional[str] = None
    # The resolved brand ({company, palette, website}) read from <project>/brand.json,
    # so a single getProject gives the UI the palette/mini-site to render. Null =
    # no brand.json yet.
    brand: Optional[ProjectBrand] = None
    # LLM-generated storytelling narrative (1-2 paragraphs). Distinct from
    # `description`. Drives the Overview hero on the frontend.
    narrative: Optional[str] = None
    narrative_readme_hash: Optional[str] = None
    project_type: str
    stage: str = ProjectStage.DRAFTING.value
    architecture_first: bool = False
    mode: str = "story"
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    file_count: int = 0
    # Resource settings
    cluster_id: Optional[str] = None
    cluster_name: Optional[str] = None
    warehouse_id: Optional[str] = None
    warehouse_name: Optional[str] = None
    default_catalog: Optional[str] = None
    default_schema: Optional[str] = None
    # Cross-workspace deploy target (Option A). Null = deploy to the app's own
    # host workspace (classic). Set = deploy INTO this workspace as the
    # deployer SP. Surfaced so the UI can show/edit the current target.
    target_workspace_host: Optional[str] = None
    # Template lineage
    source_template_id: Optional[str] = None
    source_template_name: Optional[str] = None
    # Caller's access level on THIS project: "owner" | "admin" | "editor" |
    # "viewer". Drives the read-only UI. Only populated by get_project; other
    # (write) endpoints leave it None since their caller is never a viewer.
    my_role: Optional[str] = None
    # "Anyone with the link" access: "none" | "viewer" | "editor". The share
    # dialog reads/writes this; the canvas "Share live" button surfaces the link
    # when it's not "none".
    link_access: Optional[str] = None
    # Conversation driver — the user whose PAT the agent's CLI runs as. Null =
    # unclaimed. `is_driver` is the caller-relative flag the chat UI uses to
    # decide whether to allow sending or show the "take over" banner.
    active_driver_email: Optional[str] = None
    is_driver: Optional[bool] = None
    # Age of the driver's token (seconds since last refresh) + whether it's stale.
    # A non-driver may still run the agent while `driver_token_expired` is false;
    # once true, they're blocked until someone takes over. Null when unclaimed.
    driver_token_age_seconds: Optional[int] = None
    driver_token_expired: Optional[bool] = None
    # SP mode: the agent runs as the deployer service principal (oauth-m2m), not a
    # per-user OBO token, so the whole driver/take-over model is bypassed (see
    # AUTH.md / core.auth.project_runs_as_sp). When true the UI hides the driver
    # banner + take-over control and never gates sending on token freshness.
    is_sp_mode: Optional[bool] = None


class ProjectListItem(BaseModel):
    """Project summary for list views."""
    id: str
    name: str
    description: Optional[str] = None
    # Customer/account this project is for (or null → "Not specified" in the UI).
    customer: Optional[str] = None
    project_type: str
    stage: str = ProjectStage.DRAFTING.value
    # Home entry mode: 'story' (a full solution) | 'architecture' | 'workshop'.
    mode: str = "story"
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    file_count: int = 0
    is_starred: bool = False
    # Populated only for "shared with me" views
    shared_by: Optional[str] = None
    shared_message: Optional[str] = None
    # Caller's access on a shared project: 'viewer' | 'editor' (None if owner).
    shared_role: Optional[str] = None
    owner_email: Optional[str] = None
    # Template lineage
    source_template_id: Optional[str] = None
    source_template_name: Optional[str] = None


class ProjectShareRequest(BaseModel):
    """Request to share a project with another user."""
    email: str = Field(..., description="Email of the user to share with")
    message: Optional[str] = Field(None, description="Optional message to include")
    role: str = Field(
        ShareRole.VIEWER.value,
        description="Access to grant: 'viewer' (read-only) or 'editor' (can modify)",
    )


class ProjectShareOut(BaseModel):
    """Share record response."""
    id: int
    project_id: str
    owner_email: str
    shared_with_email: str
    message: Optional[str]
    role: str = ShareRole.VIEWER.value
    status: str = ShareStatus.PENDING.value
    created_at: datetime
    responded_at: Optional[datetime] = None
    # Project context — populated on the recipient's "invitations" view so the
    # invite can be shown without a second fetch. Null on owner-side share lists.
    project_name: Optional[str] = None


class DriverStatus(BaseModel):
    """Lightweight poll response for a non-driver's chat: who holds the
    conversation, how old their token is, and whether the caller may still run
    (fresh) or must take over (expired)."""
    active_driver_email: Optional[str] = None
    is_driver: bool = False
    driver_token_age_seconds: Optional[int] = None
    driver_token_expired: bool = False
    # SP mode: driver model bypassed (agent runs as the deployer SP). UI hides the
    # driver banner + never gates sending. See core.auth.project_runs_as_sp.
    is_sp_mode: bool = False


class HomeProjects(BaseModel):
    """Everything the home page needs in ONE call, so owned projects, shared
    projects, and pending invitations resolve together (no staggered pop-in)."""
    owned: list[ProjectListItem] = []
    shared: list[ProjectListItem] = []
    invitations: list[ProjectShareOut] = []


class BrandLogoCandidate(BaseModel):
    """One downloaded logo candidate (for review / picking). `data_url` inlines
    the image so the frontend can render it offline; `chosen` marks the one the
    agent committed to."""
    source: str  # jsonld / inline-svg / header-img / og:image / favicon
    url: str
    data_url: str
    content_type: Optional[str] = None
    chosen: bool = False
    # intrinsic size {w,h,aspect} when measurable — a wide aspect (≳2.5) signals a
    # wordmark, ~1 a square glyph/favicon. None if unmeasurable.
    dims: Optional[dict[str, Any]] = None


class BrandOut(BaseModel):
    """Resolved brand for a company name (v1, keyless, best-effort).

    `logo_data_url` is a data: URI (base64) so the frontend/diagram can use the
    logo offline; `palette` is ordered hex (primary first). `logos` is the top
    few downloaded candidates (chosen first) for visual review. `warnings`
    explains any degradation (favicon fallback, SPA site, low-confidence domain,
    …) — the service returns partial results rather than failing."""
    name: str
    # The company's OFFICIAL registrable domain (databricks.com) — drives the
    # website + which site gets screenshotted. Distinct from asset_source.
    domain: Optional[str] = None
    # Where the logo/palette were actually harvested (e.g. brand.databricks.com or
    # a CDN). Informational — NOT the official site.
    asset_source: Optional[str] = None
    confidence: float = 0.0
    logo_url: Optional[str] = None
    logo_data_url: Optional[str] = None
    logos: list[BrandLogoCandidate] = []
    palette: list[str] = []
    # The brand's square symbol without the name (Airbnb's loop), as an SVG data URL,
    # for avatars/app icons. symbol_source: "bimi" (the company's own email-logo
    # record) or "simpleicons". Fresh resolves only; not cached.
    symbol_data_url: Optional[str] = None
    symbol_source: Optional[str] = None
    source: Optional[str] = None  # which logo source won (jsonld/og/svg/header-img/favicon/wikipedia)
    # the contact sheet the vision model saw when picking the logo (data URL) —
    # lets a human see exactly what was judged.
    logo_contact_sheet: Optional[str] = None
    # per-cell provenance for that sheet: [{n, format, source, host, official, image}]
    logo_provenance: list[dict[str, Any]] = []
    # screenshot of the official homepage (data URL) — brand context + the
    # reference the vision model used to disambiguate the logo.
    site_screenshot: Optional[str] = None
    warnings: list[str] = []
    # Full instrumented trace of the resolve (tool calls, decisions, reasoning
    # notes, timings). Powers debugging + the self-improvement loop. Each item:
    # {t_ms, kind, tool?, args?, summary?, reasoning?, detail?, ms?}.
    trace: list[dict[str, Any]] = []
    # Server log lines emitted during this resolve (fresh resolves only; not cached).
    logs: list[str] = []


class BrandDiagnosticsOut(BaseModel):
    """Runtime state of the brand service's scraping deps (see brand_service.diagnostics)."""
    playwright_browsers_path: Optional[str] = None
    installed_browsers: list[str] = []
    install_log: Optional[str] = None
    packages: dict[str, Optional[str]] = {}
    # Shared libs the headless shell can't load (no root → --with-deps can't apt-install them).
    missing_libs: list[str] = []
    os: Optional[str] = None


class ShareRoleUpdateRequest(BaseModel):
    """Owner changes an existing share's role (viewer/editor)."""
    role: str = Field(..., description="New access level: 'viewer' or 'editor'")


class LinkAccessRequest(BaseModel):
    """Owner sets 'anyone with the link' access for a project."""
    link_access: str = Field(
        ...,
        description="'none' (off), 'viewer' (anyone with the link can view/clone), or 'editor' (anyone with the link can edit live).",
    )


class LinkAccessResult(BaseModel):
    """Current 'anyone with the link' access after a set."""
    link_access: str


class ShareResponseRequest(BaseModel):
    """Recipient's response to a pending share invitation."""
    accept: bool = Field(..., description="True to accept the share, False to decline")


class SuccessResponse(BaseModel):
    """Generic {success: bool} response for delete-style endpoints."""
    success: bool


class ProjectFileOut(BaseModel):
    """File metadata response."""
    path: str
    name: str
    size: int
    last_modified: datetime
    synced_at: datetime
    # True for files normally filtered out of the listing (.databrickscfg,
    # .claude/skills/, hidden tempfiles). Only ever true when the request
    # passed `?include_hidden=true`. Lets the UI badge these distinctly.
    is_hidden: bool = False


class ProjectFileContent(BaseModel):
    """File content response."""
    path: str
    content: str
    size: int
    last_modified: Optional[datetime] = None


class ProjectFileWrite(BaseModel):
    """Request body for saving a project file (e.g. the architecture canvas
    persisting node positions + edges back into architecture.md)."""
    content: str


class ArchitectureSnapshotWrite(BaseModel):
    """Request body for the architecture PNG snapshot. `data_url` is a
    `data:image/png;base64,...` string captured from the live canvas by the
    open browser tab, so the agent can read a rendered image of its diagram."""
    data_url: str


class ArchitectureSnapshotResult(BaseModel):
    """Response for a saved architecture snapshot."""
    path: str
    size: int


class DeployedResourceLink(BaseModel):
    """A single deployed Databricks resource with its live URL."""
    resource_type: str
    label: str
    url: Optional[str] = None
    resource_id: Optional[str] = None


class CapabilityBuildStatus(BaseModel):
    """Build status for one buildable capability, derived from resources.json.

    `built` is True once the capability's resource exists in `created_resources`
    (any of its `_CAPABILITY_RESOURCE_KEYS`). This is the authoritative,
    resources.json-driven signal the UI renders directly — it does NOT re-infer
    readiness from deep-link URLs (a built resource may legitimately have no
    URL, e.g. a preview-only app or a Lakebase DB with no recorded id)."""
    slug: str
    built: bool


class DeployedResourcesOut(BaseModel):
    """All deployed resources for a project, parsed from resources.json.

    `extraction_error` is set when the LLM-based resources.json extractor
    fails (auth, model unavailable, malformed response, etc.). The UI
    should surface this so users don't see an empty list and assume nothing
    was deployed when in reality the extraction step blew up.

    `capabilities` / `all_built` are the single source of truth for the
    build-progress meter (live "N of N ready") and the "done" state — computed
    once here from resources.json (see `capability_build_status`). The UI
    renders them instead of re-deriving readiness from `resources` URLs.
    """
    resources: list[DeployedResourceLink] = Field(default_factory=list)
    deployed_at: Optional[datetime] = None
    extraction_error: Optional[str] = None
    capabilities: list[CapabilityBuildStatus] = Field(default_factory=list)
    all_built: bool = False


class UsageTotalsOut(BaseModel):
    """Token totals + list-price cost. `cache_write_tokens` = 5-minute + 1-hour writes."""
    responses: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    cost_usd: float
    unpriced_responses: int  # responses from a model with no known price (cost excludes them)


class AgentUsageOut(BaseModel):
    agent: str  # "main" or the subagent type (e.g. "Explore")
    subagents: int  # how many subagents of this type ran (0 for main)
    totals: UsageTotalsOut


class ConversationUsageOut(BaseModel):
    session_id: str
    started_at: datetime
    ended_at: datetime
    totals: UsageTotalsOut
    agents: list[AgentUsageOut]


class ModelUsageOut(BaseModel):
    model: str  # as reported by the API (e.g. databricks-claude-opus-4-7)
    priced_as: Optional[str] = None  # the price-table entry used; None = unpriced
    estimated: bool = False  # True when priced as the closest older version of the family
    totals: UsageTotalsOut


class ProjectUsageOut(BaseModel):
    """What a project's agent conversations cost so far (the chat's "$" chip)."""
    totals: UsageTotalsOut
    conversations: list[ConversationUsageOut]
    models: list[ModelUsageOut]


class MessageOut(BaseModel):
    """Chat message response.

    `reasoning_data` is omitted from list endpoints (can be hundreds of KB per
    message). `has_reasoning` tells the UI whether to show the reasoning toggle;
    the payload is fetched lazily from `GET /messages/{id}/reasoning`.
    """
    id: int
    project_id: str
    role: str
    content: str
    context_hint: Optional[str] = None
    is_error: bool
    is_cancelled: bool = False
    has_reasoning: bool = False
    reasoning_data: Optional[dict] = None  # Populated only on the per-message fetch.
    created_at: datetime


class MessageCreateRequest(BaseModel):
    """Request to add a message."""
    role: str = Field(..., description="'user' or 'assistant'")
    content: str
    is_error: bool = False


class ChatImage(BaseModel):
    """An image pasted into the chat composer."""
    filename: str
    media_type: str = Field(..., description="image/png, image/jpeg, image/gif or image/webp")
    data_b64: str


class InvokeAgentRequest(BaseModel):
    """Request to invoke Claude Code agent."""
    project_id: str
    message: str = Field(..., description="User message to send to agent")
    images: list[ChatImage] = Field(
        default_factory=list,
        description="Pasted images: saved under context/uploads/ and sent to the model as image blocks.",
    )
    save_user_message: bool = Field(
        True,
        description="Persist a new user Message row for `message`. Set false when the message is already in the DB (e.g. auto-kicking the agent from a project's opening prompt).",
    )
    context_hint: str | None = Field(
        None,
        description="What the user has open in the UI right now (active view / file / preview route). Prepended to the message for the SDK call only; NOT persisted to the Message row.",
    )


class InvokeAgentResponse(BaseModel):
    """Response from invoke_agent endpoint."""
    execution_id: str
    project_id: str


class ExecutionOut(BaseModel):
    """Execution details response."""
    id: str
    project_id: str
    status: str
    session_id: Optional[str] = None
    error: Optional[str]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Template request/response models
# ---------------------------------------------------------------------------


class LiveDemoAsset(BaseModel):
    """One live resource of a deployed demo ("Try it live" button)."""
    kind: str  # app / dashboard / genie / pipeline / job / knowledge_assistant (legacy) / model / data / folder
    label: str
    url: str


class LiveDemo(BaseModel):
    """Where a seed template is deployed live — only set in the SAME workspace as this app."""
    workspace: str
    assets: list[LiveDemoAsset] = []
    demo_questions: list[str] = []


class OfficialTemplate(BaseModel):
    """An official (curated, seeded) template with everything a catalog needs:
    story, products, screenshot, and — when deployed in this workspace — its live links."""
    id: str
    name: str
    industry: Optional[str] = None
    customer: Optional[str] = None
    description: Optional[str] = None
    narrative: Optional[str] = None
    capabilities: Optional[list[str]] = None
    template_type: str = TemplateType.SOLUTION.value
    screenshot_url: Optional[str] = None  # hero image (GET), None when the template has none
    screenshot_count: int = 0
    live_demo: Optional[LiveDemo] = None  # same-workspace deployments only


class TemplateListItem(BaseModel):
    """Template summary for list views."""
    id: str
    name: str
    status: str
    owner_email: str
    industry: Optional[str]
    description: Optional[str]
    customer: Optional[str] = None  # Customer the source demo was built for
    capabilities: Optional[list[str]] = None  # Parsed from JSON
    official: bool = False  # Curated/seeded template (featured treatment)
    template_type: str = TemplateType.SOLUTION.value  # SOLUTION / WORKSHOP / GENIE_WORKSHOP / ARCHITECTURE
    has_screenshot: bool = False  # Whether a hero screenshot is available (GET .../screenshot)
    # Total gallery images (hero + extras). 0 = none, 1 = hero only, >1 = carousel.
    screenshot_count: int = 0
    has_live_demo: bool = False  # Deployed live in this workspace → "Live" badge + Try-it-live buttons
    submitted_at: datetime
    reviewed_at: Optional[datetime] = None


class TemplateDetail(BaseModel):
    """Full template details including file info."""
    id: str
    name: str
    status: str
    owner_email: str
    industry: Optional[str]
    description: Optional[str]
    # 1-2 paragraph storytelling summary shown atop the gallery sheet.
    narrative: Optional[str] = None
    full_description: Optional[str]
    customer: Optional[str] = None  # Customer the source demo was built for
    capabilities: Optional[list[str]] = None
    official: bool = False
    template_type: str = TemplateType.SOLUTION.value  # SOLUTION / WORKSHOP / GENIE_WORKSHOP / ARCHITECTURE
    has_screenshot: bool = False
    # Total gallery images (hero + extras). 0 = none, 1 = hero only, >1 = carousel.
    screenshot_count: int = 0
    submitted_at: datetime
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    source_project_id: Optional[str] = None
    file_count: int = 0
    live_demo: Optional[LiveDemo] = None  # "Try it live" links (same-workspace deployments only)


class TemplateFile(BaseModel):
    """File metadata in a template."""
    path: str
    name: str
    size: int
    is_dir: bool = False


class TemplateFileContent(BaseModel):
    """File content from a template."""
    path: str
    content: str
    size: int


class TemplateSearchResult(BaseModel):
    """Template search result with similarity score."""
    id: str
    name: str
    description: Optional[str]
    industry: Optional[str]
    capabilities: Optional[list[str]] = None
    similarity: float


class TemplateStatusUpdateRequest(BaseModel):
    """Request to update template status (admin only)."""
    status: str = Field(..., description="APPROVED or REJECTED")


class CreateProjectFromTemplateRequest(BaseModel):
    """Request to create a project from a template."""
    name: str = Field(..., description="Name for the new project")
    adapt_instructions: Optional[str] = Field(
        None,
        description="Optional free-text describing how to adapt the template. When "
        "provided, the new project opens with a user message asking the agent to "
        "review the cloned demo and apply these changes; when omitted, a friendly "
        "assistant greeting is seeded instead.",
    )


# ---------------------------------------------------------------------------
# Stage validation models
# ---------------------------------------------------------------------------


class StageCheck(BaseModel):
    """A single validation check for a stage gate."""
    label: str
    passed: bool
    detail: Optional[str] = None


class ProjectStageStatus(BaseModel):
    """Current stage status with validation details for the next gate."""
    current_stage: str
    checks: list[StageCheck] = Field(default_factory=list)
    can_advance: bool = False
    next_stage: Optional[str] = None


# ---------------------------------------------------------------------------
# Configuration/User request/response models
# ---------------------------------------------------------------------------


class DatabaseStatus(BaseModel):
    """Database connection status."""
    connected: bool
    type: str  # "local" (PGLite) or "remote" (Lakebase)
    error: Optional[str] = None


class DatabricksProfile(BaseModel):
    """A Databricks CLI profile."""
    name: str
    host: Optional[str] = None
    is_default: bool = False


class DatabricksConnectionStatus(BaseModel):
    """Databricks workspace connection status."""
    connected: bool
    profile: str
    host: Optional[str] = None
    user_email: Optional[str] = None
    error: Optional[str] = None


class ConfigStatus(BaseModel):
    """Overall configuration status."""
    database: DatabaseStatus
    databricks_profiles: list[DatabricksProfile]
    current_user: Optional["UserOut"] = None
    is_configured: bool  # True if user exists and databricks is connected
    # Mirrors `AppConfig.default_catalog`. Surfaced so the UI doesn't
    # need to hardcode it — the resources popover highlights this as the
    # recommended catalog. Source of truth lives in DEFAULT_CATALOG env
    # var (set by databricks.<target>.yml's app_env block).
    default_catalog: str
    # Whether the architecture diagram shows vendor LOGOS by default (the
    # "logos on" toggle's initial state for a diagram that hasn't set it).
    # Source: ENABLE_LOGO_BY_DEFAULT env (false in the public build; true on
    # our internal Databricks deploys). See AppConfig.enable_logo_by_default.
    enable_logo_by_default: bool = False


class UserSettings(SQLModel, table=True):
    """Per-user account settings that apply across ALL of a user's projects.

    Keyed by email and UPSERTED — deployed mode never persists a `users` row
    (identity comes from the x-forwarded-email header), so this table is the
    durable per-user store. Currently holds the cross-workspace deploy target:
    the user sets it ONCE (home-page control) and every project they build
    deploys into it.
    """
    __tablename__ = "user_settings"

    email: str = SQLField(primary_key=True, index=True, max_length=255)
    # Cross-workspace deploy target (Option A): the target workspace
    # URL this user's projects deploy INTO. Null = use the app's own workspace
    # (or the server default DEFAULT_TARGET_WORKSPACE_HOST).
    target_workspace_host: Optional[str] = SQLField(default=None, max_length=255)
    # The catalog resolved from the target's region at save time (deterministic:
    # region → the onboarded `solution_builder` catalog, or a per-region config
    # override). Cached so project creation doesn't re-probe on every new project.
    target_catalog: Optional[str] = SQLField(default=None, max_length=255)
    created_at: datetime = SQLField(default_factory=utc_now)
    updated_at: datetime = SQLField(default_factory=utc_now)


class UserSettingsOut(BaseModel):
    """Per-user settings response (+ the resolved effective target the deploy
    path will actually use, so the UI can show the default when unset)."""
    target_workspace_host: Optional[str] = None
    # The value deploys actually use = user setting or the server default.
    effective_target_workspace_host: Optional[str] = None
    # Whether the deployer SP is configured (cross-workspace deploy is live).
    # When False the deploy-target control is inert, so the UI hides it — a
    # default (SP-off) deployment shows nothing cross-workspace/SP-related.
    cross_workspace_deploy_enabled: bool = False
    # The server's shared-default target host. Lets the UI recognize when the
    # user's saved target IS the shared default and label it "shared default"
    # (never its raw name), even before the target control loads.
    default_target_workspace_host: Optional[str] = None
    # Explicit feature gate (managed/internal build vs OSS build). The UI gates
    # the ENTIRE cross-workspace target UX on `cross_workspace_deploy_enabled`
    # (declared above: deployer SP configured) instead of inferring from the
    # presence of a default host — so on an OSS install (deployer SP unset) the
    # whole feature is absent, not just dormant.


class UserSettingsUpdateRequest(BaseModel):
    """Set the user's cross-workspace deploy target. Empty string clears it
    (→ fall back to the server default / app's own workspace)."""
    target_workspace_host: Optional[str] = None


class UserOut(BaseModel):
    """User details response."""
    id: str
    email: str
    databricks_profile: str
    created_at: datetime
    updated_at: datetime


class UserUpdateRequest(BaseModel):
    """Request to update user settings."""
    databricks_profile: str = Field(..., description="Databricks profile name to use")


# ---------------------------------------------------------------------------
# Block factory request/response models
# ---------------------------------------------------------------------------


class BlockSpec(BaseModel):
    """A proposed capability block from the decomposition phase."""
    name: str = Field(..., description="Display name for the block")
    slug: str = Field(..., description="URL/file-safe identifier")
    description: str = Field(..., description="One-line description of what this block covers")
    tags: list[str] = Field(default_factory=list)
    source_section: str = Field("", description="Which part of the source document this maps to")


class BlockFactoryRequest(BaseModel):
    """Request to decompose a document into blocks."""
    content: str = Field(..., description="Raw document text to decompose")
    source_name: str = Field("", description="Name/title of the source document for traceability")
    write: bool = Field(True, description="Write blocks to disk (false for dry-run/preview)")


class GeneratedBlock(BaseModel):
    """A fully generated block ready to write."""
    spec: BlockSpec
    markdown: str = Field(..., description="Full block content including frontmatter")
    file_path: str = Field(..., description="Relative path where this block was/would be written")
    written: bool = False


class BlockFactoryResponse(BaseModel):
    """Result of the block factory pipeline."""
    source_name: str
    blocks: list[GeneratedBlock]


