#!/usr/bin/env python3
"""
Load initial templates into the Lakebase database.

This script:
1. Connects to the Lakebase database (via LAKEBASE_PG_URL or Databricks Database)
2. Reads template folders from the initial_templates directory
3. For each template:
   - Reads README.md for the full description
   - Uses LLM to extract metadata (description, industry, capabilities)
   - Generates embedding from README for semantic search
   - Deletes existing template by name if it exists
   - Inserts template record with APPROVED status
   - Compresses and inserts all files into template_content

Usage:
    # From project root (with uv):
    uv run python initial_templates/load_templates.py

    # Or with explicit LAKEBASE_PG_URL:
    LAKEBASE_PG_URL="postgresql://..." uv run python initial_templates/load_templates.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path

# Add the app src to path for imports
app_src = Path(__file__).parent.parent / "app" / "src"
sys.path.insert(0, str(app_src))

from databricks.sdk import WorkspaceClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from sqlmodel import Session

# Constants (copied from app to avoid deep imports)
INDUSTRIES = [
    "Financial Services",
    "Healthcare & Life Sciences",
    "Retail & CPG",
    "Manufacturing",
    "Media & Entertainment",
    "Public Sector",
]

CAPABILITIES = [
    {"id": "sdp", "name": "SDP"},
    {"id": "lakeflow-jobs", "name": "Lakeflow Jobs"},
    {"id": "ai-functions", "name": "AI Functions"},
    {"id": "aibi-dashboards", "name": "AI/BI Dashboards"},
    {"id": "genie", "name": "Genie"},
    {"id": "metric-views", "name": "Metric Views"},
    {"id": "vector-search", "name": "Vector Search"},
    {"id": "knowledge-assistant", "name": "Knowledge Assistant"},
    {"id": "supervisor-agent", "name": "Supervisor Agent"},
    {"id": "model-serving", "name": "Model Serving"},
    {"id": "unity-catalog", "name": "Unity Catalog"},
    {"id": "app-python", "name": "Databricks Apps"},
    {"id": "lakebase", "name": "Lakebase"},
    {"id": "streaming", "name": "Streaming"},
    {"id": "synthetic-data-gen", "name": "Synthetic Data Gen"},
    {"id": "zerobus-ingest", "name": "Zerobus Ingest"},
]

CAPABILITY_IDS = [c["id"] for c in CAPABILITIES]

# LLM config
SUMMARIZATION_MODEL = "databricks-gpt-5-4-mini"
EMBEDDING_MODEL = "databricks-qwen3-embedding-0-6b"
OWNER_EMAIL = "system@databricks.com"


def get_engine():
    """Create database engine based on environment."""
    # Check for static LAKEBASE_PG_URL first
    url = os.environ.get("LAKEBASE_PG_URL")
    if url:
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        print(f"Using static LAKEBASE_PG_URL")
        return create_engine(url, pool_size=4, pool_recycle=45 * 60, pool_pre_ping=True)

    # Check for local dev database (PGLite or manual)
    dev_port = os.environ.get("PGPORT")
    if dev_port:
        password = os.environ.get("PGPASSWORD", "postgres")
        url = f"postgresql+psycopg://postgres:{password}@127.0.0.1:{dev_port}/postgres?sslmode=disable"
        print(f"Using local dev database at 127.0.0.1:{dev_port}")
        return create_engine(url, poolclass=NullPool)

    # Production: use Databricks Database
    ws = WorkspaceClient()
    instance_name = os.environ.get("DB_INSTANCE_NAME", "demo-prompt-gen-db")
    print(f"Using Databricks database instance: {instance_name}")

    instance = ws.database.get_database_instance(instance_name)
    username = ws.config.client_id if ws.config.client_id else ws.current_user.me().user_name
    url = f"postgresql+psycopg://{username}:@{instance.read_write_dns}:5432/databricks_postgres"

    engine = create_engine(url, pool_size=4, pool_recycle=45 * 60, pool_pre_ping=True,
                          connect_args={"sslmode": "require"})

    # Dynamic token refresh
    from sqlalchemy import event
    def before_connect(dialect, conn_rec, cargs, cparams):
        cred = ws.database.generate_database_credential(instance_names=[instance_name])
        cparams["password"] = cred.token

    event.listens_for(engine, "do_connect")(before_connect)
    return engine


def get_workspace_client():
    """Get WorkspaceClient for LLM calls."""
    return WorkspaceClient()


def summarize_readme(ws: WorkspaceClient, readme_content: str) -> dict:
    """Use LLM to extract metadata from README."""
    prompt = f"""Analyze this README and return JSON with the following structure:
{{
    "description": "1-2 sentence summary of what this demo does",
    "capabilities": ["capability-id-1", "capability-id-2"],
    "industry": "one of the industries listed below"
}}

