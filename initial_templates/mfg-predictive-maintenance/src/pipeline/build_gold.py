"""Build the GOLD layer (views + UC metric view) from gold.sql.

Usage: python build_gold.py --catalog manufacturing --schema predictive_maintenance_copilot
Runs on the ambient SparkSession (job / serverless) or Databricks Connect locally.
"""
import argparse
import os
import re


def statements(sql: str):
    buf = []
    for part in sql.split(";\n"):
        buf.append(part)
        joined = ";\n".join(buf)
        if joined.count("$$") % 2 == 0:
            stmt = re.sub(r"^\s*(--[^\n]*\n\s*)*", "", joined).strip().rstrip(";")
            if stmt:
                yield stmt
            buf = []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="predictive_maintenance_copilot")
    ap.add_argument("--sql-file", default=None, help="path to gold.sql (defaults to the file next to this script)")
    args, _ = ap.parse_known_args()
    try:
        from pyspark.sql import SparkSession
        spark = SparkSession.getActiveSession() or SparkSession.builder.getOrCreate()
    except Exception:
        from databricks.connect import DatabricksSession
        spark = DatabricksSession.builder.serverless(True).getOrCreate()
    path = args.sql_file or os.path.join(os.path.dirname(os.path.abspath(__file__)), "gold.sql")
    if path.startswith("/") and not path.startswith("/Workspace") and not os.path.exists(path):
        path = "/Workspace" + path
    sql = open(path).read()
    sql = sql.replace("${catalog}", args.catalog).replace("${schema}", args.schema)
    for s in statements(sql):
        print("->", s.splitlines()[0][:110])
        spark.sql(s)
    print("gold layer built")


if __name__ == "__main__":
    main()
