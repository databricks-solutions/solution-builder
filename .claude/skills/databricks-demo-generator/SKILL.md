---
name: databricks-demo-generator
description: Generate comprehensive specification files for building Databricks assets, demos or end 2 end projects. Use when users want to create a new demo, design a demo story, or need help structuring demo components, create an entire project. This skill creates prompts that another agent will execute to build the actual demo.
---

# Databricks Demo Generator

A skill for creating and building compelling Databricks demos that Technical Solution Architects will show to enterprise customers across any industry.

## Purpose

Generate a **coherent demo package** — a business story that showcases Databricks capabilities. The story must be compelling (a clear protagonist, challenge, and resolution in $), and the technical components must connect end-to-end (data → pipeline → dashboard → agent all align). One key value of this skill: everything generated is fully coherent — the synthetic data serves the story and works as input for every downstream consumer (dashboards, apps, Genie spaces, agents).

## How this skill is organized

The main loop lives in this file (SKILL.md) — it describes **the flow**: stages, gates, what each stage produces, when to stop for user input. For **how to execute** a given stage, read the matching `SKILL_DIR/stages/NN-*.md` at the moment you enter it. Keep SKILL.md in your context at all times — pull in a stage file **only** when you're actively executing that stage.

| Stage | What | User gate at end | Execution guide |
|-------|------|------------------|-----------------|
| **0. Capture Intent** | Understand request, browse domain/pattern blocks, propose story ideas if vague | — (flows into stage 1) | Inline in SKILL.md |
| **1. Design Story** | Write `resources.json` + `README.md` + `architecture.md` (batched in one message) | ✅ *"Approve the story?"* | `stages/01-design-story.md` |
| **2. Write Specs** | Write `01-lakeflow.md`, then fan out: spawn app subagent + batch-write 02/03/04 in parallel; coherence review | ✅ *"Ready to build?"* | `stages/02-write-specs.md` |
| **3. Build** (opt) | Create Databricks resources via ai-dev-kit skills | — (build completes) | `stages/03-build.md` |
| **4. Package as a DAB** (opt) | On user request, post-build | — | `references/dab/dab.md` |

**Cross-cutting (not a stage):**
- **Spawning subagents** — shared prompt structure, speed rules, scope: `SKILL_DIR/stages/subagents.md`
- **App customization** — folded into stages 2 + 3: `SKILL_DIR/app/app.md`

## Paths

Your system prompt defines `DEMO_SKILL` (absolute path to this file), `PROJECT`, and `SKILLS`. Derive `SKILL_DIR = dirname(DEMO_SKILL)` once — this skill refers to sibling files like `SKILL_DIR/stages/*.md`, `SKILL_DIR/app/app.md`, `SKILL_DIR/references/*`.

**When spawning subagents**, substitute every placeholder (`SKILL_DIR/…`, `PROJECT/…`, `SKILLS/…`) with its real absolute path before sending — the subagent has no system prompt defining them. Full guidance in `SKILL_DIR/stages/subagents.md`.

---

## Usage tracking

Each stage fires one tracking event so we can see how the skill is used. Calls are inlined per stage below — run them as a single Bash command, ignore the result, move on. Opt out via `DBDEMOS_TRACKER_DISABLED=1`.

---

## Efficiency

Batch tool calls in the same response whenever you can: emit multiple `Read` or `Write` calls in one assistant message and the harness executes them concurrently. You still generate tokens sequentially — batching saves LLM round-trips, not output time. Load all reference blocks in one message, write independent files in one message. **Spec writing fans out after `01-lakeflow.md`**: 02 / 03 / 04 all depend only on 01, not on each other, so once 01 is written the app subagent gets spawned AND 02/03/04 are emitted as a single batched-Write turn — never serialize them. Real parallelism only happens when a subagent runs in a separate context (see `SKILL_DIR/stages/subagents.md`). Latency is dominated by LLM round-trips, not tool execution — every sequential tool call that could have been batched is wasted time.

### Telling the user where you are

Between phases, drop a one-liner so the user always knows where you are in the flow. Examples:

- *"Story approved — starting spec generation (~2 min, app subagent in background)."*
- *"Specs ready. Ready to build when you say go."*
- *"Building. Genie + dashboard subagent running, app subagent running. Continuing with governance meanwhile."*

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

Source of truth for what capabilities the demo includes. Created during spec phase with capabilities, updated during build with resource IDs. Structure mirrors `SKILL_DIR/references/example-luxebeauty/resources.json`.
You must keep this exact naming convention.

**After build** (populated with created resource IDs — do not add links here):
```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {
    "workspace_folder": "/Workspace/Users/.../luxebeauty_demo",
    "pipeline_id": "17bed323-f405-4645-a559-7605171f5b41",
    "dashboard_id": "01efab12cd34...",
    "genie_space_id": "abc123...",
    "knowledge_assistant_id": "ka-456...",
    "knowledge_assistant_endpoint": "ka-15956b19-endpoint",
    "multi_agent_supervisor_id": "mas-789...",
    "multi_agent_supervisor_endpoint": "sa-15956b19-endpoint",
    "mlflow_experiment_path": "/workspace/xxx",
    "app":{
      "name": "xxx",
      "deployment_note": "xxx",
      "id": "xx"
    },
    "lakebase_project_id": "xxx",
    "lakebase_database": "xxx"
  }
}
```

