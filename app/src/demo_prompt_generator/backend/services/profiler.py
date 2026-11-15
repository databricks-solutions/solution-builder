"""On-demand sampling profiler behind the admin GET /api/health/profile.

A sampler walks `sys._current_frames()` at `hz` for a bounded window and counts
identical stacks per thread, plus each thread's CPU-time delta over the window. It
answers "where is CPU (or a blocked thread) spending its time" without a restart or
a debugger. Runs only when asked: nothing is sampled, and nothing is kept, between
requests. Only one profile runs at a time (`ProfileBusy` otherwise).

Cost: each tick walks every sampled thread's stack, so the profiler itself uses CPU
roughly proportional to threads x depth x hz. Keep hz modest when the box is already
pegged (the endpoint caps it at MAX_HZ).
"""

from __future__ import annotations

import sys
import threading
import time
from collections import Counter
from dataclasses import dataclass, field

from .stall_detector import stack_labels, thread_cpu_seconds

MAX_SECONDS = 30
MAX_HZ = 200
MAX_DEPTH = 60          # innermost frames kept per sampled stack
TOP_N = 25              # stacks per thread in the JSON view (collapsed output has all)

_profile_lock = threading.Lock()


class ProfileBusy(RuntimeError):
    """Another profile is already running; only one sampler at a time."""


@dataclass
class ThreadProfile:
    name: str
    cpu_s: float | None                          # CPU used during the window; None = no clock
    counts: Counter = field(default_factory=Counter)  # collapsed stack -> samples
    samples: int = 0


@dataclass
class ProfileResult:
    seconds: float
    hz: int
    ticks: int
    thread_filter: str
    threads: list[ThreadProfile]

    def to_dict(self, top: int = TOP_N) -> dict:
        out = []
        for t in self.threads:
            total = t.samples or 1
            out.append({
                "name": t.name,
                "cpu_s": None if t.cpu_s is None else round(t.cpu_s, 3),
                "samples": t.samples,
                "stacks": [
                    {"stack": s, "count": n, "pct": round(100.0 * n / total, 1)}
                    for s, n in t.counts.most_common(top)
                ],
            })
        return {"seconds": self.seconds, "hz": self.hz, "ticks": self.ticks,
                "thread": self.thread_filter, "threads": out}

    def collapsed(self) -> str:
        """Brendan Gregg's folded format (`thread;frame;frame count`), for flamegraph.pl /
        speedscope. Every distinct stack, not just the top N."""
        lines = []
        for t in self.threads:
            root = t.name.replace(";", ",")
            for stack, n in t.counts.most_common():
                lines.append(f"{root};{stack} {n}")
        return "\n".join(lines) + ("\n" if lines else "")


def sample_profile(seconds: float, hz: int, thread: str = "all") -> ProfileResult:
    """Sample for `seconds` at `hz`. `thread="main"` samples only the main thread (the
    event loop, under uvicorn); `"all"` samples every thread except the caller's.
    Blocks the calling thread for the window: call it from a worker thread."""
    seconds = min(max(float(seconds), 0.1), MAX_SECONDS)
    hz = min(max(int(hz), 1), MAX_HZ)
    if not _profile_lock.acquire(blocking=False):
        raise ProfileBusy("a profile is already running")
    try:
        me = threading.get_ident()
        main_ident = threading.main_thread().ident
        profiles: dict[int, ThreadProfile] = {}
        cpu0 = thread_cpu_seconds()
        interval = 1.0 / hz
        t0 = time.monotonic()
        deadline = t0 + seconds
        next_t = t0
        ticks = 0
        while time.monotonic() < deadline:
            frames = sys._current_frames()
            for t in threading.enumerate():
                ident = t.ident
                if ident is None or ident == me:
                    continue
                if thread == "main" and ident != main_ident:
                    continue
                frame = frames.get(ident)
                if frame is None:
                    continue
                prof = profiles.get(ident)
                if prof is None:
                    prof = profiles[ident] = ThreadProfile(name=t.name, cpu_s=None)
                prof.counts[";".join(stack_labels(frame, limit=MAX_DEPTH))] += 1
                prof.samples += 1
            ticks += 1
            next_t += interval
            now = time.monotonic()
            if next_t < now:          # fell behind (busy box): resync rather than burst
                next_t = now
            time.sleep(next_t - now)
        elapsed = time.monotonic() - t0
        cpu1 = thread_cpu_seconds()
        for ident, prof in profiles.items():
            if ident in cpu0 and ident in cpu1:
                prof.cpu_s = cpu1[ident] - cpu0[ident]
        ordered = sorted(
            profiles.values(),
            key=lambda p: (-(p.cpu_s if p.cpu_s is not None else 0.0), -p.samples),
        )
        return ProfileResult(
            seconds=round(elapsed, 2), hz=hz, ticks=ticks, thread_filter=thread, threads=ordered
        )
    finally:
        _profile_lock.release()
