"""
File synchronization service for project files <-> PostgreSQL.

Compression strategy:
- Use zlib for text files (typically 60-80% compression)
- Store original size for memory planning
- SHA-256 hash for change detection

Sync logic:
- On file change: compress & upsert to DB
- On project open: check local vs DB, restore missing files
- Conflict handling: Local wins (most recent write)
"""

from __future__ import annotations

import hashlib
import logging
import os
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import Engine
from sqlmodel import Session, select

from ..models import ProjectFile

logger = logging.getLogger(__name__)

PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")


def compute_file_hash(content: bytes) -> str:
    """Compute SHA-256 hash of file content."""
    return hashlib.sha256(content).hexdigest()


def compress_content(content: bytes) -> bytes:
    """Compress content using zlib (level 6 - good balance)."""
    return zlib.compress(content, level=6)


def decompress_content(compressed: bytes) -> bytes:
    """Decompress zlib content."""
    return zlib.decompress(compressed)


class FileSyncService:
    """
    Handles bidirectional sync between filesystem and PostgreSQL.
    """

    def __init__(self, engine: Engine):
        self.engine = engine
        self._base_dir = Path(PROJECTS_BASE_DIR).resolve()
        # Ensure base directory exists
        self._base_dir.mkdir(parents=True, exist_ok=True)

    def _project_dir(self, project_id: str) -> Path:
        return self._base_dir / project_id

    async def sync_files_to_db(self, project_id: str, relative_paths: list[str]) -> int:
        """
        Sync changed files from filesystem to database.

        Args:
            project_id: Project UUID
            relative_paths: List of file paths relative to project root

        Returns:
            Number of files synced
        """
        project_dir = self._project_dir(project_id)
        synced = 0

        with Session(self.engine) as session:
            for rel_path in relative_paths:
                file_path = project_dir / rel_path

                if file_path.is_file():
                    # File exists - sync to DB
                    try:
                        content = file_path.read_bytes()
                        content_hash = compute_file_hash(content)

                        # Check if content actually changed
                        existing = session.exec(
                            select(ProjectFile)
                            .where(ProjectFile.project_id == project_id)
                            .where(ProjectFile.relative_path == rel_path)
                        ).first()

                        if existing and existing.content_hash == content_hash:
                            continue

                        compressed = compress_content(content)
                        mtime = datetime.fromtimestamp(
                            file_path.stat().st_mtime, tz=timezone.utc
                        )

                        if existing:
                            existing.content_compressed = compressed
                            existing.content_hash = content_hash
                            existing.file_size = len(content)
                            existing.last_modified = mtime
                            existing.synced_at = datetime.now(timezone.utc)
                        else:
                            new_file = ProjectFile(
                                project_id=project_id,
                                relative_path=rel_path,
                                content_compressed=compressed,
                                content_hash=content_hash,
                                file_size=len(content),
                                last_modified=mtime,
                            )
                            session.add(new_file)

                        synced += 1

                    except Exception as e:
                        logger.error(f"Failed to sync {rel_path}: {e}")
                else:
                    # File deleted - remove from DB
                    existing = session.exec(
                        select(ProjectFile)
                        .where(ProjectFile.project_id == project_id)
                        .where(ProjectFile.relative_path == rel_path)
                    ).first()

                    if existing:
                        session.delete(existing)
                        synced += 1

            session.commit()

        return synced

    def sync_files_to_db_sync(self, project_id: str, relative_paths: list[str]) -> int:
        """
        Synchronous version of sync_files_to_db for use in non-async contexts.
        """
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're in an async context, create a task
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        asyncio.run, self.sync_files_to_db(project_id, relative_paths)
                    )
                    return future.result()
            else:
                return loop.run_until_complete(
                    self.sync_files_to_db(project_id, relative_paths)
                )
        except RuntimeError:
            return asyncio.run(self.sync_files_to_db(project_id, relative_paths))

    def restore_project_from_db(self, project_id: str, session: Optional[Session] = None) -> int:
        """
        Restore project files from database to filesystem.

        Called when:
        - Project opened but local folder missing/empty
        - User switches devices
        - Manual refresh requested

        Returns:
            Number of files restored
        """
        project_dir = self._project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)

        def _restore(sess: Session) -> int:
            restored = 0
            files = sess.exec(
                select(ProjectFile).where(ProjectFile.project_id == project_id)
            ).all()

            for file_record in files:
                file_path = project_dir / file_record.relative_path

                # Check if local file exists and is newer
                if file_path.exists():
                    local_mtime = datetime.fromtimestamp(
                        file_path.stat().st_mtime, tz=timezone.utc
                    )
                    # Ensure db timestamp is timezone-aware for comparison
                    db_mtime = file_record.last_modified
                    if db_mtime.tzinfo is None:
                        db_mtime = db_mtime.replace(tzinfo=timezone.utc)
                    if local_mtime > db_mtime:
                        continue

                # Restore from DB
                try:
                    file_path.parent.mkdir(parents=True, exist_ok=True)
                    content = decompress_content(file_record.content_compressed)
                    file_path.write_bytes(content)
                    restored += 1
                except Exception as e:
                    logger.error(f"Failed to restore {file_record.relative_path}: {e}")

            return restored

        if session is not None:
            return _restore(session)
        else:
            with Session(self.engine) as new_session:
                return _restore(new_session)

    def get_project_files_list(self, project_id: str, session: Optional[Session] = None) -> list[dict]:
        """Get list of all files in a project from DB."""
        # Use provided session or create new one
        def _query(sess: Session) -> list[dict]:
            files = sess.exec(
                select(ProjectFile).where(ProjectFile.project_id == project_id)
            ).all()
            return [
                {
                    "path": f.relative_path,
                    "name": Path(f.relative_path).name,
                    "size": f.file_size,
                    "last_modified": f.last_modified.isoformat(),
                    "synced_at": f.synced_at.isoformat(),
                }
                for f in files
            ]

        if session is not None:
            return _query(session)
        else:
            with Session(self.engine) as new_session:
                return _query(new_session)

    def get_file_content(self, project_id: str, relative_path: str, session: Optional[Session] = None) -> Optional[str]:
        """
        Get file content, preferring local file over DB.

        Args:
            project_id: Project UUID
            relative_path: Path relative to project root
            session: Optional session to reuse (avoids new connection)

        Returns:
            File content as string, or None if not found
        """
        project_dir = self._project_dir(project_id)
        file_path = project_dir / relative_path

        # Try local file first
        if file_path.exists():
            try:
                return file_path.read_text()
            except UnicodeDecodeError:
                # Binary file - return base64 encoded
                import base64
                return base64.b64encode(file_path.read_bytes()).decode("ascii")
            except Exception as e:
                logger.warning(f"Failed to read local file {relative_path}: {e}")

        # Fall back to DB
        def _query(sess: Session) -> Optional[str]:
            file_record = sess.exec(
                select(ProjectFile)
                .where(ProjectFile.project_id == project_id)
                .where(ProjectFile.relative_path == relative_path)
            ).first()

            if file_record:
                try:
                    content = decompress_content(file_record.content_compressed)
                    return content.decode("utf-8")
                except UnicodeDecodeError:
                    # Binary file - return base64 encoded
                    import base64
                    return base64.b64encode(content).decode("ascii")
                except Exception as e:
                    logger.error(f"Failed to decompress {relative_path}: {e}")
            return None

        if session is not None:
            return _query(session)
        else:
            with Session(self.engine) as new_session:
                return _query(new_session)

    def full_sync_project(self, project_id: str, session: Optional[Session] = None) -> dict:
        """
        Full bidirectional sync for a project.

        Strategy:
        1. List all files in DB
        2. List all files in filesystem
        3. For missing in FS: restore from DB
        4. For missing in DB: sync to DB
        5. For conflicts: use local version (most recent)
        """
        project_dir = self._project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)

        stats = {"restored": 0, "synced": 0, "conflicts": 0}

        def _sync(sess: Session) -> dict:
            nonlocal stats
            # Get DB files
            db_files = {
                f.relative_path: f
                for f in sess.exec(
                    select(ProjectFile).where(ProjectFile.project_id == project_id)
                ).all()
            }

            # Get local files (excluding ignored patterns)
            local_files = set()
            for root, dirs, files in os.walk(project_dir):
                # Skip .claude directory (managed separately)
                dirs[:] = [d for d in dirs if d != ".claude" and not d.startswith("__")]

                for fname in files:
                    abs_path = Path(root) / fname
                    rel_path = str(abs_path.relative_to(project_dir))

                    # Skip hidden files and common ignores
                    if not fname.startswith(".") and not fname.endswith(".pyc"):
                        local_files.add(rel_path)

            # Restore missing local files
            for rel_path, db_record in db_files.items():
                if rel_path not in local_files:
                    file_path = project_dir / rel_path
                    file_path.parent.mkdir(parents=True, exist_ok=True)
                    content = decompress_content(db_record.content_compressed)
                    file_path.write_bytes(content)
                    stats["restored"] += 1

            # Sync new/modified local files
            for rel_path in local_files:
                file_path = project_dir / rel_path
                content = file_path.read_bytes()
                content_hash = compute_file_hash(content)

                if rel_path in db_files:
                    db_record = db_files[rel_path]
                    if db_record.content_hash != content_hash:
                        # Different content - sync local to DB
                        compressed = compress_content(content)
                        db_record.content_compressed = compressed
                        db_record.content_hash = content_hash
                        db_record.file_size = len(content)
                        db_record.last_modified = datetime.fromtimestamp(
                            file_path.stat().st_mtime, tz=timezone.utc
                        )
                        db_record.synced_at = datetime.now(timezone.utc)
                        stats["synced"] += 1
                else:
                    # New local file
                    compressed = compress_content(content)
                    new_file = ProjectFile(
                        project_id=project_id,
                        relative_path=rel_path,
                        content_compressed=compressed,
                        content_hash=content_hash,
                        file_size=len(content),
                        last_modified=datetime.fromtimestamp(
                            file_path.stat().st_mtime, tz=timezone.utc
                        ),
                    )
                    sess.add(new_file)
                    stats["synced"] += 1

            sess.commit()
            return stats

        if session is not None:
            return _sync(session)
        else:
            with Session(self.engine) as new_session:
                return _sync(new_session)

    def delete_project_files(self, project_id: str, session: Optional[Session] = None) -> int:
        """Delete all files for a project from DB."""
        def _delete(sess: Session) -> int:
            files = sess.exec(
                select(ProjectFile).where(ProjectFile.project_id == project_id)
            ).all()

            count = len(files)
            for f in files:
                sess.delete(f)

            sess.commit()
            return count

        if session is not None:
            return _delete(session)
        else:
            with Session(self.engine) as new_session:
                return _delete(new_session)
