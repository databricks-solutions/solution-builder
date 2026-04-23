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
import os
import signal
import subprocess
from pathlib import Path
from typing import Awaitable, Callable


def _descendant_pids(root_pid: int) -> list[int]:
    """Walk the process tree below `root_pid` using `pgrep -P`.

    Returns descendants in reverse-BFS order so callers signal leaves before
    parents. `tsx watch` likes to fork detached children that escape their
    original process group, so group-kill alone isn't enough on macOS.
    """
    out: list[int] = []
    frontier = [root_pid]
    while frontier:
        batch: list[int] = []
        for pid in frontier:
            try:
                res = subprocess.run(
                    ["pgrep", "-P", str(pid)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
            except FileNotFoundError:
                return out  # no pgrep; caller falls back to killpg
            for line in res.stdout.split():
                line = line.strip()
                if line.isdigit():
                    batch.append(int(line))
        out.extend(batch)
        frontier = batch
    return list(reversed(out))


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

        # Snapshot the full descendant tree BEFORE signaling — once SIGTERM
        # fires, `ps` / `pgrep` may race with reaping and miss detached nodes.
        descendants = _descendant_pids(root_pid)

        try:
            pgid = os.getpgid(root_pid)
        except ProcessLookupError:
            return

        # SIGTERM the group — handles the well-behaved subtree.
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            return
        # Also SIGTERM each descendant directly — `tsx watch` forks some
        # children into their own session so killpg misses them.
        for pid in descendants:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

        try:
            await asyncio.wait_for(self._proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            for pid in descendants:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            await self._proc.wait()

        # Final sweep: any grandchild that survived both the group-kill and
        # the direct-kill loop gets SIGKILL'd by PID.
        for pid in _descendant_pids(root_pid) + descendants:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
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
