"""Add official flag, screenshot, and content_checksum to templates.

Supports seeding `initial_templates/` folders as curated ("official") DB
templates keyed by folder name, upgraded smoothly on restart:
  - official: curated templates (seeded); shown with a featured treatment and
    surfaced on the internal /internal-demos gallery.
  - screenshot: optional hero PNG bytes for the gallery tile + slide-over.
  - content_checksum: hash of the seeded folder's file-set, so the startup
    seeder can skip unchanged templates and diff-update only changed ones.

Revision ID: v13_template_official_screenshot
Revises: v11_project_mode
Create Date: 2026-07-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v13_template_official_screenshot"
down_revision: Union[str, None] = "v11_project_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "templates",
        sa.Column("official", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("templates", sa.Column("screenshot", sa.LargeBinary(), nullable=True))
    op.add_column("templates", sa.Column("content_checksum", sa.String(64), nullable=True))
    op.create_index("ix_templates_official", "templates", ["official"])


def downgrade() -> None:
    op.drop_index("ix_templates_official", table_name="templates")
    op.drop_column("templates", "content_checksum")
    op.drop_column("templates", "screenshot")
    op.drop_column("templates", "official")
