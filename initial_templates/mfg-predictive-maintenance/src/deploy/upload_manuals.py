"""Copy the pre-rendered manual PDFs (src/documents/pdf, synced by the bundle) into the UC volume
/Volumes/<catalog>/<schema>/manuals — the documents the Genie agent searches (the whole volume is indexed)."""
import argparse
import os
import shutil

ap = argparse.ArgumentParser()
ap.add_argument("--catalog", required=True)
ap.add_argument("--schema", required=True)
ap.add_argument("--src-dir", required=True)
a, _ = ap.parse_known_args()

# The volume is created here (idempotent): the bundle doesn't declare it as a bundle resource because the
# schema only exists once generate_data has run.
from pyspark.sql import SparkSession
spark = SparkSession.getActiveSession() or SparkSession.builder.getOrCreate()
spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{a.catalog}`.`{a.schema}`")
spark.sql(f"CREATE VOLUME IF NOT EXISTS `{a.catalog}`.`{a.schema}`.manuals")

src = a.src_dir if a.src_dir.startswith("/Workspace") else "/Workspace" + a.src_dir
dst = f"/Volumes/{a.catalog}/{a.schema}/manuals"
n = 0
for f in sorted(os.listdir(src)):
    if f.lower().endswith(".pdf"):
        shutil.copyfile(os.path.join(src, f), os.path.join(dst, f))
        n += 1
        print("uploaded", f)
print(f"{n} manuals -> {dst}")
