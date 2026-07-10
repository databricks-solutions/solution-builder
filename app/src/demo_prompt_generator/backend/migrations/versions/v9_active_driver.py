"""Add projects.active_driver_email.

The "driver" of a project's conversation — the user whose PAT the agent's
Databricks CLI runs as. With editor sharing, two editors would otherwise
overwrite each other's <project>/.databrickscfg token and swap the agent's
identity mid-run. This field makes the driver explicit + sticky: only the
driver's requests refresh the token / run the agent; others must take over.
Nullable — null means "unclaimed" (the first sender, normally the owner,
becomes driver).

Revision ID: v9_active_driver
Revises: v8_share_role_status
Create Date: 2026-07-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v9_active_driver"
down_revision: Union[str, None] = "v8_share_role_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("active_driver_email", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "active_driver_email")
