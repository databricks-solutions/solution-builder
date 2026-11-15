# 03 — NOC Copilot app (Databricks App, AppKit + React, Lakebase)

- **Lakebase** (`dbgen_noc_copilot` in project `dbdemos-asset-generator`): `app.incidents` (mirror of `noc_incidents` + triage JSON, decision, audit trail), `app.trouble_tickets` (write-back: priority, root cause, actions, dispatches, child alarms suppressed), chat tables.
- **Pages:** Home (story + live tiles), Incident queue, Incident workbench, Tickets & dispatch, Network analytics, Ops dashboard (embedded AI/BI).
- **Triage agent** (`server/services/triage.ts`, `databricks-claude-sonnet-4-5`, chat-completions tool loop, ≤ 14 turns): `get_incident_context`, `get_topology`, `search_alarm_history`, `get_optics`, `get_cell_kpis`, `get_customer_impact`, `check_planned_activity`, `find_technicians`, `ask_noc_runbook` (the Genie agent over the runbook documents) → `submit_triage` (verdict, priority, root cause, timeline, impact, actions A-01..A-10, dispatch, notifications, restore estimate, runbook citations). Streamed step by step (SSE).
- **Write-back:** "Open trouble ticket & dispatch" (one parent ticket, child alarms suppressed, selected technicians dispatched) or "Close as explained".
- **Chat dock** (`databricks-gpt-5-4`, Responses API): `ask_data` (the Genie agent: network analytics + NOC runbooks), `find_incidents`.
- Auth: viewer OBO token; every model / Genie call retries once as the app SP on 401/403 (`lib/auth.ts authedFetch`).
