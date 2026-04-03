---
name: Lakebase
slug: lakebase
category: capability
tags: [lakebase, postgresql, oltp, operational, sync]
description: >
  Context for generating Lakebase specifications, including when managed PostgreSQL adds value
  to a demo, connection patterns, sync configuration for reverse ETL, and how Lakebase bridges
  the gap between analytical lakehouse tables and operational application state.
related: [databricks-app, declarative-pipeline, streaming]
---

# Lakebase

## What It Does

Lakebase is Databricks-managed PostgreSQL for OLTP workloads. It provides a relational database for operational application state — user sessions, case management, action logs, configuration — that complements the analytical lakehouse. Synced tables enable bidirectional data flow between Lakebase and Delta tables.

## When to Use in a Demo

- When the demo includes a Databricks App that needs to read/write operational state (case status, user actions, investigation notes, approval workflows).
- When the narrative requires "closing the loop" — the hero persona not only investigates but takes action, and that action is recorded.
- When demonstrating reverse ETL: Gold table insights pushed back to an operational system.
- NOT needed for pure analytics demos — if the demo stops at "here is what we found," Lakebase adds no value.

## Key Configuration Decisions

1. **Instance type:** Provisioned for predictable workloads, Autoscaling for demos with variable load. Autoscaling supports scale-to-zero for cost efficiency.
2. **Database schema:** Design 2-4 tables for operational state. Keep it simple — cases, actions, users, configuration. These are not analytical tables.
3. **Sync configuration:** Synced tables replicate Delta Gold tables into Lakebase for app consumption, or Lakebase operational data back into Delta for analytics. Define sync direction and refresh cadence.
4. **Connection method:** Apps connect via resource bindings in `app.yaml`. Notebooks connect via `databricks-sdk` credential generation. Never expose raw connection strings.
5. **Branching (Autoscale):** Use database branches for dev/test isolation without copying data. Branches are instant and zero-copy.

## Common Pitfalls

- Using Lakebase as the primary analytical store — it is for OLTP, not OLAP. Keep analytical queries in the lakehouse.
- Creating too many tables — Lakebase in a demo should have 2-4 small operational tables, not a replica of the entire data layer.
- Forgetting to set up synced tables — without sync, the app and lakehouse are disconnected islands.
- Hardcoding credentials instead of using SDK-generated credentials or resource bindings.
- Not provisioning the instance before the demo — Lakebase creation takes a few minutes.

## How It Connects to Other Components

- **Databricks App:** The app reads/writes Lakebase for operational state (case management, action logs).
- **Declarative pipeline:** Synced tables bring Gold insights into Lakebase or operational data back to Delta.
- **Dashboard:** Synced operational data (case resolutions, actions taken) can appear on dashboards.
- **Streaming:** Near-real-time sync can keep operational state current with streaming data.

## Example Specification Snippet

```yaml
lakebase:
  instance_name: "fraud-ops-db"
  instance_type: autoscaling
  tables:
    - name: investigation_cases
      columns: [case_id, alert_id, status, assigned_to, opened_at, closed_at, notes]
      purpose: "Track fraud investigation lifecycle"
    - name: investigation_actions
      columns: [action_id, case_id, action_type, performed_by, timestamp, details]
      purpose: "Log actions taken (block card, flag merchant, escalate)"
    - name: merchant_watchlist
      columns: [merchant_id, risk_level, added_date, reason, reviewed_by]
      purpose: "Operational watchlist for merchant monitoring"
  synced_tables:
    - direction: delta_to_lakebase
      source: gold_compromised_cards
      target: compromised_cards_live
      refresh: "5 minutes"
    - direction: lakebase_to_delta
      source: investigation_actions
      target: bronze_investigation_actions
      refresh: "continuous"
```
