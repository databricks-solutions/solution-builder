# Readmission Copilot — Databricks App (Larkspur Health)

The care-transitions command center of the *reduce hospital readmissions* demo (see the template's top-level README for
the story and the demo script).

| Route | What |
|---|---|
| `/` | Care-transitions board: the 4 West heart-failure headline, a unit census strip (HF readmissions by unit), the discharge whiteboard (LACE inputs, risk tier, follow-up status, 30-day timeline per patient, filterable), HF trend, 4 West by discharge weekday, follow-up effect, note-only social risks, chat starters, activity, what changed on the unit |
| `/worklist[/:encounterId]` | Discharge worklist ranked by `readmission_risk_model@champion` + the transition workspace: risk, drivers, what-if with a 7-day follow-up, what AI Functions read in the discharge note, prior admissions, **Build transition plan** (streamed), care-pathway guidance (Genie agent), task list, 48-hour call script, **Approve plan & create outreach tasks** (Lakebase write-back) |
| `/outreach` | Outreach queue (Lakebase): tasks from approved plans and from the copilot; mark done |
| `/hrrp` | CMS HRRP exposure: penalty by hospital, ERR by hospital × condition, deterministic what-if slider (`shared/hrrp.ts`) |
| `/analytics` | Readmission analytics from `config/queries/*.sql` |
| `/dashboard` | Embedded AI/BI dashboard (`DASHBOARD_ID`) |

- **Transition plan** (`server/services/transition-plan.ts`, `POST /api/worklist/:id/plan`): worklist row (risk + drivers + note
  insights) → unit events → Genie agent (documents) → deterministic pathway task rules → summary + call script (`MEMO_MODEL`).
- **Chat agent** (`server/agent/care-copilot.ts`): `ask_data` (the Genie agent: analytics + pathway documents), `readmission_signal`, `hrrp_exposure`,
  `get_worklist`, `get_patient`, `build_transition_plan`, `create_outreach_task` (write-back), `outreach_queue`.
- **Lakebase** (`server/db/schema.ts`): `app.worklist`, `app.transition_plans`, `app.outreach_tasks` + chat tables; the worklist is
  seeded from Delta (`transition_worklist`) at boot (`server/db/sync.ts`).
- **Resources**: `GENIE_SPACE_ID` is read at boot from `<catalog>.<schema>.demo_resources` (written by the
  setup job) unless set in the env (`server/services/resources.ts`).
- **Reset** (`POST /api/admin/reset`, header button): wipes plans, tasks and conversations and re-syncs the worklist.

Local: `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8802 ./start.sh` with `.env` from `.env.template`.
