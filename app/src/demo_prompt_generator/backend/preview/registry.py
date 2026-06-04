"""
In-memory registry of running preview processes.

One PreviewState per project. Picks a free TCP port up-front and injects it
as `DATABRICKS_APP_PORT` so concurrent previews never collide. Detects
readiness by probing that port (no log scraping). Persists the root PID to
`<app>/.preview.server.pid` so a restarted parent can sweep up orphans.
Enforces a concurrency cap, auto-stops idle previews, and fans log lines out
via the attached LogBuffer.
"""

from __future__ import annotations

import asyncio
import os
import signal
import socket
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

from .logbuffer import LogBuffer
from .process import PreviewProcess, _descendant_pids


Status = Literal["stopped", "starting", "ready", "failed"]

# Tunables — if we ever want these configurable, lift them to AppConfig.
MAX_CONCURRENT = 10
IDLE_TIMEOUT_SECONDS = 5 * 60
IDLE_POLL_SECONDS = 20
LOG_BUFFER_LINES = 5000
# How long we wait for the subprocess to start accepting TCP connections on its
# assigned port before we flip to "failed".
READY_PROBE_TIMEOUT_SECONDS = 180.0
READY_PROBE_INTERVAL_SECONDS = 0.5
# Where we record the root subprocess PID so a restarted parent process can
# find and kill orphans from previous runs. Lives inside the project's app/.
SERVER_PID_FILENAME = ".preview.server.pid"


def _pick_free_port(exclude: set[int] | None = None) -> int:
    """Ask the kernel for a free TCP port — never reusing this process's own
    listening port, and never reusing a port we've already assigned to
    another preview that hasn't bound yet.

    `bind(("127.0.0.1", 0))` asks the kernel for an ephemeral port. The
    kernel won't return a port that's CURRENTLY bound by another process,
    so apps that are already listening are safe by construction. Two
    cases the kernel alone can't protect against:

      1. **The parent app's port.** On Linux the default ephemeral range
         starts at 32768 and `DATABRICKS_APP_PORT` is typically 8000, so
         a clean collision is rare — but in deployments where the parent
         runs in the ephemeral range (or any misconfigured Databricks Apps
         host that hands out a high port to the parent), the kernel can
         reissue the parent's port. The preview's child would then bind
         to it, and Databricks Apps' load balancer (routing to whatever
         is on `DATABRICKS_APP_PORT`) would serve the demo's UI in lieu
         of ours, effectively killing the demo-generator app.

      2. **Other previews we've already promised a port to.** Between
         allocating a port for preview A and A's child actually binding
         (~hundreds of ms while npm + tsx warm up), a /start for preview
         B could call bind(0) and get the SAME port back. Both children
         then race; the loser exits with EADDRINUSE. We track all
         already-assigned-but-not-yet-bound ports in `exclude` so callers
         can pass them in.

    Defensive retry up to 8 times before failing loudly — better than
    hijacking the parent or stealing another preview's slot.
    """
    parent_port_str = os.environ.get("DATABRICKS_APP_PORT") or ""
    parent_port = int(parent_port_str) if parent_port_str.isdigit() else None
    forbidden: set[int] = set(exclude or ())
    if parent_port is not None:
        forbidden.add(parent_port)
    for _ in range(8):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        if port not in forbidden:
            return port
    raise RuntimeError(
        f"could not find a free port distinct from forbidden set "
        f"(parent + in-flight previews): {sorted(forbidden)}"
    )


async def _port_is_listening(port: int) -> bool:
    try:
        _reader, writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", port),
            timeout=0.5,
        )
    except (OSError, asyncio.TimeoutError):
        return False
    writer.close()
    try:
        await writer.wait_closed()
    except Exception:
        pass
    return True


