"""Pure zip builders: the project download, the Genie Code workshop kit and the
template DAB export.

Kept apart from the routes on purpose: these run in a spawned CPU-pool worker
(services/cpu_pool.py), and a worker must import only this module, not FastAPI,
SQLModel or the DB layer the routes pull in. Keep this module free of backend
imports.
"""

from __future__ import annotations

import io
import os
import time
import zipfile
from pathlib import Path

from .content_codec import decompress_content

# Upper bound on one zip build in the CPU pool (services/cpu_pool.py).
ZIP_TIMEOUT_S = 120

# Files/folders to exclude from listing. Keep in sync with
# file_watcher.IGNORE_PATTERNS and file_sync.PRUNE_DIRS.
#
# Exact names for directory pruning (matched per-segment in the walk).
EXCLUDED_PATTERNS = {
    # Managed elsewhere
    ".claude",
    ".databricks",
    # Language package/artifact dirs
    "node_modules",
    "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache",
    # Build output
    "dist", "build", ".next", ".turbo", ".parcel-cache", "__dist__",
    # VCS + OS
    ".git",
    ".DS_Store",
}


def _is_excluded_segment(segment: str) -> bool:
    """True if a path segment (dir or file basename) should be hidden from
    the file listing. Extends EXCLUDED_PATTERNS with glob rules for variant
    names the set can't express literally:
      - .venv*, venv* (covers .venv, venv, .venv-datagen, etc.)
      - .tmp*         (hidden tempfile pattern like .tmpXXXXXX)
      - *.tmp, *.tmp.* (tmp suffix/middle)
    Keep in sync with file_watcher.IGNORE_PATTERNS."""
    if segment in EXCLUDED_PATTERNS:
        return True
    if segment.startswith(".venv") or (
        segment.startswith("venv") and (segment == "venv" or segment.startswith("venv-") or segment.startswith("venv."))
    ):
        return True
    if segment.startswith(".tmp"):
        return True
    if segment.endswith(".tmp") or ".tmp." in segment:
        return True
    if segment == ".databrickscfg" or segment.startswith(".databrickscfg."):
        return True
    # Per-project FMAPI auth files (see core/fmapi_auth.py).
    if segment == ".anthropic_token" or segment.startswith(".anthropic_token."):
        return True
    if segment == "get_anthropic_token.sh" or segment.startswith(".get_anthropic_token.sh."):
        return True
    return False


# Two kinds of exclusion. The listing UI is stricter than the on-disk /
# Lakebase sync layer:
#
#   _is_excluded_from_sync(rel_path) — what to keep off Lakebase entirely.
#     Permits a small allowlist under `.claude/`:
#       - `.claude/projects/**` (Claude Code transcripts — needed for
#         session resume across container restarts)
#       - `.claude/.claude.json` (CLI's live per-user config — losing it
#         on restart loses queued prompts / resume targets)
#     Rejects every other `.claude/` child (settings.json, skills/,
#     .credentials.json, statsig/, todos/, ide/, backups/ — auth material,
#     per-container caches, or auto-rotated snapshots that duplicate the
#     live file). Backups are explicitly NOT synced: the live .claude.json
#     already is, and shipping per-launch copies would bloat the mirror
#     for no recovery value.
#
#   _is_hidden_from_listing(rel_path) — what to hide from the file viewer.
#     Adds `.claude/**` to the deny list: transcripts and CLI config are
#     implementation details, not user-facing files.
#
# Most callsites want _is_hidden_from_listing. The sync layer
# (file_sync.py, the watcher) is the only place that should use the
# more permissive _is_excluded_from_sync.
def _is_excluded_from_sync(rel_path: str | Path) -> bool:
    """Sync-layer exclusion. Use this when deciding what to send to
    Lakebase. Permits `.claude/projects/**` (transcripts) + the live
    `.claude/.claude.json` config; rejects every other `.claude/` child
    including `.claude/backups/**`."""
    parts = Path(rel_path).parts
    if not parts:
        return False
    if parts[0] == ".claude":
        if len(parts) == 2 and parts[1] == ".claude.json":
            # Allowlist the live CLI config — keep this in sync with
            # file_watcher.IGNORE_PATTERNS (which also allowlists it).
            return False
        if len(parts) >= 2 and parts[1] == "projects":
            # Skip the literal `.claude/projects/` prefix when checking
            # the rest of the path.
            return any(_is_excluded_segment(p) for p in parts[2:])
        return True
    return any(_is_excluded_segment(p) for p in parts)


def _is_hidden_from_listing(rel_path: str | Path) -> bool:
    """Listing/UI exclusion. Stricter than _is_excluded_from_sync — we
    don't want transcripts (or anything else under `.claude/`) showing up
    in the file viewer."""
    parts = Path(rel_path).parts
    if not parts:
        return False
    if parts[0] == ".claude":
        return True
    return any(_is_excluded_segment(p) for p in parts)


# Kept for back-compat — most callers want the stricter listing rule.
_is_excluded_path = _is_hidden_from_listing


WORKSHOP_HTML_PATH = "notebooks_html/workshop.html"
_KIT_TOP_FILES = ("README.md", "CONTEXT.md")
_KIT_DIRS = ("specifications", "data_generation")


def _project_slug(name: str) -> str:
    """Filesystem-safe project slug for the project zip download."""
    return "".join(c if c.isalnum() or c in "._- " else "_" for c in name)


def _kit_slug(name: str) -> str:
    """Shell-safe kit folder name: lowercase, no spaces, so the README's
    `databricks workspace import-dir` command works unquoted."""
    s = "".join(c if c.isalnum() or c in "._-" else "-" for c in name.strip().lower())
    return "-".join(p for p in s.split("-") if p) or "workshop"


