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
    created_at: datetime


class GenerationListItem(BaseModel):
    id: int
    demo_name: str
    industry: str
    created_at: datetime


class InspireRequest(BaseModel):
    topic: str = Field(..., description="Industry or topic to generate a use-case for")


# ---------------------------------------------------------------------------
# SQLModel table — persisted in Lakebase
# ---------------------------------------------------------------------------


class Generation(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    demo_name: str
    owner_name: str
    industry: str
    form_json: str = SQLField(sa_column=Column(Text))
    skill_md: str = SQLField(sa_column=Column(Text))
    created_at: datetime = SQLField(default_factory=datetime.utcnow)
