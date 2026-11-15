# Trial Site Copilot — Databricks App (Halcyra Therapeutics)

The clinical-operations workbench of the *clinical trial protocol design & site selection* demo (see the template's
top-level README for the story and demo script).

| Route | What |
|---|---|
| `/` | Portfolio home: CASCADE-CKD headline, 4-step AI workflow, randomized vs plan per trial, chat starters, recent activity |
| `/trials/CASCADE-CKD` | Trial workbench: enrollment vs plan, screen failures (as coded vs real reason read by AI Functions), eligible-pool funnel, site health, **Run rescue analysis** (streamed), amendment proposal + protocol-assistant citations, projection, model-ranked rescue sites, closure review, memo, **Approve rescue plan** (Lakebase write-back), audit trail |
| `/sites` | Site network (Leaflet OSM map) + tables (active / model-ranked candidates / study-manager actions) |
| `/analytics` | Portfolio analytics from `config/queries/*.sql` |
| `/dashboard` | Embedded AI/BI portfolio dashboard |

- **Rescue analysis** (`server/services/rescue.ts`, `POST /api/trials/:id/rescue`): deterministic facts from the gold tables +
  `site_scores` → the Genie agent over the protocol documents (`GENIE_SPACE_ID`) → projection (`shared/projection.ts`, also used client-side) → memo (`MEMO_MODEL`).
- **Chat agent** (`server/agent/trial-copilot.ts`): `ask_data` (the Genie agent `GENIE_SPACE_ID`: analytics + protocol documents), `screen_fail_breakdown`,
  `simulate_amendment`, `rank_rescue_sites`, `site_performance`, `rescue_plan_status`.
- **Lakebase** (`server/db/schema.ts`): `app.site_ops`, `app.rescue_plans` + chat tables; seeded from Delta at boot (`server/db/sync.ts`).
- **Reset** (`POST /api/admin/reset`, header button): wipes plans/conversations and re-syncs the site network.

Local: `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8822 ./start.sh` with `.env` from `.env.template`.
