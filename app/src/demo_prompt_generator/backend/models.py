from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field
from sqlmodel import Column, Field as SQLField, SQLModel, Text

from .. import __version__


class VersionOut(BaseModel):
    version: str

    @classmethod
    def from_metadata(cls):
        return cls(version=__version__)


# ---------------------------------------------------------------------------
# Enums matching original_doc.md form fields
# ---------------------------------------------------------------------------


class Urgency(str, Enum):
    asap = "asap"
    normal = "normal"
    planning = "planning"


class DataSourceType(str, Enum):
    synthetic = "synthetic"
    csv = "csv"
    public = "public"
    anonymized = "anonymized"


class DeliveryFormat(str, Enum):
    live_walkthrough = "live_walkthrough"
    self_guided = "self_guided"
    recorded_video = "recorded_video"
    embedded_slides = "embedded_slides"
    hands_on_lab = "hands_on_lab"
    conference_demo = "conference_demo"


class DemoLength(str, Enum):
    short = "5-10"
    standard = "15-20"
    deep_dive = "30-45"
    workshop = "60+"


class Tone(str, Enum):
    business = "business"
    technical = "technical"
    story_driven = "story_driven"
    conversational = "conversational"


class Cloud(str, Enum):
    aws = "aws"
    azure = "azure"
    gcp = "gcp"


# ---------------------------------------------------------------------------
# Databricks features — checkboxes from Section 3
# ---------------------------------------------------------------------------


class DatabricksFeatures(BaseModel):
    delta_lake: bool = False
    delta_live_tables: bool = False
    unity_catalog: bool = False
    databricks_sql: bool = False
    mlflow: bool = False
    model_registry: bool = False
    model_serving: bool = False
    feature_store: bool = False
    automl: bool = False
    mosaic_ai: bool = False
    vector_search: bool = False
    structured_streaming: bool = False
    serverless_compute: bool = False
    workflows_jobs: bool = False
    genie: bool = False
    databricks_apps: bool = False
    lakehouse_monitoring: bool = False


# ---------------------------------------------------------------------------
# Request model — all form fields from original_doc.md
# ---------------------------------------------------------------------------


class DemoRequestIn(BaseModel):
    """All fields from the demo request form (original_doc.md)."""

    # Section 1: The Basics
    demo_name: str = Field(..., description="Snake-case demo identifier")
    date_needed: Optional[str] = Field(None, description="YYYY-MM-DD")
    owner_name: str = Field(..., description="Submitter name")
    owner_team: Optional[str] = Field(None, description="Team or role")
    primary_audience: str = Field(..., description="Who will be in the room")
    account_name: Optional[str] = Field(None, description="Company name or 'internal'")
    urgency: Optional[Urgency] = None

    # Section 2: The Story
    business_problem: str = Field(..., description="Customer pain point")
    wow_moment: str = Field(..., description="What audience should believe after")
    talking_points: Optional[list[str]] = Field(default_factory=list)
    competitor: Optional[str] = None

    # Section 3: Demo Content
    solution_summary: str = Field(..., description="Main use-case scenario")
    features: DatabricksFeatures = Field(default_factory=DatabricksFeatures)
    data_source_type: DataSourceType = DataSourceType.synthetic
    industry: str = Field(..., description="Industry or domain for the data")
    row_count: Optional[str] = Field(None, description="Approximate rows needed")
    kpis: Optional[list[str]] = Field(default_factory=list, description="Must-have metrics")

    # Section 4: Look & Feel
    delivery_formats: list[DeliveryFormat] = Field(default_factory=list)
    demo_length: DemoLength = DemoLength.standard
    tone: Tone = Tone.business
    branding: Optional[str] = None

    # Section 5: Constraints & Context
    topics_to_avoid: Optional[str] = None
    existing_demo: Optional[str] = Field(None, description="Link or name of existing demo")
    workspace_url: Optional[str] = None
    cloud: Optional[Cloud] = None
    additional_context: Optional[str] = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class GenerationOut(BaseModel):
    id: int
    demo_name: str
    owner_name: str
    industry: str
    skill_md: str
    stage: str = "package"
    is_starred: bool = False
    is_library: bool = False
    library_tags: Optional[list[str]] = None
    proposal_md: Optional[str] = None
    skill_files: Optional[dict[str, str]] = None
    created_at: datetime


class GenerationListItem(BaseModel):
    id: int
    demo_name: str
    industry: str
    stage: str = "package"
    is_starred: bool = False
    is_library: bool = False
    library_tags: Optional[list[str]] = None
    created_at: datetime


