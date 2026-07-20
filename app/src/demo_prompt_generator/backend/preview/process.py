"""
Subprocess spawn + kill with process-tree handling.

`./start.sh` → `node server.js` → npm/tsx grandchildren. A naive
`proc.terminate()` only kills the shell; the Node server keeps running.

We spawn with `start_new_session=True` so the subprocess gets its own
process group and we can `killpg` the lot. But `tsx watch` likes to fork
some children into their own session (escaping the group), so we ALSO walk
the descendant tree via `pgrep -P` and SIGTERM/SIGKILL each one by PID.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)

# The Node process-group id file that start.sh writes (the group created by its
# inner `exec setsid npm run dev`, which escapes start.sh's own group). Written
# for BOTH registry- and agent-launched runs; the rogue reaper keys off it.
PGID_FILENAME = ".preview.pgid"


def _children_of(pid: int) -> list[int]:
    """Direct children of `pid`, via `pgrep -P` when present, else `ps`.

    `pgrep`/`ps` both exist on macOS and Linux; a minimal prod container might
    lack `pgrep`, so `ps -axo pid=,ppid=` is the fallback (no /proc parsing —
    `ps` is portable and covers every host this runs on). A missing primitive
    used to silently return nothing, leaking the whole Node tree.
    """
    # pgrep: trust its output only when it exited cleanly (0 = matches,
    # 1 = no matches). Any other exit (or missing binary) → fall back to ps.
    try:
        res = subprocess.run(
            ["pgrep", "-P", str(pid)], capture_output=True, text=True, check=False,
        )
        if res.returncode in (0, 1):
            return [int(t) for t in res.stdout.split() if t.strip().isdigit()]
    except FileNotFoundError:
        pass
    try:
        res = subprocess.run(
            ["ps", "-axo", "pid=,ppid="], capture_output=True, text=True, check=False,
        )
    except (FileNotFoundError, OSError):
        return []
    kids: list[int] = []
    for line in res.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit() and int(parts[1]) == pid:
            kids.append(int(parts[0]))
    return kids


def _descendant_pids(root_pid: int) -> list[int]:
    """Walk the process tree below `root_pid`, leaves-first (reverse BFS) so
    callers signal children before parents. `tsx watch` forks detached children
    that escape the process group, so a group-kill alone isn't enough."""
    out: list[int] = []
    frontier = [root_pid]
    seen = {root_pid}
    while frontier:
        batch: list[int] = []
        for pid in frontier:
            for kid in _children_of(pid):
                if kid not in seen:
                    seen.add(kid)
                    batch.append(kid)
        out.extend(batch)
        frontier = batch
    return list(reversed(out))


# Process names that a preview tree is made of. Used to VALIDATE a PID/PGID
# before SIGKILL so a recycled PID (after a container restart / long downtime)
# can't be friendly-fired. Matched as a substring of the process command.
_PREVIEW_PROC_MARKERS = ("node", "npm", "start.sh", "vite", "tsx", "esbuild")


def process_age_seconds(pid: int) -> float | None:
    """Elapsed wall-seconds since `pid` started, or None if unknown/dead.
    Uses `ps -o etimes=` (elapsed seconds), portable across macOS + Linux.
    Used by the rogue-subprocess reaper's age gate."""
    try:
        res = subprocess.run(
            ["ps", "-o", "etimes=", "-p", str(pid)],
            capture_output=True, text=True, check=False,
        )
    except (FileNotFoundError, OSError):
        return None
    out = res.stdout.strip()
    return float(out) if out.isdigit() else None


