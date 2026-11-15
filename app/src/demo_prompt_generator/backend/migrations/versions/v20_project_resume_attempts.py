"""Add projects.resume_attempts.

Boot-time resume crash-loop guard (SP mode). Incremented each time an interrupted
conversation is auto-resumed on boot (services/resume_agent); reset to 0 on a
clean turn completion. The resume scan stops auto-resuming a project once this
reaches RESUME_MAX_ATTEMPTS (3), so a turn that reliably crashes the app is left
interrupted for a human instead of resume-crash-looping across deploys.
`server_default='0'` backfills every existing row. Nullable (treated as 0).

Revision ID: v20_project_resume_attempts
Revises: v19_add_template_type
Create Date: 2026-08-31
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v20_project_resume_attempts"
down_revision: Union[str, None] = "v19_add_template_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "resume_attempts",
            sa.Integer(),
            nullable=True,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "resume_attempts")
