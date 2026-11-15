"""File-content codec: zstd (level 9) for new rows, zlib autodetect for legacy rows.

Dependency-free on purpose (stdlib + zstandard only), so a process-pool worker
can import it without the app or the DB layer. file_sync re-exports these names.
"""

from __future__ import annotations

import threading
import zlib

import zstandard as zstd


# ─── zstd thread-safety: per-thread compressor / decompressor ────────────────
#
# `ZstdCompressor` / `ZstdDecompressor` are NOT thread-safe — the library
# docs are explicit [1] and the C extension releases the GIL during
# compression, so threads truly race in parallel on a shared `ZSTD_CCtx`.
# In this app `sync_files_to_db` runs off the loop via `asyncio.to_thread`
# and the file watcher fires concurrent debounced flushes per project, so a
# single module-level compressor surfaced as
#     ZstdError: cannot compress: Src size is incorrect
# followed by a worker segfault from continued mutation of the corrupted
# C struct (production incident 2026-05-21T21:00:49Z, three projects'
# transcripts flushed at once).
#
# We use `threading.local()` rather than a `threading.Lock`: a lock would
# serialize every compress call and erase the parallelism zstandard
# explicitly enables. Per-thread contexts cost ~1 kB per worker thread for
# the process lifetime. Level 9 is unchanged.
#
# [1] https://python-zstandard.readthedocs.io/en/latest/api_usage.html#thread-and-object-reuse-safety

_ZSTD_LEVEL = 9
_zstd_local = threading.local()


def _get_compressor() -> zstd.ZstdCompressor:
    """Return the calling thread's `ZstdCompressor`, creating it lazily."""
    c = getattr(_zstd_local, "compressor", None)
    if c is None:
        c = zstd.ZstdCompressor(level=_ZSTD_LEVEL)
        _zstd_local.compressor = c
    return c


def _get_decompressor() -> zstd.ZstdDecompressor:
    """Return the calling thread's `ZstdDecompressor`, creating it lazily."""
    d = getattr(_zstd_local, "decompressor", None)
    if d is None:
        d = zstd.ZstdDecompressor()
        _zstd_local.decompressor = d
    return d


# zstd frames start with the magic number 0xFD2FB528 (little-endian) →
# bytes 0x28 0xB5 0x2F 0xFD. zlib streams (RFC 1950) start with 0x78
# followed by one of {0x01, 0x5E, 0x9C, 0xDA} depending on the level —
# never 0x28. So a single-byte prefix check is enough to disambiguate.
_ZSTD_MAGIC_FIRST_BYTE = 0x28


def compress_content(content: bytes) -> bytes:
    """Compress with zstd level 9 via a thread-local context (see above)."""
    return _get_compressor().compress(content)


def decompress_content(compressed: bytes) -> bytes:
    """Decompress, autodetecting zlib (legacy rows) vs zstd from the magic byte.

    Historical rows were written with zlib level 6; new rows are zstd. The
    first-byte check (see `_ZSTD_MAGIC_FIRST_BYTE`) removes the need for a
    schema column or backfill.
    """
    if compressed and compressed[0] == _ZSTD_MAGIC_FIRST_BYTE:
        return _get_decompressor().decompress(compressed)
    return zlib.decompress(compressed)
