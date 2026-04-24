# Stage 03 — Build Resources

Run this only after the user confirms at the stage-2 build-or-stop gate — creating the actual Databricks resources that implement the specs.

All resource files (.py, .sql, .yaml, …) must go in the project folder.

## Building with skills

**Each resource has a dedicated ai-dev-kit skill under `SKILLS/<skill-dir>/SKILL.md`.** The full list — dir name + one-line purpose — is already in your system prompt under *Available Skills*; pick the one that matches the capability in `resources.json`. If unsure, `ls SKILLS/` to confirm what's present at runtime.

Read the skill's `SKILL.md` BEFORE building — it contains the exact CLI commands, auth flow, and verification steps. Use the CLI the skill documents; do NOT use MCP tools.

For each capability: **read `SKILLS/<skill-dir>/SKILL.md` → read the spec file → create the resource → validate → update `resources.json` with the resource ID**.

Important capabilities with instructions for you to check if you need to build them: 
Dashboard => read aibi-dashboards.md
Metric views => read metric-view.md
ML model => read ml-training-serving.md (you must deploy it as a databricks serverless job, no spark connect)

## Build-order gates — do not skip

Consumption resources depend on upstream data. The dependency graph is in `SKILL_DIR/references/platform_architecture.md`. The core rule:

> **Never create a downstream resource before its upstream data exists and is verified.**

Before creating any dashboard, Genie space, KA, or agent: verify every table/document it references exists and has rows. If a gate fails, STOP and fix upstream — do not proceed.

**CRITICAL: keep spec files in sync.** If you change a resource during build, or if the user asks you to change one, update its spec file first.

## Parallelization with subagents — PARENT ONLY

> **Subagents: skip this section.** It's the parent agent's responsibility to decide what to parallelize. If you're a subagent, stop reading here — your prompt told you exactly which resource to build.

Build time dominates this stage. Several resources are independent — run them in parallel with subagents. The table below is **one example** (matching the LuxeBeauty reference demo); adapt it to whatever resources your demo actually has. The principle is what matters: independent resources run in parallel; dependencies gate with the wait rules below, while avoiding having too many subagents running at once.

| Stage | Run where | Runs in parallel with | Blocks on |
|-------|-----------|-----------------------|-----------|
| `01-lakeflow` A (synthetic data) | Main thread | — | — |
| `01-lakeflow` B (SDP pipeline) | Main thread, after A | — | A (needs raw data) |
| `01-lakeflow` C (incident PDFs) | Subagent, spawn with A | A + B | — |
| `02-uc-governance` | Main thread | — | B (needs tables) |
| `03-ai-bi` (Genie → Dashboard, sequential inside) | Subagent | `04-agent-bricks`, App | B |
| `04-agent-bricks` (KA → MAS, sequential inside) | Subagent | `03-ai-bi`, App | 01.C for KA step; B for MAS step |
| App generation | Subagent, spawn after 01.B | `03-ai-bi`, `04-agent-bricks` | 01.B (needs tables to wire the app), plus whatever resource IDs it embeds (dashboard id, MAS endpoint) — may need a brief wait at the end to fill those in |

The example shows that a **long-running task like App generation can start as soon as its minimum dependency is met** (tables exist after 01.B), rather than waiting for the whole build to finish. Apply this logic to any resource in your demo: as soon as its upstream is ready, spawn it in parallel with anything independent.

### Wait rules (non-negotiable)

- **Every subagent must complete before you start a section that consumes its output.** Example: KA creation needs the PDFs; wait on 01.C.
- **Do not declare the build complete (or summarize resource URLs) until ALL subagents have reported back.** If any are still running, tell the user you're waiting and stop the turn.
- When you spawn a subagent, tell the user in one short line (e.g. *"Spinning up Genie + Dashboard in the background — ~2 min. Continuing with the agent resources meanwhile."*). Do not ask follow-up questions until results are in.

## How to spawn a build subagent

First **read `SKILL_DIR/stages/subagents.md`** — it has the shared prompt structure (framing, speed rules, scope boundaries, completion format). This section only fills in the build-subagent-specific parts.

### Build-subagent — specifics to include in the prompt

**Framing sentence** (for section 1 of the shared template):

> You are a subagent spawned by the `databricks-demo-generator` skill, executing **Stage 03 (build)** — specifically, creating the [resource name, e.g. "AI/BI dashboard"] described in `[spec file]`. Your single job: create this one resource, validate it, update `resources.json` with its ID, and return id + URL. Do not build any other resources.

