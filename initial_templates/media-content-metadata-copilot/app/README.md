# Metadata Copilot — Databricks App (Orbitline+)

The content-operations workbench of the *Automated content metadata generation / Content enrichment & taxonomy*
demo (see the template's top-level README for the story and demo script).

| Route | What |
|---|---|
| `/` | Home — the catalogue wall: editorial masthead (Harborlight discovery gap, live from Lakebase) over a poster wall of the Harborlight shelf (generated poster art, completeness rings, tags, 4-week impressions), starter questions |
| `/library` | Metadata queue — Hidden gems / Safety review / Harborlight library / Reviewed / All |
| `/titles/:id` | Title workbench — live metadata, scenes, **Run AI re-tag** (streamed), editable diff, standards checks with citations, the Genie agent's Standards Guide answer, look-alikes + projected lift, clips, **Approve & publish** (Lakebase write-back + audit trail) |
| `/analytics` | Weekly impressions per title (pilot vs control vs rest) + completeness bands (SQL warehouse) |
| `/dashboard` | Embedded AI/BI dashboard |

- **AI re-tag** (`server/services/retag.ts`, `POST /api/titles/:id/retag`): AI Functions proposal (computed in Delta
  by the setup job) → deterministic Standards Guide rules (`lib/metadata.ts`) → Genie agent (documents) → Vector Search
  look-alikes → editor brief (`WRITER_MODEL`, default databricks-claude-sonnet-4-5).
- **Decision** (`POST /api/titles/:id/decision`): publishes the (edited) proposal to `app.titles.meta`, recomputes
  completeness / tier / rating / home rows, appends the before/after to `audit_trail`.
- **Chat agent** (`server/agent/copilot.ts`, databricks-gpt-5-4): `ask_data` (the Genie agent: analytics + Standards Guide), `find_titles`,
  `more_like_this`, `find_clips`.
- **Reset** (`POST /api/admin/reset`, header button): wipes app tables and re-syncs the library from Delta.

Local run: `cp .env.template .env`, fill it, then `DATABRICKS_CONFIG_PROFILE=<profile> DATABRICKS_APP_PORT=8825 ./start.sh`.
