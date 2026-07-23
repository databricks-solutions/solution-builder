---
name: Lakebase
category: apps-infra
disabled: false
buildable: true
skill: databricks-lakebase
genie_code_workshop: false
---

# Lakebase

Databricks-managed PostgreSQL for OLTP workloads. Relational database for operational app state — user sessions, case management, action logs, configuration — complementing the analytical lakehouse. Synced tables enable bidirectional data flow between Lakebase and Delta.

## When to Use

- When a Databricks App needs to read/write operational state (case status, user actions, investigation notes, approval workflows).
- When the narrative requires "closing the loop" — hero persona investigates and takes action, action is recorded.
- When demonstrating reverse ETL: Gold table insights pushed to an operational system.
- NOT needed for pure analytics demos — if the demo stops at "here is what we found," Lakebase adds no value.

## Key Decisions

1. **Database schema:** 2-4 tables for operational state. Keep simple — cases, actions, users, config. Not analytical tables.
2. **Sync configuration:** Synced tables flow data between Lakebase and Delta. Define direction (Delta->Lakebase for app reads, Lakebase->Delta for analytics).
3. **Connection method:** Resource bindings in `app.yaml` or SDK credential generation — never expose raw connection strings.

## Pitfalls

- Using Lakebase as primary analytical store — it is OLTP, not OLAP. Keep analytical queries in the lakehouse.
- Too many tables — demo should have 2-4 small operational tables, not a data layer replica.
- Forgetting synced tables — without sync, app and lakehouse are disconnected islands.
- Hardcoding credentials instead of SDK-generated credentials or resource bindings.
- Not provisioning before demo — Lakebase creation takes a few minutes.

## Connections

- **Databricks App:** App reads/writes Lakebase for operational state (case management, action logs).
- **Declarative pipeline:** Synced tables bring Gold insights into Lakebase or operational data back to Delta.
- **Dashboard:** Synced operational data (case resolutions, actions taken) can appear on dashboards.
- **Streaming:** Near-real-time sync keeps operational state current with streaming data.

## URL
Best practices: https://www.databricks.com/blog/beyond-provisioning-developers-guide-databricks-lakebase-autoscaling
https://docs.databricks.com/aws/en/lakebase/index.html
