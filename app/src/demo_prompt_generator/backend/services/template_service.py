"""
Template Service for template library feature.

Handles:
- Template submission from projects
- Semantic search using pgvector
- Creating projects from templates
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import Engine
from sqlmodel import Session, select, text

from ..models import (
    Project,
    ProjectFile,
    Template,
    TemplateContent,
    TemplateStatus,
    generate_uuid,
    utc_now,
)
from .file_sync import compress_content, decompress_content, compute_file_hash
from ..core.constants import INDUSTRIES, get_capabilities
from .llm_service import LLMService, ModelSize

logger = logging.getLogger(__name__)

PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

def _should_include_in_template(relative_path: str) -> bool:
    """A template carries the whole demo a fork can deploy — narrative (README,
    specs), the deployable assets (data-gen, dashboard/genie JSON, DAB, app
    source), everything. It does NOT carry build artifacts, dependencies,
    local/deploy state, or heavy binaries — those are regenerated per fork.

    Exclude-list (reject junk, keep the rest). A path is excluded if any of its
    directory segments is a known-junk dir, or its basename/extension is junk."""
    parts = Path(relative_path).parts
    name = parts[-1] if parts else relative_path

    # Junk directories (dependencies, virtualenvs, build outputs, agent state,
    # local deploy state, caches, test outputs).
    JUNK_DIRS = {
        ".claude", "node_modules", ".venv", "venv", "__pycache__", ".databricks",
        "dist", "build", ".git", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        "test-results", "playwright-report", "raw_data", ".turbo", ".next",
    }
    if any(seg in JUNK_DIRS for seg in parts):
        return False

    # Junk basenames (local env, deploy-state markers, OS cruft). NOTE: lockfiles
    # (package-lock.json, uv.lock, …) are KEPT — the DAB/app needs them at deploy
    # time (a missing app lockfile crashes the Apps container with ERR_MODULE_NOT_FOUND).
    # `template_screenshot.png` is excluded here: it's loaded into the Template's
    # `screenshot` binary column (not shipped as a fork file).
    JUNK_NAMES = {
        ".env", ".ds_store", ".preview.pgid", ".preview.server.pid",
        "app.yaml.template", "template_screenshot.png",
        # Seed-only per-folder metadata — read by the seeder, never shipped as a
        # fork file (a real generated project has no manifest.json).
        "manifest.json",
    }
    if name.lower() in JUNK_NAMES:
        return False
    if name.startswith(".env."):
        return False
    # Extra gallery screenshots (template_screenshot_1.png, _2.png, …) are
    # gallery-only like the hero — loaded into the template_screenshots table,
    # never shipped as fork files.
    if re.fullmatch(r"template_screenshot_\d+\.png", name.lower()):
        return False

    # Junk extensions (compiled/binary/archive artifacts).
    JUNK_EXTS = {
        ".pyc", ".pyo", ".so", ".o", ".class", ".log", ".tmp", ".zip",
        ".tar", ".gz", ".tgz", ".whl", ".map",
    }
    if any(name.lower().endswith(ext) for ext in JUNK_EXTS):
        return False

    return True


def _capabilities_from_resources_json(resources_json_text: str) -> list[str]:
    """The project's REAL capability selection, flattened from its resources.json
    `capabilities.{buildable, talking_track}` (buildable first, then talking_track,
    deduped, order preserved). This is the source of truth — far better than
    LLM-guessing the capabilities from the README. Returns [] on parse failure or
    when the block is absent (caller falls back to the LLM extraction)."""
    try:
        caps = json.loads(resources_json_text).get("capabilities")
    except (json.JSONDecodeError, AttributeError, ValueError):
        return []
    if not isinstance(caps, dict):
        return list(caps) if isinstance(caps, list) else []
    out: list[str] = []
    seen: set[str] = set()
    for group in ("buildable", "talking_track"):
        for c in caps.get(group, []) or []:
            if c not in seen:
                seen.add(c)
                out.append(c)
    return out


def _clear_created_resources(resources_json_bytes: bytes) -> bytes:
    """Return a resources.json with `created_resources` emptied but `capabilities`
    (and any other keys) preserved. Used when forking a template into a new project
    so the fork inherits the capability selection but points at NO live Databricks
    objects (the template's stored IDs are the author's workspace — dead links +
    false "built" status otherwise). Mirrors projects._fresh_resources_from /
    clone_project. On parse failure, returns the bytes unchanged."""
    try:
        data = json.loads(resources_json_bytes.decode("utf-8"))
        if isinstance(data, dict):
            data["created_resources"] = {}
            return json.dumps(data, indent=2).encode("utf-8")
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        pass
    return resources_json_bytes


def _upsert_template_content(
    session: Session,
    template_id: str,
    files: list[tuple[str, bytes, str, int]],
) -> dict[str, int]:
    """Sync a template's stored files to exactly `files`, touching only changes.

    `files` = list of (relative_path, content_compressed, content_hash, file_size).
    Compares against existing TemplateContent rows by content_hash:
      - unchanged (same hash) → left in place (row id preserved)
      - changed (path exists, different hash) → content updated
      - new (path absent) → inserted
      - removed (existing path not in `files`) → deleted
    Returns counts {added, changed, unchanged, removed} for logging. The caller
    commits. This replaces the old delete-all-then-reinsert so re-seeds/updates
    are smooth (no churn on unchanged files, no unique-constraint dance)."""
    existing = {
        tc.relative_path: tc
        for tc in session.exec(
            select(TemplateContent).where(TemplateContent.template_id == template_id)
        ).all()
    }
    incoming_paths = {f[0] for f in files}
    added = changed = unchanged = removed = 0

    for rel_path, compressed, content_hash, file_size in files:
        row = existing.get(rel_path)
        if row is None:
            session.add(TemplateContent(
                template_id=template_id,
                relative_path=rel_path,
                content_compressed=compressed,
                content_hash=content_hash,
                file_size=file_size,
            ))
            added += 1
        elif row.content_hash != content_hash:
            row.content_compressed = compressed
            row.content_hash = content_hash
            row.file_size = file_size
            session.add(row)
            changed += 1
        else:
            unchanged += 1

    for rel_path, row in existing.items():
        if rel_path not in incoming_paths:
            session.delete(row)
            removed += 1

    return {"added": added, "changed": changed, "unchanged": unchanged, "removed": removed}


def _store_embedding(session: Session, template_id: str, embedding: list[float]) -> None:
    """Store an embedding vector, gracefully skipping if pgvector is unavailable (PGLite)."""
    # PGLite doesn't support the vector type — skip embedding storage.
    # In Lakebase mode (the default), LAKEBASE_DATABASE_PATH is set.
    if os.environ.get("USE_PGLITE") == "1" or not os.environ.get("LAKEBASE_DATABASE_PATH"):
        logger.debug("Skipping embedding storage (PGLite mode, no pgvector)")
        return
    session.execute(
        text("""
            UPDATE templates
            SET embedding = CAST(:embedding AS vector)
            WHERE id = :template_id
        """),
        {"embedding": str(embedding), "template_id": template_id}
    )


def _summarize_readme(llm: LLMService, readme_content: str) -> dict:
    """Extract metadata (description, capabilities, industry) from README via LLM."""
    import json
    capability_ids = [c["id"] for c in get_capabilities()]
    prompt = f"""Analyze this README and return JSON:
{{
    "description": "1-2 sentence summary",
    "capabilities": ["capability-id-1", "capability-id-2"],
    "industry": "one of the industries listed below"
}}

