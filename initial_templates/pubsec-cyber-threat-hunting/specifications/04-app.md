# 04 — Threat Hunting Copilot app (Databricks App + Lakebase)

Node/Express (AppKit) + React. Lakebase `app.leads` (mirror of `investigation_leads`, + investigation, disposition,
audit trail) and `app.incident_cases` (write-back). Pages: Home, Lead queue, Lead workbench, Incident cases,
Hunt analytics, CISO dashboard (embedded), chat dock.

**Investigation agent** (`server/services/investigate.ts`, `databricks-claude-sonnet-4-5`, ≤14 turns): tools
`get_lead_context`, `search_sign_ins` (user or IP prefix), `search_vpn_sessions`, `search_endpoint_activity`
(user and/or host), `search_dns` (host or domain), `ask_ir_playbook`; every SQL tool is parameterized and input-validated.
Must end with `submit_investigation` {verdict, severity, headline, summary, timeline 8–14 rows with technique ids,
techniques, containment (C-01..C-09 catalog), notifications, benign_evidence, records_at_risk, playbook_citations}.
The server enriches techniques with names / tactic / CDOR coverage from `attack_techniques`.

**Write-back:** `POST /api/leads/:id/case` (severity, title, selected containment, notes → `incident_cases`, lead
escalated, audit entry) and `POST /api/leads/:id/close` (benign disposition + evidence). Reset: `POST /api/admin/reset`.

**Chat dock** (`server/agent/copilot.ts`, `databricks-gpt-5-4` Responses API): `ask_data` (the Genie agent: telemetry analytics + IR playbook),
`find_leads`. All model / Genie calls use the viewer OBO token and retry once as the app SP on 401/403.
