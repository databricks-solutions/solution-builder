# Threat Hunting Copilot — app

The SOC analyst workbench of the *Cybersecurity (threat hunting, UEBA, SIEM augmentation)* demo (see the
template's top-level README for the story and demo script). Node + Express (`@databricks/appkit`) + React,
Lakebase for the writable state, the SQL warehouse for everything in Delta.

| Route | What it is |
|---|---|
| `/` | Home — SOC console: queue ticker, UEBA risk leaderboard, priority-lead swimlane timeline, ATT&CK coverage matrix (blind spots in red), Copilot query rail |
| `/leads` | UEBA lead queue (mirrored from `investigation_leads` into Lakebase at boot) |
| `/leads/:id` | Lead workbench — UEBA 21-day trend + top factors, raw evidence, **Investigate this lead** (streamed agent pivots), verdict, incident timeline, MITRE ATT&CK mapping with CDOR detection coverage, containment plan (IR playbook PB-7.1), **Open incident case** / **Close as benign** write-back + audit trail |
| `/cases` | Incident cases opened from the workbench (Lakebase `app.incident_cases`) |
| `/analytics` | Hunt analytics — the low-and-slow spray per day, detection-rule efficacy |
| `/dashboard` | Embedded AI/BI dashboard (CISO view) |

- **Investigation agent** (`server/services/investigate.ts`): `INVESTIGATION_MODEL` (default
  `databricks-claude-sonnet-4-5`) in a chat-completions tool loop. Tools are parameterized read-only SQL over
  `DEMO_CATALOG.DEMO_SCHEMA` (sign-ins, VPN, EDR, DNS, UEBA, alerts, travel, tickets) plus `ask_ir_playbook`
  (the Genie agent `GENIE_SPACE_ID` over the playbook documents); it must finish with `submit_investigation`.
- **Chat agent** (`server/agent/copilot.ts`): `databricks-gpt-5-4` on the Responses API with `ask_data`
  (the Genie agent `GENIE_SPACE_ID`: telemetry analytics + the IR playbook) and `find_leads`.
- Every model / Genie call uses the viewer's OBO token and retries once as the app service principal on 401/403.
- **Reset demo** (header) wipes the Lakebase tables and re-syncs the lead queue from Delta.

Local run: copy `.env.template` → `.env`, fill the values, then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8827 ./start.sh`.
