"""
LuxeBeauty — Render hand-authored incident HTML files to PDF and upload to UC.

This script is intentionally independent of `data_generation/generate_data.py`:
the data and the doc bundle change for different reasons and on different
cadences. Re-running this script does not touch any tables.

Workflow:
  1. Read every `*.html` under `./html/` (same directory as this script).
  2. Render each to PDF via plutoprint (HTML → PDF, no headless browser).
  3. Upload each PDF to UC Volume:
       /Volumes/<your-catalog>/<your-schema>/manufacturing_reports/<name>.pdf
  4. The volume is created if missing.

Dependencies: `plutoprint` + the `databricks-sdk` (already in the dbdemos venv).

Usage:
  DATABRICKS_CONFIG_PROFILE=WEST python html_to_pdf.py
"""

from __future__ import annotations

import io
import pathlib
import sys

import plutoprint
from databricks.sdk import WorkspaceClient

CATALOG = "<your-catalog>"
SCHEMA  = "<your-schema>"
VOLUME  = "manufacturing_reports"

HERE         = pathlib.Path(__file__).resolve().parent
HTML_DIR     = HERE / "html"
VOLUME_PATH  = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}"


def html_to_pdf_bytes(html_path: pathlib.Path) -> bytes:
    """Render one HTML file to a PDF byte string via plutoprint."""
    book = plutoprint.Book()
    book.set_metadata(plutoprint.PDF_METADATA_TITLE,
                      html_path.stem.replace("_", " ").title())
    book.set_metadata(plutoprint.PDF_METADATA_CREATOR, "LuxeBeauty Manufacturing Records")
    book.load_html(html_path.read_text(encoding="utf-8"))
    buf = io.BytesIO()
    book.write_to_pdf_stream(buf)
    return buf.getvalue()


def ensure_volume(wc: WorkspaceClient) -> None:
    """Create the UC Volume if it doesn't already exist."""
    full_name = f"{CATALOG}.{SCHEMA}.{VOLUME}"
    try:
        wc.volumes.read(full_name)
    except Exception:
        from databricks.sdk.service.catalog import VolumeType
        wc.volumes.create(
            catalog_name=CATALOG,
            schema_name=SCHEMA,
            name=VOLUME,
            volume_type=VolumeType.MANAGED,
        )
        print(f"  created volume {full_name}")


def main() -> int:
    if not HTML_DIR.is_dir():
        print(f"ERROR: {HTML_DIR} not found", file=sys.stderr)
        return 1

    html_files = sorted(HTML_DIR.glob("*.html"))
    if not html_files:
        print(f"ERROR: no .html files in {HTML_DIR}", file=sys.stderr)
        return 1

    print(f"Found {len(html_files)} HTML files in {HTML_DIR}")

    wc = WorkspaceClient()
    ensure_volume(wc)

    for src in html_files:
        pdf_bytes = html_to_pdf_bytes(src)
        target = f"{VOLUME_PATH}/{src.stem}.pdf"
        wc.files.upload(file_path=target, contents=io.BytesIO(pdf_bytes), overwrite=True)
        print(f"  ✓ {src.name:55s} → {target}  ({len(pdf_bytes):,} bytes)")

    print(f"\nUploaded {len(html_files)} PDFs to {VOLUME_PATH}")
    print("The Knowledge Assistant should now re-sync this volume:")
    print(f"  databricks knowledge-assistants sync-knowledge-sources <ka-id>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