def _group_looks_like_preview(pgid: int) -> bool:
    """True iff ANY live member of process group `pgid` looks like a preview
    process (node/npm/start.sh/vite/tsx/esbuild). This is the validation that
    guards against PID-reuse friendly-fire before we SIGKILL a group.

    Why membership, not the leader: `start.sh`'s inner `exec setsid npm run dev`
    makes the group leader's pid == pgid at creation, but that leader routinely
    exits while the group lives on via `node server.js` / `tsx` / `esbuild`
    children. Validating only the (dead) leader's command was the bug that made
    the reaper refuse to kill exactly the orphaned groups it exists to reap.
    Lists members via `ps -g <pgid> -o command=` (portable macOS + Linux).
    Empty/unreadable → False (don't kill what we can't identify)."""
    try:
        res = subprocess.run(
            ["ps", "-g", str(pgid), "-o", "command="],
            capture_output=True, text=True, check=False,
        )
    except (FileNotFoundError, OSError):
        return False
    for line in res.stdout.splitlines():
        low = line.strip().lower()
        if low and any(m in low for m in _PREVIEW_PROC_MARKERS):
            return True
    return False


def _pid_looks_like_preview(pid: int) -> bool:
    """True iff `pid`'s own command looks like a preview process. Used for the
    pid-rooted kill path (registry start.sh cleanup). Unreadable → False."""
    try:
        res = subprocess.run(
            ["ps", "-o", "command=", "-p", str(pid)],
            capture_output=True, text=True, check=False,
        )
    except (FileNotFoundError, OSError):
        return False
    low = res.stdout.strip().lower()
    return bool(low) and any(m in low for m in _PREVIEW_PROC_MARKERS)


# Swallow both ProcessLookupError (target already gone) and PermissionError
# (pid/pgid reaped and possibly recycled by a process we don't own — EPERM).
# Either way there's nothing of ours left to signal; move on.
_KILL_OK = (ProcessLookupError, PermissionError)


def _killpg(pgid: int, sig: int) -> None:
    try:
        os.killpg(pgid, sig)
    except _KILL_OK:
        pass


def _kill(pid: int, sig: int) -> None:
    try:
        os.kill(pid, sig)
    except _KILL_OK:
        pass


def _pgid_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
        return True
    except _KILL_OK:
        return False


def kill_process_tree(
    ident: int, *, is_pgid: bool = False, validate: bool = False, timeout: float = 4.0
) -> bool:
    """SIGTERM→SIGKILL a process (or process group) and its descendant tree.

    Shared by the preview stop/stale-sweep and the rogue-subprocess reaper.
    `is_pgid=True` treats `ident` as a process-group id (the common case: the
    Node group from `.preview.pgid`); otherwise `ident` is a root PID and we kill
    its group + descendants.

    `validate=True` refuses to kill unless the target still looks like a preview
    tree — for a group, iff ANY LIVE MEMBER matches (not the leader, which is
    routinely dead while the group lives); for a pid, iff its own command
    matches. This guards PID/PGID reuse without the leader-is-dead false-negative.

    Returns True iff we found a live target and signalled it.
    """
    if is_pgid:
        if not _pgid_alive(ident):
            return False
        if validate and not _group_looks_like_preview(ident):
            logger.warning(
                f"[kill] refusing to kill group {ident} — no live member looks "
                f"like a preview tree (possible PGID reuse)"
            )
            return False
        # Signal the group, escalate to SIGKILL after the grace period. killpg
        # reaches every member incl. the detached tsx/esbuild forks in the group.
        _killpg(ident, signal.SIGTERM)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and _pgid_alive(ident):
            time.sleep(0.2)
        _killpg(ident, signal.SIGKILL)
        return True

    # pid mode: root PID + its group + its descendant tree.
    root_pid = ident
    try:
        os.kill(root_pid, 0)
    except _KILL_OK:
        return False
    if validate and not _pid_looks_like_preview(root_pid):
        logger.warning(
            f"[kill] refusing to kill pid {root_pid} — command does not look "
            f"like a preview tree (possible PID reuse)"
        )
        return False
    descendants = _descendant_pids(root_pid)  # snapshot before signalling
    try:
        pgid = os.getpgid(root_pid)
    except _KILL_OK:
        pgid = None
    if pgid is not None:
        _killpg(pgid, signal.SIGTERM)
    for pid in descendants:
        _kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.kill(root_pid, 0)
            time.sleep(0.2)
        except _KILL_OK:
            break
    # Re-walk (catches forks spawned during the grace window) + the snapshot.
    for pid in _descendant_pids(root_pid) + descendants + [root_pid]:
        _kill(pid, signal.SIGKILL)
    if pgid is not None:
        _killpg(pgid, signal.SIGKILL)
    return True


