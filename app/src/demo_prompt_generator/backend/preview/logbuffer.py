"""
Fixed-size ring buffer of log lines with a monotonic sequence number, plus
asyncio-queue fan-out so multiple SSE clients can stream from the same buffer.

Each line carries a seq (never reused, survives wraps) so clients can reconnect
with `?since=<seq>` and get replayed anything still in the buffer.
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
from typing import Literal


LogStream = Literal["stdout", "stderr", "system"]


@dataclass(frozen=True, slots=True)
class LogLine:
    seq: int
    stream: LogStream
    text: str


class LogBuffer:
    """
    Ring buffer of LogLines with fan-out to subscriber queues.

    - `append()` pushes to the ring and fans out to every subscriber.
    - `subscribe()` returns an asyncio.Queue that receives every new line
      AFTER subscription; combine with `snapshot_since(seq)` to get history.
    - `snapshot_since(seq)` returns all buffered lines with seq > given seq.
    """

    def __init__(self, maxlen: int = 5000) -> None:
        self._ring: deque[LogLine] = deque(maxlen=maxlen)
        self._next_seq: int = 1
        self._subscribers: set[asyncio.Queue[LogLine]] = set()

    @property
    def last_seq(self) -> int:
        return self._next_seq - 1

    def append(self, stream: LogStream, text: str) -> LogLine:
        line = LogLine(seq=self._next_seq, stream=stream, text=text)
        self._next_seq += 1
        self._ring.append(line)
        for q in self._subscribers:
            # Non-blocking put — if a slow client's queue is full, drop for them.
            try:
                q.put_nowait(line)
            except asyncio.QueueFull:
                pass
        return line

    def snapshot_since(self, since_seq: int) -> list[LogLine]:
        # Ring is small (5k) and this runs on reconnect only; linear scan is fine.
        if since_seq >= self.last_seq:
            return []
        return [ln for ln in self._ring if ln.seq > since_seq]

    def subscribe(self, max_queue: int = 1000) -> asyncio.Queue[LogLine]:
        q: asyncio.Queue[LogLine] = asyncio.Queue(maxsize=max_queue)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[LogLine]) -> None:
        self._subscribers.discard(q)

    def clear(self) -> None:
        """Reset the ring (but NOT the sequence — seq is monotonic for the
        lifetime of the buffer). Called on restart so old logs don't leak."""
        self._ring.clear()
