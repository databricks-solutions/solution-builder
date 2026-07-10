"""Company brand resolver (v1 — keyless, best-effort).

Given a company name (e.g. "Rolls-Royce"), find its official site and extract a
LOGO + COLOR PALETTE. Uses the OpenAI Agents SDK as the agent loop, pointed at
our Databricks serving endpoint (custom OpenAI-compatible client, tracing
disabled → keyless-to-us). Each capability is an `@function_tool`; the model
does the thin selection work (which site is official, which image is the logo,
whether to re-search). Fetch/parse/palette are deterministic Python.

VERBOSE LOGGING: every tool call logs its input + a summary of its output, and
the agent's final decision is logged, under logger name
`demo_prompt_generator.backend.services.brand_service`. Set LOG_LEVEL=DEBUG (or
just watch INFO) to trace what the agent did. See docs/brand-service-spec.md.
"""

from __future__ import annotations

import base64
import io
import ipaddress
import json
import logging
import re
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urljoin, urlparse

import httpx

if TYPE_CHECKING:
    from ..models import BrandLogoCandidate, BrandOut
    from .llm_service import LLMService

logger = logging.getLogger(__name__)

# Crawl as Googlebot: many sites do server-side rendering / "dynamic rendering"
# for search bots, so we get the STATIC (SSR'd) HTML — the logo + meta are in the
# markup instead of JS-injected. Also less likely to hit consumer bot-walls.
_UA = (
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
# Fallback UA for sites that bot-wall Googlebot (e.g. Notion 403s the crawler UA).
_UA_BROWSER = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
_HTTP_TIMEOUT = 12.0
_MAX_HTML_BYTES = 3_000_000  # don't slurp huge pages

# --- SEARCH cache (survives restarts) ----------------------------------------
# TEMPORARY, for the improvement loop: one JSON file mapping an EXACT search key
# ("<n>|<query>") → the raw DDG result list. We cache SEARCHES, not whole
# resolves, on purpose: when I patch the resolve LOGIC and re-run, the searches
# replay instantly from cache (DDG is slow + rate-limit-fragile) but ALL the
# extraction/decision logic re-executes so I see the effect of my change.
# Changing a query string naturally busts its entry. BRAND_NO_CACHE=1 disables;
# BRAND_SEARCH_CACHE overrides the path.
def _search_cache_path() -> str:
    import os
    return os.environ.get("BRAND_SEARCH_CACHE", "/tmp/brand_search_cache.json")


def _search_cache_all() -> dict[str, Any]:
    try:
        with open(_search_cache_path()) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _search_cache_get(key: str) -> Optional[list[dict]]:
    import os
    if os.environ.get("BRAND_NO_CACHE") == "1":
        return None
    v = _search_cache_all().get(key)
    return v if isinstance(v, list) else None


def _search_cache_put(key: str, value: list[dict]) -> None:
    import os
    if os.environ.get("BRAND_NO_CACHE") == "1":
        return
    try:
        data = _search_cache_all()
        data[key] = value
        path = _search_cache_path()
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, path)  # atomic-ish
    except Exception as e:
        logger.warning("[brand] search-cache write failed: %s", e)


# ---------------------------------------------------------------------------
# Per-resolve run context — collects candidate signals as the agent explores.
# ---------------------------------------------------------------------------
@dataclass
class BrandRun:
    name: str
    domain: Optional[str] = None
    official_site: Optional[str] = None  # the URL the agent confirmed as official
    confidence: float = 0.0
    # every logo candidate seen, tagged by source + the page it came from
    logo_candidates: list[dict[str, Any]] = field(default_factory=list)
    # color -> set of sources that mentioned it (frequency = cross-source trust).
    # source is a short tag: "snippet:<domain>", "css:<domain>", "page:<domain>",
    # "logo", "site-css", "agent". A hex seen from many independent sources is a
    # strong signal it's a real brand color.
    color_votes: dict[str, set[str]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    # The agent's FINAL logo choice (via choose_logo tool): {url, bytes, ct, source}.
    chosen_logo: Optional[dict[str, Any]] = None
    # The agent's FINAL ordered palette (via set_palette). None → fall back to votes.
    chosen_palette: Optional[list[str]] = None
    # FULL instrumented trace: one entry per tool call / decision / reasoning note.
    # Powers the self-improvement loop — I read these to see WHAT each tool did,
    # WHY the agent chose something, and where things went wrong. Emitted on
    # BrandOut.trace + mirrored to a JSONL file.
    steps: list[dict[str, Any]] = field(default_factory=list)
    _t0: float = field(default_factory=time.monotonic)
    # within-run logo download cache (url -> (bytes|None, ct|None)) so retries,
    # validation, and _collect_logo_candidates never re-fetch the same asset.
    dl_cache: dict[str, tuple[Optional[bytes], Optional[str]]] = field(default_factory=dict)
    # the contact sheet PNG the vision model saw when picking the logo (for the
    # review file — lets a human see exactly what was judged).
    logo_sheet_png: Optional[bytes] = None
    # per-cell provenance for that sheet: [{n, format, source, host, official,
    # backend, image}] — where each graded image came from.
    logo_provenance: list[dict[str, Any]] = field(default_factory=list)
    # review logos built from the EXACT graded cells (chosen flagged) — so the
    # human reviews the same set the model saw. Empty if no visual pick happened.
    review_logos: list[Any] = field(default_factory=list)
    # screenshot (JPEG bytes) of the official site — brand context for followups +
    # a reference the vision model uses to disambiguate the logo. Captured once.
    site_screenshot: Optional[bytes] = None
    _shot_tried: bool = False

    def warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)
            logger.info("[brand:%s] warning: %s", self.name, msg)
            self.trace("warning", detail=msg)

    def trace(self, kind: str, *, tool: Optional[str] = None, args: Any = None,
              summary: Any = None, reasoning: Optional[str] = None,
              detail: Optional[str] = None, ms: Optional[float] = None) -> None:
        """Append one structured step. `kind` ∈ tool|decision|reasoning|warning|
        phase. Keep summaries compact (no raw bytes / no full data URLs)."""
        entry: dict[str, Any] = {
            "t_ms": round((time.monotonic() - self._t0) * 1000),
            "kind": kind,
        }
        for k, v in (("tool", tool), ("args", args), ("summary", summary),
                     ("reasoning", reasoning), ("detail", detail), ("ms", ms)):
            if v is not None:
                entry[k] = v
        self.steps.append(entry)

    def log_reasoning(self, step: str, why: str) -> None:
        """Record an agent/tool reasoning note (why it chose X, what was hard)."""
        logger.info("[brand:%s] REASONING [%s] %s", self.name, step, why)
        self.trace("reasoning", tool=step, reasoning=why)

    def vote_color(self, hex_value: str, source: str) -> Optional[str]:
        """Normalize + record a color vote from a source, tagged by that source.
        Permissive on purpose — we keep off-white/neutral brand colors here (some
        brands' official palettes include oat/cream neutrals) and only reject
        pure junk; the FINAL palette assembly (_final_palette) does the real
        selection weighting official sources highest. Returns normalized hex."""
        h = _to_hex(hex_value)
        if not h or len(h) != 7:
            return None
        try:
            r, g, b = int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)
        except ValueError:
            return None
        # reject only pure white / pure black (keep off-whites + dark neutrals)
        if (r, g, b) == (255, 255, 255) or max(r, g, b) < 8:
            return None
        self.color_votes.setdefault(h, set()).add(source)
        return h


# ---------------------------------------------------------------------------
# Low-level fetch + parse (deterministic; used by the tools).
# ---------------------------------------------------------------------------
class UnsafeUrlError(Exception):
    """Raised when a URL would target a non-public host (SSRF guard)."""


