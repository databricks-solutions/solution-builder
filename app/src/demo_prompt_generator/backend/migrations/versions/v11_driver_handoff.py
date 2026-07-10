"""Add projects.driver_handoff_pending.

Set when a take-over happens; consumed on the next agent turn, which folds a
one-line "operator changed to X" notice into the query so Claude learns about
the identity handoff exactly once. Non-null default False (existing rows =
no pending handoff).

Revision ID: v11_driver_handoff
Revises: v10_driver_token_ts
Create Date: 2026-07-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v11_driver_handoff"
down_revision: Union[str, None] = "v10_driver_token_ts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "driver_handoff_pending",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "driver_handoff_pending")