@dataclass
class PreviewState:
    project_id: str
    status: Status = "stopped"
    port: int | None = None
    pid: int | None = None
    started_at: float | None = None  # monotonic
    last_activity: float = field(default_factory=time.monotonic)
    log_buffer: LogBuffer = field(default_factory=lambda: LogBuffer(LOG_BUFFER_LINES))
    _process: PreviewProcess | None = None
    _probe_task: asyncio.Task[None] | None = None
    _state_subscribers: set[asyncio.Queue["StateEvent"]] = field(default_factory=set)

    # ------------------------------------------------------------------
    # Subscribe to state changes (SSE clients get this + log events)
    # ------------------------------------------------------------------
    def subscribe_state(self) -> asyncio.Queue["StateEvent"]:
        q: asyncio.Queue[StateEvent] = asyncio.Queue(maxsize=100)
        self._state_subscribers.add(q)
        return q

    def unsubscribe_state(self, q: asyncio.Queue["StateEvent"]) -> None:
        self._state_subscribers.discard(q)

    def _emit_state(self) -> None:
        ev = StateEvent(
            status=self.status,
            port=self.port,
            pid=self.pid,
            started_at=self.started_at,
        )
        for q in self._state_subscribers:
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                pass

    def bump_activity(self) -> None:
        self.last_activity = time.monotonic()


@dataclass(frozen=True, slots=True)
class StateEvent:
    status: Status
    port: int | None
    pid: int | None
    started_at: float | None


class ConcurrencyError(RuntimeError):
    pass


class NotReadyError(RuntimeError):
    """Raised when the project has no ./app/start.sh yet."""