Available capability IDs: {json.dumps(capability_ids)}
Available industries: {json.dumps(INDUSTRIES)}

README:
{readme_content[:8000]}
"""
    try:
        result = llm.chat_json(prompt, size=ModelSize.MINI)
        result["capabilities"] = [c for c in result.get("capabilities", []) if c in capability_ids]
        if result.get("industry") not in INDUSTRIES:
            result["industry"] = None
        return result
    except Exception as e:
        logger.error(f"Failed to summarize README: {e}")
        return {"description": None, "capabilities": [], "industry": None}


class TemplateService:
    """
    Service for template CRUD operations and semantic search.
    """

    def __init__(self, engine: Engine, llm_service: LLMService):
        self.engine = engine
        self.llm = llm_service

    def submit_template(
        self,
        project_id: str,
        owner_email: str,
        session: Session,
    ) -> Template:
        """
        Submit a project as a template for review.

        1. Copy all project files to template_content
        2. Read README.md and call LLM for summary
        3. Generate embedding from README
        4. Create template entry with REVIEW_REQUESTED status

        Args:
            project_id: Source project UUID
            owner_email: Email of the submitter
            session: Database session

        Returns:
            Created Template object
        """
        # Get the project
        project = session.exec(
            select(Project).where(Project.id == project_id)
        ).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Get project files
        project_files = session.exec(
            select(ProjectFile).where(ProjectFile.project_id == project_id)
        ).all()

        if not project_files:
            raise ValueError(f"Project {project_id} has no files")

        # Find README.md
        readme_content = None
        for f in project_files:
            if f.relative_path.lower() == "readme.md":
                readme_content = decompress_content(f.content_compressed).decode("utf-8")
                break

        # Use project name as fallback if no README
        if not readme_content:
            readme_content = f"# {project.name}\n\n{project.description or ''}"

        # Real capabilities come from the project's own resources.json — the
        # source of truth. Only fall back to the LLM's README guess if that
        # block is missing/empty.
        resources_text = None
        for f in project_files:
            if f.relative_path.lower() == "resources.json":
                resources_text = decompress_content(f.content_compressed).decode("utf-8")
                break
        real_capabilities = (
            _capabilities_from_resources_json(resources_text) if resources_text else []
        )

        # LLM extraction (still used for description + industry, and as the
        # capabilities fallback when resources.json has none).
        extracted = _summarize_readme(self.llm, readme_content)
        capabilities = real_capabilities or extracted.get("capabilities", [])

        # Generate embedding
        embedding = self.llm.get_embedding(readme_content)

        # Create template record
        template_id = generate_uuid()
        template = Template(
            id=template_id,
            name=project.name,
            status=TemplateStatus.REVIEW_REQUESTED.value,
            owner_email=owner_email,
            industry=extracted.get("industry"),
            description=extracted.get("description"),
            # The story summary the project already generated from its README —
            # copied verbatim, never re-generated on the template side.
            narrative=project.narrative,
            full_description=readme_content,
            capabilities=json.dumps(capabilities),
            customer=project.customer,
            submitted_at=utc_now(),
            source_project_id=project_id,
        )
        session.add(template)

        # Store embedding (gracefully skips on PGLite where pgvector is unavailable)
        _store_embedding(session, template_id, embedding)

        # Bulk copy project files to template_content (skip excluded files)
        template_files = [
            TemplateContent(
                template_id=template_id,
                relative_path=f.relative_path,
                content_compressed=f.content_compressed,
                content_hash=f.content_hash,
                file_size=f.file_size,
            )
            for f in project_files
            if _should_include_in_template(f.relative_path)
        ]
        session.add_all(template_files)
        session.commit()
        session.refresh(template)
        return template

    def search_templates(
        self,
        query: str,
        session: Session,
        limit: int = 3,
        status: str = "APPROVED",
    ) -> list[dict]:
        """
        Semantic search for templates using pgvector, with text fallback for PGLite.

        Args:
            query: Search query text
            session: Database session
            limit: Max number of results
            status: Filter by status (default APPROVED)

        Returns:
            List of template dicts with similarity scores
        """
        try:
            # Try pgvector semantic search first
            query_embedding = self.llm.get_embedding(query)

            results = session.execute(
                text("""
                    SELECT
                        id, name, description, industry, capabilities,
                        1 - (embedding <=> CAST(:query_embedding AS vector)) AS similarity
                    FROM templates
                    WHERE status = :status
                    AND embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:query_embedding AS vector)
                    LIMIT :limit
                """),
                {
                    "query_embedding": str(query_embedding),
                    "status": status,
                    "limit": limit,
                }
            ).fetchall()
        except Exception as e:
            logger.debug(f"pgvector search unavailable, falling back to text search: {e}")
            session.rollback()
            # Fallback: simple ILIKE text search on name and description
            results = session.execute(
                text("""
                    SELECT
                        id, name, description, industry, capabilities,
                        0.5 AS similarity
                    FROM templates
                    WHERE status = :status
                    AND (
                        name ILIKE '%' || :query || '%'
                        OR description ILIKE '%' || :query || '%'
                    )
                    LIMIT :limit
                """),
                {
                    "query": query,
                    "status": status,
                    "limit": limit,
                }
            ).fetchall()

        return [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "industry": r.industry,
                "capabilities": json.loads(r.capabilities) if r.capabilities else [],
                "similarity": float(r.similarity) if r.similarity else 0.0,
            }
            for r in results
        ]

    def list_templates(
        self,
        session: Session,
        status: Optional[str] = None,
        industry: Optional[str] = None,
        owner_email: Optional[str] = None,
    ) -> list[Template]:
        """
        List templates with optional filters.

        Args:
            session: Database session
            status: Filter by status
            industry: Filter by industry
            owner_email: Filter by owner

        Returns:
            List of Template objects
        """
        query = select(Template)

        if status:
            query = query.where(Template.status == status)
        if industry:
            query = query.where(Template.industry == industry)
        if owner_email:
            query = query.where(Template.owner_email == owner_email)

        query = query.order_by(Template.submitted_at.desc())

        return list(session.exec(query).all())

    def get_template(self, template_id: str, session: Session) -> Optional[Template]:
        """Get a template by ID."""
        return session.exec(
            select(Template).where(Template.id == template_id)
        ).first()

    def get_template_files(self, template_id: str, session: Session) -> list[TemplateContent]:
        """Get all files for a template."""
        return list(session.exec(
            select(TemplateContent).where(TemplateContent.template_id == template_id)
        ).all())

    def get_template_file_content(
        self,
        template_id: str,
        relative_path: str,
        session: Session,
    ) -> Optional[str]:
        """Get content of a specific template file."""
        file = session.exec(
            select(TemplateContent)
            .where(TemplateContent.template_id == template_id)
            .where(TemplateContent.relative_path == relative_path)
        ).first()

        if not file:
            return None

        try:
            return decompress_content(file.content_compressed).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to decompress template file {relative_path}: {e}")
            return None

    def update_template_status(
        self,
        template_id: str,
        status: str,
        reviewer_email: str,
        session: Session,
    ) -> Optional[Template]:
        """
        Update template status (admin review action).

        Args:
            template_id: Template to update
            status: New status (APPROVED or REJECTED)
            reviewer_email: Email of the reviewer
            session: Database session

        Returns:
            Updated Template or None if not found
        """
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()

        if not template:
            return None

        template.status = status
        template.reviewed_at = utc_now()
        template.reviewed_by = reviewer_email

        session.commit()
        session.refresh(template)
        return template

    def create_project_from_template(
        self,
        template_id: str,
        project_name: str,
        user_email: str,
        session: Session,
        warehouse_id: Optional[str] = None,
        warehouse_name: Optional[str] = None,
        default_catalog: Optional[str] = None,
        default_schema: Optional[str] = None,
    ) -> Project:
        """
        Create a new project from a template.

        1. Create new project record
        2. Copy template_content to project_files
        3. Copy files to local filesystem

        Args:
            template_id: Template to copy from
            project_name: Name for the new project
            user_email: Email of the user creating the project
            session: Database session
            warehouse_id: Default warehouse ID
            warehouse_name: Default warehouse name
            default_catalog: Default catalog name
            default_schema: Default schema name

        Returns:
            Created Project object
        """
        # Get template
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()
        if not template:
            raise ValueError(f"Template {template_id} not found")

        # Get template files
        template_files = session.exec(
            select(TemplateContent).where(TemplateContent.template_id == template_id)
        ).all()

        # Create new project with default resources
        project_id = generate_uuid()
        project = Project(
            id=project_id,
            user_email=user_email,
            name=project_name,
            description=f"Created from template: {template.name}",
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            default_catalog=default_catalog,
            default_schema=default_schema,
            source_template_id=template_id,
            customer=template.customer,
        )
        session.add(project)

        # Materialize each template file for the fork. resources.json is rewritten
        # with created_resources cleared (the fork points at no live Databricks
        # objects until its owner builds — the template's IDs are the author's
        # workspace). Everything else copies through verbatim (compressed bytes
        # reused, no re-compress).
        def _fork_bytes(tf) -> Optional[bytes]:
            """Decompressed content for the fork, with resources.json transformed.
            Returns None to fall back to the verbatim compressed copy (perf path)."""
            if tf.relative_path.lower() == "resources.json":
                return _clear_created_resources(decompress_content(tf.content_compressed))
            return None

        project_files = []
        for tf in template_files:
            new_bytes = _fork_bytes(tf)
            if new_bytes is None:
                project_files.append(ProjectFile(
                    project_id=project_id,
                    relative_path=tf.relative_path,
                    content_compressed=tf.content_compressed,
                    content_hash=tf.content_hash,
                    file_size=tf.file_size,
                ))
            else:
                project_files.append(ProjectFile(
                    project_id=project_id,
                    relative_path=tf.relative_path,
                    content_compressed=compress_content(new_bytes),
                    content_hash=compute_file_hash(new_bytes),
                    file_size=len(new_bytes),
                ))
        session.add_all(project_files)
        session.commit()

        # Copy files to local filesystem (same transform for resources.json).
        project_dir = Path(PROJECTS_BASE_DIR) / project_id
        project_dir.mkdir(parents=True, exist_ok=True)

        for tf in template_files:
            file_path = project_dir / tf.relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                new_bytes = _fork_bytes(tf)
                content = new_bytes if new_bytes is not None else decompress_content(tf.content_compressed)
                file_path.write_bytes(content)
            except Exception as e:
                logger.error(f"Failed to write file {tf.relative_path}: {e}")

        session.refresh(project)
        return project

    def delete_template(self, template_id: str, session: Session) -> bool:
        """
        Delete a template and its files.

        Args:
            template_id: Template to delete
            session: Database session

        Returns:
            True if deleted, False if not found
        """
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()

        if not template:
            return False

        # Delete template (cascade will delete template_content)
        session.delete(template)
        session.commit()
        return True

    def get_template_by_project(
        self,
        project_id: str,
        session: Session,
    ) -> Optional[Template]:
        """
        Get template linked to a project.

        Args:
            project_id: Project ID to search for
            session: Database session

        Returns:
            Template if found, None otherwise
        """
        return session.exec(
            select(Template).where(Template.source_project_id == project_id)
        ).first()

    def update_template_from_project(
        self,
        template_id: str,
        project_id: str,
        session: Session,
    ) -> Template:
        """
        Update template content from project files.

        Replaces all template files with current project files and regenerates embedding.

        Args:
            template_id: Template to update
            project_id: Source project ID
            session: Database session

        Returns:
            Updated Template

        Raises:
            ValueError: If template or project not found
        """
        # Get template
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()
        if not template:
            raise ValueError(f"Template {template_id} not found")

        # Get project
        project = session.exec(
            select(Project).where(Project.id == project_id)
        ).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Get project files
        project_files = session.exec(
            select(ProjectFile).where(ProjectFile.project_id == project_id)
        ).all()
        if not project_files:
            raise ValueError(f"Project {project_id} has no files")

        # Filter files (skip excluded) and capture README + resources.json content
        readme_content = None
        resources_text = None
        filtered_files = []
        for f in project_files:
            if not _should_include_in_template(f.relative_path):
                continue
            filtered_files.append(f)
            # Capture README for embedding update
            if f.relative_path.lower() == "readme.md":
                readme_content = decompress_content(f.content_compressed).decode("utf-8")
            elif f.relative_path.lower() == "resources.json":
                resources_text = decompress_content(f.content_compressed).decode("utf-8")

        # Smooth sync: only touch changed/added/removed files (no delete-all churn).
        _upsert_template_content(
            session,
            template_id,
            [(f.relative_path, f.content_compressed, f.content_hash, f.file_size)
             for f in filtered_files],
        )

        # Use project name/description if no README
        if not readme_content:
            readme_content = f"# {project.name}\n\n{project.description or ''}"

        # Real capabilities from the project's resources.json (source of truth);
        # LLM only for description/industry + capabilities fallback.
        real_capabilities = (
            _capabilities_from_resources_json(resources_text) if resources_text else []
        )
        extracted = _summarize_readme(self.llm, readme_content)
        template.name = project.name
        template.industry = extracted.get("industry")
        template.description = extracted.get("description")
        template.narrative = project.narrative
        template.full_description = readme_content
        template.capabilities = json.dumps(real_capabilities or extracted.get("capabilities", []))
        template.customer = project.customer
        template.source_project_id = project_id

        # Update embedding (gracefully skips on PGLite)
        embedding = self.llm.get_embedding(readme_content)
        _store_embedding(session, template_id, embedding)

        session.commit()
        session.refresh(template)
        return template

    def get_or_create_source_project(
        self,
        template_id: str,
        user_email: str,
        session: Session,
        warehouse_id: Optional[str] = None,
        warehouse_name: Optional[str] = None,
        default_catalog: Optional[str] = None,
        default_schema: Optional[str] = None,
    ) -> Project:
        """
        Get the source project for a template, or create a new one if it was deleted.

        Args:
            template_id: Template ID
            user_email: User email (for creating new project)
            session: Database session
            warehouse_id: Default warehouse ID (for new project)
            warehouse_name: Default warehouse name (for new project)
            default_catalog: Default catalog name (for new project)
            default_schema: Default schema name (for new project)

        Returns:
            Existing or newly created Project

        Raises:
            ValueError: If template not found
        """
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()
        if not template:
            raise ValueError(f"Template {template_id} not found")

        # If source project exists, return it
        if template.source_project_id:
            project = session.exec(
                select(Project).where(Project.id == template.source_project_id)
            ).first()
            if project:
                return project

        # Project was deleted or never existed - create a new one from template
        project = self.create_project_from_template(
            template_id=template_id,
            project_name=f"Edit: {template.name}",
            user_email=user_email,
            session=session,
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            default_catalog=default_catalog,
            default_schema=default_schema,
        )

        # Link the new project to the template
        template.source_project_id = project.id
        session.commit()
        session.refresh(template)

        return project