class StarRequest(BaseModel):
    is_starred: bool


class InspireRequest(BaseModel):
    topic: str = Field(..., description="Industry or topic to generate a use-case for")


# ---------------------------------------------------------------------------
# Workspace (AI-driven) request/response models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class WorkspaceGenerateRequest(BaseModel):
    topic: str = Field(..., description="Use-case topic to generate a full SKILL.md from")


class WorkspaceRefineRequest(BaseModel):
    generation_id: int
    message: str = Field(..., description="User's refinement instruction")
    history: list[ChatMessage] = Field(default_factory=list)
    focused_sections: list[str] = Field(
        default_factory=list,
        description="Section titles to focus refinement on (from @mentions)",
    )


class WorkspaceProposeRequest(BaseModel):
    topic: str = Field(..., description="Use-case topic to generate a proposal from")


class WorkspaceApproveRequest(BaseModel):
    generation_id: int


class WorkspaceBuildoutRequest(BaseModel):
    generation_id: int
    user_architecture: str | None = Field(default=None, description="User-designed architecture diagram (Mermaid) from the builder")
    files_payload: str | None = None


class WorkspaceBuildoutFileRequest(BaseModel):
    generation_id: int
    filename: str = Field(..., description="File to generate (e.g. 'data-schema.md')")
    generated_files: dict[str, str] = Field(default_factory=dict, description="Previously generated files for context")
    user_architecture: str | None = Field(default=None)


class WorkspaceRefineFileRequest(BaseModel):
    generation_id: int
    filename: str = Field(..., description="Target file to refine (e.g. 'storyline.md')")
    message: str = Field(..., description="User's refinement instruction")
    history: list[ChatMessage] = Field(default_factory=list)


class WorkspaceBuildoutSaveRequest(BaseModel):
    generation_id: int
    files: dict[str, str] = Field(..., description="Completed files so far")


# ---------------------------------------------------------------------------
# SQLModel table — persisted in Lakebase
# ---------------------------------------------------------------------------

PACKAGE_FILES = ["SKILL.md", "storyline.md", "architecture.md", "data-schema.md", "project-structure.md", "walkthrough.md"]


class Generation(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    demo_name: str
    owner_name: str
    user_id: Optional[str] = SQLField(default=None, index=True)
    industry: str
    form_json: str = SQLField(sa_column=Column(Text))
    skill_md: str = SQLField(sa_column=Column(Text))
    stage: str = SQLField(default="package")
    proposal_md: Optional[str] = SQLField(default=None, sa_column=Column(Text, nullable=True))
    skill_files: Optional[str] = SQLField(default=None, sa_column=Column(Text, nullable=True))
    is_starred: bool = SQLField(default=False)
    is_library: bool = SQLField(default=False)
    library_tags: Optional[str] = SQLField(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = SQLField(default_factory=datetime.utcnow)


class Conversation(SQLModel, table=True):
    """A chat conversation thread linked to a generation."""
    id: Optional[int] = SQLField(default=None, primary_key=True)
    generation_id: int = SQLField(index=True)
    title: str = SQLField(default="")
    created_at: datetime = SQLField(default_factory=datetime.utcnow)
    updated_at: datetime = SQLField(default_factory=datetime.utcnow)


class ChatMessageRecord(SQLModel, table=True):
    """An individual chat message within a conversation."""
    __tablename__ = "chat_message"
    id: Optional[int] = SQLField(default=None, primary_key=True)
    conversation_id: int = SQLField(index=True)
    role: str  # "user", "assistant", or "system"
    content: str = SQLField(sa_column=Column(Text))
    created_at: datetime = SQLField(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Conversation request/response models
# ---------------------------------------------------------------------------


class ConversationOut(BaseModel):
    id: int
    generation_id: int
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationWithMessages(BaseModel):
    id: int
    generation_id: int
    title: str
    messages: list[ChatMessage]
    created_at: datetime
    updated_at: datetime


class ChatMessageOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    created_at: datetime


class SaveMessagesRequest(BaseModel):
    generation_id: int
    messages: list[ChatMessage] = Field(..., description="All messages to persist")


class WorkspaceAgentRefineRequest(BaseModel):
    generation_id: int
    message: str = Field(..., description="User's instruction for the agent")
    history: list[ChatMessage] = Field(default_factory=list)


class WorkspaceBuildRequest(BaseModel):
    generation_id: int
