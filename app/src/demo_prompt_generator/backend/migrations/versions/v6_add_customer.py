"""Add projects.customer and templates.customer.

The customer/account a demo is being built FOR. On projects it's inferred by a
mini model from the chat conversation (services/customer_extraction.py) and is
user-editable; templates inherit it from their source project. Nullable — a null
renders as "Not specified" in the UI.

Revision ID: v6_add_customer
Revises: v5_arch_first
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v6_add_customer"
down_revision: Union[str, None] = "v5_arch_first"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("customer", sa.String(255), nullable=True),
    )
    op.add_column(
        "templates",
        sa.Column("customer", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("templates", "customer")
    op.drop_column("projects", "customer")
