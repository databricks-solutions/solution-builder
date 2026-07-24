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
from watchdog.observers.api import BaseObserver
from watchdog.observers.polling import PollingObserver

logger = logging.getLogger(__name__)

# Configuration
DEBOUNCE_SECONDS = 0.5
BATCH_SIZE = 100
PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Patterns to ignore from sync (these paths are managed elsewhere, or would thrash
# the DB with thousands of events during `npm install`, `uv sync`, builds, etc.)
IGNORE_PATTERNS = [
    # Managed elsewhere. `.claude/projects/**` (Claude Code transcripts)
    # is deliberately NOT here — we DO sync those so a container restart
    # doesn't break `--resume`. Everything else under `.claude/` is
    # either regenerated per-container, re-copied on project create, or
    # contains auth/cache material we never want in Lakebase.
    ".claude/skills/**",  # Skills managed by skills_manager
    ".claude/settings*",  # Local settings
    ".claude/.credentials*",  # Keychain spillover from CLAUDE_CONFIG_DIR
    ".claude/statsig/**",  # Telemetry / feature-flag cache
    ".claude/.shell-snapshots/**",  # Per-container shell state
    ".claude/todos/**",  # Local todo state
    ".claude/ide/**",  # IDE lock files
    # `.claude/.claude.json` itself is INTENTIONALLY synced (not listed here):
    # losing it on container restart loses Claude Code's per-project state
    # (resume targets, queued prompts, accept-edit flags) so resumes break.
    # The CLI's auto-rotated backups under `.claude/backups/` are NOT synced —
    # they're per-launch snapshots, duplicate the live file, and would bloat
    # the mirror without adding any recovery value (the live file is already
    # there). If the live file is ever corrupted, the CLI will recreate it.
    ".claude/backups/**",
    ".databrickscfg",  # Per-project Databricks auth file — see backend/AUTH.md
    ".databrickscfg.*",  # Atomic-write temp variants
    # Per-project FMAPI auth — token + helper script + settings.json. Refreshed
    # by core/fmapi_auth.py; never backed up. See core/fmapi_auth.py.
    ".anthropic_token",
    ".anthropic_token.*",
    "get_anthropic_token.sh",
    ".get_anthropic_token.sh.*",
    # Language package/artifact dirs — never back these up.
    # Glob on dir segments: `.venv*/**` catches `.venv`, `.venv-datagen`,
    # `.venv-something`, etc. `venv*/**` covers bare `venv` variants.
    # `.py*-venv/**` covers `uv venv --python 3.12 .py312-venv` style dirs
    # that don't start with `.venv`.
    "node_modules/**",
    ".venv*/**",
    "venv*/**",
    ".py*-venv/**",
    "__pycache__/**",
    ".pytest_cache/**",
    ".ruff_cache/**",
    ".mypy_cache/**",
    # Build / bundler output
    "dist/**",
    "build/**",
    ".next/**",
    ".turbo/**",
    ".parcel-cache/**",
    "__dist__/**",
    # Databricks CLI bundle cache — the CLI creates `.databricks/` on every
    # `bundle deploy` / `bundle validate`. Contains the Terraform binary
    # (~19 MB), the Databricks Terraform provider (~27 MB), bundle state
    # JSON, and sync-snapshots. All regenerated on demand by the CLI; never
    # treated as project source. Skipping cut backup size by ~1 GB in prod.
    ".databricks/**",
    # VCS + OS cruft
    ".git/**",
    ".DS_Store",
    # File-type noise
    "*.pyc",
    "*.pyo",
    "*.swp",
    "*.tmp",
    "*.tmp.*",  # Atomic write temp files (e.g. file.py.tmp.59934.123456)
    ".tmp*",    # Hidden tempfile pattern (e.g. .tmpJXLTJq from Python's tempfile)
    "*.log",
]


def should_ignore(relative_path: str) -> bool:
    """Check if a path matches any ignore pattern.

    For `dir/**` patterns, matches `dir/` anywhere in the path (e.g. `app/node_modules/...`
    is ignored by `node_modules/**`, not just a top-level `node_modules/...`).
    """
    basename = os.path.basename(relative_path)
    parts = relative_path.split("/")
    for pattern in IGNORE_PATTERNS:
        if fnmatch.fnmatch(relative_path, pattern) or fnmatch.fnmatch(basename, pattern):
            return True
        if pattern.endswith("/**"):
            dir_name = pattern[:-3]
            # Match if any path segment equals the dir name (or matches it as a glob).
            if any(fnmatch.fnmatch(part, dir_name) for part in parts):
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

    # Watchdog ≥ 5 enables inotify open/close events on Linux (`opened`,
    # `closed`, `closed_no_write`). They fire on every read — `cat foo.json`,
    # `Read`-tool invocations, etc. — and would resync the cache uselessly
    # on every file access, flooding logs and CPU. We only care about
    # mutations.
    _MUTATION_EVENTS = frozenset({"created", "modified", "deleted", "moved"})

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return

        event_type = event.event_type  # 'created', 'modified', 'deleted', 'moved' (or open/close on inotify)
        if event_type not in self._MUTATION_EVENTS:
            return

        # Move events have two paths. The src is where the file LEFT (often a
        # tempfile that we'd ignore); the dest is where the file landed — the
        # "real" name a caller cares about (e.g. atomic writes: tempfile →
        # target.md). We fire once per side so both the old-side cache
        # removal and the new-side cache add happen.
        paths_to_emit: list[tuple[str, str]] = []  # (path, event_type)
        if event_type == "moved":
            dest_path = getattr(event, "dest_path", None)
            if event.src_path:
                paths_to_emit.append((event.src_path, "deleted"))
            if dest_path:
                paths_to_emit.append((dest_path, "created"))
        else:
            paths_to_emit.append((event.src_path, event_type))

        for abs_path, evt_kind in paths_to_emit:
            info = self._extract_project_info(abs_path)
            if not info:
                continue
            project_id, relative_path = info
            if not relative_path:
                continue
            if should_ignore(relative_path):
                continue
            self.on_change(project_id, relative_path, evt_kind)


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
        self._observer: Optional[BaseObserver] = None
        self._pending: dict[str, set[str]] = defaultdict(set)  # project_id -> {paths}
        self._debounce_tasks: dict[str, asyncio.Task] = {}
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Start watching the projects directory."""
        self._loop = loop
        self._running = True

        # Schedule on the RESOLVED base path so watcher event paths match
        # `_extract_project_info`'s resolved base (which does `.resolve()`).
        # A raw relative "./projects" here + resolved compare there silently
        # drops events when cwd/symlinks differ.
        base_dir = Path(PROJECTS_BASE_DIR).resolve()
        base_dir.mkdir(parents=True, exist_ok=True)

        # In the Databricks Apps container the project dir lives on an overlay
        # filesystem where Linux inotify does NOT deliver events for writes made
        # by the agent's separate subprocess — the default Observer() (inotify)
        # sees nothing, so the file cache never resyncs and the UI/agent don't
        # get file-change notices until a force refresh. PollingObserver stats
        # the tree on an interval and works regardless of the fs. Locally
        # (macOS FSEvents / native inotify on a real disk) the fast native
        # Observer works fine, so only switch to polling in the container.
        handler = ProjectEventHandler(on_change=self._on_file_change)
        in_apps = bool(os.getenv("DATABRICKS_APP_PORT"))
        if in_apps:
            self._observer = PollingObserver(timeout=2.0)
        else:
            self._observer = Observer()
        self._observer.schedule(handler, str(base_dir), recursive=True)
        self._observer.start()

        logger.info(
            f"File watcher started on {base_dir} "
            f"({'polling' if in_apps else 'native'} observer)"
        )

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

    def forget(self, project_id: str) -> None:
        """Drop a project's pending-paths + debounce task (called on delete/reap)
        so `_pending` doesn't accumulate a permanent empty-set entry per project
        ever touched. Cancels any in-flight debounce for it."""
        self._pending.pop(project_id, None)
        task = self._debounce_tasks.pop(project_id, None)
        if task is not None:
            task.cancel()

    def _on_file_change(self, project_id: str, relative_path: str, event_type: str) -> None:
        """Called from watchdog thread - updates the listing cache synchronously,
        then schedules an async DB flush."""
        if not self._running or not self._loop:
            return

        # Per-file event is high-volume (one line per write during agent
        # runs / `uv sync` bursts). Keep at DEBUG so prod logs aren't
        # drowned; flip to INFO via LOG_LEVEL=DEBUG when investigating.
        logger.debug(
            f"[watcher] {event_type} {project_id}/{relative_path}"
        )

        # Refresh the file-listing cache by re-listing the directory containing
        # the changed path. Single hook for any event type (created / modified /
        # deleted / moved): whatever disk shows wins. Safe from a watchdog
        # thread — the cache uses its own RLock.
        try:
            from ..routes.project_files import cache_resync_dir
            cache_resync_dir(project_id, relative_path)
        except Exception as e:
            # Cache resync is best-effort. The watcher keeps going regardless.
            logger.warning(
                f"[cache] resync failed for {project_id}/{relative_path}: {e}",
                exc_info=True,
            )

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

            # Atomically take-and-remove the pending set (dict.pop is a single
            # op) instead of list()+clear() — the latter had a cross-thread gap
            # where a path the watchdog thread add()ed between the two calls was
            # silently dropped, and it left a permanent empty-set key per project.
            paths = list(self._pending.pop(project_id, set()))

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
