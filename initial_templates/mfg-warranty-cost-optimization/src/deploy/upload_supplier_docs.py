# Databricks notebook source
"""
Copy the supplier-quality documents (src/supplier_docs/*.md: PPAP, PCN-0419, SQA, warranty policy,
field-campaign procedure — synced with the bundle) into the <catalog>.<schema>.supplier_quality_docs
UC volume — the documents the Genie agent searches (the whole volume is indexed, so nothing else goes there).

Parameters: catalog, schema
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
catalog, schema = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")
assert catalog and schema

# COMMAND ----------

import os

spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.supplier_quality_docs COMMENT 'PPAP submissions, PCNs, supplier quality agreements, warranty + field-campaign procedures - documents searched by the Genie agent'")
VOLUME_PATH = f"/Volumes/{catalog}/{schema}/supplier_quality_docs"
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
src_dir = f"/Workspace{bundle_root}/src/supplier_docs"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".md"))
for fn in files:
    with open(f"{src_dir}/{fn}", "rb") as fr, open(f"{VOLUME_PATH}/{fn}", "wb") as fw:
        fw.write(fr.read())
    print(f"  {fn} → {VOLUME_PATH}/{fn}")
print(f"Uploaded {len(files)} supplier-quality documents.")
