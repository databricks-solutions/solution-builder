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
import multiprocessing
import os
import threading
import time
from collections import defaultdict
from multiprocessing.connection import Connection
from multiprocessing.context import SpawnContext, SpawnProcess
from pathlib import Path
from typing import Callable, Iterator, Optional

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.api import BaseObserver
from watchdog.observers.polling import PollingObserverVFS

from .watcher_process import run_child

logger = logging.getLogger(__name__)

# Configuration
DEBOUNCE_SECONDS = 0.5
BATCH_SIZE = 100
PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")
POLL_INTERVAL_SECONDS = 2  # Apps-container polling walk (in-process or out-of-process)
# Out-of-process child: restart backoff after it dies (reset once it has run healthily).
RESTART_BACKOFF_SECONDS = (1.0, 5.0, 30.0)
HEALTHY_RUN_SECONDS = 60.0
# Shutdown runs inside the 15 s SIGTERM budget: bound how long stop() waits on the child.
CHILD_STOP_JOIN_SECONDS = 1.0
# A restarted child replays files changed since the previous child was last heard from,
# minus this margin (covers heartbeat and poll latency). See watcher_process.run_child.
RESTART_REPLAY_MARGIN_SECONDS = 5.0

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
    # POV deck screenshots for the visual critic (pov_deck_tool.py screens): about 80 PNGs per
    # run, rewritten every round. Rebuilt from the deck on demand, so never worth a Lakebase row.
    ".screens/**",
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


# Directory names / path prefixes whose whole subtree should_ignore() drops. Derived from
# IGNORE_PATTERNS so the polling walk prunes with the same rules that filter events.
_IGNORED_DIR_NAMES = tuple(p[:-3] for p in IGNORE_PATTERNS if p.endswith("/**") and "/" not in p[:-3])
_IGNORED_DIR_PREFIXES = tuple(
    p[:-3]
    for p in IGNORE_PATTERNS
    if p.endswith("/**") and "/" in p[:-3] and not any(c in p[:-3] for c in "*?[")
)


def _subtree_always_ignored(rel_dir: str) -> bool:
    """True only if should_ignore() is True for `rel_dir` AND every path beneath it.

    A conservative subset of should_ignore(): a segment rule holds for every descendant
    (a descendant keeps rel_dir's segments as its prefix), and a `dir/**` prefix rule holds
    for everything starting with `dir/`. Anything else is left to the per-event filter.
    """
    # Claude Code transcripts are synced, so they are never pruned.
    if rel_dir == ".claude/projects" or rel_dir.startswith(".claude/projects/"):
        return False
    if any(fnmatch.fnmatch(part, name) for part in rel_dir.split("/") for name in _IGNORED_DIR_NAMES):
        return True
    return any(rel_dir == pre or rel_dir.startswith(pre + "/") for pre in _IGNORED_DIR_PREFIXES)


def make_pruned_listdir(base_dir: str) -> Callable[[str | None], Iterator[os.DirEntry]]:
    """`listdir` for a PollingObserverVFS over `base_dir` that skips ignored subtrees.

    watchdog's polling walk stats every entry it lists, so without this a project's
    node_modules/.venv is re-stat'ed file by file on every poll and then dropped by
    should_ignore. Only DIRECTORIES inside a project are pruned (never the projects/ root
    or a project root itself), and only when _subtree_always_ignored() holds.
    """
    prefix = base_dir.rstrip(os.sep) + os.sep

    def listdir(path: str | None) -> Iterator[os.DirEntry]:
        assert path is not None  # watchdog always passes the watched root
        with os.scandir(path) as it:
            entries = list(it)
        kept: list[os.DirEntry] = []
        for entry in entries:
            child = os.path.join(path, entry.name)
            rel_child = child[len(prefix):] if child.startswith(prefix) else ""
            # Project-level entries (`<project_id>` itself) are never pruned.
            _, sep, rel_in_project = rel_child.partition(os.sep)
            if sep and _subtree_always_ignored(rel_in_project.replace(os.sep, "/")):
                try:
                    is_dir = entry.is_dir()
                except OSError:
                    is_dir = False  # keep it: pruning is only ever an optimisation
                if is_dir:
                    continue
            kept.append(entry)
        return iter(kept)

    return listdir


