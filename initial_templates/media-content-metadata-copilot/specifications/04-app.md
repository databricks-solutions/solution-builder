# 04 — Databricks App: Metadata Copilot (content-ops workbench)

Forked from the solution-builder app template (Node/Express AppKit + React + Lakebase/Drizzle + OpenAI Agents SDK + MLflow tracing).

| Route | What it shows |
|---|---|
| `/` Home | Story hero (Harborlight share of catalogue vs impressions, completeness, completion — live from Lakebase), 4-step workflow, impressions per title by source, chat starter chips, KPIs, recent activity |
| `/library` Metadata queue | Scopes: Hidden gems / Safety review / Harborlight library / Reviewed / All; per row: completeness live → AI, impressions vs well-tagged peer, completion vs peer, flags (missing warnings, kids row, tier change) |
| `/titles/:id` Workbench | Key art + facts + exposure/completion/completeness; live metadata; scenes (evidence highlighted); **Run AI re-tag** (streamed) → editor brief → editable diff → warnings with evidence scenes → standards checks with citations → Standards Guide answer (Genie agent) → look-alikes + projected impact → **Approve & publish metadata** / Reject (Lakebase write-back + audit trail); promo clip + "Find matching clips across the library" |
| `/analytics` | Weekly impressions per title (pilot vs control vs rest) + completeness band table (SQL warehouse, `config/queries/*.sql`) |
| `/dashboard` | Embedded AI/BI dashboard |
| Chat dock | Agent (databricks-gpt-5-4) with `ask_data` (the Genie agent: analytics + Standards Guide), `find_titles` (Lakebase queue), `more_like_this` + `find_clips` (Vector Search) |

Server: `routes/titles.ts`, `db/queries/titles.ts`, `services/retag.ts`, `lib/metadata.ts`, `lib/vs.ts`, `lib/serving.ts`,
`agent/copilot.ts`, `db/sync.ts` (boot-time Delta → Lakebase mirror of 1,400 titles + 9.7k scenes). Lakebase database
`dbgen_content_metadata_copilot` in project `solution-builder`. Header **Reset demo** re-syncs from Delta.
