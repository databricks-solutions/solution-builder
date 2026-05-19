"""Add LLM-generated narrative columns to projects.

`narrative` stores the 1-2 paragraph storytelling summary shown on the
Overview hero. `narrative_readme_hash` lets the frontend detect when the
README has drifted from what the narrative was generated against so it
can auto-regenerate.

Revision ID: v4_proj_narrative
Revises: v3_event_logs
Create Date: 2026-05-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v4_proj_narrative"
down_revision: Union[str, None] = "v3_event_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("narrative", sa.Text(), nullable=True))
    op.add_column(
        "projects",
        sa.Column("narrative_readme_hash", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "narrative_readme_hash")
    op.drop_column("projects", "narrative")