**Reads — substitute absolute paths**:

- `SKILLS/<skill-dir>/SKILL.md` — the ai-dev-kit skill for THIS resource type (pick from the *Available Skills* index in the system prompt; `ls SKILLS/` if unsure). Non-negotiable; it has the CLI + verification steps.
- `PROJECT/README.md` — the story (narrative context).
- `PROJECT/specifications/01-lakeflow.md` — data schemas (dashboards, Genie, KA, MAS all reference tables from here).
- `PROJECT/specifications/<relevant>.md` — the actual spec for THIS task.
- `SKILL_DIR/references/blocks/capabilities/<block>.md` — relevant capability block, if the spec skips positioning/pitfalls. Skip when the spec is self-sufficient.

**Project state to inline:** warehouse_id, catalog, schema, workspace_folder (from `PROJECT/resources.json`), plus any already-built resource IDs the subagent must reference.

**Blocking deps:** if the subagent depends on another in-flight subagent's output (e.g. KA needs PDFs from 01.C), tell it to wait before the blocking step.

**Completion format:** *"Return: `resource_type`, `resource_id`, `resource_url`, and list of fields you updated in `resources.json`."*

### Anti-patterns — do NOT do this

- **Inline the spec content or the README narrative** (widget layout, SQL for every dataset, schema definitions, story summaries). The files are the source of truth; the subagent reads them. Inlining introduces drift, costs tokens, and pre-decides what the subagent should decide.
- **Duplicate what a file says.** If it's in `app.md`, `TEMPLATE_MAP.md`, the ai-dev-kit skill, the spec, or the README — point at the file, don't re-type it in the prompt. When the file is updated, your prompt goes stale.
- **Re-enumerate step-by-step CLI commands.** The `SKILLS/<skill-dir>/SKILL.md` / `app.md` the subagent reads knows how to build the resource.
- **Pass unresolved placeholders.** Every `SKILL_DIR/…`, `PROJECT/…`, `SKILLS/…` in the prompt must be a real absolute path before you send it.
- **Don't include `stages/03-build.md`** — the subagent doesn't need the parent's parallelization table. But **DO include `SKILL.md`** as the first read for most build subagents (gates, coherence, storytelling). Skip it only for truly narrow tasks like PDF generation from an already-written spec. See `SKILL_DIR/stages/subagents.md`.

## App generation

If the demo includes a Databricks App (`databricks-apps` in `resources.json`), **spawn the app-build subagent automatically as soon as `01-lakeflow` B (the SDP pipeline) completes and the app spec exists** (tell the user it'll take a while). App generation is slow (~5 min) and can start before Genie / KA / MAS; kicking it off early lets it run in parallel with everything else.

Follow the shared playbook in `SKILL_DIR/stages/subagents.md` plus the build-subagent specifics above. App-build-specific additions:

**Framing sentence:**

> You are a subagent spawned by the `databricks-demo-generator` skill, executing **Stage 03 (build)** — specifically, customizing and deploying the Databricks App for this demo. Your single job: copy the template, rewrite it for this demo's story, wire config to the built resources, and deploy.

**Reads:** the core path is `SKILL_DIR/app/app.md` — it walks through copying the template, customizing it, and wiring config. Plus: `PROJECT/README.md`, `PROJECT/specifications/01-lakeflow.md`, all files under `PROJECT/specifications/app/`, and invoke the `fe-databricks-tools:databricks-apps` skill.

**Late-fill rule:** if the app embeds IDs from resources still being built in parallel (dashboard id, MAS endpoint), the subagent finishes template customization first and fills those in at the end once those resources are ready.

**Start only for the smoke test, then always stop.** The only time the agent runs `./start.sh` is the mandatory one-shot smoke test at the end of the build (see `SKILL_DIR/app/app.md` Step 5) — start it, let it boot up to ~60s, capture the log, then **unconditionally kill the process**. The UI owns the process lifecycle afterwards. A leftover `./start.sh` is an orphan the UI can't track. When the smoke test passes and is cleaned up, tell the user to open the **App** tab and click **Start**.

**Small iterations:** subagents are only for the first generation. For small change requests from the user afterward, do everything on the main loop so the user can easily track your thinking.

---

When the build is complete and ALL subagents have reported back, return to SKILL.md and summarize the resources (IDs + URLs) to the user. If small iterations are requested afterward, handle them on the main loop.
