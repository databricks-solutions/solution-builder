# 04 — Databricks App "Warranty Copilot" (`app/`)

AppKit (Node/Express + React), Lakebase `dbgen_warranty_copilot` (`app.*`), OBO auth with app-SP fallback, MLflow tracing.

| Route | Purpose |
|---|---|
| `/` | Headline + KPI tiles (`/api/charts/warranty_kpis`), signal cards, chat starters, recent activity |
| `/signals` | Early-warning board (`/api/charts/early_warning`) |
| `/signals/:id` | Workbench: weekly claims, cohort chart, claims with AI chips, **Assemble root-cause case** (SSE), priced options, supplier notice, **Open quality case** |
| `/claims` | Claims explorer (AI mode vs dealer code, mismatch filter, search) |
| `/cases` | Quality cases (write-back table) |
| `/analytics` | Monthly claims per 1K, Hanlin lots, supplier recovery |
| `/dashboard` | Embedded AI/BI dashboard |

Chat agent tools: `ask_data` (the Genie agent: analytics + supplier documents), `list_warranty_signals`, `get_root_cause_evidence`,
`open_quality_case` (explicit requests only). Starter chain lives in `config/app.json` → `assistantScript`.
The header's **Reset the demo** calls `POST /api/admin/reset`, which truncates the app tables and re-syncs them from Delta.
