"""In-memory cache of schema names in the default catalog.

Naming a project's schema used to cost a `SHOW SCHEMAS IN <catalog> LIKE ...`
round-trip on the create path (wakes a cold warehouse → up to ~10s). Instead we
prime a process-wide set of existing schema names ONCE at startup (piggybacking
on the catalog-bootstrap daemon, which is already connected), then resolve names
against the in-memory set — no per-create round-trip.

Authority model (see the create/provision flow): the cache is the fast, good-
enough answer at *create* time; the real uniqueness guarantee is the deferred
`CREATE SCHEMA` at /provision. A schema created externally AFTER startup could
collide — rare, and surfaced there. So this is an optimistic cache, not a lock.

Thread-safe (a plain lock — the daemon primes it, sync request handlers read it).
"""

from __future__ import annotations

import re
import threading

from ._config import logger

# Keyed by catalog → set of schema names known in that catalog. Only the
# default catalog is primed today, but keying by catalog keeps it correct if
# a demo ever points elsewhere.
_cache: dict[str, set[str]] = {}
_primed: set[str] = set()  # catalogs we've successfully primed at least once
_lock = threading.Lock()


def prime(ws, catalog: str) -> None:
    """Load ALL schema names in `catalog` into the cache. Best-effort — on any
    error the cache stays unprimed for this catalog and callers fall back to a
    live `SHOW SCHEMAS` query. Safe to call more than once (re-primes)."""
    catalog = (catalog or "").strip()
    if not catalog:
        return
    try:
        names = {s.name for s in ws.schemas.list(catalog_name=catalog) if s.name}
        with _lock:
            _cache[catalog] = names
            _primed.add(catalog)
        logger.info(
            f"[schema-cache] primed {catalog!r} with {len(names)} schema names"
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            f"[schema-cache] could not prime {catalog!r}: {e}; "
            f"name resolution will fall back to live queries"
        )


def is_primed(catalog: str) -> bool:
    with _lock:
        return (catalog or "").strip() in _primed


def reserve(catalog: str, base_schema: str) -> str | None:
    """Pick a non-colliding name for `base_schema` in `catalog` FROM THE CACHE
    and reserve it (add it so concurrent creates don't reuse it). Returns the
    reserved name, or None if the catalog isn't primed (caller should fall back
    to a live query). Mirrors `_resolve_unique_schema_name`'s suffixing:
    `base`, then `base_1`, `_2`, … using the highest existing `_<n>` + 1."""
    catalog = (catalog or "").strip()
    with _lock:
        if catalog not in _primed:
            return None
        existing = _cache.setdefault(catalog, set())
        if base_schema not in existing:
            existing.add(base_schema)
            return base_schema
        pat = re.compile(rf"^{re.escape(base_schema)}_(\d+)$")
        max_suffix = 0
        for name in existing:
            m = pat.match(name)
            if m:
                max_suffix = max(max_suffix, int(m.group(1)))
        name = f"{base_schema}_{max_suffix + 1}"
        existing.add(name)
        return name


def note(catalog: str, schema: str) -> None:
    """Record a schema name as known (e.g. after a successful CREATE SCHEMA, or
    when seeding from existing project rows). No-op if the catalog isn't primed
    — an unprimed cache stays unprimed so callers keep using live queries."""
    catalog = (catalog or "").strip()
    if not catalog or not schema:
        return
    with _lock:
        if catalog in _primed:
            _cache[catalog].add(schema)


def forget(catalog: str, schema: str) -> None:
    """Drop a reserved name (e.g. the DB insert failed, so we never actually
    claimed it). Lets the name be handed out again."""
    catalog = (catalog or "").strip()
    with _lock:
        _cache.get(catalog, set()).discard(schema)
