"""Add projects.architecture_first.

Architecture-first projects (created from the home page's "Describe your
architecture" mode) open on the Architecture tab and show the "Build the
solution for this architecture" CTA. The flag flips to False when the user
kicks off the build, after which the project behaves like any other.

Revision ID: v5_arch_first
Revises: v4_proj_narrative
Create Date: 2026-07-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v5_arch_first"
down_revision: Union[str, None] = "v4_proj_narrative"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "architecture_first",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "architecture_first")
