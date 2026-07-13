"""Add brand cache tables.

Two-layer cache for the company-brand resolver, so repeat lookups skip the slow
resolve (search + logo vision + screenshot) and survive restart:
  - brand_cache: one row per company, keyed by domain, holding palette + logo
    bytes + site screenshot (the expensive artifacts).
  - brand_query_alias: normalized-user-query → domain, so different phrasings of
    the same company share the one brand_cache row.

Revision ID: v12_brand_cache
Revises: v11_driver_handoff
Create Date: 2026-07-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision: str = "v12_brand_cache"
down_revision: Union[str, None] = "v11_driver_handoff"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "brand_cache",
        sa.Column("domain", sa.String(255), primary_key=True),
        sa.Column("company", sa.String(255), nullable=False, server_default=""),
        sa.Column("palette", JSON, nullable=False),
        sa.Column("website", sa.String(500), nullable=True),
        sa.Column("logo_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("logo_content_type", sa.String(100), nullable=True),
        sa.Column("screenshot_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "brand_query_alias",
        sa.Column("query_norm", sa.String(255), primary_key=True),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_brand_query_alias_domain", "brand_query_alias", ["domain"])


def downgrade() -> None:
    op.drop_index("ix_brand_query_alias_domain", table_name="brand_query_alias")
    op.drop_table("brand_query_alias")
    op.drop_table("brand_cache")
