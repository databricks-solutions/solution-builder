"""Add templates.live_demo.

JSON text with the live-demo links ("Try it live" buttons) of a seeded template,
filled by the startup seeder only when the template's manifest `live_demo` is
deployed in the same workspace as this app. Nullable: NULL = no live demo here.

Revision ID: v21_template_live_demo
Revises: v20_project_resume_attempts
Create Date: 2026-09-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v21_template_live_demo"
down_revision: Union[str, None] = "v20_project_resume_attempts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("templates", sa.Column("live_demo", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("templates", "live_demo")
