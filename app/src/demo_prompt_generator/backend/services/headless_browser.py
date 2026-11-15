"""Process-wide budget and lifecycle for headless Chromium.

Every headless browser the app starts goes through here: the brand service's
homepage screenshots and the architecture render tool (`arch_render.py`). Each
headless shell is ~300-400 MB and the Apps container is small, so ONE shared pool of
slots caps how many Chromium trees run at once across both features. Running more
agents must not mean more browsers.

Three things live here:

  * `browser_slot(timeout)` — the shared slot pool. `timeout=None` waits (brand's
    old behaviour); a timeout raises `BrowserBusy` so the caller can answer "busy,
    retry" instead of queueing forever.
  * `browser_env()` / `sanitize_browser_env()` — the env a browser child must run with
    (BROWSER_LD_LIBRARY_PATH on the loader path; NODE_OPTIONS stripped).
  * `track_group` / `kill_live_groups` — every browser child runs in its own process
    group; the groups in flight are tracked so the SIGTERM path (services/shutdown.py)
    can reap them. Nothing is kept warm between calls: a render's browser lives only
    as long as its child process.
"""

from __future__ import annotations

import contextlib
import os
import signal
import threading
from typing import Iterator

# Two concurrent headless browsers across brand screenshots AND architecture renders.
BROWSER_SLOTS_MAX = 2

# BoundedSemaphore: releasing more than acquired is a bug, and it should fail loudly.
_slots = threading.BoundedSemaphore(BROWSER_SLOTS_MAX)
_live_lock = threading.Lock()
_live_groups: set[int] = set()


class BrowserBusy(RuntimeError):
    """No browser slot became free within the caller's wait budget."""


@contextlib.contextmanager
def browser_slot(timeout: float | None = None) -> Iterator[None]:
    """Hold one of the shared browser slots for the duration of the block.

    `timeout=None` blocks until a slot is free. A number of seconds raises
    `BrowserBusy` if none frees up in time (the caller reports "busy, retry")."""
    if not _slots.acquire(timeout=timeout):
        raise BrowserBusy(f"all {BROWSER_SLOTS_MAX} headless browser slots are in use")
    try:
        yield
    finally:
        _slots.release()


def browser_env() -> dict[str, str]:
    """This process's env plus the Chromium shared libs start.sh unpacked
    (BROWSER_LD_LIBRARY_PATH) on the loader path, for the browser child only. Never set
    LD_LIBRARY_PATH on the parent: nothing else should load those libs."""
    env = dict(os.environ)
    if env.get("BROWSER_LD_LIBRARY_PATH"):
        env["LD_LIBRARY_PATH"] = env["BROWSER_LD_LIBRARY_PATH"]
    return env


def sanitize_browser_env() -> None:
    """Strip env vars that break Playwright's Node driver subprocess. Some environments
    inject a NODE_OPTIONS=--require=<file> pointing at a missing script, and the driver
    crashes with 'Connection closed while reading from the driver'."""
    no = os.environ.get("NODE_OPTIONS", "")
    if "restore-node-options" in no or "cmux" in no:
        os.environ.pop("NODE_OPTIONS", None)


def track_group(pgid: int) -> None:
    with _live_lock:
        _live_groups.add(pgid)


def untrack_group(pgid: int) -> None:
    with _live_lock:
        _live_groups.discard(pgid)


def kill_live_groups() -> int:
    """SIGKILL every browser process group still in flight. Called from the shutdown
    path, which can run inside a signal handler, so it takes NO lock: a snapshot of the
    set (a single C-level copy under the GIL) and os.killpg only. Returns how many
    groups were signalled."""
    n = 0
    for pgid in list(_live_groups):
        try:
            os.killpg(pgid, signal.SIGKILL)
            n += 1
        except OSError:
            pass  # already exited
    return n
