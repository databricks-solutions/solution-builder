export const AUTO_BUILD_KICKOFF = `Auto-build mode: build this demo end-to-end, all the way to deployed resources on the workspace. Do not stop, do not ask, do not narrate. Read DEMO_SKILL once before you start — it contains the per-stage execution guidance you'll follow.

Then walk this checklist top to bottom. For every line, check whether the artifact already exists; if it does, skip it; if it doesn't, create it now. Do not redo or rewrite anything that already exists.

1. PROJECT/resources.json — capabilities populated (buildable + talking_track) per the user's selection
2. PROJECT/README.md — exists and ≥200 chars, with a clear protagonist, challenge, business value
3. PROJECT/architecture.md — exists, with the architecture diagram schema (JSON) for visual rendering
4. PROJECT/specifications/01-lakeflow.md — exists (data + pipeline spec), per DEMO_SKILL stage 2
5. PROJECT/specifications/0{2,3,4}-*.md — one spec file per other selected capability, batch-written in a single turn
6. PROJECT/**/*.py and/or *.sql — implementation code for every spec, per DEMO_SKILL stage 3
7. PROJECT/databricks.yml — DAB bundle config covering every resource, per DEMO_SKILL DAB reference
8. Deployed resources tracked in PROJECT/resources.json.created_resources for every entry in capabilities.buildable. Deploy in dependency order: catalog/schema → tables → pipelines (run to completion) → dashboards → Genie spaces → Knowledge Assistants → agents / Multi-Agent Supervisor → app. Update resources.json after each created resource. Verify upstream tables have rows before creating any dashboard / Genie / KA / agent that consumes them.

Rules:
- Choose sensible defaults instead of asking; document them in the artifact you're writing.
- Batch independent reads and independent writes in the same turn — every sequential round-trip you could have batched is wasted time.
- Only stop and surface a question if you hit a hard error you cannot recover from.
- Do not narrate intermediate steps. When you're done, finish with a short summary of what was created (with workspace links for deployed resources).`;
