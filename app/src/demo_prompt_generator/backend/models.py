"""
Database models and Pydantic schemas for the Databricks Asset Generator.

Clean break from previous generation/block/collection system.
New project-based architecture with file sync and Claude Code integration.
"""

from __future__ import annotations

import uuid
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
    SPECIFICATION = "SPECIFICATION"  # instructions/*.md files exist
    BUILT = "BUILT"                  # .py/.sql files + resources.json with IDs
    BUNDLED = "BUNDLED"              # databricks.yml exists (DAB)


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
    project_type: str = SQLField(default=ProjectType.DATABRICKS_DEMO.value, max_length=50)
    stage: str = SQLField(default=ProjectStage.DRAFTING.value, max_length=20)

    # Skills config (JSON array of skill names)
    skills: str = SQLField(default="[]", sa_column=Column(Text))

    # Claude Code session fields (1:1 conversation per project)
    session_id: Optional[str] = SQLField(default=None, max_length=100)
    cluster_id: Optional[str] = SQLField(default=None, max_length=100)
    cluster_name: Optional[str] = SQLField(default=None, max_length=255)
    warehouse_id: Optional[str] = SQLField(default=None, max_length=100)
    warehouse_name: Optional[str] = SQLField(default=None, max_length=255)

    # Default Unity Catalog context
    default_catalog: Optional[str] = SQLField(default=None, max_length=255)
    default_schema: Optional[str] = SQLField(default=None, max_length=255)

    # Timestamps
    created_at: datetime = SQLField(default_factory=utc_now)
    updated_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_projects_user_created", "user_email", "created_at"),
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
    Metadata field stores reasoning (thinking/tools) for assistant messages.
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
    # Reasoning data for assistant messages (ordered list of thinking/tool entries)
    reasoning_data: Optional[dict] = SQLField(default=None, sa_column=Column(JSON, nullable=True))
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


class ProjectUpdateRequest(BaseModel):
    """Request to update a project."""
    name: Optional[str] = None
    description: Optional[str] = None


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


class ProjectListItem(BaseModel):
    """Project summary for list views."""
    id: str
    name: str
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


class ProjectFileContent(BaseModel):
    """File content response."""
    path: str
    content: str
    size: int
    last_modified: Optional[datetime] = None


class MessageOut(BaseModel):
    """Chat message response."""
    id: int
    project_id: str
    role: str
    content: str
    is_error: bool
    reasoning_data: Optional[dict] = None  # Reasoning entries for assistant messages
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