class PreviewProcess:
    """A single subprocess running `./start.sh` in a project's app directory."""

    def __init__(
        self,
        *,
        app_dir: Path,
        on_stdout: Callable[[str], None],
        on_stderr: Callable[[str], None],
        on_exit: Callable[[int], Awaitable[None]],
        env: dict[str, str] | None = None,
    ) -> None:
        self._app_dir = app_dir
        self._on_stdout = on_stdout
        self._on_stderr = on_stderr
        self._on_exit = on_exit
        self._env = env
        self._proc: asyncio.subprocess.Process | None = None
        self._reader_tasks: list[asyncio.Task[None]] = []
        self._waiter_task: asyncio.Task[None] | None = None

    @property
    def pid(self) -> int | None:
        return self._proc.pid if self._proc else None

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    async def start(self) -> None:
        if self.running:
            raise RuntimeError("process already running")
        start_sh = self._app_dir / "start.sh"
        if not start_sh.exists():
            raise FileNotFoundError(f"{start_sh} does not exist")
        # Make sure the script is executable — belt & suspenders.
        if not os.access(start_sh, os.X_OK):
            start_sh.chmod(start_sh.stat().st_mode | 0o111)

        # New session so the subprocess has its own process group; we kill the
        # group on stop, which reaches Node and any npm/tsx grandchildren.
        self._proc = await asyncio.create_subprocess_exec(
            "./start.sh",
            cwd=str(self._app_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, **(self._env or {})},
            start_new_session=True,
        )
        self._reader_tasks = [
            asyncio.create_task(self._pump(self._proc.stdout, self._on_stdout)),
            asyncio.create_task(self._pump(self._proc.stderr, self._on_stderr)),
        ]
        self._waiter_task = asyncio.create_task(self._wait_and_exit())

    async def stop(self, *, timeout: float = 5.0) -> None:
        if not self.running or self._proc is None:
            return
        root_pid = self._proc.pid

        # Two groups to kill (see module docstring): start.sh does
        # `exec setsid npm run dev`, so Node runs in its OWN group that ESCAPES
        # start.sh's group. Kill BOTH via the shared kill_process_tree (blocking,
        # so run off the loop). No validate: we spawned these this session and
        # hold the live handle, so there's no PID-reuse ambiguity.
        #   1. The Node group recorded in `.preview.pgid` (best-effort — the file
        #      may not exist yet if start.sh hadn't written it; then start.sh's
        #      own descendant walk in (2) is the backstop).
        #   2. start.sh's own pid + group + descendants.
        try:
            raw = (self._app_dir / PGID_FILENAME).read_text().strip()
            node_pgid = int(raw) if raw.lstrip("-").isdigit() else None
        except OSError:
            node_pgid = None
        if node_pgid:
            await asyncio.to_thread(
                kill_process_tree, node_pgid, is_pgid=True, validate=False, timeout=timeout
            )
        await asyncio.to_thread(
            kill_process_tree, root_pid, is_pgid=False, validate=False, timeout=timeout
        )
        # Reap the asyncio child handle so returncode is set and pumps drain.
        try:
            await asyncio.wait_for(self._proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            pass

    @staticmethod
    async def _pump(
        stream: asyncio.StreamReader | None,
        sink: Callable[[str], None],
    ) -> None:
        if stream is None:
            return
        while True:
            line = await stream.readline()
            if not line:
                return
            try:
                sink(line.decode("utf-8", errors="replace").rstrip("\n"))
            except Exception:  # never let a bad sink crash the pump
                pass

    async def _wait_and_exit(self) -> None:
        assert self._proc is not None
        code = await self._proc.wait()
        # Let pumps drain any remaining output
        for t in self._reader_tasks:
            try:
                await asyncio.wait_for(t, timeout=1.0)
            except asyncio.TimeoutError:
                t.cancel()
        await self._on_exit(code)
