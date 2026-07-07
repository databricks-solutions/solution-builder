"""Add context_hint to messages table.

Stores what the user had open in the UI when they sent a message (e.g. "the
architecture diagram", "the file `README.md`", "the live preview app open at
preview-app/operations"). Persisted so the chat UI can surface it on refresh
(a small "C" badge), and so it survives a reload. Nullable — messages sent with
no active context (overview/story tabs) and non-user roles leave it NULL.

Revision ID: v6_msg_context_hint
Revises: v5_arch_first
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "v6_msg_context_hint"
down_revision: Union[str, None] = "v5_arch_first"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("context_hint", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "context_hint")
