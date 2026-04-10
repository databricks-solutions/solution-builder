"""
Watchdog-based file monitoring for project directories.

Key design decisions:
1. Single Observer watches entire projects/ directory
2. Per-project queues with debouncing (500ms) to coalesce rapid changes
3. Batch processing (up to 100 files) for database efficiency
4. Ignore .claude/skills/ - managed separately by skills_manager
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import os
from collections import defaultdict
from pathlib import Path
from typing import Callable, Optional

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

# Configuration
DEBOUNCE_SECONDS = 0.5
BATCH_SIZE = 100
PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Patterns to ignore from sync (these paths are managed elsewhere)
IGNORE_PATTERNS = [
    ".claude/skills/**",  # Skills managed by skills_manager
    ".claude/settings*",  # Local settings
    "__pycache__/**",
    ".git/**",
    "*.pyc",
    "*.pyo",
    "*.swp",
    ".DS_Store",
    "*.tmp",
    "*.log",
]


def should_ignore(relative_path: str) -> bool:
    """Check if a path matches any ignore pattern."""
    for pattern in IGNORE_PATTERNS:
        if fnmatch.fnmatch(relative_path, pattern):
            return True
        # Also check if any parent path matches directory patterns
        if pattern.endswith("/**"):
            dir_pattern = pattern[:-3]
            if relative_path.startswith(dir_pattern + "/") or relative_path == dir_pattern:
                return True
    return False


class ProjectEventHandler(FileSystemEventHandler):
    """Handle file system events for project directories."""

    def __init__(self, on_change: Callable[[str, str, str], None]):
        """
        Args:
            on_change: Callback(project_id, relative_path, event_type)
        """
        self.on_change = on_change
        self._base_dir = Path(PROJECTS_BASE_DIR).resolve()

    def _extract_project_info(self, path: str) -> tuple[str, str] | None:
        """Extract (project_id, relative_path) from absolute path."""
        try:
            abs_path = Path(path).resolve()
            rel_to_base = abs_path.relative_to(self._base_dir)
            parts = rel_to_base.parts
            if len(parts) < 1:
                return None
            project_id = parts[0]
            relative_path = str(Path(*parts[1:])) if len(parts) > 1 else ""
            return project_id, relative_path
        except ValueError:
            return None

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return

        info = self._extract_project_info(event.src_path)
        if not info:
            return

        project_id, relative_path = info

        # Skip if no relative path (root of project)
        if not relative_path:
            return

        # Skip ignored paths
        if should_ignore(relative_path):
            return

        event_type = event.event_type  # 'created', 'modified', 'deleted', 'moved'
        self.on_change(project_id, relative_path, event_type)


class FileWatcherService:
    """
    Monitors project directories and triggers sync on changes.

    Features:
    - Debounces rapid changes (500ms delay)
    - Batches multiple files for efficient DB operations
    - Ignores .claude/skills/ (managed by skills_manager)
    """

    def __init__(self, sync_callback: Callable[[str, list[str]], asyncio.coroutine]):
        """
        Args:
            sync_callback: Async function(project_id, list[relative_paths]) to sync files
        """
        self.sync_callback = sync_callback
        self._observer: Optional[Observer] = None
        self._pending: dict[str, set[str]] = defaultdict(set)  # project_id -> {paths}
        self._debounce_tasks: dict[str, asyncio.Task] = {}
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Start watching the projects directory."""
        self._loop = loop
        self._running = True

        base_dir = Path(PROJECTS_BASE_DIR)
        base_dir.mkdir(parents=True, exist_ok=True)

        handler = ProjectEventHandler(on_change=self._on_file_change)
        self._observer = Observer()
        self._observer.schedule(handler, str(base_dir), recursive=True)
        self._observer.start()

        logger.info(f"File watcher started on {base_dir}")

    def stop(self) -> None:
        """Stop watching."""
        self._running = False
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)

        # Cancel pending debounce tasks
        for task in self._debounce_tasks.values():
            task.cancel()
        self._debounce_tasks.clear()

        logger.info("File watcher stopped")

    def _on_file_change(self, project_id: str, relative_path: str, event_type: str) -> None:
        """Called from watchdog thread - schedules async processing."""
        if not self._running or not self._loop:
            return

        self._pending[project_id].add(relative_path)

        # Schedule debounced flush
        if project_id in self._debounce_tasks:
            self._debounce_tasks[project_id].cancel()

        # Use call_soon_threadsafe since we're called from watchdog thread
        self._loop.call_soon_threadsafe(
            self._schedule_flush, project_id
        )

    def _schedule_flush(self, project_id: str) -> None:
        """Schedule a debounced flush task (called from main loop)."""
        if project_id in self._debounce_tasks:
            self._debounce_tasks[project_id].cancel()

        self._debounce_tasks[project_id] = self._loop.create_task(
            self._debounced_flush(project_id)
        )

    async def _debounced_flush(self, project_id: str) -> None:
        """Wait for debounce period, then flush pending changes."""
        try:
            await asyncio.sleep(DEBOUNCE_SECONDS)

            paths = list(self._pending[project_id])
            self._pending[project_id].clear()

            if not paths:
                return

            # Batch if needed
            for i in range(0, len(paths), BATCH_SIZE):
                batch = paths[i : i + BATCH_SIZE]
                try:
                    await self.sync_callback(project_id, batch)
                except Exception as e:
                    logger.error(f"Sync failed for {project_id}: {e}")
        except asyncio.CancelledError:
            # Task was cancelled due to new change, that's fine
            pass
        finally:
            # Clean up the task reference
            self._debounce_tasks.pop(project_id, None)


# Global instance
_watcher: Optional[FileWatcherService] = None


def get_watcher() -> Optional[FileWatcherService]:
    """Get the global file watcher instance."""
    return _watcher


def init_watcher(sync_callback: Callable) -> FileWatcherService:
    """Initialize the global file watcher."""
    global _watcher
    _watcher = FileWatcherService(sync_callback)
    return _watcher
