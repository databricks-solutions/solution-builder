"""Two-layer, restart-surviving cache in front of the (slow) brand resolver.

Layers:
  - brand_query_alias: normalized user query ("databricks data ai") → domain.
  - brand_cache: one row per domain with the expensive artifacts (palette, logo
    bytes, site screenshot). Many queries share one row (deduped by domain).

`cached_resolve()` is the single entry point both /api/brands/resolve and
/api/projects/{id}/brand go through. On a hit it rebuilds a BrandOut straight
from Lakebase (no search / no vision / no screenshot). On a miss it runs the
real resolver, then writes both layers.

TTL is 30 days; `no_cache=True` (or BRAND_NO_CACHE=1) bypasses the read AND
invalidates any existing entry for the resolved domain before re-writing it —
so "force refresh" in the UI genuinely re-resolves and replaces the row.
"""

from __future__ import annotations

import base64
import logging
import os
import re
from datetime import timedelta, timezone
from typing import Optional

from sqlmodel import Session, select

from ..models import BrandCacheEntry, BrandOut, BrandQueryAlias, utc_now

logger = logging.getLogger(__name__)

CACHE_TTL = timedelta(days=30)

# mime → extension bits reused when rebuilding data URLs for the logo.
_DEFAULT_LOGO_CT = "image/png"


def normalize_query(q: str) -> str:
    """Fold a typed query to a stable cache key: lowercase, drop punctuation,
    collapse whitespace. 'Databricks Data + AI!' → 'databricks data ai'."""
    q = (q or "").lower()
    q = re.sub(r"[^a-z0-9]+", " ", q)
    return re.sub(r"\s+", " ", q).strip()


def _no_cache(flag: bool) -> bool:
    return flag or os.environ.get("BRAND_NO_CACHE") == "1"


def _entry_to_brandout(e: BrandCacheEntry) -> BrandOut:
    """Rebuild a BrandOut from a cached row (data URLs regenerated from bytes)."""
    logo_data_url = None
    if e.logo_bytes:
        ct = e.logo_content_type or _DEFAULT_LOGO_CT
        logo_data_url = f"data:{ct};base64," + base64.b64encode(e.logo_bytes).decode("ascii")
    screenshot = None
    if e.screenshot_bytes:
        screenshot = "data:image/jpeg;base64," + base64.b64encode(e.screenshot_bytes).decode("ascii")
    return BrandOut(
        name=e.company,
        domain=e.domain,
        confidence=1.0,  # a cached hit is as good as it gets
        logo_url=None,
        logo_data_url=logo_data_url,
        logos=[],
        palette=list(e.palette or []),
        source="cache",
        site_screenshot=screenshot,
        warnings=[],
        trace=[{"kind": "phase", "tool": "cache", "summary": {"hit": e.domain}}],
    )


def _data_url_bytes(data_url: Optional[str]) -> tuple[Optional[bytes], Optional[str]]:
    """(bytes, mime) from a data: URL, or (None, None)."""
    if not data_url or not data_url.startswith("data:") or "," not in data_url:
        return None, None
    try:
        header, b64 = data_url.split(",", 1)
        mime = header[5:].split(";", 1)[0].strip() or None
        return base64.b64decode(b64), mime
    except Exception:
        return None, None


def _lookup(session: Session, query_norm: str) -> Optional[BrandCacheEntry]:
    """Query alias → brand row, honoring TTL. Expired rows are treated as misses."""
    alias = session.get(BrandQueryAlias, query_norm)
    if not alias:
        return None
    entry = session.get(BrandCacheEntry, alias.domain)
    if not entry:
        return None
    # DB round-trips can hand back a naive datetime; treat it as UTC so the TTL
    # subtraction doesn't blow up on aware-vs-naive.
    resolved = entry.resolved_at
    if resolved.tzinfo is None:
        resolved = resolved.replace(tzinfo=timezone.utc)
    if utc_now() - resolved > CACHE_TTL:
        logger.info("[brand_cache] stale entry for %s (%s) — re-resolving", query_norm, entry.domain)
        return None
    return entry


async def cached_resolve(session: Session, query: str, resolver, *, no_cache: bool = False) -> BrandOut:
    """Resolve a company brand through the cache. `resolver` is an awaitable
    `resolver(query) -> BrandOut` (i.e. BrandService.resolve). Reads the cache
    unless bypassed; on a miss (or bypass) runs the resolver and writes both the
    brand row (keyed by resolved domain) and the query alias."""
    qn = normalize_query(query)
    bypass = _no_cache(no_cache)

    if qn and not bypass:
        hit = _lookup(session, qn)
        if hit:
            logger.info("[brand_cache] HIT %r → %s", qn, hit.domain)
            return _entry_to_brandout(hit)

    # Miss (or forced refresh) — run the real resolver.
    out = await resolver(query)

    # Only cache a usable result with a domain to key on.
    domain = (out.domain or "").strip().lower()
    if not domain:
        return out

    if bypass:
        # Force-refresh: drop any prior row + aliases for this domain so we don't
        # serve the old artifacts again.
        stale_aliases = session.exec(
            select(BrandQueryAlias).where(BrandQueryAlias.domain == domain)
        ).all()
        for a in stale_aliases:
            session.delete(a)
        old = session.get(BrandCacheEntry, domain)
        if old:
            session.delete(old)
        session.commit()

    logo_bytes, logo_ct = _data_url_bytes(out.logo_data_url)
    shot_bytes, _ = _data_url_bytes(out.site_screenshot)

    entry = session.get(BrandCacheEntry, domain)
    if entry:
        entry.company = out.name
        entry.palette = list(out.palette or [])
        entry.website = f"https://{domain}"
        entry.logo_bytes = logo_bytes
        entry.logo_content_type = logo_ct
        entry.screenshot_bytes = shot_bytes
        entry.resolved_at = utc_now()
    else:
        entry = BrandCacheEntry(
            domain=domain,
            company=out.name,
            palette=list(out.palette or []),
            website=f"https://{domain}",
            logo_bytes=logo_bytes,
            logo_content_type=logo_ct,
            screenshot_bytes=shot_bytes,
        )
        session.add(entry)

    # Upsert the alias (this exact phrasing → this domain).
    if qn:
        alias = session.get(BrandQueryAlias, qn)
        if alias:
            alias.domain = domain
        else:
            session.add(BrandQueryAlias(query_norm=qn, domain=domain))

    session.commit()
    logger.info("[brand_cache] WROTE %s (query %r, palette=%d, logo=%s, shot=%s)",
                domain, qn, len(out.palette or []), bool(logo_bytes), bool(shot_bytes))
    return out
