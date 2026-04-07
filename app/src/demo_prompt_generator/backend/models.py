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


class ExecutionStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ERROR = "error"


# ---------------------------------------------------------------------------
# SQLModel tables
# ---------------------------------------------------------------------------


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

    # Skills config (JSON array of skill names)
    skills: str = SQLField(default="[]", sa_column=Column(Text))

    # Claude Code session fields (1:1 conversation per project)
    session_id: Optional[str] = SQLField(default=None, max_length=100)
    cluster_id: Optional[str] = SQLField(default=None, max_length=100)
    warehouse_id: Optional[str] = SQLField(default=None, max_length=100)

    # Timestamps
    created_at: datetime = SQLField(default_factory=utc_now)
    updated_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_projects_user_created", "user_email", "created_at"),
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
    created_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_messages_project_created", "project_id", "created_at"),
    )


class Execution(SQLModel, table=True):
    """
    Stores execution state for Claude Code agent sessions.

    Enables session independence - users can reconnect after page refresh.
    Events stored as JSON array for replay/streaming continuation.
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
    events_json: str = SQLField(default="[]", sa_column=Column(Text))
    error: Optional[str] = SQLField(default=None, sa_column=Column(Text))
    created_at: datetime = SQLField(default_factory=utc_now)
    updated_at: datetime = SQLField(default_factory=utc_now)

    __table_args__ = (
        Index("ix_executions_project_status", "project_id", "status"),
        Index("ix_executions_project_created", "project_id", "created_at"),
    )


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------


class ProjectCreateRequest(BaseModel):
    """Request to create a new project."""
    name: str = Field(..., description="Human-readable project name")
    description: Optional[str] = Field(None, description="Optional project description")


class ProjectUpdateRequest(BaseModel):
    """Request to update a project."""
    name: Optional[str] = None
    description: Optional[str] = None


class ProjectOut(BaseModel):
    """Project details response."""
    id: str
    name: str
    user_email: str
    description: Optional[str]
    project_type: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    file_count: int = 0


class ProjectListItem(BaseModel):
    """Project summary for list views."""
    id: str
    name: str
    project_type: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    file_count: int = 0


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
    error: Optional[str]
    created_at: datetime
    updated_at: datetime