Available capability IDs (only use these exact IDs):
{json.dumps(CAPABILITY_IDS, indent=2)}

Available industries (choose exactly one):
{json.dumps(INDUSTRIES, indent=2)}

README:
{readme_content[:8000]}
"""

    try:
        client = ws.serving_endpoints.get_open_ai_client()
        response = client.chat.completions.create(
            model=SUMMARIZATION_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=1000,
        )
        result = json.loads(response.choices[0].message.content)

        # Validate capabilities
        valid_capabilities = [c for c in result.get("capabilities", []) if c in CAPABILITY_IDS]
        result["capabilities"] = valid_capabilities

        # Validate industry
        if result.get("industry") not in INDUSTRIES:
            result["industry"] = None

        return result
    except Exception as e:
        print(f"  Warning: Failed to summarize README: {e}")
        return {"description": None, "capabilities": [], "industry": None}


def get_embedding(ws: WorkspaceClient, text: str) -> list[float]:
    """Get embedding vector for text."""
    max_chars = 8000
    if len(text) > max_chars:
        text = text[:max_chars]

    try:
        client = ws.serving_endpoints.get_open_ai_client()
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text,
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"  Warning: Failed to get embedding: {e}")
        return [0.0] * 1024


def compress_content(content: bytes) -> bytes:
    """Compress file content with zlib."""
    return zlib.compress(content, level=6)


def compute_hash(content: bytes) -> str:
    """Compute SHA-256 hash of content."""
    return hashlib.sha256(content).hexdigest()


def collect_files(template_dir: Path) -> list[tuple[str, bytes]]:
    """Collect all files in template directory, returning (relative_path, content) tuples."""
    files = []
    for path in template_dir.rglob("*"):
        if path.is_file():
            # Get relative path parts for filtering
            rel_path = path.relative_to(template_dir)
            rel_parts = rel_path.parts

            # Skip hidden files and __pycache__
            if any(part.startswith(".") or part == "__pycache__" for part in rel_parts):
                continue

            relative_path = str(rel_path)
            try:
                content = path.read_bytes()
                files.append((relative_path, content))
            except Exception as e:
                print(f"  Warning: Could not read {relative_path}: {e}")

    return files


def delete_template_by_name(session: Session, name: str) -> bool:
    """Delete template by name if it exists. Returns True if deleted."""
    result = session.execute(
        text("SELECT id FROM templates WHERE name = :name"),
        {"name": name}
    )
    row = result.fetchone()
    if row:
        template_id = row[0]
        # CASCADE will delete template_content
        session.execute(text("DELETE FROM templates WHERE id = :id"), {"id": template_id})
        session.commit()
        return True
    return False


def insert_template(
    session: Session,
    template_id: str,
    name: str,
    description: str | None,
    full_description: str,
    industry: str | None,
    capabilities: list[str],
    embedding: list[float],
):
    """Insert template record."""
    now = datetime.now(timezone.utc)

    # Convert embedding to pgvector format
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    session.execute(
        text("""
            INSERT INTO templates (
                id, name, status, owner_email, industry, description,
                full_description, capabilities, embedding, submitted_at,
                reviewed_at, reviewed_by
            ) VALUES (
                :id, :name, 'APPROVED', :owner_email, :industry, :description,
                :full_description, :capabilities, CAST(:embedding AS vector), :submitted_at,
                :reviewed_at, :reviewed_by
            )
        """),
        {
            "id": template_id,
            "name": name,
            "owner_email": OWNER_EMAIL,
            "industry": industry,
            "description": description,
            "full_description": full_description,
            "capabilities": json.dumps(capabilities),
            "embedding": embedding_str,
            "submitted_at": now,
            "reviewed_at": now,
            "reviewed_by": OWNER_EMAIL,
        }
    )
    session.commit()


def insert_template_file(
    session: Session,
    template_id: str,
    relative_path: str,
    content: bytes,
):
    """Insert a template file."""
    compressed = compress_content(content)
    content_hash = compute_hash(content)

    session.execute(
        text("""
            INSERT INTO template_content (
                template_id, relative_path, content_compressed, content_hash, file_size
            ) VALUES (
                :template_id, :relative_path, :content_compressed, :content_hash, :file_size
            )
        """),
        {
            "template_id": template_id,
            "relative_path": relative_path,
            "content_compressed": compressed,
            "content_hash": content_hash,
            "file_size": len(content),
        }
    )


def load_template(session: Session, ws: WorkspaceClient, template_dir: Path) -> bool:
    """Load a single template from directory. Returns True on success."""
    # Derive name from directory structure: industry/use-case -> "Industry: Use Case"
    parts = template_dir.relative_to(template_dir.parent.parent).parts
    if len(parts) == 2:
        industry_dir, use_case_dir = parts
        name = f"{industry_dir.replace('-', ' ').title()}: {use_case_dir.replace('-', ' ').title()}"
    else:
        name = template_dir.name.replace("-", " ").title()

    print(f"\nLoading template: {name}")
    print(f"  Directory: {template_dir}")

    # Read README.md
    readme_path = template_dir / "README.md"
    if not readme_path.exists():
        print(f"  ERROR: No README.md found, skipping")
        return False

    readme_content = readme_path.read_text()
    print(f"  README.md: {len(readme_content)} chars")

    # Delete existing template with same name
    if delete_template_by_name(session, name):
        print(f"  Deleted existing template with name: {name}")

    # Extract metadata using LLM
    print(f"  Extracting metadata via LLM...")
    metadata = summarize_readme(ws, readme_content)
    print(f"    Industry: {metadata.get('industry')}")
    print(f"    Capabilities: {metadata.get('capabilities')}")
    print(f"    Description: {metadata.get('description', '')[:80]}...")

    # Generate embedding
    print(f"  Generating embedding...")
    embedding = get_embedding(ws, readme_content)
    print(f"    Embedding dimension: {len(embedding)}")

    # Collect all files
    files = collect_files(template_dir)
    print(f"  Found {len(files)} files")

    # Generate template ID
    template_id = str(uuid.uuid4())

    # Insert template record
    insert_template(
        session=session,
        template_id=template_id,
        name=name,
        description=metadata.get("description"),
        full_description=readme_content,
        industry=metadata.get("industry"),
        capabilities=metadata.get("capabilities", []),
        embedding=embedding,
    )
    print(f"  Inserted template: {template_id}")

    # Insert all files
    for relative_path, content in files:
        insert_template_file(session, template_id, relative_path, content)
    session.commit()
    print(f"  Inserted {len(files)} files")

    return True


def find_template_dirs(base_dir: Path) -> list[Path]:
    """Find all template directories (those with README.md)."""
    templates = []
    for readme in base_dir.rglob("README.md"):
        # Skip the base directory itself
        if readme.parent == base_dir:
            continue
        # Skip example directories
        if "example" in str(readme.parent).lower():
            continue
        templates.append(readme.parent)
    return sorted(templates)


def main():
    """Main entry point."""
    print("=" * 60)
    print("Template Loader")
    print("=" * 60)

    # Find templates directory
    script_dir = Path(__file__).parent
    print(f"Templates directory: {script_dir}")

    # Find all template directories
    template_dirs = find_template_dirs(script_dir)
    print(f"Found {len(template_dirs)} template directories:")
    for d in template_dirs:
        print(f"  - {d.relative_to(script_dir)}")

    if not template_dirs:
        print("No templates found!")
        return 1

    # Connect to database
    print("\nConnecting to database...")
    engine = get_engine()

    # Test connection
    with Session(engine) as session:
        session.execute(text("SELECT 1"))
        print("Database connection successful!")

    # Get workspace client for LLM calls
    print("Initializing Databricks client...")
    ws = get_workspace_client()

    # Load each template
    success_count = 0
    error_count = 0

    for template_dir in template_dirs:
        try:
            with Session(engine) as session:
                if load_template(session, ws, template_dir):
                    success_count += 1
                else:
                    error_count += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            error_count += 1

    # Summary
    print("\n" + "=" * 60)
    print(f"SUMMARY: {success_count} loaded, {error_count} errors")
    print("=" * 60)

    return 0 if error_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
