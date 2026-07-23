"""Read/write a project's brand — the on-disk brand contract.

Everything lives under `<project>/brand/`:
  - brand.json   — {company, palette, website, company_logo, company_official_website_screenshot}
  - company_logo.<ext>
  - website.png

The filenames stored INSIDE brand.json are BARE (e.g. "company_logo.svg") and
resolved relative to brand.json's own folder — so the JSON is portable. Helpers
here return project-root-relative paths (e.g. "brand/brand.json") for the
file-sync layer, which keys everything off the project root.

The solution-builder skill + app.md read `brand/brand.json` to theme the app. It's
a normal project file, so the file-sync watcher persists it to the DB and
restores it on reload like any other artifact.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from pathlib import Path
from typing import Optional

from ..models import ProjectBrand
from .skills_manager import PROJECTS_BASE_DIR

logger = logging.getLogger(__name__)

BRAND_DIR = "brand"
BRAND_FILENAME = "brand.json"
BRAND_SCREENSHOT_FILENAME = "website.png"
BRAND_LOGO_STEM = "company_logo"

# project-root-relative path to brand.json — what the file-sync layer expects.
BRAND_JSON_PATH = f"{BRAND_DIR}/{BRAND_FILENAME}"

# mime → file extension for the logo (data-URL mimes we might get from the resolver)
_LOGO_EXT = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
}


def _brand_dir(project_id: str) -> Path:
    return Path(PROJECTS_BASE_DIR) / project_id / BRAND_DIR


def rel_path(name: str) -> str:
    """Project-root-relative path for a bare brand filename (for file-sync)."""
    return f"{BRAND_DIR}/{name}"


def read_brand(project_id: str) -> Optional[ProjectBrand]:
    """Return the project's brand from brand/brand.json, or None if absent."""
    path = _brand_dir(project_id) / BRAND_FILENAME
    try:
        if not path.exists():
            return None
        data = json.loads(path.read_text())
        return ProjectBrand(
            company=str(data.get("company") or ""),
            palette=[str(h) for h in (data.get("palette") or []) if h],
            website=data.get("website") or None,
            company_logo=data.get("company_logo") or None,
            company_official_website_screenshot=data.get("company_official_website_screenshot") or None,
        )
    except Exception as e:  # best-effort — a malformed file must not break getProject
        logger.warning("[brand_file] %s: failed to read brand.json: %s", project_id, e)
        return None


def write_brand(project_id: str, brand: ProjectBrand) -> Path:
    """Write brand/brand.json (pretty, stable key order). Filenames are stored
    BARE (relative to this folder). Returns the path."""
    path = _brand_dir(project_id) / BRAND_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "company": brand.company,
        "palette": brand.palette,
        "website": brand.website,
        "company_logo": brand.company_logo,
        "company_official_website_screenshot": brand.company_official_website_screenshot,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")
    logger.info("[brand_file] %s: wrote %s (company=%r, %d colors, logo=%s, screenshot=%s)",
                project_id, BRAND_JSON_PATH, brand.company, len(brand.palette),
                brand.company_logo or "none",
                brand.company_official_website_screenshot or "none")
    return path


def write_logo(project_id: str, data_url: str) -> Optional[str]:
    """Save the resolved logo as brand/company_logo.<ext> (extension from the
    data-URL mime — SVG stays SVG). Returns the BARE filename to record in
    brand.json, or None on failure."""
    try:
        if not data_url.startswith("data:") or "," not in data_url:
            return None
        header, b64 = data_url.split(",", 1)
        mime = header[5:].split(";", 1)[0].strip().lower()
        ext = _LOGO_EXT.get(mime)
        if not ext:
            logger.info("[brand_file] %s: unknown logo mime %r — skipping", project_id, mime)
            return None
        raw = base64.b64decode(b64)
        name = f"{BRAND_LOGO_STEM}.{ext}"
        out = _brand_dir(project_id) / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(raw)
        logger.info("[brand_file] %s: wrote %s (%d bytes)", project_id, rel_path(name), len(raw))
        return name
    except Exception as e:
        logger.warning("[brand_file] %s: failed to save logo: %s", project_id, e)
        return None


def write_screenshot(project_id: str, image_bytes: bytes) -> Optional[str]:
    """Save the official-site screenshot as brand/website.png. Returns the BARE
    filename to record in brand.json, or None on failure. Converts to PNG (the
    resolver hands us JPEG bytes) so the `.png` name is honest."""
    try:
        from PIL import Image  # type: ignore[import-untyped]

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        out = _brand_dir(project_id) / BRAND_SCREENSHOT_FILENAME
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, format="PNG")
        logger.info("[brand_file] %s: wrote %s (%dx%d)", project_id,
                    rel_path(BRAND_SCREENSHOT_FILENAME), img.width, img.height)
        return BRAND_SCREENSHOT_FILENAME
    except Exception as e:
        logger.warning("[brand_file] %s: failed to save site screenshot: %s", project_id, e)
        return None
