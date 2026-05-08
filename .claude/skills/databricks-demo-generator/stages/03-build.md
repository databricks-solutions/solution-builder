# Stage 03 — Build Resources

Run this only after the user confirms at the stage-2 build-or-stop gate — creating the actual Databricks resources that implement the specs.

All resource files (.py, .sql, .yaml, …) must go in the project folder.

## Building with skills

**Each resource has a dedicated ai-dev-kit skill under `SKILLS/<skill-dir>/SKILL.md`.** The full list — dir name + one-line purpose — is already in your system prompt under *Available Skills*; pick the one that matches the capability in `resources.json`. If unsure, `ls SKILLS/` to confirm what's present at runtime.

Read the skill's `SKILL.md` BEFORE building — it contains the exact CLI commands, auth flow, and verification steps. Use the CLI the skill documents; do NOT use MCP tools.

For each capability the recipe is: **read `SKILLS/<skill-dir>/SKILL.md` → read the spec file → create the resource → validate → update `resources.json` with the resource ID**. Independent capabilities run **in parallel via subagents** — see the table below. Don't loop through resources sequentially; build time dominates this stage.

Important capabilities with instructions for you to check if you need to build them: 
Dashboard => must read aibi-dashboards.md to know how to structure the dashboard
Metric views => read metric-view.md
ML model => read ml-training-serving.md (you must deploy it as a databricks serverless job, no spark connect)

## Build-order gates — do not skip

Consumption resources depend on upstream data. The dependency graph is in `DEMO_SKILL_DIR/references/platform_architecture.md`. The core rule:

> **Never create a downstream resource before its upstream data exists and is verified.**

Before creating any dashboard, Genie space, KA, or agent: verify every table/document it references exists and has rows. If a gate fails, STOP and fix upstream — do not proceed.

**CRITICAL: keep spec files in sync.** If you change a resource during build, or if the user asks you to change one, update its spec file first.

## Parallelization with subagents — PARENT ONLY

> **Subagents: skip this section.** Your prompt told you exactly which resource to build.

**Subagents are expensive** — fresh context, re-reads of every spec they need, no shared state with you. Worth it only for tasks that are **long, self-contained, and parallelizable**. **Your main thread must always be doing real work** — never spawn a fan-out that leaves you idle waiting. If you'd be idle, pull one task back and build it yourself instead.

**Spawn a subagent for any of these:** App generation, unstructured-docs (HTML + PDF + upload), KA, MAS, Genie+Dashboard (paired, one subagent), ML training/serving. Pair sequential dependencies inside one subagent (Genie→Dashboard, KA→MAS) to save round-trips. Everything else stays on main: `01-lakeflow` A→B, `02-uc-governance`, single-CLI resources, validation.

**Decision rule, applied at every checkpoint** (when unblocked tasks become available):

1. Pick the smallest unblocked task for the main thread.
2. Spawn the long parallelizable rest as subagents (one each).
3. Main thread finishes → pick the next unblocked task. Don't wait.
4. Don't spawn a subagent if it leaves you idle — do that work yourself.

**Worked example — KA + MAS + App + Genie + Dashboard:**
After 01-lakeflow B (tables exist), in parallel: spawn App (longest, ~5 min), spawn Genie+Dashboard, spawn unstructured-docs (early — independent of pipeline). Main thread builds KA→MAS itself once docs are done. 1 main + 3 subagents, no idling. Drop subagents whose work isn't in your demo; if everything fits on main thread without idling, spawn nothing.

**Wait rules:**
- A consumer must wait for its producer (KA needs the docs subagent's PDFs).
- Don't declare the build complete until **all** subagents have reported back.
- One short line per spawn (e.g. *"App in background ~5 min, doing KA+MAS on main."*). No follow-up question until results return.

**App late-fill:** the App embeds IDs still in flight (dashboard id, MAS endpoint). Tell the App subagent to finish template customization first and fill those at the end once the parent shares them.

## How to spawn a build subagent

Read `DEMO_SKILL_DIR/stages/subagents.md` for the shared playbook (reads list, project state, anti-patterns, completion format, gate rules). Build-specific additions only below.

**Framing sentence:**

> You are a subagent spawned by the `databricks-demo-generator` skill, executing **Stage 03 (build)** — specifically, creating the [resource name] described in `[spec file]`. Your single job: create this one resource, validate it, update `resources.json` with its ID, and return id + URL.

**Extra reads (on top of the standard set in `subagents.md`):**
- `SKILLS/<skill-dir>/SKILL.md` — the ai-dev-kit skill for THIS resource type. Pick from the *Available Skills* index in the system prompt; `ls SKILLS/` if unsure. Non-negotiable — it has the CLI + verification steps.
- `PROJECT/specifications/01-lakeflow.md` — table schemas (every build subagent references these).
- `PROJECT/specifications/<relevant>.md` — the spec for THIS task.
- Optional: `DEMO_SKILL_DIR/references/blocks/capabilities/<block>.md` if the spec lacks positioning context.

**Don't include `stages/03-build.md`** — the subagent doesn't need the parent's parallelization logic.

**Blocking deps:** if the subagent depends on another in-flight subagent's output (e.g. KA needs PDFs from the docs subagent), tell it to wait before the blocking step.

## App generation

If the demo includes a Databricks App (`databricks-apps` in `resources.json`), **spawn the app-build subagent automatically as soon as `01-lakeflow` B (the SDP pipeline) completes and the app spec exists** (tell the user it'll take a while). App generation is slow (~5 min) and can start before Genie / KA / MAS; kicking it off early lets it run in parallel with everything else.

Follow the shared playbook in `DEMO_SKILL_DIR/stages/subagents.md` plus the build-subagent specifics above. App-build-specific additions:

**Framing sentence:**

> You are a subagent spawned by the `databricks-demo-generator` skill, executing **Stage 03 (build)** — specifically, customizing and deploying the Databricks App for this demo. Your single job: copy the template, rewrite it for this demo's story, wire config to the built resources, and deploy.

**Reads:** the core path is `DEMO_SKILL_DIR/app/app.md` — it walks through copying the template, customizing it, and wiring config. Plus: `PROJECT/README.md`, `PROJECT/specifications/01-lakeflow.md`, all files under `PROJECT/specifications/app/`, and invoke the `fe-databricks-tools:databricks-apps` skill.

**Late-fill rule:** if the app embeds IDs from resources still being built in parallel (dashboard id, MAS endpoint), the subagent finishes template customization first and fills those in at the end once those resources are ready.

**Start only for the smoke test, then always stop.** The only time the agent runs `./start.sh` is the mandatory one-shot smoke test at the end of the build (see `DEMO_SKILL_DIR/app/app.md` Step 5) — start it, let it boot up to ~60s, capture the log, then **unconditionally kill the process**. The UI owns the process lifecycle afterwards. A leftover `./start.sh` is an orphan the UI can't track. When the smoke test passes and is cleaned up, tell the user to open the **App** tab and click **Start**.

**Small iterations:** subagents are only for the first generation. For small change requests from the user afterward, do everything on the main loop so the user can easily track your thinking.

---

When the build is complete and ALL subagents have reported back, return to SKILL.md and summarize the resources (IDs + URLs) to the user. If small iterations are requested afterward, handle them on the main loop.
