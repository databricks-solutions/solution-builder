#!/usr/bin/env python
"""Screenshot backend BENCHMARK — Playwright headless-shell vs Camoufox.

Two backends capture the same sites; we compare which renders cleanly (esp. the
bot-walled ones Playwright can't reach: LVMH, BlaBlaCar, SAP). Camoufox is a
hardened anti-detection Firefox — heavier, but beats network-layer WAFs that
block plain headless Chromium.

  uv run python scripts/brand_screenshot_bench.py                # default site set
  uv run python scripts/brand_screenshot_bench.py --sites a.com b.com
  uv run python scripts/brand_screenshot_bench.py --backend camoufox --only lvmh.com

Outputs per site+backend: /tmp/brand_bench/<backend>_<slug>.jpg  +  a summary
table (uniformity — lower = more content; higher = blanker) + timing. READ the
images to judge (uniformity is a proxy, not truth).

Camoufox notes learned the hard way:
- needs playwright<1.61 (1.61 isMobile viewport breaks its Juggler; GH#653)
- strip NODE_OPTIONS before launch (a stray --require crashes its Node launcher)
- `browser.new_page()` uses the launch `window=`; do NOT pass a Playwright
  context viewport (Firefox rejects setDefaultViewport under the bug above).
"""
from __future__ import annotations

import argparse
import io
import os
import time
from collections import Counter
from pathlib import Path
from typing import Optional

# Reuse the exact production capture logic (cookies, dismiss, content-ready,
# render check) so the benchmark reflects real behavior, not a toy path.
from demo_prompt_generator.backend.services import brand_service as bs

OUT = Path("/tmp/brand_bench")


def _uniformity(jpeg: bytes) -> float:
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(jpeg)).convert("RGB").resize((64, 40))
        q = [(r >> 3, g >> 3, b >> 3) for r, g, b in im.getdata()]
        return round(Counter(q).most_common(1)[0][1] / len(q), 3)
    except Exception:
        return 0.0


# ── Backend 1: Playwright chromium-headless-shell (production) ────────────────
# The bench measures each backend DIRECTLY (via _capture_*), not the production
# fallback chain (_screenshot_site tries playwright then camoufox) — otherwise a
# playwright "FAIL" cell would silently show the camoufox render and we couldn't
# compare them head-to-head.
def capture_playwright(url: str) -> Optional[bytes]:
    return bs._capture_playwright(url)


# ── Backend 2: Camoufox (anti-detection Firefox) ─────────────────────────────
def capture_camoufox(url: str) -> Optional[bytes]:
    return bs._capture_camoufox(url)


BACKENDS = {"playwright": capture_playwright, "camoufox": capture_camoufox}


def capture_subprocess(backend: str, url: str, out_path: Path, timeout_s: int = 45) -> Optional[bytes]:
    """Run one capture via the PRODUCTION subprocess runner (bs._run_backend_subprocess):
    a child process with a hard SIGKILL timeout that reaps the browser subtree, so a
    hung page / crashed driver can't stall the benchmark. Single source of truth with
    prod — the bench exercises the exact isolation the app uses."""
    shot = bs._run_backend_subprocess(backend, url, timeout_s=timeout_s)
    if shot:
        out_path.write_bytes(shot)
    return shot

DEFAULT_SITES = [
    # bot-walled (Playwright fails these) — the real test for Camoufox
    "https://www.lvmh.com", "https://www.sap.com", "https://www.blablacar.com",
    # normal sites (both should handle) — regression check
    "https://stripe.com", "https://www.doctolib.fr", "https://www.notion.com",
]


def _slug(url: str) -> str:
    return url.split("//")[1].replace("www.", "").split("/")[0].replace(".", "_")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="*", help="override the site list")
    ap.add_argument("--only", help="single site")
    ap.add_argument("--backend", choices=list(BACKENDS), help="only this backend")
    args = ap.parse_args()

    sites = [args.only] if args.only else (args.sites or DEFAULT_SITES)
    backends = [args.backend] if args.backend else list(BACKENDS)
    OUT.mkdir(parents=True, exist_ok=True)

    rows = []
    for url in sites:
        slug = _slug(url)
        rec = {"site": slug}
        for be in backends:
            t = time.time()
            out_path = OUT / f"{be}_{slug}.jpg"
            if out_path.exists():
                out_path.unlink()
            shot = capture_subprocess(be, url, out_path)  # hard-timeout, isolated
            secs = time.time() - t
            if shot:
                rec[be] = f"{_uniformity(shot):.2f} ({secs:.0f}s)"
            else:
                rec[be] = f"FAIL ({secs:.0f}s)"
        rows.append(rec)
        print(f"  {slug:16} " + "  ".join(f"{be}={rec[be]:>14}" for be in backends))

    print("\n=== summary (uniformity: <0.9 = rendered content; FAIL/≥0.9 = blank/blocked) ===")
    hdr = f"{'site':16} " + "  ".join(f"{be:>16}" for be in backends)
    print(hdr)
    for r in rows:
        print(f"{r['site']:16} " + "  ".join(f"{r[be]:>16}" for be in backends))
    print(f"\nimages: {OUT}/<backend>_<site>.jpg")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