class PreviewRegistry:
    """
    One registry per FastAPI process. Holds all running previews.
    """

    def __init__(
        self,
        *,
        get_project_dir: Callable[[str], Path],
    ) -> None:
        self._get_project_dir = get_project_dir
        self._states: dict[str, PreviewState] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._idle_task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # Lifecycle of the registry itself (tie to FastAPI lifespan)
    # ------------------------------------------------------------------
    async def startup(self) -> None:
        # Clean up orphaned subprocess trees from a previous parent run before
        # accepting traffic. No-op on a fresh install.
        self._sweep_stale_pid_files()
        self._idle_task = asyncio.create_task(self._idle_loop())

    async def shutdown(self) -> None:
        if self._idle_task is not None:
            self._idle_task.cancel()
        # Kill everything we started.
        await asyncio.gather(
            *(self._do_stop(pid) for pid in list(self._states.keys())),
            return_exceptions=True,
        )

    # ------------------------------------------------------------------
    # State access
    # ------------------------------------------------------------------
    def get(self, project_id: str) -> PreviewState:
        if project_id not in self._states:
            self._states[project_id] = PreviewState(project_id=project_id)
        return self._states[project_id]

    def has_running(self, project_id: str) -> bool:
        s = self._states.get(project_id)
        return bool(s and s.status in ("starting", "ready"))

    def app_dir(self, project_id: str) -> Path:
        """Resolve `<project>/app/`. Does NOT assume it exists."""
        return self._get_project_dir(project_id) / "app"

    def has_start_script(self, project_id: str) -> bool:
        return (self.app_dir(project_id) / "start.sh").exists()

    def _lock_for(self, project_id: str) -> asyncio.Lock:
        if project_id not in self._locks:
            self._locks[project_id] = asyncio.Lock()
        return self._locks[project_id]

    # ------------------------------------------------------------------
    # Start / Stop / Restart
    # ------------------------------------------------------------------
    async def start(
        self,
        project_id: str,
        extra_env: dict[str, str] | None = None,
    ) -> PreviewState:
        # extra_env is merged into the subprocess env at spawn (e.g. Databricks
        # auth — DATABRICKS_CONFIG_FILE / DATABRICKS_CONFIG_PROFILE). The
        # caller (HTTP route) builds it because it has access to the request
        # headers + user profile. See backend/AUTH.md.
        async with self._lock_for(project_id):
            state = self.get(project_id)

            # Idempotent: if already ready, bump activity and return.
            if state.status == "ready":
                state.bump_activity()
                return state
            # If already starting, return as-is (caller should poll events).
            if state.status == "starting":
                return state

            if not self.has_start_script(project_id):
                raise NotReadyError(
                    f"{self.app_dir(project_id)}/start.sh does not exist"
                )

            running = sum(
                1 for s in self._states.values() if s.status in ("starting", "ready")
            )
            if running >= MAX_CONCURRENT:
                raise ConcurrencyError(
                    f"Too many preview apps running ({running}/{MAX_CONCURRENT})."
                )

            await self._do_start(state, extra_env=extra_env or {})
            return state

    async def stop(self, project_id: str) -> PreviewState:
        async with self._lock_for(project_id):
            await self._do_stop(project_id)
            return self.get(project_id)

    async def restart(
        self,
        project_id: str,
        extra_env: dict[str, str] | None = None,
    ) -> PreviewState:
        async with self._lock_for(project_id):
            await self._do_stop(project_id)
            # Clear logs on restart (per product decision).
            self.get(project_id).log_buffer.clear()
            if not self.has_start_script(project_id):
                raise NotReadyError(
                    f"{self.app_dir(project_id)}/start.sh does not exist"
                )
            await self._do_start(self.get(project_id), extra_env=extra_env or {})
            return self.get(project_id)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------
    async def _do_start(
        self,
        state: PreviewState,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> None:
        # Registry picks the port and hands it to the subprocess via
        # DATABRICKS_APP_PORT. `start.sh` reads that env var with 8765 as the
        # fallback — by injecting it we guarantee no collision across
        # concurrent previews, and we already know where to probe for ready.
        # Exclude any port we've already assigned to another preview that
        # hasn't bound yet (TOCTOU protection between two near-simultaneous
        # /start calls; see _pick_free_port docstring case 2).
        in_use = {s.port for s in self._states.values() if s.port is not None}
        port = _pick_free_port(exclude=in_use)

        state.status = "starting"
        state.port = port
        state.started_at = time.monotonic()
        state.bump_activity()
        state._emit_state()

        def on_stdout(line: str) -> None:
            state.log_buffer.append("stdout", line)

        def on_stderr(line: str) -> None:
            state.log_buffer.append("stderr", line)

        async def on_exit(code: int) -> None:
            state.log_buffer.append("system", f"process exited with code {code}")
            state.pid = None
            # A user-initiated stop pre-flips status to "stopped" before killing
            # the process, so any exit we observe here was NOT user-initiated.
            # That means: if the process died on its own, it failed — regardless
            # of exit code. A server that exits cleanly with code 0 during
            # "starting" or "ready" is still a failure from the user's POV
            # (their preview isn't running). Only a pre-set "stopped" is honored.
            if state.status != "stopped":
                state.status = "failed"
            state.port = None
            state._emit_state()
            if state._probe_task is not None and not state._probe_task.done():
                state._probe_task.cancel()

        proc = PreviewProcess(
            app_dir=self.app_dir(state.project_id),
            on_stdout=on_stdout,
            on_stderr=on_stderr,
            on_exit=on_exit,
            env={
                "DATABRICKS_APP_PORT": str(port),
                # DO NOT REMOVE. Force child to bind ONLY on loopback.
                # Bug it fixes: in prod Databricks Apps containers with
                # multiple users running previews concurrently, hitting the
                # parent's URL would intermittently return a CHILD's HTML.
                # Cause: AppKit defaults to host=0.0.0.0 (see
                # node_modules/@databricks/appkit/dist/plugins/server/index.js).
                # The parent must use 0.0.0.0 (the platform proxy needs it).
                # When _pick_free_port() asks the kernel via
                # bind(("127.0.0.1", 0)), the kernel can hand back the
                # parent's port — because 127.0.0.1:N and 0.0.0.0:N are
                # DIFFERENT addresses to the kernel and the parent's
                # 0.0.0.0:N doesn't block a 127.0.0.1:N bind from the
                # child's perspective in the port-pick. The child then
                # calls listen(N, "0.0.0.0") — and depending on container
                # kernel semantics either succeeds via SO_REUSEPORT-like
                # behavior or silently shadows the parent. Platform proxy
                # round-robins → users get the child's app on the parent
                # URL. FLASK_RUN_HOST=127.0.0.1 makes the child bind
                # 127.0.0.1:N instead, which IS detected as conflicting
                # with parent's 0.0.0.0:N → child fails with EADDRINUSE
                # at start instead of silent shadowing → registry retries
                # with a different port → no collision possible.
                # The child does not need external reachability: only the
                # parent's reverse proxy in proxy.py:100 talks to it via
                # http://127.0.0.1:<port>. Works identically in local dev.
                "FLASK_RUN_HOST": "127.0.0.1",
                **(extra_env or {}),
            },
        )
        state._process = proc
        try:
            await proc.start()
        except Exception as e:
            state.log_buffer.append("system", f"failed to start: {e}")
            state.status = "failed"
            state.port = None
            state._emit_state()
            raise
        state.pid = proc.pid
        # Persist the root PID so a restarted parent can find and kill the
        # subprocess tree on its next startup sweep.
        self._write_server_pid(state.project_id, proc.pid)
        state._emit_state()

        # Spawn the readiness probe: flip to "ready" as soon as something is
        # accepting TCP connections on the assigned port.
        state._probe_task = asyncio.create_task(self._probe_ready(state, port))

    async def _probe_ready(self, state: PreviewState, port: int) -> None:
        deadline = time.monotonic() + READY_PROBE_TIMEOUT_SECONDS
        try:
            while time.monotonic() < deadline:
                if state.status != "starting":
                    return  # stopped / failed / already ready via another path
                if await _port_is_listening(port):
                    if state.status == "starting":
                        state.status = "ready"
                        state._emit_state()
                    return
                await asyncio.sleep(READY_PROBE_INTERVAL_SECONDS)
            # Timed out — the process is up but never opened its port.
            if state.status == "starting":
                state.log_buffer.append(
                    "system",
                    f"timed out waiting for port {port} after {READY_PROBE_TIMEOUT_SECONDS:.0f}s",
                )
                state.status = "failed"
                state._emit_state()
        except asyncio.CancelledError:
            return

    async def _do_stop(self, project_id: str) -> None:
        state = self._states.get(project_id)
        if state is None or state._process is None:
            if state is not None:
                state.status = "stopped"
                state.port = None
                state.pid = None
                state._emit_state()
            self._clear_server_pid(project_id)
            return
        proc = state._process
        state.status = "stopped"  # pre-emit so on_exit doesn't flip to failed
        if state._probe_task is not None and not state._probe_task.done():
            state._probe_task.cancel()
        await proc.stop()
        state._process = None
        state._probe_task = None
        state.pid = None
        state.port = None
        self._clear_server_pid(project_id)
        state._emit_state()

    # ------------------------------------------------------------------
    # Persisted root-PID file (survives a parent crash/restart)
    # ------------------------------------------------------------------
    def _server_pid_path(self, project_id: str) -> Path:
        return self.app_dir(project_id) / SERVER_PID_FILENAME

    def _write_server_pid(self, project_id: str, pid: int) -> None:
        try:
            self._server_pid_path(project_id).write_text(str(pid))
        except OSError:
            pass  # non-fatal — we just lose the restart-recovery path

    def _clear_server_pid(self, project_id: str) -> None:
        try:
            self._server_pid_path(project_id).unlink(missing_ok=True)
        except OSError:
            pass

    def _sweep_stale_pid_files(self) -> None:
        """
        Called on registry startup. For every project that has a leftover
        .preview.server.pid from a previous parent run, walk that PID's tree
        and SIGKILL everything, then delete the file. Safe to call multiple
        times; no-op when no files exist.
        """
        # Each project's `app/` sits at `<projects_root>/<id>/app/`. We derive
        # <projects_root> from any one project's dir (they share a parent).
        try:
            sample_root = self._get_project_dir("__sweep__").parent
        except Exception:
            return
        if not sample_root.exists():
            return
        for pid_file in sample_root.glob(f"*/app/{SERVER_PID_FILENAME}"):
            try:
                raw = pid_file.read_text().strip()
                pid = int(raw) if raw.isdigit() else None
            except OSError:
                pid = None
            if pid is not None:
                # Kill descendants first (leaves → parent), then the root.
                for d in _descendant_pids(pid):
                    try:
                        os.kill(d, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            try:
                pid_file.unlink(missing_ok=True)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Idle auto-stop
    # ------------------------------------------------------------------
    async def _idle_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(IDLE_POLL_SECONDS)
                await self._sweep_idle()
            except asyncio.CancelledError:
                return
            except Exception:  # swallow; never die
                pass

    async def _sweep_idle(self) -> None:
        now = time.monotonic()
        for project_id, state in list(self._states.items()):
            if state.status not in ("starting", "ready"):
                continue
            if now - state.last_activity > IDLE_TIMEOUT_SECONDS:
                state.log_buffer.append(
                    "system",
                    f"idle for {IDLE_TIMEOUT_SECONDS}s — auto-stopping",
                )
                try:
                    await self.stop(project_id)
                except Exception:
                    pass