def _assert_public_url(url: str) -> None:
    """SSRF guard: only http(s) to a PUBLIC host. The agent (and the pages/search
    results it follows) supply URLs, so this is attacker-influenceable — reject
    loopback / private / link-local / reserved (e.g. 169.254.169.254 cloud
    metadata, localhost, RFC-1918). Checked on the initial URL AND every redirect
    hop (see _http_get)."""
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"scheme not allowed: {p.scheme}")
    host = p.hostname
    if not host:
        raise UnsafeUrlError("no host")
    # Resolve to IP(s) and reject any non-global address.
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as e:
        raise UnsafeUrlError(f"cannot resolve host: {e}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_reserved:
            raise UnsafeUrlError(f"non-public host {host} → {ip}")


def _http_get(url: str, *, referer: str | None = None, binary: bool = False,
              _max_hops: int = 5, _ua: str | None = None):
    """GET with an SSRF guard applied to the URL and to EVERY redirect hop
    (redirects are followed manually so a public URL can't 302 to an internal
    one). On a 403/406 (bot-wall) with the default Googlebot UA, retry ONCE with
    a real-browser UA — some sites (e.g. Notion) block crawler UAs. Raises on
    non-public targets / HTTP errors — callers catch."""
    ua = _ua or _UA
    headers = {"User-Agent": ua, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    with httpx.Client(follow_redirects=False, timeout=_HTTP_TIMEOUT, headers=headers) as c:
        current = url
        for _ in range(_max_hops):
            _assert_public_url(current)
            r = c.get(current)
            if r.is_redirect and r.headers.get("location"):
                current = urljoin(current, r.headers["location"])
                continue
            if r.status_code in (403, 406) and _ua is None:
                # bot-walled: retry once as a normal browser
                return _http_get(current, referer=referer, binary=binary,
                                 _max_hops=_max_hops, _ua=_UA_BROWSER)
            r.raise_for_status()
            return r
        raise UnsafeUrlError("too many redirects")


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _write_trace_file(run: BrandRun, out: "BrandOut") -> None:
    """Mirror the run's trace + result summary to a JSONL/JSON file so I can
    diff/grep across runs without re-resolving. Best-effort; skips data URLs."""
    import os
    try:
        d = os.environ.get("BRAND_TRACE_DIR", "/tmp/brand_traces")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, f"{_slugify(run.name)}.json")  # overwrite: latest run
        payload = {
            "name": out.name,
            "domain": out.domain,
            "confidence": out.confidence,
            "source": out.source,
            "palette": out.palette,
            "logo_url": out.logo_url if (out.logo_url or "").startswith("http") else "(data-url)",
            "logo_sources": [f"{l.source}{'*' if l.chosen else ''}" for l in out.logos],
            "warnings": out.warnings,
            "trace": run.steps,
        }
        with open(path, "w") as f:
            json.dump(payload, f, indent=2, default=str)
    except Exception as e:
        logger.warning("[brand] trace-file write failed: %s", e)


def _domain_of(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


# Hex + rgb() color literals anywhere in text (snippets, HTML, CSS).
_HEX_RE = re.compile(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b")
_RGB_RE = re.compile(r"rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}", re.I)


def _harvest_colors(text: str, limit: int = 40) -> list[str]:
    """Pull every hex + rgb() color literal out of arbitrary text, in order of
    first appearance, normalized to #rrggbb. Used on search snippets, aggregator
    pages, and CSS."""
    out: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)", text):
        h = _to_hex(m.group(0))
        if h and h not in seen:
            seen.add(h)
            out.append(h)
            if len(out) >= limit:
                break
    return out


def _is_asset_host(host: str) -> bool:
    """Host that serves ASSETS (CDN / digital-asset-manager / aggregator), not the
    company's own site — so it's a bad thing to report as the brand domain."""
    h = host.lower()
    return any(k in h for k in (
        "cloudfront", "cdn", "assets", "storage", "amazonaws", "googleapis",
        "bfldr", "brandfolder", "contentful", "imgix", "akamai", "fastly",
        "wp.com", "wixstatic", "cloudinary",
        # aggregators (never the real brand site)
        "brandcolorcode", "mobbin", "colorarchive", "schemecolor", "loftlyy",
        "icolorpalette", "brandfetch", "wikipedia", "wikimedia",
    ))


def _is_icon_like(url: str) -> bool:
    """URL that smells like a favicon / app-icon / social-share card rather than
    the primary logo/wordmark."""
    low = url.lower()
    return any(k in low for k in (
        "favicon", "apple-touch", "apple_touch", "/icon", "icon-", "-icon",
        "touch-icon", "mstile", "og-image", "og_image", "opengraph", "social",
        "twitter-card", "sharing",
    ))


def _has_vector_or_png_candidate(run: BrandRun) -> bool:
    """True if a non-icon SVG/PNG logo candidate exists (so we can reject a JPEG)."""
    for c in run.logo_candidates:
        u = c["url"].lower()
        if _is_icon_like(u):
            continue
        if u.startswith("data:image/svg") or ".svg" in u or ".png" in u or c["source"] == "inline-svg":
            return True
    return False


def _has_non_icon_candidate(run: BrandRun) -> bool:
    """True if some collected logo candidate is a real (non-icon) logo we could
    pick instead — so we can safely reject an icon-like URL."""
    for c in run.logo_candidates:
        if c["source"] in ("jsonld", "og:image", "favicon"):
            # these sources are only trustworthy as logos if the URL isn't icon-y
            if _is_icon_like(c["url"]):
                continue
        if not _is_icon_like(c["url"]):
            return True
    return False


def _svg_uses_css_vars(svg_markup: str) -> bool:
    """True if the SVG paints via CSS custom properties (fill="var(--…)") or
    `currentColor` — such SVGs render INVISIBLE out of their page context, so
    they're useless as a standalone logo. (This is the Stripe-inline-svg bug.)"""
    low = svg_markup.lower()
    return "var(--" in low or "currentcolor" in low


# ---------------------------------------------------------------------------
# LOGO by SIGHT: gather candidate images (DDG image search + site crawl), build
# a labelled contact sheet, and let a MULTIMODAL model pick the real logo.
# Judge by looking at pixels — not by scraping HTML or URL heuristics. Cross-
# source recurrence + SVG preference are stated in the prompt; the model decides.
# ---------------------------------------------------------------------------
# Image search. We hit DuckDuckGo's OWN image endpoint (duckduckgo.com/i.js)
# directly — the same index the website uses, which returns clean real logos.
# (The `ddgs` LIBRARY's image search is unreliable: its `duckduckgo` backend is
# dead and its default `auto` roulettes over bing/google/brave/yandex/mojeek,
# sometimes falling through to a poisoned backend that returns unrelated junk —
# that's how 'airbnb logo' once returned IKEA/candles/porn. So we do NOT use the
# lib for images; we fall back to its bing/google backends only if i.js fails.)
_DDG_UA = _UA_BROWSER  # DDG's i.js wants a real-browser UA
_vqd_cache: dict[str, str] = {}


def _ddg_vqd(client: "httpx.Client", query: str) -> Optional[str]:
    """Scrape the per-query `vqd` token DDG requires for its i.js image API."""
    if query in _vqd_cache:
        return _vqd_cache[query]
    try:
        r = client.get("https://duckduckgo.com/", params={"q": query})
        m = (re.search(r'vqd=["\']?([\d-]+)', r.text) or re.search(r'vqd=([\d-]+)&', r.text))
        if m:
            _vqd_cache[query] = m.group(1)
            return m.group(1)
    except Exception:
        pass
    return None


def _ddg_images(query: str, n: int = 12) -> list[dict[str, Any]]:
    """Image search via DuckDuckGo's own i.js endpoint → [{title, image,
    thumbnail, page, w, h}]. Falls back to the ddgs library (bing/google) only if
    i.js fails. Best-effort."""
    headers = {"User-Agent": _DDG_UA, "Accept": "application/json,*/*"}
    try:
        with httpx.Client(headers=headers, timeout=_HTTP_TIMEOUT, follow_redirects=True) as c:
            vqd = _ddg_vqd(c, query)
            if vqd:
                r = c.get("https://duckduckgo.com/i.js",
                          params={"l": "us-en", "o": "json", "q": query, "vqd": vqd,
                                  "f": "", "p": "1"},
                          headers={"Referer": "https://duckduckgo.com/"})
                results = r.json().get("results", [])
                out = []
                for x in results[:n * 2]:
                    img = x.get("image")
                    if not img:
                        continue
                    out.append({
                        "title": x.get("title", ""), "image": img,
                        "thumbnail": x.get("thumbnail") or img, "page": x.get("url", ""),
                        "w": _as_int(x.get("width")), "h": _as_int(x.get("height")),
                        "backend": "ddg-i.js",
                    })
                if out:
                    return out[:n * 2]
    except Exception as e:
        logger.debug("[brand] ddg i.js error for %r: %s", query, e)

    # fallback: ddgs library, pinned backends (avoid the junk-prone `auto`)
    from ddgs import DDGS
    out2: list[dict[str, Any]] = []
    seen: set[str] = set()
    for backend in ("bing", "google"):
        try:
            rows = DDGS().images(query, max_results=n, backend=backend)
        except Exception:
            continue
        for r2 in rows:
            img = r2.get("image")
            if img and img not in seen:
                seen.add(img)
                out2.append({"title": r2.get("title", ""), "image": img,
                             "thumbnail": r2.get("thumbnail") or img, "page": r2.get("url", ""),
                             "w": _as_int(r2.get("width")), "h": _as_int(r2.get("height")),
                             "backend": backend})
        if out2:
            break
    return out2


# Lean flags for a short-lived one-shot screenshot. --single-process + --no-zygote
# avoid spawning extra renderer/zygote processes; the disable-* flags cut
# background work; capping the JS heap keeps a runaway page from ballooning.
# Measured ~384 MB peak / ~1.8s per screenshot (vs ~521 MB / 3.5s for full
# chromium with defaults). We keep IMAGES enabled — the header logo must render
# for the reference screenshot — but block fonts/media at the route level.
# NOTE: no --single-process / --no-zygote. They save a little RAM but CRASH the
# renderer on heavy SPAs (airbnb.com etc.) — "Target page has been closed". Most
# company sites are SPAs, and reliability > the small memory saving, so we keep
# the normal multi-process model. (Measured memory delta was ~noise anyway.)
_PW_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--disable-software-rasterizer",
    "--disable-extensions", "--disable-background-networking", "--disable-sync",
    "--disable-default-apps", "--disable-translate", "--mute-audio", "--no-first-run",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    "--disable-ipc-flooding-protection", "--disable-hang-monitor",
    "--disable-client-side-phishing-detection", "--metrics-recording-only",
    "--safebrowsing-disable-auto-update", "--hide-scrollbars",
    "--disable-features=site-per-process,TranslateUI,BackForwardCache,AcceptCHFrame",
    "--js-flags=--max-old-space-size=256",
]
# We deliberately DON'T set --blink-settings=imagesEnabled=false or block
# images/CSS: those are the biggest RAM wins BUT they'd give an ugly, logo-less,
# unstyled screenshot — and the screenshot's whole job is to be a good-looking
# visual reference (header logo visible). Instead we block only the invisible
# heavy stuff at the route level (fonts, media, analytics/ads) — see _screenshot_site.
_SHOT_BLOCK_TYPES = {"font", "media"}
_SHOT_BLOCK_URL_HINTS = (
    "google-analytics", "googletagmanager", "doubleclick", "facebook.net",
    "connect.facebook", "hotjar", "segment.io", "mixpanel", "amplitude",
    "fullstory", "intercom", "/gtag/", "/analytics", "adservice", "adsystem",
)
# Serialize screenshots process-wide: each headless-shell is ~375 MB, so running
# several concurrently (multiple resolves at once) could OOM the container. This
# lock caps it to ONE browser at a time — a resolve waiting for a screenshot just
# queues briefly. (Screenshots are short-lived, ~3 s, so the queue drains fast.)
_SCREENSHOT_LOCK = threading.Lock()


def _screenshot_site(url: str) -> Optional[bytes]:
    """Screenshot a site (desktop viewport so the header logo is visible) → JPEG
    bytes, or None. SSRF-guarded; best-effort. Serialized via _SCREENSHOT_LOCK so
    at most one Chromium runs at a time (memory cap). Sync — runs on the resolve
    worker thread. Browser/context/page are always torn down (finally)."""
    try:
        _assert_public_url(url)
    except Exception:
        return None
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        logger.info("[brand] playwright unavailable, skipping screenshot: %s", e)
        return None

    logger.info("[brand] screenshot: waiting for browser slot for %s", url)
    with _SCREENSHOT_LOCK:
        logger.info("[brand] screenshot: launching headless-shell for %s", url)
        pw = browser = context = page = None
        try:
            pw = sync_playwright().start()
            # chromium-headless-shell: Chrome's stripped headless build (lighter than
            # full chromium). We only screenshot public homepages — no full browser
            # or anti-bot tooling needed.
            browser = pw.chromium.launch(headless=True, channel="chromium-headless-shell", args=_PW_ARGS)
            context = browser.new_context(viewport={"width": 1280, "height": 800},
                                          user_agent=_UA_BROWSER)
            page = context.new_page()

            def _route(route, request):
                u = request.url.lower()
                if request.resource_type in _SHOT_BLOCK_TYPES or any(h in u for h in _SHOT_BLOCK_URL_HINTS):
                    route.abort()
                else:
                    route.continue_()
            page.route("**/*", _route)
            page.goto(url, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(1200)  # let the header/hero paint
            shot = page.screenshot(type="jpeg", quality=80,
                                   clip={"x": 0, "y": 0, "width": 1280, "height": 900})
            logger.info("[brand] screenshot: captured %s (%d bytes)", url, len(shot))
            return shot
        except Exception as e:
            logger.info("[brand] screenshot failed for %s: %s", url, e)
            return None
        finally:
            # tear down in order: page → context → browser → playwright, each best-
            # effort so one failure doesn't leak the rest.
            for closer in (page, context, browser):
                try:
                    if closer:
                        closer.close()
                except Exception:
                    pass
            try:
                if pw:
                    pw.stop()
            except Exception:
                pass


def _colors_from_screenshot(png_or_jpeg: bytes, top: int = 8) -> list[str]:
    """Exact dominant colors from a site screenshot's PIXELS (colorthief). Returns
    up to `top` hexes, background whites/near-blacks/greys filtered by
    _clean_palette. Precise (real pixels) — the LLM later judges which are brand
    colors vs incidental. Best-effort → [] on failure."""
    try:
        from colorthief import ColorThief  # type: ignore[import-untyped]
        pal = ColorThief(io.BytesIO(png_or_jpeg)).get_palette(color_count=10, quality=5)
        hexes = ["#%02x%02x%02x" % rgb for rgb in pal]
        return _clean_palette(hexes)[:top]
    except Exception as e:
        logger.debug("[brand] screenshot color sample failed: %s", e)
        return []


def _as_int(v: Any) -> int:
    try:
        return int(v)
    except Exception:
        return 0


def _fetch_raster(url: str) -> Optional["ImageType"]:
    """Download a URL and open it as an RGBA PIL image, or None. SVGs are skipped
    here (no native rasterizer); the caller uses the DDG thumbnail for those."""
    from PIL import Image  # type: ignore[import-untyped]

    if not url or url.startswith("data:image/svg") or url.lower().endswith(".svg"):
        return None
    try:
        r = _http_get(url, binary=True)
        img = Image.open(io.BytesIO(r.content))
        return img.convert("RGBA")
    except Exception:
        return None


if TYPE_CHECKING:
    from PIL.Image import Image as ImageType


def _compose_contact_sheet(cells: list["ImageType"], labels: Optional[list[str]] = None,
                           cols: int = 4, tile: int = 150) -> "ImageType":
    """Grid of numbered candidate logos, each on a split light/dark tile (so both
    white- and dark-text logos are visible) with a PROVENANCE caption underneath
    (#n + where it came from). This is the exact image sent to the grader, so its
    caption doubles as debug output. Returns one PNG image."""
    from PIL import Image, ImageDraw  # type: ignore[import-untyped]

    rows = (len(cells) + cols - 1) // cols
    pad, label_h = 8, 28  # taller label strip for the provenance caption
    cw, ch = tile + pad * 2, tile + pad * 2 + label_h
    sheet = Image.new("RGB", (cols * cw, rows * ch), (245, 245, 247))
    draw = ImageDraw.Draw(sheet)
    for i, cell in enumerate(cells):
        r, c = divmod(i, cols)
        x0, y0 = c * cw, r * ch
        draw.rectangle([x0 + pad, y0 + pad, x0 + pad + tile // 2, y0 + pad + tile], fill=(255, 255, 255))
        draw.rectangle([x0 + pad + tile // 2, y0 + pad, x0 + pad + tile, y0 + pad + tile], fill=(0, 0, 0))
        logo = cell.copy()
        logo.thumbnail((tile - 8, tile - 8))
        lx = x0 + pad + (tile - logo.width) // 2
        ly = y0 + pad + (tile - logo.height) // 2
        sheet.paste(logo, (lx, ly), logo)
        cap = f"#{i + 1}"
        if labels and i < len(labels) and labels[i]:
            cap += f" {labels[i]}"
        draw.text((x0 + pad + 1, y0 + pad + tile + 3), cap[:46], fill=(20, 20, 20))
    return sheet


def _gather_logo_images(run: BrandRun, context: str = "",
                        search_phrase: str = "") -> list[dict[str, Any]]:
    """Collect logo image candidates from DDG image search + site-crawl.
    DISAMBIGUATE the query for common names: leading with the domain slug (e.g.
    'linear.app' / 'linear app') and a category keyword from `context` pulls the
    RIGHT brand's logo to the top — plain '<name> logo' returns the most-indexed
    same-named company, often the wrong one. Returns [{image, thumbnail, page,
    source, is_svg, raster}]; rasters feed the contact sheet, `image` is delivered."""
    brand = run.name
    # domain-anchored disambiguators (strongest signal): "linear.app", "linear app"
    dom_slug = ""
    if run.domain:
        dom_slug = run.domain
        base = run.domain.split(".")[0]
        spaced = f"{base} {run.domain.split('.')[-1]}"  # "linear app"
    # a short category hint pulled from the agent's context (first few words)
    hint = " ".join(re.findall(r"[A-Za-z]+", context))[:40].strip()

    # i.js returns a clean index, so a few well-aimed queries suffice. Lead with
    # the agent's disambiguated phrase, then domain-anchored (disambiguates common
    # names), then plain variants for coverage. (No site: operators — the image
    # API ignores them.)
    queries: list[str] = []
    if search_phrase.strip():
        queries.append(search_phrase.strip())
    if dom_slug:
        queries += [f'{dom_slug} logo', f'{spaced} logo']
    if hint:
        queries.append(f'{brand} {hint} logo')
    queries += [f'{brand} logo transparent', f'{brand} logo svg']
    queries = list(dict.fromkeys(queries))  # dedupe, keep order

    seen_img: set[str] = set()
    raw: list[dict[str, Any]] = []
    # image-search results
    for q in queries:
        for r in _ddg_images(q, n=8):
            if r["image"] in seen_img:
                continue
            seen_img.add(r["image"])
            raw.append({**r, "source": "image-search"})
        if len(raw) >= 20:
            break
    # site-crawl candidates (evidence too — often the clean SVG from the site)
    for c in run.logo_candidates:
        u = c["url"]
        if u not in seen_img:
            seen_img.add(u)
            raw.append({"image": u, "thumbnail": u, "page": c.get("page", ""),
                        "title": c.get("source", ""), "source": c.get("source", "site"),
                        "w": 0, "h": 0})

    # materialize rasters for the contact sheet (thumbnail for svg/unfetchable).
    # Skip images whose SEARCH dims scream 'screenshot/photo' — logos are small,
    # roughly square-to-wide marks, not 1400×900 dashboards or tall posters.
    cands: list[dict[str, Any]] = []
    for r in raw:
        w, h = r.get("w") or 0, r.get("h") or 0
        if w and h:
            if w >= 1000 and h >= 700:
                continue  # big → UI screenshot / hero image
            asp = w / h if h else 0
            if asp and (asp > 8 or asp < 0.2):
                continue  # extreme banner/strip
        is_svg = r["image"].lower().endswith(".svg") or r["image"].startswith("data:image/svg")
        raster = None if is_svg else (_fetch_raster(r["image"]) or _fetch_raster(r["thumbnail"]))
        if raster is None and is_svg:
            raster = _fetch_raster(r["thumbnail"])  # DDG's raster preview of the svg
        if raster is None:
            continue
        cands.append({**r, "is_svg": is_svg, "raster": raster})
        if len(cands) >= 12:
            break
    return cands


def _validate_logo_image(run: BrandRun, llm: "LLMService", data: bytes,
                         ct: Optional[str], context: str = "") -> dict[str, Any]:
    """Show a single image to the vision model and ask: is this actually THIS
    company's logo? Returns {is_logo: bool, what: str}. Used to gate choose_logo /
    fallbacks so nothing commits a non-logo (e.g. a person illustration off a CDN)
    unseen. SVGs are checked via their rasterization if we have one, else skipped
    (can't rasterize → trust the agent)."""
    import base64 as _b64

    from PIL import Image  # type: ignore[import-untyped]
    from .llm_service import ModelSize

    if ct and "svg" in ct:
        return {"is_logo": True, "what": "svg (not vision-checked)"}
    try:
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        # flatten onto white so transparent logos are visible
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        buf = io.BytesIO()
        bg.convert("RGB").save(buf, "PNG")
        b64 = _b64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as e:
        return {"is_logo": True, "what": f"unrenderable ({e}); not checked"}

    q = (f"Is this image the actual brand LOGO/wordmark of the company '{run.name}'"
         + (f" ({run.domain})" if run.domain else "") + "? "
         + (f"Context: {context}. " if context else "")
         + "A logo is a compact brand mark or wordmark — NOT a product screenshot, a "
         "photo, a person/illustration, an icon of something generic, or another "
         "company's logo. Return JSON {is_logo: bool, what: '<what the image "
         "actually shows in a few words>'}.")
    try:
        raw = llm.chat_vision([
            {"type": "text", "text": q},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ], size=ModelSize.MINI, json_output=True, max_tokens=120)
        out = json.loads(raw)
        return {"is_logo": bool(out.get("is_logo")), "what": out.get("what", "")}
    except Exception as e:
        logger.warning("[brand:%s]   logo validate error: %s", run.name, e)
        return {"is_logo": True, "what": f"validation failed ({e}); not checked"}


def _pick_logo_by_sight(run: BrandRun, llm: "LLMService", context: str = "",
                        search_phrase: str = "") -> Optional[dict[str, Any]]:
    """Gather candidate logo images, build a contact sheet, and have a MULTIMODAL
    model pick the real logo by looking. `context` disambiguates same-named
    companies; `search_phrase` is the agent's lead image-search query. Commits
    run.chosen_logo. Returns {committed, rationale, shortlist, considered} or None."""
    import base64 as _b64

    from .llm_service import ModelSize

    cands = _gather_logo_images(run, context=context, search_phrase=search_phrase)
    if not cands:
        return {"committed": None, "rationale": "no logo images could be gathered", "shortlist": []}

    def _from_official(c: dict[str, Any]) -> bool:
        if not run.domain:
            return False
        d = _domain_of(c.get("page") or c["image"])
        return run.domain in d or d in run.domain

    # PROVENANCE per cell: format + where it came from (search backend / site
    # crawl) + host domain + official flag. Drawn UNDER each tile in the grading
    # image AND kept as a structured legend for the debug/review output.
    def _img_type(c: dict[str, Any]) -> str:
        if c["is_svg"]:
            return "svg"
        u = c["image"].lower().split("?")[0]
        for ext in ("png", "jpeg", "jpg", "webp", "gif", "avif"):
            if u.endswith("." + ext):
                return "jpg" if ext == "jpeg" else ext
        # fall back to the PIL raster's format if the URL has no extension
        fmt = getattr(c.get("raster"), "format", None)
        return (fmt or "img").lower()

    provenance = []
    for i, c in enumerate(cands):
        host = _domain_of(c.get("page") or c["image"])
        prov = {"n": i + 1, "type": _img_type(c), "source": c.get("source", "?"),
                "host": host, "official": _from_official(c),
                "backend": c.get("backend"), "image": c["image"]}
        provenance.append(prov)
    run.logo_provenance = provenance
    sheet_labels = [f"{p['type']} · {p['host'] or p['source']}"
                    + (" ★off" if p["official"] else "") for p in provenance]

    sheet = _compose_contact_sheet([c["raster"] for c in cands], labels=sheet_labels, tile=210)
    buf = io.BytesIO()
    sheet.save(buf, "PNG")
    sheet_b64 = _b64.b64encode(buf.getvalue()).decode("ascii")
    run.logo_sheet_png = buf.getvalue()  # for the review file

    # Screenshot the official site once — a REFERENCE the model uses to recognize
    # the real logo (it's visible in the site header), plus brand context returned
    # on the result. Best-effort.
    if run.official_site and not run._shot_tried:
        run._shot_tried = True
        run.site_screenshot = _screenshot_site(run.official_site)
        run.trace("tool", tool="screenshot_site", args={"url": run.official_site},
                  summary={"captured": bool(run.site_screenshot)})
        # Pixel-sample the screenshot for EXACT dominant colors (colorthief reads
        # real pixels — precise, unlike asking the model to name hex). These join
        # the color evidence tagged "screenshot"; the agent still decides which are
        # brand colors (the screenshot itself is in the vision call for that).
        if run.site_screenshot:
            for hx in _colors_from_screenshot(run.site_screenshot):
                run.vote_color(hx, "screenshot")
    shot_b64 = _b64.b64encode(run.site_screenshot).decode("ascii") if run.site_screenshot else None

    legend = "\n".join(
        f"#{p['n']}: {p['type'].upper()} from {p['host'] or p['source']}"
        for p in provenance
    )
    prompt = (
        f"This contact sheet shows candidate LOGOS for the company '{run.name}'"
        + (f", whose official site is {run.domain}" if run.domain else "")
        + ". Each numbered cell shows one candidate on a split white/black "
        "background.\n\n"
        + (f"WHICH COMPANY THIS IS: {context}\n"
           "Some cells may be the logo of a DIFFERENT company that shares this "
           "name — reject those.\n\n" if context else "")
        + legend + "\n\n"
        + ("A SECOND image is provided: a SCREENSHOT of the company's homepage — "
           "use it to help recognize what the brand actually looks like. NOTE the "
           "screenshot can be imperfect (cookie banners, partial render, wrong "
           "region, missing header) — treat it as a helpful hint, not absolute "
           "truth. Reason it through: cross-check it against the candidates and "
           "pick the most coherent, consistent answer.\n\n" if shot_b64 else "")
        + "Pick the cell showing the REAL, CURRENT, PRIMARY logo/wordmark of THIS "
        "specific company. Guidance:\n"
        "- Each cell's caption says where it came from (file type + host) — that's "
        "context; judge each candidate on what it actually shows.\n"
        "- Reject logos of other same-named companies, random icons, screenshots, "
        "broken/cropped images, or unrelated art.\n"
        "- Prefer the full wordmark (name in the brand typeface, with symbol if "
        "present) over a bare app-icon, unless the brand's primary mark IS the icon.\n"
        "- If the SAME logo recurs across cells, that's a strong signal it's correct.\n"
        "- Prefer a clean, complete rendering that looks good on BOTH backgrounds. "
        "The caption also gives each cell's file type: prefer SVG (crisp vector), "
        "then PNG (usually transparent); a JPG can't be transparent so it's often a "
        "lower-quality grab — fine only if it's clearly the right logo.\n"
        "CRITICAL — many sheets contain NO real logo (app/dashboard SCREENSHOTS, "
        "product UI, photos, unrelated art, or only other companies' logos). A logo "
        "is a compact brand mark/wordmark, NOT a screenshot of a product or a photo. "
        "If NO cell is a genuine logo of THIS company, set best=null — do NOT force "
        "a pick or call a screenshot a wordmark.\n"
        "Return JSON: {best: <cell number, or null if none is a real logo of this "
        "company>, confidence: <0.0-1.0>, alternates: [<cells that are ALSO a valid "
        "logo of THIS company, e.g. the logomark-only version>], wrong_company: "
        "[<cells showing a DIFFERENT company's logo, a screenshot/UI, a photo, or "
        "junk>], rationale: <one or two sentences; why it's THIS company's logo, or "
        "why nothing qualifies>}."
    )
    try:
        content: list[dict[str, Any]] = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{sheet_b64}"}},
        ]
        if shot_b64:  # ground-truth reference: the real homepage
            content.append({"type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{shot_b64}"}})
        raw = llm.chat_vision(content, size=ModelSize.MINI, json_output=True, max_tokens=400)
        pick = json.loads(raw)
    except Exception as e:
        logger.warning("[brand:%s]   logo vision-pick error: %s", run.name, e)
        pick = {}

    wrong = {n for n in (pick.get("wrong_company") or []) if isinstance(n, int)}
    alt = {n for n in (pick.get("alternates") or []) if isinstance(n, int)}
    shortlist = [{"n": i + 1, "source": c["source"], "is_svg": c["is_svg"],
                  "image": c["image"], "page": c.get("page", ""),
                  "wrong_company": (i + 1) in wrong, "alternate": (i + 1) in alt}
                 for i, c in enumerate(cands)]
    # Prune wrong-company / junk cells from the candidates we KEEP (review grid +
    # any fallback), so a same-named other company's logo (e.g. OpenAI leaking
    # into 'Linear' results) never shows up as a candidate or gets fallen back to.
    cand_urls = {c["image"] for c in cands}
    keep_urls = {c["image"] for i, c in enumerate(cands) if (i + 1) not in wrong}
    # keep site-crawl candidates that weren't judged-wrong, and add the GOOD
    # image-search cells (best + alternates) so the review grid shows what was
    # actually judged — not stale site-crawl images.
    run.logo_candidates = [lc for lc in run.logo_candidates
                           if lc["url"] not in cand_urls or lc["url"] in keep_urls]
    existing = {lc["url"] for lc in run.logo_candidates}
    for i, c in enumerate(cands):
        n = i + 1
        if n in wrong or c["image"] in existing:
            continue
        # surface the pick + alternates (and other non-wrong) into the grid
        run.logo_candidates.append({"source": f"image-search", "url": c["image"],
                                    "page": c.get("page", "")})

    best_n = pick.get("best")
    conf = pick.get("confidence")
    rationale = pick.get("rationale", "")
    if wrong:
        rationale += f" [dropped {len(wrong)} wrong-company/junk cell(s)]"
    # Abstain rather than commit junk: no valid cell, or the model itself is
    # unconfident (it saw only screenshots/photos/other-brands). The agent can then
    # try again with better context or choose_logo manually.
    if not isinstance(best_n, int) or not (1 <= best_n <= len(cands)) or best_n in wrong:
        return {"committed": None, "shortlist": shortlist, "considered": len(cands),
                "rationale": rationale or "no cell is a real logo of this company"}
    if isinstance(conf, (int, float)) and conf < 0.5:
        return {"committed": None, "shortlist": shortlist, "considered": len(cands),
                "rationale": f"low confidence ({conf}): {rationale or 'no clear logo in candidates'}"}

    chosen = cands[best_n - 1]
    # SVG PREFERENCE: if the pick (or a recurrence of the same logo) has an SVG
    # version among candidates, deliver the SVG. Simple heuristic: if the chosen
    # isn't svg but any candidate from the SAME source domain is an svg, prefer it.
    deliver = chosen
    if not chosen["is_svg"]:
        same_dom = _domain_of(chosen.get("page") or chosen["image"])
        for c in cands:
            if c["is_svg"] and _domain_of(c.get("page") or c["image"]) == same_dom:
                deliver = c
                rationale += " [delivered SVG version from same source]"
                break

    data, ct = _download_cached(run, deliver["image"], deliver.get("page"))
    if not data:  # SVG or asset didn't download → fall back to the raster we saw
        data, ct = _download_cached(run, chosen["image"], chosen.get("page"))
        deliver = chosen
    if not data:
        return {"committed": None, "rationale": rationale or "picked cell wouldn't download",
                "shortlist": shortlist, "considered": len(cands)}

    run.chosen_logo = {"url": deliver["image"], "bytes": data, "ct": ct,
                       "source": deliver["source"], "page": deliver.get("page"),
                       "dims": _logo_dims(data, ct)}
    logger.info("[brand:%s]   find_logo → cell #%s (%s, %s)",
                run.name, best_n, deliver["source"], ct)

    # Tag each grid cell with the model's VERDICT so the review explains 12→N:
    # chosen / alternate / rejected(wrong-company or junk) / candidate.
    for p in run.logo_provenance:
        n = p["n"]
        p["verdict"] = ("chosen" if n == best_n else "rejected" if n in wrong
                        else "alternate" if n in alt else "candidate")

    # Build the REVIEW logo list from the EXACT graded cells (minus wrong-company),
    # so 'what the human reviews' == 'what the model saw' — same set, same order,
    # chosen flagged. (Replaces the old _collect_logo_candidates rebuild that mixed
    # in un-graded site-crawl images.)
    from ..models import BrandLogoCandidate
    import base64 as _bb
    review: list["BrandLogoCandidate"] = []
    for i, c in enumerate(cands):
        n = i + 1
        if n in wrong:
            continue
        rbuf = io.BytesIO()
        c["raster"].convert("RGBA").save(rbuf, "PNG")
        review.append(BrandLogoCandidate(
            source=c["source"], url=(c["image"] if c["image"].startswith("http") else f"(inline {c['source']})"),
            data_url="data:image/png;base64," + _bb.b64encode(rbuf.getvalue()).decode("ascii"),
            content_type=("image/svg+xml" if c["is_svg"] else "image/png"),
            chosen=(n == best_n), dims=_logo_dims(data, ct) if n == best_n else None,
        ))
    run.review_logos = review

    committed = {"cell": best_n, "source": deliver["source"], "content_type": ct,
                 "is_svg": deliver["is_svg"], "image": deliver["image"]}
    return {"committed": committed, "rationale": rationale, "shortlist": shortlist,
            "considered": len(cands)}


# ---------------------------------------------------------------------------
# Pre-trim: reduce a raw HTML page to the bits worth sending to the extractor
# LLM (head meta, header/nav, visible text, and any inline color/logo hints).
# Keeps token cost bounded and focuses the model.
# ---------------------------------------------------------------------------
def _trim_html_for_llm(html: str, base: str, *, max_chars: int = 6000) -> dict[str, Any]:
    """Return {meta, headings, links, imgs, svgs, inline_colors, text} distilled
    from a page — small enough to feed an LLM. `imgs`/`svgs`/`links` are absolute
    URLs; `inline_colors` are hex/rgb found in inline <style>/style= attrs."""
    from selectolax.parser import HTMLParser

    tree = HTMLParser(html)
    meta: dict[str, str] = {}
    _t = tree.css_first("title")
    if _t:
        meta["title"] = (_t.text() or "").strip()[:200]
    for prop in ("og:site_name", "og:title", "og:image", "application-name"):
        n = tree.css_first(f'meta[property="{prop}"]') or tree.css_first(f'meta[name="{prop}"]')
        content = n.attributes.get("content") if n else None
        if content:
            meta[prop] = content.strip()[:200]

    # JSON-LD Organization.logo (declared logo — strong candidate)
    for s in tree.css('script[type="application/ld+json"]'):
        txt = s.text() or ""
        m = re.search(r'"logo"\s*:\s*"([^"]+)"', txt) or re.search(
            r'"logo"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"', txt)
        if m:
            meta["jsonld_logo"] = urljoin(base, m.group(1))
            break

    # icon / apple-touch-icon
    for rel in ("apple-touch-icon", "icon"):
        n = tree.css_first(f'link[rel="{rel}"]')
        if n and n.attributes.get("href"):
            meta.setdefault("icon", urljoin(base, n.attributes["href"]))
            break

    # Colors from inline <style> + style= attributes
    inline_style = " ".join(s.text() or "" for s in tree.css("style"))
    inline_style += " ".join(n.attributes.get("style", "") or "" for n in tree.css("[style]"))
    inline_colors = _harvest_colors(inline_style, limit=30)
    # CSS custom props that look brand-ish (name → value), higher signal
    for m in re.finditer(r"(--[\w-]*(?:brand|primary|accent|color)[\w-]*)\s*:\s*([^;}\n]+)", inline_style, re.I):
        h = _to_hex(m.group(2).strip())
        if h and h not in inline_colors:
            inline_colors.append(h)

    # Header/nav <img> logo candidates (absolute URLs)
    imgs: list[str] = []
    for scope in ("header", "nav", "[class*=header]", "[class*=nav]", "a[href='/']"):
        for img in tree.css(f"{scope} img[src]"):
            u = urljoin(base, img.attributes.get("src", ""))
            if u and u not in imgs:
                imgs.append(u)
    if meta.get("og:image"):
        imgs.append(meta["og:image"])

    # Inline <svg> logos → data URLs (skip css-var/currentColor ones: invisible)
    svgs: list[str] = []
    for svg in tree.css("header svg, nav svg, svg[class*=logo], a[href='/'] svg"):
        markup = svg.html or ""
        if not markup or len(markup) < 80 or len(markup) > 200_000:
            continue
        if _svg_uses_css_vars(markup):
            continue  # unrenderable standalone
        sw = _svg_dim(svg.attributes.get("width"))
        sh = _svg_dim(svg.attributes.get("height"))
        if sw and sh and sw <= 48 and sh <= 48 and abs(sw - sh) <= 8:
            continue  # tiny square icon
        svgs.append("data:image/svg+xml;base64," + base64.b64encode(markup.encode("utf-8")).decode("ascii"))
        if len(svgs) >= 3:
            break

    # Stylesheet URLs (for the agent to follow with fetch_css)
    links: list[str] = []
    for link in tree.css('link[rel="stylesheet"][href]'):
        links.append(urljoin(base, link.attributes["href"]))
    # A few navigational links (brand/press/about) for the agent to explore
    nav_links: list[str] = []
    for a in tree.css("a[href]"):
        href = (a.attributes.get("href") or "").lower()
        if any(k in href for k in ("brand", "press", "media", "about", "logo")):
            nav_links.append(urljoin(base, a.attributes["href"]))

    # Visible text (bounded)
    for tag in tree.css("script, style, noscript, svg"):
        tag.decompose()
    parts: list[str] = []
    for sel in ("h1", "h2", "img[alt]", "nav a", "header a", "p"):
        for n in tree.css(sel):
            t = (n.attributes.get("alt") if sel.endswith("[alt]") else n.text()) or ""
            t = t.strip()
            if t and len(t) < 200:
                parts.append(t)
    text = "\n".join(dict.fromkeys(parts))[:max_chars]

    return {
        "meta": meta,
        "stylesheets": list(dict.fromkeys(links))[:8],
        "brand_links": list(dict.fromkeys(nav_links))[:8],
        "img_candidates": list(dict.fromkeys(imgs))[:12],
        "svg_candidates": svgs,
        "inline_colors": inline_colors[:24],
        "text": text,
    }


# ---------------------------------------------------------------------------
# The @function_tool set. Bound to a BrandRun + an LLMService (the tools use the
# MINI model to EXTRACT structured info from messy pages/snippets). Closures
# over `run` + `llm` in _run_agent.
# ---------------------------------------------------------------------------
def _build_tools(run: BrandRun, llm: "LLMService"):
    from agents import function_tool
    from .llm_service import ModelSize

    def _ddg(query: str, n: int = 6) -> list[dict]:
        # EXACT-query cache (survives restarts): re-running the eval loop hits the
        # same queries repeatedly, and DDG is rate-limit-fragile. Keyed on the
        # exact (query, n) so changing the query naturally busts it.
        ckey = f"{n}|{query}"
        cached = _search_cache_get(ckey)
        if cached is not None:
            run.trace("tool", tool="_ddg", args={"query": query, "n": n},
                      summary={"cached": True, "results": len(cached)})
            return cached
        try:
            from ddgs import DDGS
            rows = DDGS().text(query, max_results=n)
            out = [{"title": r.get("title"), "url": r.get("href") or r.get("url"),
                    "snippet": r.get("body")} for r in rows]
            _search_cache_put(ckey, out)
            run.trace("tool", tool="_ddg", args={"query": query, "n": n},
                      summary={"cached": False, "results": len(out)})
            return out
        except Exception as e:
            run.warn(f"search failed ({type(e).__name__}) — degraded")
            logger.warning("[brand:%s]   ddg error for %r: %s", run.name, query, e)
            run.trace("tool", tool="_ddg", args={"query": query}, detail=f"error: {e}")
            return []

    @function_tool
    def find_official_site(query: str) -> list[dict]:
        """Web-search to FIND the company's official website. `query` should be
        something like '<company> official website'. Returns up to 6 results as
        {title, url, snippet}. Pick the official site yourself (watch for brand
        collisions — a car brand vs an aerospace company share a name)."""
        logger.info("[brand:%s] TOOL find_official_site(%r)", run.name, query)
        out = _ddg(query)
        logger.info("[brand:%s]   → %d results: %s", run.name, len(out), [r.get("url") for r in out])
        return out

    @function_tool
    def search_brand_colors(name: str) -> dict:
        """Web-search for the company's BRAND COLOR PALETTE and have the extractor
        LLM read all the result snippets to pull out hex codes + which sources
        mention them. Runs several color-focused queries (brand palette, hex,
        brandcolorcode). Returns {colors: [{hex, sources:[domains], label}],
        pages_worth_opening: [urls]}. Colors are also VOTED internally (more
        independent sources = stronger). Aggregators like brandcolorcode.com,
        mobbin.com, colorarchive.org are good."""
        logger.info("[brand:%s] TOOL search_brand_colors(%r)", run.name, name)
        rows: list[dict] = []
        for q in (f"{name} brand color palette hex", f"{name} brand colors hex code",
                  f"{name} brandcolorcode"):
            rows += _ddg(q, n=5)
        # dedupe by url
        seen, uniq = set(), []
        for r in rows:
            if r["url"] and r["url"] not in seen:
                seen.add(r["url"])
                uniq.append(r)
        blob = "\n".join(f"[{_domain_of(r['url'] or '')}] {r['title']}: {r['snippet']}" for r in uniq)[:6000]
        # Deterministic vote of any hex already visible in snippets
        for r in uniq:
            dom = _domain_of(r["url"] or "")
            for h in _harvest_colors(f"{r.get('title','')} {r.get('snippet','')}"):
                run.vote_color(h, f"snippet:{dom}")
        # LLM extraction over all snippets
        colors: list[dict] = []
        try:
            data = llm.chat_json(
                f"Company: {name}\n\nSearch result snippets about its brand colors:\n{blob}\n\n"
                "Extract the company's BRAND color palette. Return a JSON object with a "
                "'colors' array; each item has: hex (#rrggbb), label (primary/accent/etc), "
                "sources (array of the domains that mentioned it). Only real brand colors "
                "(ignore generic UI greys unless clearly brand). Prefer colors mentioned "
                "by multiple sources.",
                size=ModelSize.MINI, max_tokens=700,
            )
            colors = data.get("colors", []) if isinstance(data, dict) else []
            for c in colors:
                hx = c.get("hex", "") if isinstance(c, dict) else (c if isinstance(c, str) else "")
                vh = run.vote_color(hx, "extractor")
                if vh and isinstance(c, dict):
                    c["hex"] = vh
        except Exception as e:
            logger.warning("[brand:%s]   color-extract LLM error: %s", run.name, e)
        pages = [r["url"] for r in uniq if any(
            a in (r["url"] or "") for a in ("brandcolorcode", "mobbin", "colorarchive",
                                            "schemecolor", "loftlyy", "icolorpalette"))][:4]
        logger.info("[brand:%s]   → %d extracted colors, %d votes so far, %d pages",
                    run.name, len(colors), len(run.color_votes), len(pages))
        run.trace("tool", tool="search_brand_colors", args={"name": name},
                  summary={"extracted": [c.get("hex") for c in colors],
                           "total_votes": len(run.color_votes),
                           "pages_worth_opening": pages})
        return {"colors": colors, "pages_worth_opening": pages}

    @function_tool
    def search_brand_logo(name: str) -> list[dict]:
        """Web-search for the company's LOGO (svg/png). Returns up to 6 results as
        {title, url, snippet} — official brand/press pages and logo repositories.
        Open the promising ones with fetch_page, then choose_logo the best asset."""
        logger.info("[brand:%s] TOOL search_brand_logo(%r)", run.name, name)
        rows = _ddg(f"{name} logo svg download brand assets", n=6)
        logger.info("[brand:%s]   → %d results", run.name, len(rows))
        return rows

    @function_tool
    def fetch_page(url: str) -> dict:
        """Fetch a web page, pre-trim it, and have the extractor LLM summarize it
        for brand purposes. Returns {final_url, is_official_guess, company_match,
        logo_candidates:[{url,note}], colors:[hex], stylesheets:[url],
        brand_links:[url], notes}. Use on the official site AND aggregator/brand
        pages. Follow `stylesheets` with fetch_css and `brand_links` for more."""
        logger.info("[brand:%s] TOOL fetch_page(%r)", run.name, url)
        try:
            r = _http_get(url)
            base = str(r.url)
            distilled = _trim_html_for_llm(r.text[:_MAX_HTML_BYTES], base)
        except Exception as e:
            logger.warning("[brand:%s]   fetch_page error: %s", run.name, e)
            return {"final_url": url, "error": str(e)}

        # Record raw signals into the run (so code can render candidates / fallback)
        page_dom = _domain_of(base)
        for u in distilled["img_candidates"]:
            run.logo_candidates.append({"source": "header-img", "url": u, "page": base})
        for u in distilled["svg_candidates"]:
            run.logo_candidates.append({"source": "inline-svg", "url": u, "page": base})
        if distilled["meta"].get("jsonld_logo"):
            run.logo_candidates.append({"source": "jsonld", "url": distilled["meta"]["jsonld_logo"], "page": base})
        if distilled["meta"].get("og:image"):
            run.logo_candidates.append({"source": "og:image", "url": distilled["meta"]["og:image"], "page": base})
        if distilled["meta"].get("icon"):
            run.logo_candidates.append({"source": "favicon", "url": distilled["meta"]["icon"], "page": base})
        for h in distilled["inline_colors"]:
            run.vote_color(h, f"page:{page_dom}")

        # LLM read of the distilled page. Replace inline-svg data URLs (huge) with
        # short refs so the model doesn't burn tokens echoing them; map back after.
        svg_refs = {f"inline-svg-{i}": u for i, u in enumerate(distilled["svg_candidates"])}
        for_llm = {**distilled, "svg_candidates": list(svg_refs.keys())}
        summary: dict[str, Any] = {}
        try:
            summary = llm.chat_json(
                f"We are researching the brand of: {run.name}\nPage URL: {base}\n\n"
                f"Distilled page data (JSON):\n{json.dumps(for_llm)[:6000]}\n\n"
                "READ this page and report what it tells us about this company's "
                "brand, as evidence for a human/agent to weigh. Return a JSON object:\n"
                "- finding (string): 1-3 sentences describing what THIS page is and "
                "what it says about the brand's logo/colors that's relevant. If the "
                "page explicitly declares an official palette (e.g. a brand-guidelines "
                "page: 'our primary colors are Lava #FF3621, Navy #0B2026…'), say so "
                "and quote the names+hexes. If it's just a third-party/aggregator or "
                "the colors are only inferred from styling, say that too.\n"
                "- is_official (boolean): is this the company's OWN site/brand page "
                "(not a third-party aggregator)?\n"
                "- declares_palette (boolean): does the page EXPLICITLY state these "
                "are the brand's colors (vs colors merely appearing in the design)?\n"
                "- colors (array of {hex:'#rrggbb', name?:'Lava 600', role?:'primary/"
                "secondary/accent/neutral'}): the brand colors this page evidences. "
                "Include declared neutrals/off-whites if the page lists them as brand "
                "colors — do NOT drop them.\n"
                "- logo_candidates (array of {url, note}): urls from img/svg/meta that "
                "look like the real logo (skip favicons/social cards).\n"
                "Be honest and specific; this is evidence, not a final answer.",
                size=ModelSize.MINI, max_tokens=1100,
            )
        except Exception as e:
            logger.warning("[brand:%s]   fetch_page LLM error: %s", run.name, e)

        is_official = bool(summary.get("is_official"))
        declares = bool(summary.get("declares_palette"))
        # Record color evidence, tagged with authority so the agent can weigh it:
        # a color DECLARED on the OFFICIAL brand page is far stronger than one
        # merely seen on an aggregator or inferred from CSS.
        page_colors: list[dict[str, Any]] = []
        for c in (summary.get("colors") or []):
            hx = c.get("hex") if isinstance(c, dict) else c
            vh = run.vote_color(hx or "", f"page:{page_dom}")
            if vh:
                if is_official and declares:
                    run.vote_color(vh, "official-declared")
                item = {"hex": vh}
                if isinstance(c, dict):
                    if c.get("name"):
                        item["name"] = c["name"]
                    if c.get("role"):
                        item["role"] = c["role"]
                page_colors.append(item)
        if is_official and not run.official_site:
            run.official_site = base
            run.domain = page_dom

        # Map any svg refs the model returned back to their real data URLs.
        llm_logos = summary.get("logo_candidates") or []
        for lc in llm_logos:
            if isinstance(lc, dict) and lc.get("url") in svg_refs:
                lc["url"] = svg_refs[lc["url"]]

        finding = summary.get("finding") or ""
        out = {
            "final_url": base,
            "finding": finding,
            "is_official": is_official,
            "declares_palette": declares,
            "colors": page_colors,
            "logo_candidates": llm_logos or [
                {"url": u, "note": "header/nav image"} for u in distilled["img_candidates"][:6]
            ],
            "stylesheets": distilled["stylesheets"],
            "brand_links": distilled["brand_links"],
        }
        logger.info("[brand:%s]   → official=%s declares=%s %d colors %d logos: %s",
                    run.name, is_official, declares, len(page_colors),
                    len(out["logo_candidates"]), finding[:80])
        run.trace("tool", tool="fetch_page", args={"url": url},
                  summary={"final_url": base, "is_official": is_official,
                           "declares_palette": declares, "colors": [c["hex"] for c in page_colors],
                           "n_logo_candidates": len(out["logo_candidates"])},
                  reasoning=finding or None)
        return out

    @function_tool
    def fetch_css(url: str) -> dict:
        """Fetch a CSS stylesheet and extract brand colors from it — the REAL site
        colors usually live here (not inline). Regexes hex/rgb + --brand/--primary/
        --accent vars, then the extractor LLM picks the brand-defining ones.
        Returns {colors: [hex], brand_vars: {name: hex}}. Votes them internally."""
        logger.info("[brand:%s] TOOL fetch_css(%r)", run.name, url)
        try:
            r = _http_get(url)
            css = r.text[:_MAX_HTML_BYTES]
        except Exception as e:
            logger.warning("[brand:%s]   fetch_css error: %s", run.name, e)
            return {"error": str(e), "colors": [], "brand_vars": {}}
        dom = _domain_of(str(r.url))
        # brand-ish custom properties (highest signal)
        brand_vars: dict[str, str] = {}
        for m in re.finditer(r"(--[\w-]*(?:brand|primary|accent|color|theme)[\w-]*)\s*:\s*([^;}\n]+)", css, re.I):
            h = _to_hex(m.group(2).strip())
            if h:
                brand_vars[m.group(1)] = h
                run.vote_color(h, f"css:{dom}")
        all_colors = _harvest_colors(css, limit=60)
        # LLM trims to the brand-defining ones
        colors = all_colors[:12]
        try:
            data = llm.chat_json(
                f"Company: {run.name}. From this stylesheet's colors, pick the BRAND "
                f"palette (ignore generic greys/utility colors).\nBrand-named vars: "
                f"{json.dumps(brand_vars)}\nAll colors (first appearance order): "
                f"{json.dumps(all_colors[:40])}\n\nReturn a JSON object with a 'colors' "
                "array of #rrggbb strings, ordered primary-first, max 6.",
                size=ModelSize.MINI, max_tokens=300,
            )
            picked = data.get("colors", []) if isinstance(data, dict) else []
            for h in picked:
                v = run.vote_color(h, f"css:{dom}")
                if v:
                    colors = picked
        except Exception as e:
            logger.warning("[brand:%s]   fetch_css LLM error: %s", run.name, e)
        logger.info("[brand:%s]   → %d css colors, %d brand vars", run.name, len(colors), len(brand_vars))
        run.trace("tool", tool="fetch_css", args={"url": url},
                  summary={"colors": colors, "brand_vars": brand_vars})
        return {"colors": colors, "brand_vars": brand_vars}

    @function_tool
    def color_votes() -> dict:
        """The color EVIDENCE gathered so far, for you to weigh before set_palette.
        Each entry: {hex, official_declared (was it explicitly declared on the
        company's OWN brand page — the strongest signal), n_sources (independent
        sources that showed it), sources}. Ranked official-declared first, then by
        cross-source agreement. Use judgment — declared-official beats a color seen
        on many aggregators."""
        def key(kv):
            official = "official-declared" in kv[1]
            return (0 if official else 1, -len({s.split(":")[0] for s in kv[1]}), kv[0])
        ranked = sorted(run.color_votes.items(), key=key)
        logger.info("[brand:%s] TOOL color_votes → %d colors", run.name, len(ranked))
        return {"colors": [
            {"hex": h, "official_declared": "official-declared" in s,
             "n_sources": len({x.split(":")[0] for x in s}), "sources": sorted(s)}
            for h, s in ranked]}

    @function_tool
    def find_logo(context: str = "", search_phrase: str = "") -> dict:
        """Find the company's real logo BY LOOKING at it. Image-searches, gathers
        candidates + site-crawl images, builds a contact sheet, and a multimodal
        model VIEWS them and picks the real primary logo (favouring a clean vector,
        noting recurrence). Commits the pick. Call once you know the official domain.

        `search_phrase`: the image-search query to lead with — WRITE A SPECIFIC,
        DISAMBIGUATED phrase for common names so the RIGHT brand's logo surfaces
        (plain '<name> logo' returns the most-indexed same-named company, often
        wrong). Good: 'linear.app issue tracking software logo', 'Ramp corporate
        card fintech logo ramp.com'. Include the domain + what the company does.

        `context`: describe WHICH company this is so the vision model rejects
        same-named others (e.g. 'Linear = software at linear.app, NOT the
        electronics brand'). Pass what you learned from the official page.

        Returns the committed logo + rationale + shortlist. If you disagree,
        choose_logo(url) with a specific candidate."""
        logger.info("[brand:%s] TOOL find_logo(phrase=%r, context=%r)",
                    run.name, search_phrase[:50], context[:50])
        pick = _pick_logo_by_sight(run, llm, context=context, search_phrase=search_phrase)
        if not pick or not pick.get("committed"):
            run.trace("decision", tool="find_logo", summary={"committed": None},
                      reasoning=(pick or {}).get("rationale"))
            return {"committed": None,
                    "reason": (pick or {}).get("rationale") or "no usable logo image found",
                    "shortlist": (pick or {}).get("shortlist", [])}
        run.trace("decision", tool="find_logo",
                  summary={"committed": pick["committed"], "considered": pick.get("considered")},
                  reasoning=pick.get("rationale"))
        return {"committed": pick["committed"], "rationale": pick.get("rationale"),
                "shortlist": pick.get("shortlist", [])}

    @function_tool
    def choose_logo(logo_url: str, context: str = "") -> dict:
        """Manually commit a specific logo URL (override find_logo, or a URL you
        found). The image is VISUALLY VALIDATED — we download it and a vision model
        confirms it's actually THIS company's logo (not a screenshot, photo,
        illustration, or another brand). Rejected if it isn't. `context` helps the
        check for ambiguous names. Returns {ok, content_type, dims} or {ok:false,
        reason, what_it_actually_is}."""
        logger.info("[brand:%s] TOOL choose_logo(%r)", run.name, logo_url)
        page = next((c.get("page") for c in run.logo_candidates if c["url"] == logo_url), None)
        if not page:
            _p = urlparse(logo_url)
            page = f"{_p.scheme}://{_p.netloc}/" if _p.netloc else None
        data, ct = _download_cached(run, logo_url, page)
        if not data:
            run.trace("decision", tool="choose_logo", args={"url": logo_url},
                      summary={"ok": False}, reasoning="download failed")
            return {"ok": False, "reason": "could not download that URL — pick another"}
        if ct and "svg" in ct and _svg_uses_css_vars(data.decode("utf-8", "ignore")):
            return {"ok": False, "reason": "that SVG paints via CSS variables/currentColor — "
                    "it renders invisible standalone; pick another"}
        # VISUAL VALIDATION — don't commit blind (this is how a person-illustration
        # off Airbnb's CDN slipped through before).
        check = _validate_logo_image(run, llm, data, ct, context=context)
        if not check["is_logo"]:
            run.trace("decision", tool="choose_logo", args={"url": logo_url},
                      summary={"ok": False}, reasoning=f"vision rejected: {check['what']}")
            return {"ok": False, "reason": f"that image is not {run.name}'s logo — it "
                    f"looks like: {check['what']}. Pick the actual logo/wordmark.",
                    "what_it_actually_is": check["what"]}
        dims = _logo_dims(data, ct)
        src = next((c["source"] for c in run.logo_candidates if c["url"] == logo_url), "agent-picked")
        run.chosen_logo = {"url": logo_url, "bytes": data, "ct": ct, "source": src,
                           "page": page, "dims": dims}
        run.trace("decision", tool="choose_logo", args={"url": logo_url},
                  summary={"ok": True, "content_type": ct, "dims": dims, "validated": check["what"]})
        return {"ok": True, "content_type": ct, "dims": dims}

    @function_tool
    def set_official_site(domain_or_url: str, why: str) -> dict:
        """Assert the company's OFFICIAL domain when you're confident from search
        evidence — use this especially if fetch_page couldn't load the site (403/
        bot-wall) but the search results clearly identify it (e.g. notion.com /
        notion.so). Records the domain so the result isn't blank. `why` = your
        justification (goes in the trace)."""
        dom = _domain_of(domain_or_url if "://" in domain_or_url else f"https://{domain_or_url}")
        logger.info("[brand:%s] TOOL set_official_site(%s)", run.name, dom)
        if not dom:
            return {"ok": False, "reason": "could not parse a domain"}
        run.official_site = f"https://{dom}"
        run.domain = dom
        run.confidence = max(run.confidence, 0.7)
        run.trace("decision", tool="set_official_site", args={"domain": dom}, reasoning=why)
        return {"ok": True, "domain": dom}

    @function_tool
    def set_palette(hexes: list[str]) -> dict:
        """Commit the FINAL ordered brand palette (primary first), as #rrggbb
        strings — YOUR decision, weighing the evidence (official-declared colors
        from the brand page rank highest; then cross-source agreement via
        color_votes). Include the brand's real neutrals if the official palette
        lists them (e.g. an oat/cream off-white). We keep EXACTLY what you pass
        (only normalizing hex format + dropping exact duplicates) — so choose
        deliberately, typically 3–6 colors."""
        logger.info("[brand:%s] TOOL set_palette(%r)", run.name, hexes)
        seen, out = set(), []
        for h in hexes:
            if not isinstance(h, str):
                continue
            nh = _to_hex(h)
            if nh and nh not in seen:
                seen.add(nh)
                out.append(nh)
        run.chosen_palette = out
        run.trace("decision", tool="set_palette", args={"requested": hexes},
                  summary={"accepted": out})
        return {"palette": out}

    @function_tool
    def log_reasoning(step: str, why: str) -> dict:
        """Record WHY you did something (which site you judged official & why,
        which logo you picked over others & why, how you resolved conflicting
        colors, what was hard/ambiguous). These notes are saved to the trace and
        help humans debug + improve the system — be specific and honest, including
        when you're unsure. Call this at each real decision point."""
        run.log_reasoning(step, why)
        return {"logged": True}

    return [find_official_site, search_brand_colors, search_brand_logo, fetch_page,
            fetch_css, color_votes, set_official_site, find_logo, choose_logo,
            set_palette, log_reasoning]


# ---------------------------------------------------------------------------
# Deterministic logo pick + palette (run AFTER the agent, on collected signals).
# ---------------------------------------------------------------------------
_LOGO_RANK = {"jsonld": 0, "inline-svg": 1, "header-img": 2, "og:image": 3, "favicon": 4}


def _ranked_candidates(run: BrandRun) -> list[dict[str, Any]]:
    """Candidates deduped by url, ranked best→worst (code's RECOMMENDATION —
    the agent makes the final call). Icon-like URLs (favicons/app-icons/og cards)
    are demoted below real logos regardless of their nominal source, because a
    site's JSON-LD "logo" is frequently just the favicon."""
    seen: set[str] = set()
    uniq = []
    for c in run.logo_candidates:
        if c["url"] not in seen:
            seen.add(c["url"])
            uniq.append(c)
    def key(c: dict[str, Any]) -> tuple[int, int]:
        return (1 if _is_icon_like(c["url"]) else 0, _LOGO_RANK.get(c["source"], 9))
    return sorted(uniq, key=key)


def _download_logo(url: str, referer: str | None) -> tuple[Optional[bytes], Optional[str]]:
    """Download a logo URL → (bytes, content_type), or (None, None). Handles
    inline-svg `data:` URLs (decoded locally) as well as http(s)."""
    if url.startswith("data:"):
        try:
            header, _, payload = url.partition(",")
            ct = header[5:].split(";")[0] or "image/svg+xml"
            data = base64.b64decode(payload) if ";base64" in header else payload.encode("utf-8")
            return (data, ct) if data else (None, None)
        except Exception:
            return None, None
    try:
        r = _http_get(url, referer=referer, binary=True)
        data = r.content
        ct = r.headers.get("content-type", "").split(";")[0]
        if data and (ct.startswith("image/") or url.lower().endswith((".svg", ".png", ".jpg", ".jpeg", ".webp"))):
            return data, ct or None
    except Exception:
        pass
    return None, None


def _download_cached(run: BrandRun, url: str, referer: str | None) -> tuple[Optional[bytes], Optional[str]]:
    """_download_logo memoized per run (avoids re-fetching on retries/validation)."""
    if url in run.dl_cache:
        return run.dl_cache[url]
    res = _download_logo(url, referer)
    run.dl_cache[url] = res
    return res


def _validate_candidates(run: BrandRun) -> list[dict[str, Any]]:
    """Download the ranked logo candidates IN PARALLEL and keep the ones that
    actually render (drop dead URLs, css-var/invisible SVGs). Returns enriched
    candidates [{url, source, page, ct, dims, aspect}] best→worst, with icon-like
    and near-square demoted. This is the pre-validation that lets the agent pick a
    known-good logo in ONE shot instead of guessing + retrying."""
    from concurrent.futures import ThreadPoolExecutor

    ranked = _ranked_candidates(run)[:8]  # cap network work

    def _dl(c: dict[str, Any]) -> Optional[dict[str, Any]]:
        data, ct = _download_cached(run, c["url"], c.get("page"))
        if not data:
            return None
        if ct and "svg" in ct and _svg_uses_css_vars(data.decode("utf-8", "ignore")):
            return None
        dims = _logo_dims(data, ct)
        return {**c, "ct": ct, "dims": dims, "aspect": (dims or {}).get("aspect")}

    valid: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for res in ex.map(_dl, ranked):
            if res:
                valid.append(res)

    def quality(c: dict[str, Any]) -> int:
        """Higher = better logo. A rubric, not a black box — so the trace is
        legible. The dominant penalty is OG-card shape (~1200×630 social banners
        keep getting mislabeled as header images)."""
        ct = c.get("ct") or ""
        dims = c.get("dims") or {}
        w, h, asp = dims.get("w") or 0, dims.get("h") or 0, c.get("aspect") or 0
        s = 0
        # format
        if "svg" in ct:
            s += 30          # vector wordmark — ideal
        elif "png" in ct or "webp" in ct:
            s += 15          # transparent raster — fine
        elif "jpeg" in ct:
            s -= 30          # opaque photo/banner — almost never a logo
        # shape
        if _is_og_card_shape(w, h, asp):
            s -= 60          # 1200×630-ish social card — NOT a logo
        elif 1.8 <= asp <= 6.0:
            s += 25          # classic wide wordmark
        elif 1.3 <= asp < 1.8:
            s += 8           # lockup / squarish mark
        elif asp and asp < 1.1:
            s -= 10          # near-square → likely a glyph/icon
        # size sanity: real logos aren't tiny, aren't billboard-huge
        if w and (w < 24 or h < 12):
            s -= 20          # tiny fragment (e.g. 21×15)
        if w and w > 1000:
            s -= 15          # oversized → probably a banner/hero, not the mark
        # source / url
        if _is_icon_like(c["url"]):
            s -= 40
        s -= _LOGO_RANK.get(c["source"], 9)
        return s

    for c in valid:
        c["_q"] = quality(c)
    valid.sort(key=lambda c: c["_q"], reverse=True)
    return valid


def _is_og_card_shape(w: float, h: float, asp: float) -> bool:
    """A social-share (og:image) card: wide, big, ~1.9:1. The web standard is
    1200×630. These constantly masquerade as logos — reject by shape."""
    if not (w and h):
        return False
    return w >= 1000 and 1.7 <= asp <= 2.15


def _logo_dims(data: bytes, ct: Optional[str]) -> Optional[dict[str, Any]]:
    """Best-effort intrinsic size of a logo → {w, h, aspect} (aspect = w/h).
    SVG: read width/height attrs or the viewBox; raster: Pillow. Lets us tell a
    wide WORDMARK (aspect ≳ 2.5) from a square glyph/favicon (aspect ≈ 1)."""
    try:
        if ct and "svg" in ct:
            head = data[:2000].decode("utf-8", "ignore")
            mw = re.search(r'\bwidth\s*=\s*["\']([^"\']+)', head)
            mh = re.search(r'\bheight\s*=\s*["\']([^"\']+)', head)
            w = _svg_dim(mw.group(1)) if mw else None
            h = _svg_dim(mh.group(1)) if mh else None
            if not (w and h):
                vb = re.search(r'viewBox\s*=\s*["\']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)', head)
                if vb:
                    w, h = float(vb.group(1)), float(vb.group(2))
            if w and h and h > 0:
                return {"w": round(w), "h": round(h), "aspect": round(w / h, 2)}
            return None
        from PIL import Image  # type: ignore[import-untyped]
        im = Image.open(io.BytesIO(data))
        w, h = im.size
        if h > 0:
            return {"w": w, "h": h, "aspect": round(w / h, 2)}
    except Exception:
        pass
    return None


def _pick_and_download_logo(
    run: BrandRun,
) -> tuple[Optional[str], Optional[bytes], Optional[str], Optional[str], Optional[str]]:
    """Fallback logo pick when the agent didn't choose one: best candidate that
    actually downloads, ranked cascade. Returns (url, bytes, ct, source, page)."""
    for c in _ranked_candidates(run):
        data, ct = _download_cached(run, c["url"], c.get("page"))
        if data:
            logger.info("[brand:%s] fallback-picked logo source=%s url=%s (%d bytes, %s)",
                        run.name, c["source"], c["url"], len(data), ct or "?")
            if c["source"] == "favicon":
                run.warn("logo is a favicon/icon fallback — may be low-res")
            return c["url"], data, ct, c["source"], c.get("page")
    run.warn("no downloadable logo found")
    return None, None, None, None, None


def _collect_logo_candidates(
    run: BrandRun, *, chosen_url: Optional[str], chosen_bytes: Optional[bytes],
    chosen_ct: Optional[str], cap: int = 4,
) -> list["BrandLogoCandidate"]:
    """Download the top-ranked candidates for VISUAL REVIEW (test page / picker).
    Chosen logo first; then the next best distinct ones. Favicons are only
    included if we'd otherwise have too few. Deduped by bytes; capped."""
    from ..models import BrandLogoCandidate

    out: list[BrandLogoCandidate] = []
    seen_bytes: set[bytes] = set()

    def _add(source: str, url: str, data: bytes, ct: Optional[str], chosen: bool) -> None:
        if data in seen_bytes:
            return
        seen_bytes.add(data)
        if not ct:
            ct = "image/svg+xml" if url.startswith("data:image/svg") else "image/png"
        out.append(BrandLogoCandidate(
            source=source, url=url,
            data_url=f"data:{ct};base64,{base64.b64encode(data).decode('ascii')}",
            content_type=ct, chosen=chosen, dims=_logo_dims(data, ct),
        ))

    if chosen_url and chosen_bytes:
        src = run.chosen_logo["source"] if run.chosen_logo else "agent-picked"
        _add(src, chosen_url, chosen_bytes, chosen_ct, chosen=True)

    for c in _ranked_candidates(run):
        if len(out) >= cap:
            break
        if c["url"] == chosen_url:
            continue
        # skip low-value favicons unless we still have room and little else
        if c["source"] == "favicon" and len(out) >= 2:
            continue
        data, ct = _download_cached(run, c["url"], c.get("page"))
        if data:
            _add(c["source"], c["url"], data, ct, chosen=False)
    return out


def _palette_from(logo_bytes: Optional[bytes], content_type: Optional[str], run: BrandRun) -> list[str]:
    """Dominant colors OF THE LOGO. SVG → parse fills; raster → colorthief.
    Filter near-white/black + low-saturation. (Site/aggregator colors are merged
    separately via the vote tally in _final_palette.)"""
    palette: list[str] = []
    try:
        if logo_bytes and content_type and "svg" in content_type:
            hexes = re.findall(r'(?:fill|stop-color|stroke)\s*[:=]\s*["\']?(#[0-9a-fA-F]{3,6})', logo_bytes.decode("utf-8", "ignore"))
            palette = _clean_palette(hexes)
        elif logo_bytes:
            from colorthief import ColorThief  # type: ignore[import-untyped]
            ct = ColorThief(io.BytesIO(logo_bytes))
            raw = ct.get_palette(color_count=6, quality=5)
            palette = _clean_palette(["#%02x%02x%02x" % rgb for rgb in raw])
    except Exception as e:
        logger.debug("[brand:%s] palette extract failed: %s", run.name, e)
    return _clean_palette(palette)[:6]


def _final_palette(run: BrandRun, logo_bytes: Optional[bytes], ct: Optional[str]) -> list[str]:
    """Resolve the final palette. The AGENT's explicit set_palette wins and is
    respected as-is (only exact-dup + hex-normalize — NO filtering/merging behind
    its back; it can read 'Oat Light #F9F7F4' and decide). Only when the agent
    didn't set one do we fall back to an evidence ranking: official-declared colors
    first, then by number of independent sources, then logo colors."""
    if run.chosen_palette:
        # normalize + drop exact dups only; trust the agent's judgment
        seen, out = set(), []
        for h in run.chosen_palette:
            nh = _to_hex(h)
            if nh and nh not in seen:
                seen.add(nh)
                out.append(nh)
        logger.info("[brand:%s] final palette (agent, %d): %s", run.name, len(out), out)
        return out[:8]

    # fallback: rank by authority then cross-source count
    def rank_key(kv: tuple[str, set[str]]) -> tuple:
        srcs = kv[1]
        official = any(s == "official-declared" for s in srcs)
        n_indep = len({s.split(":")[0] for s in srcs})
        return (0 if official else 1, -n_indep, kv[0])

    palette = [h for h, _ in sorted(run.color_votes.items(), key=rank_key)]
    for h in (_palette_from(logo_bytes, ct, run) if logo_bytes else []):
        if h not in palette:
            palette.append(h)
    palette = _clean_palette(palette)[:6]
    logger.info("[brand:%s] final palette (fallback, %d): %s", run.name, len(palette), palette)
    return palette


def _svg_dim(value: Optional[str]) -> Optional[float]:
    """Parse an svg width/height attr ('20', '20px', '1.5rem') → number, else None."""
    if not value:
        return None
    m = re.match(r"\s*([\d.]+)", value)
    return float(m.group(1)) if m else None


def _to_hex(value: str) -> Optional[str]:
    """Normalize a CSS color literal to a valid #rrggbb. Handles #hex (3- or
    6-digit, expanding #abc→#aabbcc) and rgb()/rgba(); returns None for anything
    else (incl. malformed hex). Always returns 7-char lowercase — consistent with
    _clean_palette, so downstream consumers never see a 4-char value."""
    v = value.strip().lower()
    if v.startswith("#"):
        h = v[1:]
        if len(h) == 3 and all(c in "0123456789abcdef" for c in h):
            return "#" + "".join(c * 2 for c in h)
        if len(h) == 6 and all(c in "0123456789abcdef" for c in h):
            return "#" + h
        return None  # malformed (#12, #ggg, #abcd, …)
    m = re.match(r"rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)", v)
    if m:
        r, g, b = (min(255, int(x)) for x in m.groups())
        return "#%02x%02x%02x" % (r, g, b)
    return None


def _drop_reason(hex_: str) -> str:
    """Why _clean_palette would reject this hex (mirrors its filters). For agent
    feedback so it can substitute a real brand color."""
    h = (_to_hex(hex_) or hex_).lower()
    if len(h) != 7:
        return "not a valid #rrggbb color"
    r, g, b = int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx > 245 and mn > 245:
        return "near-white (backgrounds aren't brand colors)"
    if mx < 18:
        return "near-black (not a distinctive brand color)"
    if (mx - mn) < 12 and not (mn < 40):
        return "greyscale/low-saturation (not a brand color)"
    return "duplicate or filtered"


def _clean_palette(hexes: list[str], *, merge_near: bool = True) -> list[str]:
    """Dedupe + normalize 3-digit, drop near-white/black + very low-saturation,
    and (by default) collapse NEAR-DUPLICATE hues — two colors a human would call
    'the same' (e.g. #ff3621 vs #ee3d2c, two greens) shouldn't both take a palette
    slot. Order preserved (first occurrence wins)."""
    seen: set[str] = set()
    kept: list[tuple[int, int, int]] = []
    out: list[str] = []
    for h in hexes:
        h = h.lower()
        if len(h) == 4:  # #abc → #aabbcc
            h = "#" + "".join(c * 2 for c in h[1:])
        if len(h) != 7 or h in seen:
            continue
        try:
            r, g, b = int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)
        except ValueError:
            continue
        mx, mn = max(r, g, b), min(r, g, b)
        if mx > 245 and mn > 245:  # near-white
            continue
        if mx < 18:  # near-black
            continue
        if (mx - mn) < 12 and not (mn < 40):  # low-saturation grey (keep dark greys)
            continue
        # collapse near-duplicates: skip if within a small RGB distance of one kept
        if merge_near and any(abs(r - kr) + abs(g - kg) + abs(b - kb) <= 40
                              for kr, kg, kb in kept):
            continue
        seen.add(h)
        kept.append((r, g, b))
        out.append(h)
    return out


# ---------------------------------------------------------------------------
# Public entrypoint.
# ---------------------------------------------------------------------------
class BrandService:
    def __init__(self, ws, config):
        self.ws = ws
        self.config = config

    def _confirm_domain_guess(self, run: BrandRun) -> Optional[str]:
        """A cheap TENTATIVE domain head-start (the agent still does the real work
        and can override via set_official_site). Try <slug>.<tld> and confirm the
        page's TITLE actually contains the company name — an empty title (JS shell)
        or a name-less title does NOT count (that's how linear.io got wrongly
        confirmed). We keep the REGISTRABLE guessed domain, not the geo-redirected
        final host (airbnb.com → airbnb.co.uk must still report airbnb.com).
        Confidence stays modest (0.65) so a better signal wins."""
        slug = _slugify(run.name)
        needle = re.sub(r"[^a-z0-9]", "", run.name.lower())
        # .com first (canonical for most brands), then app/ai/co/io.
        for tld in (".com", ".app", ".ai", ".io", ".co"):
            guessed = f"{slug}{tld}"
            try:
                r = _http_get(f"https://{guessed}")
                from selectolax.parser import HTMLParser
                tree = HTMLParser(r.text[:_MAX_HTML_BYTES])
                _t = tree.css_first("title")
                title = re.sub(r"[^a-z0-9]", "", (_t.text() if _t else "").lower())
                # REQUIRE the name in a non-empty title (not just the URL) — this
                # rejects empty JS shells and parked pages that only echo the host.
                if len(title) >= 3 and needle[:8] in title:
                    logger.info("[brand:%s] domain guess (tentative): %s", run.name, guessed)
                    run.confidence = max(run.confidence, 0.65)
                    run.official_site = f"https://{guessed}"   # registrable, not geo-redirect
                    run.domain = guessed
                    run.trace("phase", tool="domain_guess",
                              summary={"confirmed": guessed, "tentative": True})
                    return f"https://{guessed}"
            except Exception:
                continue
        logger.info("[brand:%s] domain guess did not confirm — agent will search", run.name)
        run.trace("phase", tool="domain_guess", summary={"confirmed": None})
        return None

    async def resolve(self, name: str) -> "BrandOut":
        """Async entrypoint. Runs the ENTIRE (blocking) resolve on a worker thread
        so it never stalls the event loop (all HTTP, ddgs, colorthief, and the
        agent loop are synchronous). SEARCHES are cached (see _search_cache_*), so
        re-running after a logic patch is fast but re-executes all logic."""
        import asyncio
        out: BrandOut = await asyncio.to_thread(self._resolve_sync, name)
        return out

    def _resolve_sync(self, name: str) -> "BrandOut":
        """The full blocking pipeline. Wrapped so it ALWAYS returns a BrandOut
        (the route promises this) — any unexpected error → minimal result."""
        from ..models import BrandOut

        run = BrandRun(name=name.strip())
        logger.info("[brand:%s] === resolve start ===", run.name)
        try:
            self._run_agent(run)

            # Logo = the agent's choice if it committed one; else the code's
            # ranked fallback (agent errored / didn't choose).
            logo_page = None
            logo_url = logo_bytes = ct = source = None  # type: ignore[assignment]
            if run.chosen_logo:
                logo_url = run.chosen_logo["url"]
                logo_bytes = run.chosen_logo["bytes"]
                ct = run.chosen_logo["ct"]
                source = run.chosen_logo["source"]
                logo_page = run.chosen_logo.get("page")
                logger.info("[brand:%s] using chosen logo: %s (%s)", run.name, logo_url, source)
            else:
                # No committed logo. If the vision step explicitly ABSTAINED (saw
                # only non-logos / wrong-company), we return NO logo — we do NOT
                # fall back to a raw scraped candidate, which would re-introduce the
                # junk the model just rejected. Only use the deterministic fallback
                # if we never even attempted a visual pick.
                if run.logo_provenance:  # a contact sheet was judged → respect the abstain
                    run.warn("no logo committed — the candidate images did not contain a "
                             "clear logo for this company (see logo trace/rationale)")
                    logger.info("[brand:%s] no logo (vision abstained; not falling back)", run.name)
                else:
                    logo_url, logo_bytes, ct, source, logo_page = _pick_and_download_logo(run)

            # The domain we REPORT: a CONFIRMED official site always wins. Else the
            # page the logo candidate was found on (its host) — NOT the logo asset
            # URL (assets live on CDNs/DAMs like images.stripeassets.com or
            # brandfolder.com, or are inline data: URLs). Asset host only as a last
            # resort for a real http(s) logo when we have nothing better.
            page_host = _domain_of(logo_page) if logo_page else None
            if run.official_site:
                run.domain = _domain_of(run.official_site)
            elif page_host and not _is_asset_host(page_host):
                run.domain = page_host
            elif not run.domain and logo_url and logo_url.startswith(("http://", "https://")):
                run.domain = _domain_of(logo_url)

            # Palette: the agent's explicit choice wins; else fall back to the
            # cross-source vote tally, then the logo/CSS colors.
            palette = _final_palette(run, logo_bytes, ct)
            data_url = None
            if logo_bytes and ct:
                data_url = f"data:{ct};base64,{base64.b64encode(logo_bytes).decode('ascii')}"

            # Review list = the exact graded cells (from the vision pick). Only
            # fall back to _collect_logo_candidates if there was no visual pick.
            if run.review_logos:
                logos = run.review_logos
            else:
                logos = _collect_logo_candidates(run, chosen_url=logo_url,
                                                 chosen_bytes=logo_bytes, chosen_ct=ct)
            if run.official_site:
                run.confidence = max(run.confidence, 0.8)
            elif run.confidence == 0.0 and run.domain:
                run.confidence = 0.5
                run.warn("domain from agent exploration (not a confirmed guess)")

            run.trace("decision", tool="final", summary={
                "domain": run.domain, "confidence": run.confidence,
                "logo_source": source, "logo_ct": ct, "palette": palette,
                "n_logo_candidates": len(run.logo_candidates),
                "n_color_votes": len(run.color_votes),
            })
            sheet_url = None
            if run.logo_sheet_png:
                sheet_url = "data:image/png;base64," + base64.b64encode(run.logo_sheet_png).decode("ascii")
            out = BrandOut(
                name=run.name, domain=run.domain, confidence=run.confidence,
                logo_url=logo_url, logo_data_url=data_url, logos=logos, palette=palette,
                source=source, warnings=run.warnings, trace=run.steps,
                logo_contact_sheet=sheet_url,
                logo_provenance=[{k: v for k, v in p.items() if k != "raster"}
                                 for p in run.logo_provenance],
                site_screenshot=("data:image/jpeg;base64," + base64.b64encode(run.site_screenshot).decode("ascii")
                                 if run.site_screenshot else None),
            )
        except Exception as e:
            logger.exception("[brand:%s] resolve failed unexpectedly", run.name)
            run.trace("warning", detail=f"resolve crashed: {type(e).__name__}: {e}")
            out = BrandOut(name=run.name, warnings=[*run.warnings, f"resolve failed: {type(e).__name__}"],
                           trace=run.steps)
        logger.info("[brand:%s] === resolve done: domain=%s logo=%s(%s) palette=%d warnings=%d steps=%d ===",
                    run.name, out.domain, bool(out.logo_url), out.source, len(out.palette),
                    len(out.warnings), len(run.steps))
        _write_trace_file(run, out)
        return out

    def _run_agent(self, run: BrandRun) -> None:
        """Run the orchestrating Agents-SDK loop against the Databricks endpoint.
        The orchestrator uses the NORMAL model for judgment; its tools use the
        MINI model internally to EXTRACT structured info from messy pages/snippets
        (LLM-in-tools). Runs via Runner.run_sync (we're on a worker thread, no live
        event loop), but the SDK's model layer AWAITS the client — so we hand it an
        AsyncOpenAI wrapping Databricks' SYNC client's base_url + httpx auth
        (api_key is the literal "no-token"; real auth is the httpx BearerAuth).
        Populates `run` via the tools; swallows agent errors."""
        from agents import Agent, ModelSettings, OpenAIChatCompletionsModel, Runner, set_tracing_disabled
        from openai import AsyncOpenAI

        from .llm_service import LLMService

        # Deterministic domain guess first (a cheap head start — the agent still
        # confirms it and does the real exploration).
        guessed = self._confirm_domain_guess(run)

        set_tracing_disabled(True)  # process-global: no OpenAI key / trace upload
        sync_client = self.ws.serving_endpoints.get_open_ai_client()  # auth in its httpx client
        client = AsyncOpenAI(
            base_url=str(sync_client.base_url),
            api_key="no-token",  # real auth is the httpx BearerAuth below
            http_client=httpx.AsyncClient(auth=sync_client._client.auth),
        )
        # Orchestrator model: prefer the "normal" gateway, but fall back to mini
        # when ai_gateway isn't a real endpoint (local dev sets it to a dummy
        # placeholder — see AppConfig). The tools always use mini internally.
        orch_model = self.config.ai_gateway
        if not orch_model or "do-not-delete" in orch_model:
            orch_model = self.config.ai_gateway_mini
        model = OpenAIChatCompletionsModel(model=orch_model, openai_client=client)
        llm = LLMService(self.ws, self.config)  # MINI extractor for the tools
        logger.info("[brand:%s] orchestrator model=%s", run.name, orch_model)

        instructions = (
            "You are a brand researcher. Given a company name, you deliver: (1) the "
            "official domain, (2) the real brand LOGO, (3) an ordered color PALETTE. "
            "You orchestrate — the tools fan out and EXTRACT; YOU cross-check and "
            "decide.\n\n"
            "How to work:\n"
            "• Fire several searches EARLY and in parallel when you can: "
            "find_official_site('<name> official website'), search_brand_colors('<name>'), "
            "search_brand_logo('<name>'). Each returns already-extracted info (the "
            "color search even votes hex codes it finds across sources).\n"
            "• Confirm the OFFICIAL site (beware brand collisions — a car brand vs an "
            "aerospace company sharing a name). fetch_page it; each page comes back "
            "as EVIDENCE: a plain-language 'finding', whether it's_official, whether "
            "it declares_palette, its colors, logo candidates, and links. Also open "
            "the company's own BRAND / PRESS / brand-guidelines page (e.g. "
            "brand.<domain>, <domain>/brand, /press) — that page usually states the "
            "official palette outright. If fetch_page FAILS (403/bot-wall) but search "
            "clearly identifies the domain, call set_official_site(domain, why).\n"
            "• COLORS — decide from the evidence, weighting by AUTHORITY: a palette "
            "the company DECLARES on its own brand page ('our primary colors are Lava "
            "#FF3621, Navy #0B2026, Oat #EEEDE9…') is authoritative — take those, "
            "including any brand neutrals/off-whites they list. Aggregators (mobbin, "
            "brandcolorcode…) and site CSS (fetch_css) are supporting evidence; the "
            "more independent sources agree on a hex, the more trustworthy. Call "
            "color_votes() to see everything with its authority + source count, then "
            "set_palette([...]) with your reasoned choice (primary first, ~3–6). Don't "
            "let a well-cited aggregator color override what the brand itself declares.\n"
            "• LOGO — call find_logo(context, search_phrase). Write a SPECIFIC, "
            "DISAMBIGUATED search_phrase (include the domain + what the company does) "
            "so the RIGHT brand surfaces — plain '<name> logo' returns the most-"
            "indexed same-named company, often wrong. E.g. 'linear.app issue tracking "
            "software logo' or 'Ramp corporate card fintech logo ramp.com'. Put which-"
            "company-this-is in context too. A vision model LOOKS at the gathered "
            "candidates and picks the real primary logo (rejecting same-named others, "
            "favouring a clean vector, noting recurrence); it returns committed:null "
            "if the candidates contain no real logo — then refine your search_phrase "
            "and call again, or choose_logo(url) a good shortlist candidate. Read the "
            "rationale; a clean SVG wordmark is ideal.\n"
            "• INSTRUMENTATION: call log_reasoning(step, why) at each real decision "
            "point — which site you judged official & why, which logo you picked over "
            "the alternatives & why, how you resolved conflicting colors, and anything "
            "ambiguous or hard. Be specific and honest (including uncertainty). These "
            "notes are how humans debug and improve this system.\n"
            "• Finish with ONE short line: domain + confidence. Don't invent data.\n\n"
            f'Company: "{run.name}".'
        )
        if guessed:
            instructions += f" A quick guess suggests this official site: {guessed} — verify it first."
        else:
            instructions += " No confirmed domain yet — search for the official site."

        try:
            result = Runner.run_sync(
                Agent(name="brand-orchestrator", instructions=instructions, model=model,
                      model_settings=ModelSettings(parallel_tool_calls=True),
                      tools=_build_tools(run, llm)),
                input=f"Research the brand for: {run.name}",
                max_turns=20,
            )
            logger.info("[brand:%s] agent final: %s", run.name, getattr(result, "final_output", None))
        except Exception as e:
            run.warn(f"agent loop failed ({type(e).__name__}) — using signals gathered so far")
            logger.warning("[brand:%s] agent error: %s", run.name, e)
        finally:
            # Close the per-resolve AsyncOpenAI + its httpx.AsyncClient, else we leak
            # a connection pool / fds every resolve. We're on a worker thread with no
            # running loop, so drive the async close with a fresh loop.
            try:
                import asyncio as _asyncio
                _asyncio.run(client.close())
            except Exception:
                pass
