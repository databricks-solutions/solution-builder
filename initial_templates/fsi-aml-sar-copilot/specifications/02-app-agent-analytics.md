# 02 — Investigator app, SAR agent, dashboard, Genie agent

## App `aml-sar-copilot` (app/)
* **Queue** `/`: KPIs (open, ML critical ≥ 70, critical networks, past the 10-day triage SLA, historical FP rate), the
  hidden-network banner, an ML vs rules ranking toggle, and a network badge per alert.
* **Network** `/network/:id`: SVG graph (individuals → shells → hub → offshore beneficiaries), shared-identifier links,
  and a party list with ML scores.
* **Case** `/case/:id`: reason codes, network summary, 60-day cash-per-day chart, transactions, copilot panel, decision
  (file / escalate / close, with a rationale required), and the audit trail.
* All SQL runs as the app service principal through the bound warehouse, with named parameters only.

## SAR agent (server/agent/sar-agent.ts)
Foundation Model API chat completions with tools (default `databricks-claude-sonnet-4-5`), up to 12 turns, and
parallel tool execution within a turn. Tools: `get_case_overview`, `get_cash_activity`, `get_fund_flows`,
`get_linked_parties`, `get_alert_history`, `search_aml_policy` (Genie agent, Agent mode, over the policy documents) and `submit_sar_draft` (narrative,
recommendation, rationale, red_flags, amount). It streams steps to the UI over SSE and persists the draft to
`sar_drafts` plus the audit log.

## Dashboard (dashboard/compliance_dashboard.lvdash.json, schema-less datasets)
Page 1 *Compliance overview*: 6 counters, alert volume by outcome, FP rate, days-to-file vs 30, late-filing share,
and analyst hours on false positives by scenario. Page 2 *ML queue & networks*: rules rank vs ML risk scatter, the
networks table and the live `case_decisions` table.

## Genie agent (genie/genie_space.json, serialized v2)
8 tables (sorted) + the documents volume `aml_policy_docs` (`src/policy_docs/*.md`: BSA/AML Program Policy, Structuring
Red Flags RF-03, SAR Narrative Standard SAR-04, High-Risk Jurisdictions HRJ-02, Disposition QA AD-01). Instructions define
the FP rate (dispositioned only), the SLA breach and "Bayline" = NET-290001, and route numbers to the tables and
policy questions to the documents. 8 sample questions with verified SQL + 1 policy question. Documents are answered in
Agent mode only (the app's `search_aml_policy` tool uses it).
