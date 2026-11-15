"""
LuxeBeauty — Render the hand-authored document HTML files to PDF (LOCAL step).

Run before `databricks bundle deploy`. This script ONLY renders; it never
touches a workspace. The setup job's `upload_pdfs` task copies the rendered
PDFs into the `manufacturing_reports` UC volume, and `deploy_genie` attaches
that volume to the Genie agent.

Why local-only: the document bundle is a bundle source artifact (committed
under src/documents/pdf/), not a workspace resource, and the volume target
differs per deployment (catalog/schema are bundle vars). Uploading from here
would hard-code one workspace.

Workflow:
  1. Read every `*.html` under `./html/` (same directory as this script).
  2. Render each to PDF via plutoprint (HTML → PDF, no headless browser).
  3. Write each PDF to `./pdf/<name>.pdf` (committed, synced by the bundle).

Dependencies: `plutoprint` (local only; not needed in the job).

Usage:
  python src/documents/html_to_pdf.py
"""

from __future__ import annotations

import io
import pathlib
import sys

import plutoprint

HERE     = pathlib.Path(__file__).resolve().parent
HTML_DIR = HERE / "html"
PDF_DIR  = HERE / "pdf"


def render(html_path: pathlib.Path, pdf_path: pathlib.Path) -> int:
    """Render one HTML file to a PDF file. Returns the PDF size in bytes."""
    book = plutoprint.Book()
    book.set_metadata(plutoprint.PDF_METADATA_TITLE,
                      html_path.stem.replace("_", " ").title())
    book.set_metadata(plutoprint.PDF_METADATA_CREATOR, "LuxeBeauty Manufacturing Records")
    book.load_html(html_path.read_text(encoding="utf-8"))
    buf = io.BytesIO()
    book.write_to_pdf_stream(buf)
    data = buf.getvalue()
    pdf_path.write_bytes(data)
    return len(data)


def main() -> int:
    if not HTML_DIR.is_dir():
        print(f"ERROR: {HTML_DIR} not found", file=sys.stderr)
        return 1

    html_files = sorted(HTML_DIR.glob("*.html"))
    if not html_files:
        print(f"ERROR: no .html files in {HTML_DIR}", file=sys.stderr)
        return 1

    PDF_DIR.mkdir(exist_ok=True)
    print(f"Rendering {len(html_files)} HTML files → {PDF_DIR}")
    for src in html_files:
        target = PDF_DIR / f"{src.stem}.pdf"
        size = render(src, target)
        print(f"  ✓ {src.name:55s} → {target.name}  ({size:,} bytes)")

    print("\nNext: databricks bundle deploy (upload_pdfs copies these into the volume).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
