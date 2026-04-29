export const AUTO_BUILD_KICKOFF = `Auto-build mode: drive this project end-to-end without pausing for confirmation. Do NOT redo completed work — figure out where the project is and continue from there.

Step 1 — Inspect current state (one batched turn, parallel reads):
- Read PROJECT/README.md, PROJECT/architecture.md, PROJECT/resources.json
- Glob PROJECT/specifications/*.md and Glob PROJECT/**/*.{py,sql} and Glob PROJECT/databricks.yml

From those signals, identify the current build stage on this ladder and resume from the next incomplete one:
DRAFTING → SUMMARIZED (README.md ≥ 200 chars) → ARCHITECTED (architecture.md) → SPECIFICATION (specifications/*.md) → BUILT (.py/.sql code) → BUNDLED (databricks.yml) → DEPLOYED (resources created on the workspace, tracked in resources.json).

Step 2 — Read DEMO_SKILL for stage-specific workflow guidance, then continue from the stage you're at all the way through to deployed resources: catalog/schema, tables, pipelines, dashboards, Genie spaces, Knowledge Assistants, and agents in dependency order. Update resources.json after each created resource.

Rules:
- Do not redo work already done at earlier stages — only fill gaps and advance.
- Choose sensible defaults instead of asking; document them.
- Only stop and surface a question if you hit a hard error you cannot recover from.
- Do not narrate intermediate steps. Finish with a short summary of what stages advanced.`;
