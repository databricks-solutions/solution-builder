"""Out-of-process polling watcher (Databricks Apps only). See file_watcher.py.

The polling walk used to run on a thread of the uvicorn process, so every stat()
competed with request handling for the GIL. This module is the entry point of a
separate process that runs the same observer and ships compact events back over a pipe.

Spawned with the "spawn" start method (never fork: the parent is multi-threaded with an
event loop, a DB pool and subprocesses, and a forked child would also inherit the
listening socket). Keep the top-level imports here light: the child unpickles
`run_child` by module path, so only stdlib is imported at module import time.
"""

from __future__ import annotations

import os
import stat
import time
from collections import deque
from multiprocessing.connection import Connection

# How often the child drains queued events to the parent and checks that the parent is alive.
TICK_SECONDS = 0.25
# An idle child sends an empty batch this often, so the parent can tell it was alive
# recently when it dies (that bounds the replay window after a restart).
HEARTBEAT_SECONDS = 1.0


def run_child(
    base_dir: str,
    parent_pid: int,
    ctl: Connection,
    events: Connection,
    poll_interval: float,
    since: float | None = None,
) -> None:
    """Child-process entry point.

    Sends `("ready", pid)` once the observer has taken its initial snapshot, then one list
    of `(project_id, relative_path, event_kind)` tuples per tick (an empty list is a
    heartbeat). If `since` is set (a restart), files changed at or after `since` are
    reported first, so writes made while the previous child was down are not lost.
    Returns when the parent sends anything on `ctl` (stop), closes it, or dies (the pid
    changes to the reaper and the pipe breaks).
    """
    # Imported here, not at module level: file_watcher imports this module to spawn us.
    from watchdog.events import FileModifiedEvent
    from watchdog.observers.polling import PollingObserverVFS

    from demo_prompt_generator.backend.services import file_watcher as fw

    # The parent resolved base_dir already; set the global the handler reads from so the
    # child's filtering matches the parent's base regardless of the child's environment.
    fw.PROJECTS_BASE_DIR = base_dir
    queued: deque[tuple[str, str, str]] = deque()  # appended from the observer's thread
    handler = fw.ProjectEventHandler(
        on_change=lambda project_id, rel, kind: queued.append((project_id, rel, kind))
    )
    observer = PollingObserverVFS(
        stat=os.stat,
        listdir=fw.make_pruned_listdir(base_dir),
        polling_interval=poll_interval,  # type: ignore[arg-type]  # watchdog types it int
    )
    observer.schedule(handler, base_dir, recursive=True)
    observer.start()  # takes the initial snapshot synchronously, so "ready" means watching
    try:
        events.send(("ready", os.getpid()))
        if since is not None:
            # Replay from the observer's own baseline (no extra stats). A file changed after
            # `since` is reported even if it was already seen: a duplicate sync is harmless.
            # Deletions cannot be detected this way: a stale DB row is less harmful than a
            # lost write, and the delete-safety rules prefer keeping rows.
            for emitter in list(observer.emitters):
                # watchdog's baseline for this watch (private; pinned watchdog version)
                snapshot = emitter._snapshot  # type: ignore[attr-defined]
                for path in snapshot.paths:
                    info = snapshot.stat_info(path)
                    if stat.S_ISDIR(info.st_mode):
                        continue
                    if max(info.st_mtime, info.st_ctime) >= since:  # ctime also catches renames
                        handler.on_any_event(FileModifiedEvent(path))
        last_sent = time.monotonic()
        while True:
            if ctl.poll(TICK_SECONDS):  # a stop message, or EOF when the parent closed it
                break
            if os.getppid() != parent_pid:  # parent died; we were re-parented
                break
            if queued:
                batch: list[tuple[str, str, str]] = []
                while queued:
                    batch.append(queued.popleft())
                events.send(batch)
                last_sent = time.monotonic()
            elif time.monotonic() - last_sent >= HEARTBEAT_SECONDS:
                events.send([])
                last_sent = time.monotonic()
    except (EOFError, OSError):
        pass  # the parent end of the pipe went away: nothing left to report to
    finally:
        observer.stop()
        observer.join(timeout=1)