- **buildable**: capabilities that require actual Databricks resources (pipelines, dashboards, agents, apps, etc.)
- **talking_track**: capabilities mentioned in the demo narrative but don't require resource creation
- **created_resources**: filled during build phase — keys match the resource type (e.g., `pipeline_id`, `dashboard_id`, `genie_space_id`)

Capability IDs come from `SKILL_DIR/references/platform_architecture.md`.

When the user provides exact capabilities, use those directly — don't override with pattern suggestions.

### Architecture Diagram

Read `SKILL_DIR/references/architecture.md` for the schema format (icons, tiers, columns, edges, groups). Generate the architecture as JSON in `./architecture.md` — the UI renders it automatically.

---

## Context Blocks & Platform Architecture

**Always start by reading `SKILL_DIR/references/platform_architecture.md`** — it shows the complete Databricks platform capabilities with dependencies, all product IDs and categories, and when to use each capability.

`SKILL_DIR/references/blocks/capabilities` details Databricks products — selling points, positioning, how to showcase unique value, common pitfalls. Read them when you need deeper product knowledge for story or spec writing (typically dashboards or ML model training)
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
3. **Make targeted changes** — update only the affected files. Keep everything else consistent.
4. **Propagate changes downstream** — if you change the story or data schema, update all specs that reference those values. If you change a spec, update the built resource if it exists.
5. **App changes** — **if the user asks about anything app-related (adding a page, changing an agent tool, updating theming, data model, re-generating, debugging, deploying), read `SKILL_DIR/app/app.md` FIRST.** Don't improvise from memory. Non-negotiable principles while working on the app:
   - **Don't start the app.** The Demo Prompt Generator UI supervises the app's process; a separate `./start.sh` collides with it.
   - **One-shot smoke tests only** — if you must run it to validate a change, run it once on a random port, then kill it immediately (see `app.md` Step 5 for the exact pattern). Leaving it running is a bug.
   - **Never deploy the app on your own.** "Deploy resources" / "deploy the demo" means everything except the app. Deploy the app **only** when the user says "deploy the app" / "push the app" / similar explicit wording. The flow is in `app.md` Step 6.
6. **Spec-writing standards**: if you're editing `specifications/*.md`, read `SKILL_DIR/stages/02-write-specs.md` for the standards (functional specs, temporal realism, coherence contracts, etc.).

The coherence contract still applies: every change must ripple through all dependent files.

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

**Read `SKILL_DIR/stages/01-design-story.md` now** and follow it. Outputs: `resources.json`, `README.md`, `architecture.md` at the project root.

**Gate — ask the user before continuing, unless instructed otherwise:**

```
I've created the demo story in README.md and the architecture.
Narrative: [VERY VERY brief summary the narrative, easy to read]

**Should I go ahead and generate the detailed specification files?**

Reply "yes" to continue, or let me know what to change.
```

Wait for confirmation before starting stage 2.

**Track this stage:** run `python3 SKILL_DIR/tools/track.py STORY_APPROVED <demo-slug>` after the user approves; ignore the result and move on.

## Stage 2 — Write Specs

**Read `SKILL_DIR/stages/02-write-specs.md` now** and follow it. Outputs: `META-PROMPT.md` (copied wit cp don't read/write it) + `specifications/*.md`. Includes the coherence pass at the end.

**Mental model before you start:** write `01-lakeflow.md` first (everything else depends on it). Then fan out — spawn the app subagent **and** batch-write 02 / 03 / 04 in the same parent turn. The other specs only depend on 01, never on each other, so serializing them is wasted time.

**Track this stage:** run `python3 SKILL_DIR/tools/track.py SPECS_WRITTEN <demo-slug>` once specs are all written; ignore the result and move on.

**Gate — ask the user before continuing unless instructed otherwise:**
Say for example (don't mention / describe all the files)
```
Demo specifications are ready in `./specifications/`  .
Would you like me to build the demo resources now?

Reply "yes" to start building, or "no" to stop here.
```

## Stage 3 — Build 

If the user confirms, **read `SKILL_DIR/stages/03-build.md` now** and follow it. It covers: build-order gates, subagent parallelization, how to spawn a build subagent, app generation, and sync rules between specs and built resources.

**Mental model before you start:** build time dominates this stage. The pipeline is the only sequential gate (raw data → SDP → tables exist). Once tables exist, fan out — Genie/Dashboard, KA/MAS, and the App all run as parallel subagents. Never loop through resources one at a time on the main thread.

**Track this stage:** run `python3 SKILL_DIR/tools/track.py BUILD_COMPLETE <demo-slug>` once `resources.json.created_resources` is populated; ignore the result and move on.

## Stage 4 — Package as a DAB (optional)

When the user asks you to create a DAB, read `SKILL_DIR/references/dab/dab.md` and create the DAB specification.

---

## Reference Materials

Browse `SKILL_DIR/references/` for worked examples showing file format, detail level, and how files connect. The `example-luxebeauty/` folder is the primary reference — adapt the structure, don't copy the content.

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

1. Check if a capability block exists in `SKILL_DIR/references/blocks/capabilities/`.
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
