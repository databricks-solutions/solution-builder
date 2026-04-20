"""Add active_execution_id to projects table.

Tracks which execution is currently running for a project.
Persisted so the server can detect interrupted executions after restart.

Revision ID: v1_active_exec
Revises: v0_initial
Create Date: 2026-04-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "v1_active_exec"
down_revision: Union[str, None] = "v0_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("active_execution_id", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "active_execution_id")