class ProjectEventHandler(FileSystemEventHandler):
    """Handle file system events for project directories."""

    def __init__(self, on_change: Callable[[str, str, str], None]):
        """
        Args:
            on_change: Callback(project_id, relative_path, event_type)
        """
        self.on_change = on_change
        self._base_dir = Path(PROJECTS_BASE_DIR).resolve()
        self._base_prefix = str(self._base_dir) + os.sep

    def _extract_project_info(self, path: str) -> tuple[str, str] | None:
        """Extract (project_id, relative_path) from an absolute event path, or None for
        paths outside the base, the project root itself, and ignored paths.

        Watcher paths are already under the resolved base, so the cheap string form is
        judged first. Only paths that survive the ignore rules pay for realpath, which
        keeps the symlink rules: a link resolving outside the base is dropped, and one
        resolving inside is reported at its real location.
        """
        if not path.startswith(self._base_prefix):
            return None
        parts = tuple(path[len(self._base_prefix):].split(os.sep))
        if len(parts) < 2 or should_ignore(os.sep.join(parts[1:])):
            return None
        try:
            real = Path(path).resolve().relative_to(self._base_dir).parts
        except ValueError:
            return None
        if real != parts:
            if len(real) < 2 or should_ignore(os.sep.join(real[1:])):
                return None
            parts = real
        return parts[0], os.sep.join(parts[1:])

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
            info = self._extract_project_info(abs_path)  # None when outside base or ignored
            if not info:
                continue
            project_id, relative_path = info
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
        self._flushing: dict[str, asyncio.Task] = {}  # project_id -> task currently syncing
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # Out-of-process polling (Apps container): the observer runs in a spawned child.
        self._base_dir = ""
        self._ctx: Optional[SpawnContext] = None
        self._reader: Optional[threading.Thread] = None
        self._stopping = threading.Event()
        self._child_lock = threading.Lock()  # guards _proc/_ctl against stop() racing a spawn
        self._proc: Optional[SpawnProcess] = None
        self._ctl: Optional[Connection] = None  # parent end of the child's control pipe
        self._child_pid: Optional[int] = None  # set by the child's "ready" message
        self._last_child_seen: Optional[float] = None  # wall clock of the last message

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
        # get file-change notices until a force refresh. Polling stats the tree
        # on an interval and works regardless of the fs. Locally (macOS FSEvents
        # / native inotify on a real disk) the fast native Observer works fine,
        # so only switch to polling in the container. The polling walk skips
        # ignored subtrees (node_modules, .venv, ...) instead of stat-ing them.
        in_apps = bool(os.getenv("DATABRICKS_APP_PORT"))
        # FILE_WATCHER_IN_PROCESS=1 is the kill-switch: keep the polling observer on a thread
        # of this process (the pre-child behaviour) if the spawned watcher misbehaves in prod.
        out_of_process = in_apps and os.getenv("FILE_WATCHER_IN_PROCESS") != "1"
        if out_of_process:
            # The walk runs in its own process so its stat() calls don't contend for this
            # process's GIL with request handling. Events come back through _supervise.
            self._base_dir = str(base_dir)
            self._ctx = multiprocessing.get_context("spawn")  # never fork: see watcher_process
            self._reader = threading.Thread(
                target=self._supervise, name="file-watcher-reader", daemon=True
            )
            self._reader.start()
        else:
            handler = ProjectEventHandler(on_change=self._on_file_change)
            if in_apps:
                self._observer = PollingObserverVFS(
                    stat=os.stat, listdir=make_pruned_listdir(str(base_dir)),
                    polling_interval=POLL_INTERVAL_SECONDS,
                )
            else:
                self._observer = Observer()
            self._observer.schedule(handler, str(base_dir), recursive=True)
            self._observer.start()

        mode = "out-of-process polling" if out_of_process else "polling" if in_apps else "native"
        logger.info(f"File watcher started on {base_dir} ({mode} observer)")

    def stop(self) -> None:
        """Stop watching."""
        self._running = False
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)  # runs on the loop during shutdown: keep it short
        self._stop_child()

        # Cancel pending debounce tasks
        for task in self._debounce_tasks.values():
            task.cancel()
        self._debounce_tasks.clear()

        logger.info("File watcher stopped")

    def forget(self, project_id: str) -> None:
        """Drop a project's pending-paths + debounce task (called on delete/reap)
        so `_pending` doesn't accumulate a permanent empty-set entry per project
        ever touched. Cancels any debounce that has not started syncing yet.

        The delete route is a sync def, so this runs on a worker thread: the
        bookkeeping hops onto the loop like every other touch of the task state."""
        if self._loop is None:
            return
        try:
            self._loop.call_soon_threadsafe(self._forget_on_loop, project_id)
        except RuntimeError:  # loop already closed (shutdown)
            pass

    def _forget_on_loop(self, project_id: str) -> None:
        self._pending.pop(project_id, None)
        if project_id in self._flushing:
            return  # the running flush finds nothing pending and exits on its own
        task = self._debounce_tasks.pop(project_id, None)
        if task is not None:
            task.cancel()

    # ---- out-of-process polling (Apps container) -------------------------------------
    # Parent side: _supervise (a daemon thread) owns the child's lifecycle. It spawns the
    # child, pumps its batches into _on_file_change, and respawns it with backoff if it dies.

    def _spawn(self) -> Optional[tuple[SpawnProcess, Connection]]:
        """Start a child; returns (process, event-pipe reader), or None once stopping."""
        with self._child_lock:
            if self._stopping.is_set():
                return None
            # Changes since the last message from the previous child may have been missed.
            # Its last message is never later than its death, so this bound covers both.
            since = (
                None if self._last_child_seen is None
                else self._last_child_seen - RESTART_REPLAY_MARGIN_SECONDS
            )
            if self._ctl is not None:
                self._ctl.close()
            assert self._ctx is not None
            events_recv, events_send = self._ctx.Pipe(duplex=False)
            ctl_recv, ctl_send = self._ctx.Pipe(duplex=False)
            # Pipes instead of multiprocessing.Event/Queue: those need /dev/shm semaphores.
            proc = self._ctx.Process(
                target=run_child,
                args=(
                    self._base_dir, os.getpid(), ctl_recv, events_send,
                    POLL_INTERVAL_SECONDS, since,
                ),
                name="file-watcher",
                daemon=True,
            )
            proc.start()
            # Close our copies of the child's ends so EOF reaches us when the child dies.
            events_send.close()
            ctl_recv.close()
            self._proc, self._ctl, self._child_pid = proc, ctl_send, None
            return proc, events_recv

    def _supervise(self) -> None:
        """Reader thread: run the child, forward its events, restart it if it dies."""
        failures = 0
        while not self._stopping.is_set():
            started = time.monotonic()
            spawned = self._spawn()
            if spawned is None:
                return
            proc, events_recv = spawned
            self._pump(events_recv)
            events_recv.close()
            proc.join(timeout=CHILD_STOP_JOIN_SECONDS)  # EOF: the child is exiting; reap it
            if self._stopping.is_set():
                return
            if time.monotonic() - started >= HEALTHY_RUN_SECONDS:
                failures = 0
            delay = RESTART_BACKOFF_SECONDS[min(failures, len(RESTART_BACKOFF_SECONDS) - 1)]
            failures += 1
            logger.error(
                f"[watcher] polling child exited (exitcode={proc.exitcode}); "
                f"restarting in {delay:.0f}s. Changes in the gap are replayed; deletions are not."
            )
            if self._stopping.wait(delay):
                return

    def _pump(self, events_recv: Connection) -> None:
        """Forward batches from one child until its pipe reaches EOF."""
        while True:
            try:
                msg = events_recv.recv()
            except (EOFError, OSError):
                return
            self._last_child_seen = time.time()
            if isinstance(msg, tuple):  # ("ready", pid)
                self._child_pid = msg[1]
                logger.info(f"[watcher] polling child ready (pid={msg[1]})")
                continue
            try:
                for project_id, relative_path, event_type in msg:
                    self._on_file_change(project_id, relative_path, event_type)
            except Exception:  # keep the reader alive: one bad event must not stop watching
                logger.exception("[watcher] failed to forward a batch from the polling child")

    def _stop_child(self) -> None:
        """Stop the child within CHILD_STOP_JOIN_SECONDS, escalating to terminate/kill."""
        self._stopping.set()  # set before taking the lock: a racing _spawn then declines
        with self._child_lock:
            proc, ctl = self._proc, self._ctl
            self._proc, self._ctl = None, None
        if ctl is not None:
            try:
                ctl.send("stop")
            except OSError:
                pass  # child already gone
            ctl.close()
        if proc is not None:
            proc.join(timeout=CHILD_STOP_JOIN_SECONDS)
            if proc.is_alive():
                proc.terminate()
                proc.join(timeout=0.2)
            if proc.is_alive():
                proc.kill()
                proc.join(timeout=0.1)
        if self._reader is not None:
            self._reader.join(timeout=0.2)  # exits once the child's pipe reaches EOF

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

        # Pending-set and task bookkeeping all happen on the loop (watchdog thread
        # must not touch them): a set() on this thread could land in a set the
        # loop has already popped, silently losing the path.
        self._loop.call_soon_threadsafe(self._enqueue, project_id, relative_path)

    def _enqueue(self, project_id: str, relative_path: str) -> None:
        """Runs on the loop: record a changed path and (re)arm the project's flush."""
        if not self._running:
            return
        self._pending[project_id].add(relative_path)
        self._schedule_flush(project_id)

    def _schedule_flush(self, project_id: str) -> None:
        """Arm the project's debounced flush (called from main loop)."""
        task = self._debounce_tasks.get(project_id)
        if task is not None and not task.done():
            if project_id in self._flushing:
                # Already syncing: it drains _pending before it exits, so the new
                # path is picked up without cancelling an in-flight sync mid-thread.
                return
            task.cancel()  # still debouncing (nothing taken yet): restart the timer

        self._debounce_tasks[project_id] = self._loop.create_task(
            self._debounced_flush(project_id)
        )

    async def _debounced_flush(self, project_id: str) -> None:
        """Wait for debounce period, then flush pending changes until none are left.

        One task per project: a sync is never run concurrently with another for the
        same project, and it is never cancelled mid-sync (its thread would keep running).
        """
        task = asyncio.current_task()
        assert task is not None  # always run as a Task (create_task in _schedule_flush)
        try:
            await asyncio.sleep(DEBOUNCE_SECONDS)
            self._flushing[project_id] = task

            while True:
                # Atomically take-and-remove the pending set. No await between this
                # pop and the exit below, so a path enqueued later is never lost.
                paths = list(self._pending.pop(project_id, set()))
                if not paths:
                    break
                # Batch if needed
                for i in range(0, len(paths), BATCH_SIZE):
                    batch = paths[i : i + BATCH_SIZE]
                    try:
                        await self.sync_callback(project_id, batch)
                    except Exception as e:
                        logger.error(f"Sync failed for {project_id}: {e}")
        except asyncio.CancelledError:
            # Cancelled while debouncing (a newer change restarts the timer) or at stop()
            pass
        finally:
            # Only drop entries that are still ours: a newer task may have replaced us.
            if self._flushing.get(project_id) is task:
                del self._flushing[project_id]
            if self._debounce_tasks.get(project_id) is task:
                del self._debounce_tasks[project_id]


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
