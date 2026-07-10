"""Add projects.active_driver_token_refreshed_at.

Timestamp of when the driver's PAT was last written to the project's
.databrickscfg. The forwarded token lives ~60min; a non-driver may run the
agent on the driver's token while it's fresh (<50min), but is blocked once
stale. Nullable — null means never written (unclaimed / local mode).

Revision ID: v10_driver_token_ts
Revises: v9_active_driver
Create Date: 2026-07-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v10_driver_token_ts"
down_revision: Union[str, None] = "v9_active_driver"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("active_driver_token_refreshed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "active_driver_token_refreshed_at")