def _workshop_kit_members(project_dir: Path, folder: str) -> list[tuple[Path, str]]:
    """(source file, arcname) for every kit file: the page as `workshop.html`,
    everything Genie Code reads under `folder/` (the zip to import)."""
    root = project_dir.resolve()
    members: list[tuple[Path, str]] = [(project_dir / WORKSHOP_HTML_PATH, "workshop.html")]
    for name in _KIT_TOP_FILES:
        members.append((project_dir / name, f"{folder}/{name}"))
    for d in _KIT_DIRS:
        base = project_dir / d
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*")):
            if not f.is_file() or f.is_symlink():
                continue
            rel = f.relative_to(project_dir)
            if _is_hidden_from_listing(rel) or not f.resolve().is_relative_to(root):
                continue
            members.append((f, f"{folder}/{rel.as_posix()}"))
    return [(src, arc) for src, arc in members if src.is_file()]


def _workshop_kit_import_md(title: str, folder: str) -> str:
    return (
        f"# {title} — Genie Code workshop kit\n\n"
        "Genie Code builds the solution live, one prompt at a time, from the steps in the "
        "workshop page. Two parts:\n\n"
        "- `workshop.html` — the workshop. Open it in your browser and follow it top to bottom.\n"
        f"- `{folder}.zip` — import it into your workspace as-is. It holds the script that "
        "loads the starting data (`data_generation/`) and the context that drives Genie Code "
        "(`CONTEXT.md`, the story in `README.md`, the exact names in `specifications/`).\n\n"
        "## Set up\n\n"
        f"1. In your workspace: Workspace → your user folder → Import → `{folder}.zip`. "
        f"Databricks unpacks it into a `{folder}` folder.\n"
        "2. Create a notebook inside that folder and open Genie Code there, so it can read "
        "`CONTEXT.md`.\n"
        "3. Open `workshop.html` in your browser and start with the first prompt.\n"
    )


def _zip_file_info(arcname: str) -> zipfile.ZipInfo:
    """A regular-file entry (rw-r--r--). writestr() with a bare name leaves the
    file-type bits empty, which some unzip tools (macOS Archive Utility) reject."""
    info = zipfile.ZipInfo(arcname, date_time=time.localtime()[:6])
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (0o100644 << 16)
    return info


def build_workshop_kit_zip(project_dir: Path, title: str) -> bytes | None:
    """Zip the attendee kit under `<slug>-workshop-kit/`: `workshop.html` (open
    locally), `IMPORT.md`, and `<slug>_workshop.zip` — the workspace Import
    dialog takes a zip, not a folder, so the part to upload is its own zip.
    None when the workshop page hasn't been generated yet (the route turns
    that into a 404)."""
    if not (project_dir / WORKSHOP_HTML_PATH).is_file():
        return None
    slug = _kit_slug(title)
    top, folder = f"{slug}-workshop-kit", f"{slug}_workshop"
    members = _workshop_kit_members(project_dir, folder)
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as zf:
        for src, arc in members:
            if arc.startswith(f"{folder}/"):
                zf.write(src, arc)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(_zip_file_info(f"{top}/IMPORT.md"), _workshop_kit_import_md(title, folder))
        zf.write(project_dir / WORKSHOP_HTML_PATH, f"{top}/workshop.html")
        zf.writestr(_zip_file_info(f"{top}/{folder}.zip"), inner.getvalue())
    return buf.getvalue()


def build_project_zip(project_dir: Path) -> bytes:
    """Zip every listable file under `project_dir` (the project download).

    Prune excluded dirs (node_modules, .venv, .claude, …) instead of walking
    every file inside them and filtering after: a previewed app's node_modules
    alone is ~40k files.
    """
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for root, dirs, files in os.walk(project_dir):
            rel_root = Path(root).relative_to(project_dir)
            dirs[:] = [d for d in dirs if not _is_hidden_from_listing(rel_root / d)]
            for name in files:
                rel_path = rel_root / name
                if not _is_hidden_from_listing(rel_path):
                    zip_file.write(Path(root) / name, rel_path)
    return zip_buffer.getvalue()




def build_template_zip(entries: list[tuple[str, bytes]]) -> bytes:
    """Template DAB export. `entries` is (relative_path, compressed content),
    already sorted by path, as stored in TemplateContent rows.

    Import-safe layout. The Databricks workspace UI import (multipart
    `format=AUTO`) unzips server-side and creates each entry in archive order,
    creating a file's parent folder only if that folder was already made, so an
    archive that lists `a/b.txt` before its `a/` dir 404s with "The parent folder
    (…/a) does not exist". DB row order is arbitrary, so we (1) emit an explicit
    directory entry for every ancestor folder and (2) write sorted, so a parent
    always precedes its children. An entry that cannot be decompressed is skipped
    rather than failing the whole download."""
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        seen_dirs: set[str] = set()

        def _ensure_dirs(rel_path: str) -> None:
            # Emit "a/", "a/b/", … (parent-first) for a file at "a/b/c.txt".
            parts = rel_path.replace("\\", "/").split("/")[:-1]
            prefix = ""
            for seg in parts:
                prefix = f"{prefix}{seg}/"
                if prefix not in seen_dirs:
                    seen_dirs.add(prefix)
                    zf.writestr(prefix, b"")

        for rel_path, compressed in entries:
            try:
                _ensure_dirs(rel_path)
                zf.writestr(rel_path, decompress_content(compressed))
            except Exception:
                # Skip an unreadable file rather than fail the whole download.
                continue
    return zip_buffer.getvalue()
