# 02 — Genie agent (tables + policy documents), AI/BI dashboard

## Documents — the Genie agent's `policy_docs` volume (Agent mode)
Source: files in `/Volumes/<catalog>/<schema>/policy_docs/` (11 policies + MV-UM-000), listed in the agent's
`data_sources.volumes`. Used by the app's **Ask the medical policy** box on every case and by the agent's `ask_data` tool.
Example: *"Who is allowed to deny a prior authorization at MedVault?"* → "Only a Medical Director may deny…".

## Genie agent — "MedVault Prior Authorization Operations" (`genie/genie_space.json`, serialized v2)
Tables (sorted): ai_case_review, medical_policies, members, pa_requests, policy_criteria, providers, reviewers,
snapshot_info, um_decisions. Text instructions carry the CMS-0057-F definitions, the weekend-fax window, the four
planted findings, the join keys and the tables-vs-documents routing; 7 example SQLs (all tested on the warehouse); 9 sample
questions (the last one answered from the documents):
- Why are we missing the 72-hour clock on expedited requests?
- Which practice group has the highest pend rate for lumbar spine MRI, and why?
- What share of requests met every criterion on first review, and how long did they wait?
- How is the auto-approval rate trending week over week? · What does the open queue look like by AI lane?
- Which practice groups are gold-card candidates? · Denial rate by line of business? · Workbench decisions today?
- Who is allowed to deny a prior authorization request, and which requests are eligible for the auto-approval lane?
Deployed by `src/deploy/deploy_genie.py` (parent = the demo's workspace folder).

## AI/BI dashboard — `dashboard/dashboard.lvdash.json` (schema-less datasets)
Page 1 · CMS scorecard: counters (expedited within 72h, standard within 7d, clean on first review, median turnaround,
denial rate, open backlog), weekly SLA vs first-pass-clean vs auto-approval line, open queue by AI lane, daily
08:00 backlog area chart. Page 2 · Where the time goes: expedited compliance by arrival window × channel, median
turnaround by decision path, pend rate by practice group, top pend reasons, decisions written back from the app.
