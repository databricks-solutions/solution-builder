---
name: databricks-demo-generator
description: Generate comprehensive specification files for building Databricks assets, demos or end 2 end projects. Use when users want to create a new demo, design a demo story, or need help structuring demo components, create an entire project. This skill creates prompts that another agent will execute to build the actual demo.
---

# Databricks Demo Generator

A skill for creating and building compelling Databricks demos that Technical Solution Architects will show to enterprise customers across any industry.

## Purpose

Generate a **coherent demo package** — a business story that showcases Databricks capabilities. The story must be compelling (a clear protagonist, challenge, and resolution in $), and the technical components must connect end-to-end (data → pipeline → dashboard → agent all align). One key value of this skill: everything generated is fully coherent — the synthetic data serves the story and works as input for every downstream consumer (dashboards, apps, Genie spaces, agents).

## How this skill is organized

The main loop lives in this file (SKILL.md) — it describes **the flow**: stages, gates, what each stage produces, when to stop for user input. For **how to execute** a given stage, read the matching `DEMO_SKILL_DIR/stages/NN-*.md` at the moment you enter it. Keep SKILL.md in your context at all times — pull in a stage file **only** when you're actively executing that stage.

| Stage | What | User gate at end | Execution guide |
|-------|------|------------------|-----------------|
| **0. Capture Intent** | Understand request, browse domain/pattern blocks, propose story ideas if vague | — (flows into stage 1) | Inline in SKILL.md |
| **1. Design Story** | Write `resources.json` + `README.md` (batched in one message) | ✅ *"Approve the story?"* | `stages/01-design-story.md` |
| **2. Write Specs** | Write `01-lakeflow.md`, then the other top-level specs, then the app spec (if app needed), coherence review | ✅ *"Ready to build?"* | `stages/02-write-specs.md` |
| **3. Build** (opt) | Create Databricks resources via ai-dev-kit skills | — (build completes) | `stages/03-build.md` |
| **4. Package as a DAB** (opt) | On user request only, post-build | — | `references/dab/dab.md` |
| **5. Client Handoff** (opt, prompted) | Strip SA-environment fingerprint, wire synth/real toggle, bundle Genie Code skill | ✅ *"Ready to publish for the client?"* | `references/client-handoff/client-handoff.md` |

**Cross-cutting (not a stage):**
- **App creation** — folded into stages 2 + 3: `DEMO_SKILL_DIR/app/app.md`

### Architecture-first entry (alternate start)

Sometimes the opening message says the user wants to **start by creating an architecture diagram** (architecture-first) rather than a story. Their text may be anything — a tidy brief, pasted meeting notes, or a transcript. When you see that:

