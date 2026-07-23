"""Convert templates.embedding from TEXT to pgvector vector(1024).

The column was created as TEXT (v0) "for PGLite; vector(1024) added by migration"
— but that migration never existed, so on real Postgres the column stayed TEXT
and the `<=>` similarity operator could never apply. Semantic template search
therefore silently fell through to the lexical fallback. This fixes it:

  1. CREATE EXTENSION IF NOT EXISTS vector
  2. ALTER templates.embedding TYPE vector(1024) USING embedding::vector
     (existing stringified-vector values like "[0.1, ...]" cast cleanly; NULLs
      stay NULL)
  3. an ivfflat cosine index for fast ANN search

No-ops on PGLite / non-Postgres (which has no vector type) — search there uses
the lexical fallback, unchanged.

Revision ID: v15_template_embedding_vector
Revises: v14_template_narrative
Create Date: 2026-07-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = "v15_template_embedding_vector"
down_revision: Union[str, None] = "v14_template_narrative"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMB_DIM = 1024


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # PGLite / SQLite: no vector type. Leave embedding as TEXT; search uses
        # the lexical fallback.
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    # Any pre-existing TEXT values are stringified vectors ("[...]") and cast
    # cleanly; malformed ones would fail the cast, so null them defensively
    # first is overkill — the only writer used str(list_of_floats).
    op.execute(
        f"ALTER TABLE templates "
        f"ALTER COLUMN embedding TYPE vector({_EMB_DIM}) "
        f"USING embedding::vector({_EMB_DIM})"
    )
    # ANN index for cosine distance (the <=> operator search uses).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_templates_embedding_cosine "
        "ON templates USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_templates_embedding_cosine")
    op.execute("ALTER TABLE templates ALTER COLUMN embedding TYPE text USING embedding::text")
