# IROPS Copilot — Databricks App (Aeralis Airways)

The IROPS desk of the *autonomous disruption response & rebooking* demo (see the template's top-level
`README.md` for the story and the demo script). Node + Express (`@databricks/appkit`) + React, Lakebase for the
operational state, OpenAI Agents SDK for the chat agent, MLflow tracing. Aeralis Airways and Lumen Air are fictional.

## Pages
| Route | View |
|---|---|
| `/` | Home — ORD operations centre: split-flap departures board, OSM route map (IATA-keyed, `lib/airports.ts`), passenger priority lanes, rebooking progress, *Ask the Copilot* starters, recent desk activity |
| `/flights` | Disrupted flights — the 36 cancellations, worst AutoProtect outcome first, plan status |
| `/flights/:id` | Flight workbench — manifest in priority order (SSR, connections, AI-classified messages, ML detractor risk) vs AutoProtect's hold, seats + hotels, **Re-accommodate** (streamed plan), plan vs AutoProtect, guardrails, policy answer (Genie agent), notifications, submit / commit |
| `/approvals` | IROPS Duty Manager queue — Approve & commit / Send back |
| `/analytics` | AutoProtect vs the DEN desk-priority pilot + live committed plans (`config/queries/*.sql`) |
| `/dashboard` | The embedded AI/BI dashboard (`DASHBOARD_ID`) |
| `/c/:id` | Full-page chat (the chat dock opens on every page) |

## How it works
- **Plan** (`server/services/reaccom.ts`, `POST /api/flights/:id/plan`): deterministic allocation — bookings kept
  together, priority order (special assistance → onward long-haul → urgent life event → tier → away from home → local),
  UMNR / WCHC / nearby-airport rules, partner cost caps, hotel entitlement, AutoProtect priced on the same cost model —
  then the Genie agent over the policy documents (`GENIE_SPACE_ID`) and `NOTICE_MODEL` (Duty Manager summary + personalised notifications).
- **Approval + commit** (`/submit`, `/approve`): plans over the $6,000 partner-spend auto-approve limit wait for the Duty
  Manager; commit writes the rebookings to Lakebase (seats and hotel rooms decrement) and back to Delta
  (`rebooking_plans`, `rebooking_decisions`) for the dashboard and Genie.
- **Chat agent** (`server/agent/irops.ts`): `ask_data` (the Genie agent: ops analytics + policy documents), `list_disrupted_flights`, `get_priority_passengers`,
  `plan_reaccommodation`, `submit_plan_for_approval` — it never commits.
- **Auth**: model / Genie calls go out with the viewer's OBO token and retry once as the app service principal if
  the token is rejected (`server/lib/auth.ts::authedFetch`).
- **Reset** (header button): wipes the desk tables + chat history, deletes the desk's Delta write-back rows and re-syncs.

## Run / deploy
Local: `cp .env.template .env`, fill it in, then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8828 ./start.sh`.
Deploy: see the template's `dab_instructions.md`.
