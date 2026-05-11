# Databricks notebook source
"""
Upload PDFs - Reference script for DAB workflow task.

Copies PDF files from the workspace (synced via DAB sync.include) to a UC volume.
PDFs are synced to workspace by DAB, this task copies them to the volume for
Knowledge Assistant indexing.

Requirements:
- PDFs must be in raw_data/pdf/ directory (synced via sync.include)
- Volume must exist (created by DAB deploy via resources.volumes)

Parameters (via base_parameters):
- catalog: Unity Catalog name
- schema: Schema name

This script uses the FUSE mount for workspace files:
- Workspace files synced by DAB are accessible at /Workspace/... paths
- We read files via os.listdir() and standard Python file I/O
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")

print(f"Uploading PDFs to: /Volumes/{catalog}/{schema}/docs")

# COMMAND ----------

import os

# Derive bundle root from this notebook's path
# Notebook runs from: {bundle_root}/src/deploy/upload_pdfs.py
# PDFs are at: {bundle_root}/raw_data/pdf/
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))

# Workspace FUSE path for source PDFs
pdf_source = f"/Workspace{bundle_root}/raw_data/pdf"
print(f"PDF source: {pdf_source}")

# UC Volume destination
volume_path = f"/Volumes/{catalog}/{schema}/docs"
print(f"Volume destination: {volume_path}")

# COMMAND ----------

# List PDFs in the source directory
try:
    pdf_files = [f for f in os.listdir(pdf_source) if f.lower().endswith('.pdf')]
    print(f"Found {len(pdf_files)} PDF files")
except FileNotFoundError:
    print(f"Warning: Source directory not found: {pdf_source}")
    print("No PDFs to upload. Ensure raw_data/pdf/ exists and is included in sync.include")
    pdf_files = []

# COMMAND ----------

# Copy each PDF to the volume
uploaded = 0
for filename in pdf_files:
    src_path = f"{pdf_source}/{filename}"
    dst_path = f"{volume_path}/{filename}"

    try:
        # Read from workspace FUSE mount
        with open(src_path, "rb") as f:
            content = f.read()

        # Write to UC volume
        with open(dst_path, "wb") as f:
            f.write(content)

        print(f"  Uploaded: {filename} ({len(content):,} bytes)")
        uploaded += 1

    except Exception as e:
        print(f"  Failed: {filename} - {e}")

# COMMAND ----------

print(f"\nUpload complete: {uploaded}/{len(pdf_files)} files")
print(f"Volume: /Volumes/{catalog}/{schema}/docs")
