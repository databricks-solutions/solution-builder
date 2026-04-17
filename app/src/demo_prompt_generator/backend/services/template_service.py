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
from .llm_service import LLMService

logger = logging.getLogger(__name__)

PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Files to exclude from templates (dynamic/environment-specific content)
TEMPLATE_EXCLUDED_FILES = {
    "resources.json",               # Contains created Databricks resource IDs (root)
    "specifications/resources.json",  # Contains created Databricks resource IDs (specifications/)
}


def _should_include_in_template(relative_path: str) -> bool:
    """Check if a file should be included in a template."""
    # Skip .claude directory
    if relative_path.startswith(".claude/"):
        return False
    # Skip explicitly excluded files
    if relative_path in TEMPLATE_EXCLUDED_FILES:
        return False
    return True


def _store_embedding(session: Session, template_id: str, embedding: list[float]) -> None:
    """Store an embedding vector, gracefully skipping if pgvector is unavailable (PGLite)."""
    # PGLite doesn't support the vector type — skip embedding storage
    if not os.environ.get("LAKEBASE_PG_URL"):
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
            if f.relative_path.lower() in ("readme.md", "readme.txt", "readme"):
                readme_content = decompress_content(f.content_compressed).decode("utf-8")
                break

        # Use project name as fallback if no README
        if not readme_content:
            readme_content = f"# {project.name}\n\n{project.description or ''}"

        # LLM extraction
        extracted = self.llm.summarize_readme(readme_content)

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
            full_description=readme_content,
            capabilities=json.dumps(extracted.get("capabilities", [])),
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
        )
        session.add(project)

        # Bulk create project files from template (more efficient than individual adds)
        project_files = [
            ProjectFile(
                project_id=project_id,
                relative_path=tf.relative_path,
                content_compressed=tf.content_compressed,
                content_hash=tf.content_hash,
                file_size=tf.file_size,
            )
            for tf in template_files
        ]
        session.add_all(project_files)
        session.commit()

        # Copy files to local filesystem
        project_dir = Path(PROJECTS_BASE_DIR) / project_id
        project_dir.mkdir(parents=True, exist_ok=True)

        for tf in template_files:
            file_path = project_dir / tf.relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                content = decompress_content(tf.content_compressed)
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

        # Delete existing template content
        for tc in session.exec(
            select(TemplateContent).where(TemplateContent.template_id == template_id)
        ).all():
            session.delete(tc)
        # Flush deletes before inserting new content to avoid unique constraint violation
        session.flush()

        # Filter files (skip excluded) and capture README content
        readme_content = None
        filtered_files = []
        for f in project_files:
            if not _should_include_in_template(f.relative_path):
                continue
            filtered_files.append(f)
            # Capture README for embedding update
            if f.relative_path.lower() in ("readme.md", "readme.txt", "readme"):
                readme_content = decompress_content(f.content_compressed).decode("utf-8")

        # Bulk copy project files to template_content
        template_files = [
            TemplateContent(
                template_id=template_id,
                relative_path=f.relative_path,
                content_compressed=f.content_compressed,
                content_hash=f.content_hash,
                file_size=f.file_size,
            )
            for f in filtered_files
        ]
        session.add_all(template_files)

        # Use project name/description if no README
        if not readme_content:
            readme_content = f"# {project.name}\n\n{project.description or ''}"

        # Update template metadata from LLM
        extracted = self.llm.summarize_readme(readme_content)
        template.name = project.name
        template.industry = extracted.get("industry")
        template.description = extracted.get("description")
        template.full_description = readme_content
        template.capabilities = json.dumps(extracted.get("capabilities", []))
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