1. **Skip stages 0–1.** Do **not** design a story, write `resources.json`/`README.md`, write specs, or build resources.
2. Read the **`databricks-architecture` skill** (`.claude/skills/databricks-architecture/SKILL.md`) — the flat `nodes`/`edges` schema + component catalog + reference diagrams.
3. **Extract the main components** the user's text implies — source systems, pipeline, serving layer, dashboards/apps, agents — and map each to a real catalog component id. Start from `architecture-simple.json` or `architecture-complete.json` when the intent clearly matches one, then patch in the named sources. Set `state` explicitly (there's no `resources.json` yet).
4. **Write ONLY `architecture.md`** at the project root (the schema in a fenced ```json block), then **stop** with a one-liner inviting the user to review/edit it on the Architecture tab. The story comes later — the user will click "Generate the solution from this architecture", which kicks off stage 1 *constrained to* the components they kept on the canvas.

## Paths

Your system prompt defines `PROJECT`, `SKILLS`, `DEMO_SKILL_DIR`, and `DEMO_SKILL` as absolute paths. This skill refers to sibling files like `DEMO_SKILL_DIR/stages/*.md`, `DEMO_SKILL_DIR/app/app.md`, `DEMO_SKILL_DIR/references/*`.

**When spawning subagents**, substitute every placeholder (`DEMO_SKILL_DIR/…`, `PROJECT/…`, `SKILLS/…`) with its real absolute path before sending — the subagent has no system prompt defining them. The full spawn prompt is in `DEMO_SKILL_DIR/stages/03-build.md` → Step 2.

---

## Usage tracking

Each stage fires one tracking event so we can see how the skill is used. Calls are inlined per stage below — run them as a single Bash command, ignore the result, move on. Opt out via `DBDEMOS_TRACKER_DISABLED=1`.

---

## Efficiency

Batch tool calls in the same response whenever you can: emit multiple `Read` or `Write` calls in one assistant message and the harness executes them concurrently. You still generate tokens sequentially — batching saves LLM round-trips, not output time. Load all reference blocks in one message, write independent files in one message. **Spec writing fans out after `01-lakeflow.md`**: 02 / 03 / 04 / 05 + the app spec all depend only on 01 (and on each other's outputs that the build stage materializes, not on each other's spec text), so once 01 is written they're emitted as a single batched-Write turn on the main loop — never serialize them. Latency is dominated by LLM round-trips, not tool execution — every sequential tool call that could have been batched is wasted time.

**Subagent policy.** A single subagent is used in Stage 3 (build) **and only for the App** — it's the longest task (~5 min) and runs in parallel while the parent builds everything else on main. Stages 0, 1, 2, and 4 run entirely on the main loop, and within Stage 3 only the App is delegated. The full spawn prompt is in `DEMO_SKILL_DIR/stages/03-build.md` → Step 2.

### Telling the user where you are

Between phases, drop a one-liner so the user always knows where you are in the flow. Examples:

- *"Story approved — writing all specs now (~2 min on the main loop)."*
- *"Specs ready. Ready to build when you say go."*
- *"Stage 3 building. Genie + dashboard subagent running, app subagent running. Continuing with governance meanwhile."*

No drawn-out status dumps — one line, then the work continues.

### Output discipline

Between tool calls, write about the **problem**, not the file you're about to create. If a sentence describes what the file will contain, put it in the file (comments, code) instead — don't preview it in chat. Don't narrate the act of writing ("writing the script…", "finishing the join…", "still generating…", "Building the materialized view...", Building the query output..." "Writing the daily aggregation view" etc.) — the tool call does that.

When spawning a subagent or handing off context, **point at files, don't paraphrase them.** Listing absolute paths is cheaper than summarizing what's inside — your paraphrase costs tokens and goes stale, the subagent's read is fast. Don't pre-digest the spec or the README so the subagent "doesn't have to re-read" — that's the wrong economy. Reading is cheap for them; rewriting is expensive for you.

Real thinking (surprising results, tradeoffs, ambiguity, errors) is welcome. File previews and progress updates aren't.

---

## Project Structure

```
./README.md           # Story overview, products showcased, walkthrough
./architecture.md     # Architecture diagram schema (JSON) for visual rendering
./META-PROMPT.md      # Build instructions for the AI (generic, do not write it, copy it from template)
./resources.json      # Selected capabilities + created resource IDs
./specifications/     # Detailed specs per component — the exact files depend on what the demo includes; there is no fixed list
```

### resources.json

Source of truth for what capabilities the demo includes. Created during spec phase with capabilities, updated during build with resource IDs. Structure mirrors `DEMO_SKILL_DIR/references/example-luxebeauty/resources.json`.
You must keep this exact naming convention.

**`created_resources` starts empty `{}` and grows one key at a time.** Add a resource's ID key **only after that resource is actually created and validated** (Stage 3, build loop step 5). **Never pre-seed a key** — not with a placeholder like `<your-dashboard-uuid>`, not with `""`, not by copying the example file's keys wholesale. The reference example below shows the *final* shape of a fully-built demo; it is a naming reference, **not a scaffold to paste in up front**. The UI's resource-link builder renders a clickable link for any present, non-empty ID, so a pre-seeded `dashboard_id`/`genie_space_id` becomes a dead link to a resource that doesn't exist yet.

**After build** (populated with created resource IDs — do not add links here). **Use these exact key names**; the UI's resource-link builder is wired to them. Skip a section entirely when the demo doesn't include that capability, but do NOT rename keys. Authoritative reference: `DEMO_SKILL_DIR/references/example-luxebeauty/resources.json`. Lakebase sub-keys are defined in `DEMO_SKILL_DIR/app/app.md`.

```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {
    "workspace_folder": "/Workspace/Users/<your-email>/luxebeauty_demo",
    "catalog": "luxebeauty",
    "schema": "demo_c360",
    "warehouse_id": "abc123def456...",
    "pipeline_id": "12ab34cd-5678-...",
    "metric_view_name": "luxebeauty.demo_c360.mv_returns",
    "dashboard_id": "01efab12cd34...",
    "genie_space_id": "abc123...",
    "knowledge_assistant_id": "ka-456...",
    "knowledge_assistant_endpoint": "ka-15956b19-endpoint",
    "multi_agent_supervisor_id": "mas-789...",
    "multi_agent_supervisor_endpoint": "mas-15956b19-endpoint",
    "ml_model_name": "luxebeauty.demo_c360.customer_premium_classifier",
    "mlflow_experiment_path": "/Workspace/Users/<your-email>/luxebeauty/experiments/premium_classifier",
    "app": {
      "name": "luxebeauty-demo",
      "id": "app-luxebeauty-1234",
      "deployment_note": "Deployed via `databricks apps deploy` — see app.md Step 6"
    },
    "lakebase_project_id": "<uid from `databricks postgres get-project | jq -r .uid`>",
    "lakebase_project_slug": "dbdemos-asset-generator",
    "lakebase_database": "dbgen_luxebeauty"
  }
}
```

Notes on the trickier keys:
- **`mlflow_experiment_path`** — required when the demo trains an ML model. Full workspace path passed to `mlflow.set_experiment(...)`. Without it the MLflow Experiment tile never appears in the resources grid (the UI resolves the path → numeric experiment_id via the SDK).
- **`app` is nested** (`app.name`, `app.id`, `app.deployment_note`). When the deploy fails or is intentionally skipped, still record `app.name` and put the explanation in `deployment_note`.
- **Lakebase keys are three flat fields**, not nested. See `app.md` for `lakebase_setup_db.sh` which prints them.

- **buildable**: capabilities that require actual Databricks resources (pipelines, dashboards, agents, apps, etc.)
- **talking_track**: capabilities mentioned in the demo narrative but don't require resource creation
- **created_resources**: filled during build phase — keys match the resource type (e.g., `pipeline_id`, `dashboard_id`, `genie_space_id`)

Capability IDs come from `DEMO_SKILL_DIR/references/platform_architecture.md`.

When the user provides exact capabilities, use those directly — don't override with pattern suggestions.

### Architecture Diagram

Use the **`databricks-architecture` skill** (`.claude/skills/databricks-architecture/SKILL.md`) for the schema (the flat `nodes` + `edges` format, the component catalog, and the reference diagrams to start from). Generate the architecture as JSON in `./architecture.md` — the UI renders it automatically.

---

## Context Blocks & Platform Architecture

**Always start by reading `DEMO_SKILL_DIR/references/platform_architecture.md`** — it shows the complete Databricks platform capabilities with dependencies, all product IDs and categories, and when to use each capability.

`DEMO_SKILL_DIR/references/blocks/capabilities` details Databricks products — selling points, positioning, how to showcase unique value, common pitfalls. Read them when you need deeper product knowledge for story or spec writing (typically dashboards or ML model training)
---

## Storytelling Fundamentals

The demo is a **Databricks Pitch**. Keep it simple.

Regardless of pattern, every demo needs a great story. A great demo has:
- **A clear protagonist** — Named persona with a business role and a challenge
- **Business metrics in $** — "$500K at risk" lands; "720 records" doesn't
- **A wow moment** — The point where the platform does something impressive (root cause in 60 seconds, prediction prevents downtime, NL question returns a complete answer)
- **A clear value statement** — "Days → minutes", "$2M saved annually"

### Keep It Simple

- **Accessible domains** — Retail, manufacturing, healthcare, finance. Everyone gets "returns went up" or "this machine is about to fail."
- **Business language** — Revenue, cost, customers (in $). Not technical jargon.
- **One clear challenge** — Focused narrative, easy to follow.

**The rule**: if you have to explain the business domain before the demo, pick a simpler domain.

---

## Modifying an Existing Project

When the project already has files (`README.md`, `resources.json`, `specifications/`), don't restart from stage 0. Instead:

1. **Read existing state** — `README.md`, `resources.json`, and any `specifications/*.md` files.
2. **Understand the user's request** — what they want to change (story, capabilities, a specific spec, a built resource).
3. **Check the story still holds** — does the existing README + data support the new ask? If the new component needs data or a story beat that isn't there yet, the story comes first: update `README.md` and the upstream specs (typically `01-lakeflow.md` for data, `02-uc-governance.md` for permissions) BEFORE writing the new component spec.
4. **Make targeted changes** — update only the affected files. Keep everything else consistent.
5. **Propagate changes downstream** — if you change the story or data schema, update all specs that reference those values. If you change a spec, update the built resource if it exists (regenerate data, restart the SDP pipeline, refresh the dashboard, re-run training, etc.). Then update `resources.json` with any new IDs.
6. **App changes** — **if the user asks about anything app-related (adding a page, changing an agent tool, updating theming, data model, re-generating, debugging, deploying), read `DEMO_SKILL_DIR/app/app.md` FIRST.** Don't improvise from memory. Non-negotiable principles while working on the app:
   - **Don't start the app.** The Demo Prompt Generator UI supervises the app's process; a separate `./start.sh` collides with it.
   - **One-shot smoke tests only** — if you must run it to validate a change, run it once on a random port, then kill it immediately (see `app.md` Step 5 for the exact pattern). Leaving it running is a bug.
   - **Never deploy the app on your own.** "Deploy resources" / "deploy the demo" means everything except the app. Deploy the app **only** when the user says "deploy the app" / "push the app" / similar explicit wording. The flow is in `app.md` Step 6.
7. **Spec-writing standards**: if you're editing `specifications/*.md`, read `DEMO_SKILL_DIR/stages/02-write-specs.md` for the standards (functional specs, temporal realism, coherence contracts, etc.).

The coherence contract still applies: every change must ripple through all dependent files.

### Worked example — user asks to add a component the project doesn't have

Generic pattern when adding a new capability (app, ML model, dashboard, etc.) to a project that didn't originally include it:

1. **Find example** — check `DEMO_SKILL_DIR/references/blocks/capabilities/<slug>.md` and `DEMO_SKILL_DIR/references/example-luxebeauty/specifications/` for an existing spec of the same capability. Mirror its shape.
2. **Story fit** — does the existing demo arc justify this component? If no, extend the README story beat before writing the spec.
3. **Upstream prerequisites** — does this need new data, a new column, a new dashboard viz, a new model output? If so, patch the upstream specs (`01-lakeflow.md`, etc.) first, regenerate the data, update and re run the sdp pipeline if required and only then write the new component spec.
4. **Write the new component spec when required** — under `specifications/`, following the standards in `stages/02-write-specs.md`.
5. **Build it** — follow `stages/03-build.md` for the build order (data → pipeline → consumption layers).
6. **App-specific path** — if the new component is an app, ALSO read `DEMO_SKILL_DIR/app/app.md` end-to-end (it walks the clone-template → specialize → deploy flow that's specific to the React/Node app, not the rest of the demo).
7. **Update `resources.json`** — add the new resource's IDs / endpoints / paths to `created_resources` so the UI tiles light up and the capabilities after the addition/changes.

---

## Stage 0 — Capture Intent

First, assess the user's input — how much is already decided?

**Vague** ("retail demo", "something with IoT"): full ideation needed.
1. Propose 2–3 story ideas combining domain terminology with the pattern's arc. Title format: "[Domain]'s [challenge]". Keep it brief. If the user does a followup, consider you're now a Moderate
   ```
   1. **Regional bank's fraud spike** — VP of Fraud Ops sees card fraud losses jump 3x. Traces it to compromised POS terminals at a merchant chain.
   2. **Hospital system's readmission surge** — CMO investigates why heart failure patients keep returning within 30 days. Uncovers a discharge protocol gap.
   3. **Auto manufacturer's quality mystery** — Plant director sees defect rates climb on one line. Traces it to a worn bearing in Station 7.
   Suggested stack: synthetic-data-gen, sdp, aibi-dashboards, genie  + lakeflow-connect, genie-code, databricks-one, unity-catalog
   
   Pick one, combine ideas, or describe something else / add capabilities.
   ```

**Moderate** ("fraud detection demo for a bank using data from xx, with dashboards + Genie to investigate suspicious transactions"): story direction is clear but needs fleshing out.
2. Propose a short story (~3-5 sentences, see below). Confirm the from `platform_architecture.md`, ask question if something isn't clear — no need to propose alternatives.

**Detailed** (full PRD with protagonist, catalyst, narrative arc already defined): the user has done the thinking. Skip ideation — go straight to stage 1, making sure you have the right capabilities in mind.

## Stage 1 — Design Story

**Read `DEMO_SKILL_DIR/stages/01-design-story.md` now** and follow it. Outputs: `resources.json`, `README.md` at the project root (don't create the architecture file unless asked for it).

**Gate — ask the user before continuing, unless instructed otherwise:**

```
I've created the demo story in README.md.
Narrative: [VERY VERY brief summary the narrative, easy to read]

**Should I go ahead and generate the detailed specification files?**

Reply "yes" to continue, or let me know what to change.
```

Wait for confirmation before starting stage 2.

**Track this stage:** run `python3 DEMO_SKILL_DIR/tools/track.py STORY_APPROVED <demo-slug>` after the user approves; ignore the result and move on.

## Stage 2 — Write Specs

**Read `DEMO_SKILL_DIR/stages/02-write-specs.md` now** and follow it. Outputs: `META-PROMPT.md` (copied wit cp don't read/write it) + `specifications/*.md`. Includes the coherence pass at the end.

**Mental model before you start:** write `01-lakeflow.md` first (everything else depends on it). Then write the remaining top-level specs (02 / 03 / 04 / 05, only the ones this demo uses). Then, if the demo includes a Databricks App, write `specifications/app/*.md`. Sequential — one Write per file. **Don't ruminate, don't say "now I'll write X" — open the Write tool and write.** Coherence review at the end.

**Track this stage:** run `python3 DEMO_SKILL_DIR/tools/track.py SPECS_WRITTEN <demo-slug>` once specs are all written; ignore the result and move on.

**Gate — ask the user before continuing unless instructed otherwise:**
Say for example (don't mention / describe all the files)
```
Demo specifications are ready in `./specifications/`  .
Would you like me to build the demo resources now?

Reply "yes" to start building, or "no" to stop here.
```

## Stage 3 — Build 

If the user confirms, **read `DEMO_SKILL_DIR/stages/03-build.md` now** and follow it. It covers: build-order gates, subagent parallelization, how to spawn a build subagent, app generation, and sync rules between specs and built resources.

**Mental model before you start:** build time dominates this stage. The pipeline is the only sequential gate (raw data → SDP → tables exist). Once tables exist, fan out — Genie/Dashboard, KA/MAS, and the App all run as parallel subagents. Never loop through resources one at a time on the main thread.

**Track this stage:** run `python3 DEMO_SKILL_DIR/tools/track.py BUILD_COMPLETE <demo-slug>` once `resources.json.created_resources` is populated; ignore the result and move on.

## Stage 4 — Package as a DAB (optional)

When the user asks you to create a DAB, read `DEMO_SKILL_DIR/references/dab/dab.md` and create the DAB specification. **Author + verify only — don't deploy.** Write the bundle, scripts, and `dab_instructions.md` and validate them; do NOT run `bundle deploy` / `bundle run` or the deploy scripts unless the user explicitly asks to deploy (they mutate a workspace).

After the DAB is packaged, prompt the user:
> "DAB packaged. Want to make this client-handoff-ready? (Stage 5 strips SA-env, adds a synth-data toggle, and bundles a Genie Code skill for the client.) Reply 'yes' to continue or 'no' to stop."

On `yes`, invoke `references/client-handoff/client-handoff.md`.

---

## Reference Materials

Browse `DEMO_SKILL_DIR/references/` for worked examples showing file format, detail level, and how files connect. Two examples ship — pick the one that matches the build's capability set:

- **`example-luxebeauty/`** — full-stack reference (SDP bronze→silver→gold, metric view, ML premium classifier, Knowledge Assistant, Multi-Agent Supervisor, app with tiered offers). Use this when the build includes any of `sdp` / `metric-views` / `ml-training-serving` / `knowledge-assistant` / `supervisor-agent`.
- **`example-luxebeauty-simple/`** — fast reference for the Simple-tab capability set (synth → raw→silver→gold built in-script since there's no SDP, AI/BI Dashboard + Genie, optional Databricks App + Lakebase, no SDP / KA / MAS / ML). Use this when the build sticks to that subset. **Ships two canonical artifacts** alongside the spec markdown — both are syntax references, not fill-in-the-blanks templates:
  - `data_generation/generate_data.py` — one self-contained Spark (databricks-connect) file: Spark-native generation (spark.range + F.when + broadcast joins, no driver loops) → raw Delta tables → inline `spark.sql` CTAS for silver + gold + constraints. A worked example of the technique, not a domain template — rewrite the whole thing for the demo's own schema.
  - `dashboard/dashboard.json` — a populated Lakeview JSON with the 5-stop palette, frame descriptions, sankey top-N bucketing, and category/source color pins already wired.

Adapt the structure, don't copy the narrative. Every story, schema, widget, position, color, and description must be rewritten for the current demo — the artifacts only show what a working file *looks like*, not what to put in one.

---

## Key Principles

1. **Story first** — Start with "what question does the protagonist ask?" not "what components do we need?"
2. **Coherence above all** — Data, pipeline, dashboard, Genie, agents must all align: data must support the story and the story must be visible in the components (dashboard, genie etc). One broken link ruins the demo.
3. **5-second test** — The key insight must be obvious at a glance on any dashboard. The story must be compelling ("something clearly happened" and we clearly see it)
4. **Business metrics in $** — Revenue, cost, impact. Not row counts.
5. **Match products to moments** — Every showcased product earns a clear beat in the walkthrough
6. **Functional specs** — Describe outcomes, not implementation. No API calls or code in spec files.

---

## Handling Unknown Components

When the user requests a Databricks feature you're not familiar with:

1. Check if a capability block exists in `DEMO_SKILL_DIR/references/blocks/capabilities/`.
2. If not, fetch documentation from `https://docs.databricks.com/llms.txt`.
3. Understand what value it adds to the demo.
4. Write functional specs (what it should do, inputs, outputs).

Don't refuse — learn and adapt.

---

## Flexibility

Everything in this skill is a **default**. The user is in control:

- User wants different components? Follow their lead.
- User wants a different story pattern? Do it.
- User wants to skip the walkthrough? Fine.
- User has specific requirements that contradict these defaults? User wins.

**Your job**: help the user create a great demo, whatever that looks like for them.
