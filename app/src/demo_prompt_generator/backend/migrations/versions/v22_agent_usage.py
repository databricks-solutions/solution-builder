"""Add agent_usage.

One row per model response (main agent + subagents), read from the project's
Claude Code transcripts, so the chat's "$" chip can show what a demo build cost.
Unique on (project_id, message_id): re-ingesting a transcript is an upsert.

Revision ID: v22_agent_usage
Revises: v21_template_live_demo
Create Date: 2026-11-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v22_agent_usage"
down_revision: Union[str, None] = "v21_template_live_demo"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_usage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("session_id", sa.String(64), nullable=False),
        sa.Column("message_id", sa.String(200), nullable=False),
        sa.Column("agent_id", sa.String(64), nullable=True),
        sa.Column("agent_type", sa.String(100), nullable=True),
        sa.Column("agent_description", sa.Text(), nullable=True),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_write_5m_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_write_1h_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("web_search_requests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inference_geo", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_agent_usage_project_id", "agent_usage", ["project_id"])
    op.create_index(
        "ix_agent_usage_project_message", "agent_usage", ["project_id", "message_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_agent_usage_project_message", table_name="agent_usage")
    op.drop_index("ix_agent_usage_project_id", table_name="agent_usage")
    op.drop_table("agent_usage")
