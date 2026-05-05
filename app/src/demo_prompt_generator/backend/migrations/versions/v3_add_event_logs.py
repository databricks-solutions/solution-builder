"""Add event_logs table for backend observability + weekly analysis.

Single flat append-only table — one SELECT can answer "what failed this week?",
"what's slow?", and "who's hitting it?" without joins. Populated by:
- Request middleware (one row per /api/* call)
- Global exception handler (unhandled errors)
- LLM service (chat/embedding outcome + duration)
- Agent route (agent_run start/end/error)
- POST /api/client_errors (frontend-reported errors)

Revision ID: v3_event_logs
Revises: v2_msg_cancelled
Create Date: 2026-05-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision: str = "v3_event_logs"
down_revision: Union[str, None] = "v2_msg_cancelled"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "event_logs",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="info"),
        sa.Column("request_id", sa.String(64)),
        sa.Column("user_email", sa.String(255)),
        sa.Column("project_id", sa.String(50)),
        sa.Column("method", sa.String(10)),
        sa.Column("path", sa.String(500)),
        sa.Column("status_code", sa.Integer()),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("error_type", sa.String(200)),
        sa.Column("error_message", sa.Text()),
        sa.Column("stack_trace", sa.Text()),
        sa.Column("event_metadata", JSON()),
    )
    op.create_index("ix_event_logs_created", "event_logs", ["created_at"])
    op.create_index("ix_event_logs_type_created", "event_logs", ["event_type", "created_at"])
    op.create_index("ix_event_logs_severity_created", "event_logs", ["severity", "created_at"])
    op.create_index("ix_event_logs_user_created", "event_logs", ["user_email", "created_at"])
    op.create_index("ix_event_logs_project_created", "event_logs", ["project_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_event_logs_project_created", table_name="event_logs")
    op.drop_index("ix_event_logs_user_created", table_name="event_logs")
    op.drop_index("ix_event_logs_severity_created", table_name="event_logs")
    op.drop_index("ix_event_logs_type_created", table_name="event_logs")
    op.drop_index("ix_event_logs_created", table_name="event_logs")
    op.drop_table("event_logs")
