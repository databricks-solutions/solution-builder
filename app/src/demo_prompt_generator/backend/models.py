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
from typing import Optional

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
    "synthetic-data-gen": ["pipeline_id"],
    "lakeflow-connect": ["pipeline_id"],
    "aibi-dashboards": ["dashboard_id"],
    "genie": ["genie_space_id"],
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


def _all_buildable_capabilities_built(resources_json_text: str) -> bool:
    """True when every entry in `capabilities.buildable` has at least one
    matching deployed-resource key populated in the JSON. Conservative on
    parse failure (returns False) so we don't claim BUILT on broken JSON.
    Capabilities with no required keys (or unknown to us) are skipped —
    forward-compatible with new capability slugs."""
    import json
    try:
        data = json.loads(resources_json_text)
    except (ValueError, TypeError):
        return False
    if not isinstance(data, dict):
        return False

    caps_section = data.get("capabilities") or {}
    buildable = caps_section.get("buildable") if isinstance(caps_section, dict) else None
    if not isinstance(buildable, list) or not buildable:
        # No capability manifest — fall back to the file-based heuristic by
        # treating "all built" as true. The agent hasn't started populating
        # the structured manifest yet, so we don't have a basis to gate on.
        return True

    populated_keys: set[str] = {k for k, _ in _iter_string_values(data)}

    for slug in buildable:
        if not isinstance(slug, str):
            continue
        required = _CAPABILITY_RESOURCE_KEYS.get(slug)
        if not required:
            # Capability has no deployed resource (e.g. unity-catalog) or is
            # unknown to us — don't block on it.
            continue
        if not any(k in populated_keys for k in required):
            return False
    return True


def compute_project_stage(
    file_paths: list[str],
    resources_json_text: str | None = None,
) -> str:
    """Derive the project stage from its file paths.

    Checks from highest stage downward so the first match wins.

    When `resources_json_text` is provided, BUILT additionally requires
    that every `capabilities.buildable` entry has a matching deployed
    resource key in `created_resources`. Otherwise the heuristic stays
    file-only — a `.py`/`.sql` + `resources.json` was enough, which made
    BUILT trigger before the supervisor/app capabilities were actually
    deployed.
    """
    path_set = {p.lower() for p in file_paths}
    names = {p.rsplit("/", 1)[-1] for p in path_set}

    if "databricks.yml" in names:
        return ProjectStage.BUNDLED.value

    has_code = any(p.endswith(".py") or p.endswith(".sql") for p in path_set)
    has_resources = "resources.json" in names
    if has_code and has_resources:
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


class ExecutionStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ERROR = "error"


class TemplateStatus(str, Enum):
    REVIEW_REQUESTED = "REVIEW_REQUESTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


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
    # LLM-generated 1-2 paragraph storytelling summary of the demo, distinct
    # from `description` (which is the short one-liner the user can edit).
    # Regenerated when the README changes — see /projects/{id}/narrative.
    narrative: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    # Hash of the README content the narrative was generated from. Lets the
    # frontend decide whether to auto-regenerate when the README drifts.
    narrative_readme_hash: Optional[str] = SQLField(default=None, max_length=64)
    project_type: str = SQLField(default=ProjectType.DATABRICKS_DEMO.value, max_length=50)
    stage: str = SQLField(default=ProjectStage.DRAFTING.value, max_length=20)

    # Skills config (JSON array of skill names)
    skills: str = SQLField(default="[]", sa_column=Column(Text))

    # Claude Code session fields (1:1 conversation per project)
    session_id: Optional[str] = SQLField(default=None, max_length=100)
    active_execution_id: Optional[str] = SQLField(default=None, max_length=50)
    cluster_id: Optional[str] = SQLField(default=None, max_length=100)
    cluster_name: Optional[str] = SQLField(default=None, max_length=255)
    warehouse_id: Optional[str] = SQLField(default=None, max_length=100)
    warehouse_name: Optional[str] = SQLField(default=None, max_length=255)

    # Default Unity Catalog context
    default_catalog: Optional[str] = SQLField(default=None, max_length=255)
    default_schema: Optional[str] = SQLField(default=None, max_length=255)

    # Template lineage
    source_template_id: Optional[str] = SQLField(default=None, max_length=50)

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


class ProjectShare(SQLModel, table=True):
    """
    Tracks project sharing between users.

    The owner shares a project with another user via email.
    Shared users get read-only access to view and fork the project.
    """
    __tablename__ = "project_shares"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    project_id: str = SQLField(max_length=50)
    owner_email: str = SQLField(max_length=255)
    shared_with_email: str = SQLField(max_length=255)
    message: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    created_at: datetime = SQLField(default_factory=utc_now)

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
    is_error: bool = SQLField(default=False)
    is_cancelled: bool = SQLField(default=False)
    # Reasoning data for assistant messages - zlib compressed bytes
    reasoning_data: Optional[bytes] = SQLField(default=None, sa_column=Column(LargeBinary, nullable=True))
    created_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_messages_project_created", "project_id", "created_at"),
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
    full_description: Optional[str] = SQLField(default=None, sa_column=Column(Text))  # Full README
    capabilities: Optional[str] = SQLField(default=None, sa_column=Column(Text))  # JSON array

    # Note: embedding column is created via migration (vector type not supported in SQLModel)

    submitted_at: datetime = SQLField(default_factory=utc_now)
    reviewed_at: Optional[datetime] = SQLField(default=None)
    reviewed_by: Optional[str] = SQLField(default=None, max_length=255)
    source_project_id: Optional[str] = SQLField(default=None, max_length=50)

    __table_args__ = (
        Index("ix_templates_status", "status"),
        Index("ix_templates_industry", "industry"),
    )


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


