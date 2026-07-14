"""Add projects.mode.

Home-page entry mode for a project: "story" (the default build flow),
"architecture" (lead-with-diagram; see architecture_first), or "workshop"
(Genie Code workshop — the agent generates notebooks + data-gen + context
instead of provisioning Databricks resources). Drives which Build fork the
agent takes. Existing rows default to "story".

Revision ID: v11_project_mode
Revises: v10_driver_token_ts
Create Date: 2026-07-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v11_project_mode"
down_revision: Union[str, None] = "v10_driver_token_ts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "mode",
            sa.String(length=20),
            nullable=False,
            server_default="story",
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "mode")
