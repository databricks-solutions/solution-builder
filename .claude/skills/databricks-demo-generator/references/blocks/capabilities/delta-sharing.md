---
name: Delta Sharing
category: uc-governance
disabled: false
buildable: false
---

# Delta Sharing

Open protocol for **zero-copy sharing** of live data, views, volumes and models across orgs, platforms and clouds.

## Pain

B2B data exchange today = S3 buckets, SFTP, CSVs, custom APIs. Feeds break, go stale, and once data leaves, governance is gone. Every new partner is a mini-integration project.

## Key Features

- **Zero-copy** - no data movement, query in place
- **Cross-platform** - works with any Delta/Iceberg client
- **Live data** - always current, no sync lag
- **Governed** - access controls, audit logs preserved
- **Volumes & models** - share files and ML models, not just tables

## Position

FSI: bureaus, partners, regulators, consortiums. Retail/MFG: supply-chain, joint-venture analytics. "We share this table with a partner → they live-query it in their own tool."

## How It Works

- **You create a "share"**: Select tables/views in Unity Catalog, define who can access them
- **Recipients query your data**: They connect from their tool (Databricks, Spark, pandas, Power BI) and query live — no data copy sent
- **Always fresh**: Recipients see current data, not a stale export — you control access centrally
- **Open protocol**: Recipients don't need Databricks — any Delta Sharing client works

## Demo Tips

- Great for B2B data exchange scenarios
- Emphasize: zero-copy, no data movement, always fresh
- Position as the secure way to share data externally

## URL

https://www.databricks.com/product/delta-sharing
