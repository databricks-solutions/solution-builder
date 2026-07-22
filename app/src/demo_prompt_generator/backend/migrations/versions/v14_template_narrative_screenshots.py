"""Add template narrative + a multi-screenshot child table.

  - templates.narrative: the 1-2 paragraph storytelling summary shown at the
    TOP of the gallery detail sheet (above the screenshot). Distinct from the
    short `description` (the one-liner on tiles). NOT LLM-generated on the
    template side — authored in each seed folder's resources.json, or copied
    verbatim from the source project's `narrative` on user-publish.

  - template_screenshots: extra gallery images beyond the hero. The hero stays
    on `templates.screenshot` (ordinal 0 conceptually); this table holds
    ordinal >= 1 (from template_screenshot_1.png, _2.png, …) so the sheet can
    show a small carousel. One row per extra image.

Revision ID: v14_template_narrative_screenshots
Revises: v13_template_official_screenshot
Create Date: 2026-07-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v14_template_narrative"
down_revision: Union[str, None] = "v13_template_official_screenshot"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("templates", sa.Column("narrative", sa.Text(), nullable=True))

    op.create_table(
        "template_screenshots",
        sa.Column("id", sa.String(50), primary_key=True),
        # index created explicitly below (not via index= here) so it isn't
        # created twice under the same name.
        sa.Column("template_id", sa.String(50), nullable=False),
        # 1-based ordinal of the extra image (the hero is templates.screenshot).
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("image", sa.LargeBinary(), nullable=False),
    )
    op.create_index(
        "ix_template_screenshots_template_id",
        "template_screenshots",
        ["template_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_template_screenshots_template_id", table_name="template_screenshots")
    op.drop_table("template_screenshots")
    op.drop_column("templates", "narrative")