class ProjectCreateRequest(BaseModel):
    """Request to create a new project."""
    description: str = Field(..., description="Project description - name and schema will be generated from this")
    context_document: Optional[str] = Field(
        None, description="Full text of a source document to use as context for generation"
    )
    capabilities: list[str] = Field(
        default_factory=list,
        description="Selected capability IDs — used to scope which ai-dev-kit skills get copied into the project.",
    )
    initial_prompt: Optional[str] = Field(
        None,
        description="Opening chat message. Persisted as a user Message on the new project so it survives refresh and renders before the agent replies.",
    )


class ProjectUpdateRequest(BaseModel):
    """Request to update a project."""
    name: Optional[str] = None
    description: Optional[str] = None


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


class ProjectOut(BaseModel):
    """Project details response."""
    id: str
    name: str
    user_email: str
    description: Optional[str]
    # LLM-generated storytelling narrative (1-2 paragraphs). Distinct from
    # `description`. Drives the Overview hero on the frontend.
    narrative: Optional[str] = None
    narrative_readme_hash: Optional[str] = None
    project_type: str
    stage: str = ProjectStage.DRAFTING.value
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
    # Template lineage
    source_template_id: Optional[str] = None
    source_template_name: Optional[str] = None


class ProjectListItem(BaseModel):
    """Project summary for list views."""
    id: str
    name: str
    description: Optional[str] = None
    project_type: str
    stage: str = ProjectStage.DRAFTING.value
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    file_count: int = 0
    is_starred: bool = False
    # Populated only for "shared with me" views
    shared_by: Optional[str] = None
    shared_message: Optional[str] = None
    owner_email: Optional[str] = None
    # Template lineage
    source_template_id: Optional[str] = None
    source_template_name: Optional[str] = None


class ProjectShareRequest(BaseModel):
    """Request to share a project with another user."""
    email: str = Field(..., description="Email of the user to share with")
    message: Optional[str] = Field(None, description="Optional message to include")


class ProjectShareOut(BaseModel):
    """Share record response."""
    id: int
    project_id: str
    owner_email: str
    shared_with_email: str
    message: Optional[str]
    created_at: datetime


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


class DeployedResourceLink(BaseModel):
    """A single deployed Databricks resource with its live URL."""
    resource_type: str
    label: str
    url: Optional[str] = None
    resource_id: Optional[str] = None


class DeployedResourcesOut(BaseModel):
    """All deployed resources for a project, parsed from resources.json.

    `extraction_error` is set when the LLM-based resources.json extractor
    fails (auth, model unavailable, malformed response, etc.). The UI
    should surface this so users don't see an empty list and assume nothing
    was deployed when in reality the extraction step blew up.
    """
    resources: list[DeployedResourceLink] = Field(default_factory=list)
    deployed_at: Optional[datetime] = None
    extraction_error: Optional[str] = None


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


class InvokeAgentRequest(BaseModel):
    """Request to invoke Claude Code agent."""
    project_id: str
    message: str = Field(..., description="User message to send to agent")
    save_user_message: bool = Field(
        True,
        description="Persist a new user Message row for `message`. Set false when the message is already in the DB (e.g. auto-kicking the agent from a project's opening prompt).",
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


class TemplateListItem(BaseModel):
    """Template summary for list views."""
    id: str
    name: str
    status: str
    owner_email: str
    industry: Optional[str]
    description: Optional[str]
    capabilities: Optional[list[str]] = None  # Parsed from JSON
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
    full_description: Optional[str]
    capabilities: Optional[list[str]] = None
    submitted_at: datetime
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    source_project_id: Optional[str] = None
    file_count: int = 0


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


class BlockCategory(str, Enum):
    DOMAIN = "domain"
    CAPABILITY = "capability"
    PATTERN = "pattern"


class BlockSpec(BaseModel):
    """A proposed block from the decomposition phase."""
    name: str = Field(..., description="Display name for the block")
    slug: str = Field(..., description="URL/file-safe identifier")
    category: BlockCategory
    description: str = Field(..., description="One-line description of what this block covers")
    tags: list[str] = Field(default_factory=list)
    source_section: str = Field("", description="Which part of the source document this maps to")


class BlockFactoryRequest(BaseModel):
    """Request to decompose a document into blocks."""
    content: str = Field(..., description="Raw document text to decompose")
    source_name: str = Field("", description="Name/title of the source document for traceability")
    category_hint: Optional[BlockCategory] = Field(
        None, description="If set, bias all blocks toward this category"
    )
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


