"""Initial schema - baseline for all tables.

Revision ID: v0_initial
Revises: None
Create Date: 2025-01-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "v0_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables from scratch."""

    # Users table
    op.create_table(
        "users",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("databricks_profile", sa.String(100), server_default="DEFAULT"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Projects table
    op.create_table(
        "projects",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("user_email", sa.String(255), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("project_type", sa.String(50), server_default="DATABRICKS_DEMO"),
        sa.Column("skills", sa.Text, server_default="[]"),
        sa.Column("session_id", sa.String(100)),
        sa.Column("cluster_id", sa.String(100)),
        sa.Column("cluster_name", sa.String(255)),
        sa.Column("warehouse_id", sa.String(100)),
        sa.Column("warehouse_name", sa.String(255)),
        sa.Column("default_catalog", sa.String(255)),
        sa.Column("default_schema", sa.String(255)),
        sa.Column("stage", sa.String(20), server_default="DRAFTING"),
        sa.Column("source_template_id", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_projects_user_created", "projects", ["user_email", "created_at"])
    op.create_index("ix_projects_source_template", "projects", ["source_template_id"])

    # Project files table
    op.create_table(
        "project_files",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(50), nullable=False, index=True),
        sa.Column("relative_path", sa.String(500), nullable=False),
        sa.Column("content_compressed", sa.LargeBinary, nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("file_size", sa.Integer, server_default="0"),
        sa.Column("last_modified", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_project_files_project_path", "project_files", ["project_id", "relative_path"], unique=True)

    # Messages table (reasoning_data is BYTEA for compressed storage)
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(50), nullable=False, index=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("is_error", sa.Boolean, server_default="false"),
        sa.Column("reasoning_data", sa.LargeBinary, nullable=True),  # Compressed with zlib
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_messages_project_created", "messages", ["project_id", "created_at"])

    # Executions table
    op.create_table(
        "executions",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("project_id", sa.String(50), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("events_json", sa.Text, server_default="[]"),
        sa.Column("session_id", sa.String(100)),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_executions_project_status", "executions", ["project_id", "status"])
    op.create_index("ix_executions_project_created", "executions", ["project_id", "created_at"])

    # Templates table
    op.create_table(
        "templates",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="REVIEW_REQUESTED"),
        sa.Column("owner_email", sa.String(255), nullable=False, index=True),
        sa.Column("industry", sa.String(100), index=True),
        sa.Column("description", sa.Text),
        sa.Column("full_description", sa.Text),
        sa.Column("capabilities", sa.Text),
        sa.Column("embedding", sa.Text),  # TEXT for PGLite, vector(1024) for production (added by migration)
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by", sa.String(255)),
        sa.Column("source_project_id", sa.String(50)),
    )
    op.create_index("ix_templates_status", "templates", ["status"])

    # Template content table
    op.create_table(
        "template_content",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("template_id", sa.String(50), sa.ForeignKey("templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relative_path", sa.String(500), nullable=False),
        sa.Column("content_compressed", sa.LargeBinary, nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("file_size", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_template_content_template_id", "template_content", ["template_id"])
    op.create_index("ix_template_content_unique_path", "template_content", ["template_id", "relative_path"], unique=True)

    # Project stars table
    op.create_table(
        "project_stars",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_email", sa.String(255), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_project_stars_user_project", "project_stars", ["user_email", "project_id"], unique=True)
    op.create_index("ix_project_stars_user", "project_stars", ["user_email"])

    # Project shares table
    op.create_table(
        "project_shares",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("owner_email", sa.String(255), nullable=False),
        sa.Column("shared_with_email", sa.String(255), nullable=False),
        sa.Column("message", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_project_shares_unique", "project_shares", ["project_id", "shared_with_email"], unique=True)
    op.create_index("ix_project_shares_recipient", "project_shares", ["shared_with_email"])
    op.create_index("ix_project_shares_project", "project_shares", ["project_id"])


def downgrade() -> None:
    """Drop all tables."""
    op.drop_table("project_shares")
    op.drop_table("project_stars")
    op.drop_table("template_content")
    op.drop_table("templates")
    op.drop_table("executions")
    op.drop_table("messages")
    op.drop_table("project_files")
    op.drop_table("projects")
    op.drop_table("users")
