# Databricks notebook source
"""
Copy the trade-promotion policy documents (src/trade_docs/*.md: TPG-2027 guidelines, PEA-2027 methodology,
ValuMax JBP, retailer trade terms, ValuMax BOGO recap memo — synced with the bundle) into the
<catalog>.<schema>.trade_policy_docs UC volume — the documents the Genie agent searches (the whole volume
is indexed, so nothing else goes there).

Parameters: catalog, schema
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
catalog, schema = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")
assert catalog and schema

# COMMAND ----------

import os

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{schema}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.trade_policy_docs COMMENT 'Crestwood trade promotion guidelines, post-event methodology, ValuMax JBP, trade terms - documents searched by the Genie agent'")
VOLUME_PATH = f"/Volumes/{catalog}/{schema}/trade_policy_docs"
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
src_dir = f"/Workspace{bundle_root}/src/trade_docs"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".md"))
assert files, f"no documents found in {src_dir}"
for fn in files:
    with open(f"{src_dir}/{fn}", "rb") as fr, open(f"{VOLUME_PATH}/{fn}", "wb") as fw:
        fw.write(fr.read())
    print(f"  {fn} -> {VOLUME_PATH}/{fn}")
print(f"Uploaded {len(files)} trade-policy documents.")
