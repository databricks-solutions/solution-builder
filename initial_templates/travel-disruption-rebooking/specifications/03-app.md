# 03 — IROPS Copilot app (Databricks App on Lakebase)

AppKit (Node/Express + React), Lakebase `app.*` (flights + plan JSON + audit trail, options, passengers, hotels, guardrails, chat),
OpenAI Agents SDK on `databricks-gpt-5-4`, MLflow tracing. Name `disruption-rebooking-copilot`, local port 8828.

| Page | Purpose |
|---|---|
| Home `/` | Storm headline + live tiles (5,266 disrupted, 2,229 to Sunday, 248/283 SSR overnight, 14/17 UMNR overnight), four-step workflow, "Where AutoProtect hurt most" (AE 1418 on top), Ask-the-Copilot chips, desk activity |
| Disrupted flights `/flights` | 36 cancellations sorted by SSR overnight + misconnects, plan status |
| Flight workbench `/flights/:id` | Manifest (Needs protecting / Escalated messages / All; expand a row for AI message insight + ML risk), Seats & hotels, **Re-accommodate** (streamed), plan vs AutoProtect table, guardrails, Duty Manager summary, policy answer (Genie agent), notifications, **Submit to Duty Manager** / **Commit plan** |
| Approvals `/approvals` | Duty Manager queue, note, **Approve & commit** (Lakebase + Delta write-back) / **Send back** |
| Recovery analytics `/analytics` | Same-day rate by month (AutoProtect vs pilot), method scorecard, committed plans from Delta |
| Ops dashboard `/dashboard` | Embedded AI/BI dashboard |

**Chat agent tools:** `ask_data` (Genie agent: tables + policy documents), `list_disrupted_flights`, `get_priority_passengers`, `plan_reaccommodation`
(saves a draft plan), `submit_plan_for_approval`. It never commits.

**Auth:** OBO token first; `authedFetch` / the OpenAI fetch shim retry once as the app SP on 401/403. App SP grants: UC read on the
schema + MODIFY on the two write-back tables, READ_VOLUME, CAN_RUN on Genie, Lakebase role grants.

**Reset:** header button → truncate desk tables + chat, `DELETE` desk rows from the Delta write-back tables, re-sync from Delta.
