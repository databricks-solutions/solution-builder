# Databricks notebook source
"""
Copy pre-rendered PDFs from the synced workspace to the UC volume.

Local pre-deploy step (run BEFORE `databricks bundle deploy`):
  python src/documents/html_to_pdf.py
  → writes src/documents/pdf/*.pdf
The bundle's sync.include uploads those PDFs to the workspace; this notebook
then copies them to /Volumes/{catalog}/{schema}/manufacturing_reports/.

Why not render in-job: plutoprint is heavy enough to OOM the smallest serverless
client at notebook startup. Pre-rendering locally keeps the job environment
minimal and idempotent.

Parameters:
- catalog, schema
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema",  "", "Schema")

catalog = dbutils.widgets.get("catalog")
schema  = dbutils.widgets.get("schema")
assert catalog and schema

VOLUME = "manufacturing_reports"
VOLUME_PATH = f"/Volumes/{catalog}/{schema}/{VOLUME}"
print(f"Target: {VOLUME_PATH}")

# COMMAND ----------

import os

# Notebook at {bundle_root}/src/deploy/upload_pdfs;
# PDFs at  {bundle_root}/src/documents/pdf/.
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root   = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
pdf_source    = f"/Workspace{bundle_root}/src/documents/pdf"
print(f"PDF source: {pdf_source}")

try:
    pdf_files = sorted([f for f in os.listdir(pdf_source) if f.lower().endswith(".pdf")])
except FileNotFoundError:
    raise SystemExit(
        f"No PDFs found at {pdf_source}. Pre-render them locally with "
        f"`python src/documents/html_to_pdf.py` before `databricks bundle deploy`."
    )

print(f"Found {len(pdf_files)} PDFs")

# COMMAND ----------

uploaded = 0
for fn in pdf_files:
    src = f"{pdf_source}/{fn}"
    dst = f"{VOLUME_PATH}/{fn}"
    with open(src, "rb") as fr, open(dst, "wb") as fw:
        data = fr.read()
        fw.write(data)
    print(f"  {fn:55s} → {dst}  ({len(data):,} bytes)")
    uploaded += 1

print(f"\nUploaded {uploaded}/{len(pdf_files)} PDFs.")
