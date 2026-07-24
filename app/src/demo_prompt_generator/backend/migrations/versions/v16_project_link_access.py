"""Add projects.link_access.

"Anyone with the link" sharing: a project can be opened to any signed-in app
user who has its URL, at a role ('viewer' or 'editor'), without an explicit
email invite. 'none' (the default) keeps sharing invite-only. See
_get_project_access + PATCH /projects/{id}/link-access.

Revision ID: v16_project_link_access
Revises: v15_template_embedding_vector
Create Date: 2026-07-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v16_project_link_access"
down_revision: Union[str, None] = "v15_template_embedding_vector"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "link_access",
            sa.String(length=20),
            nullable=False,
            server_default="none",
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "link_access")
