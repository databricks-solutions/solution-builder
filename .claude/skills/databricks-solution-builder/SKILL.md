---
name: databricks-solution-builder
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
| **0. Capture Intent** | Understand request, browse capability blocks, propose story ideas if vague | — (flows into stage 1) | Inline in SKILL.md |
| **1. Design Story** | Write `resources.json` + `README.md` (batched in one message) | ✅ *"Approve the story?"* | `stages/01-design-story.md` |
| **2. Write Specs** | Write `01-lakeflow.md`, then the other top-level specs, then the app spec (if app needed), coherence review | ✅ *"Ready to build?"* | `stages/02-write-specs.md` |
| **3. Build** — *pick ONE fork (by mode):* | | | |
| &nbsp;&nbsp;↳ **3.1 Build resources** *(default)* | Provision the Databricks resources via Databricks Agent Skills (DAS) | — (build completes) | `stages/03.1-build.md` |
| &nbsp;&nbsp;↳ **3.1r Build on real tables** *(grounded / "use existing data")* | Build DIRECTLY on the user's real UC tables, **READ-ONLY** — no data generation | — (build completes) | `stages/03.1r-build-on-real.md` |
| **4. Package as a DAB** (opt) | On user request only, post-build | — | `references/dab/dab.md` |
| **Flow B — Genie Code workshop** *(replaces 0–5)* | Story → specs + `CONTEXT.md` → data test → workshop page | — (no gates) | `stages/genie-workshop.md` |

**Cross-cutting (not a stage):**
- **App creation** — folded into stages 2 + 3: `DEMO_SKILL_DIR/app/app.md`

### Three entry flows

The opening message tells you which of three flows the user started (from the home page's tabs). The stages above are the **default**; two variants change where the run starts or how Build forks.

**A — Build the resources (default).** Run stages 0→3.1: design the story, write specs, then **provision the real Databricks resources** (`stages/03.1-build.md`). Deployable demo; DAB optional only if the user asks at the end.

> **"Use existing data" variant (build READ-ONLY on the user's real UC tables).** If the opening message says the user picked existing tables (and **`PROJECT/specifications/source-tables.md` exists**), that file holds the selected real tables' **fully-qualified names + schema (column names, types, comments)** — schema only. **Read it FIRST.** You **profile the tables yourself** at build time (read-only, off a warehouse) to get distinct counts / ranges / top values and derive the data capability signals (time columns, measures, dimensions, cross-table join keys) — see `references/grounding-table-stats.md`. If **`PROJECT/specifications/data-discovery.md`** also exists, **read it too** — it records what the user learned exploring these tables during data discovery: the use case they **already chose** (with its data-fit rationale), the alternatives they set aside, and the capability reasoning. Treat that use case as **AGREED SCOPE** — build it; do NOT re-pitch it, swap it for another idea, or contradict the fit findings. The demo is built **DIRECTLY on those real tables, READ-ONLY** — you query them **in place**; you do **NOT** generate synthetic data, do **NOT** copy or re-create them in another catalog, and you **NEVER** write to, alter, or drop them. Then:
> - Derive **ONE** coherent **read-only analytics** use case that the real data actually supports. If `data-discovery.md` records a chosen use case, **that IS the one** — build it (don't re-derive a different one); the opening message may also include the user's own text and/or a story they picked — honor it. Ground it in the real column names / distributions in `source-tables.md`; do NOT invent a catalyst or columns the data doesn't have.
> - Point **every** component (dashboards, Genie space, metric views, read-only AI functions) at the exact `catalog.schema.table` names from `source-tables.md`. The default capability set is read-only analytics — no ingest/SDP, no write-back app, no Lakebase, no ML training.
> - **Build forks to 3.1r:** do NOT run `stages/03.1-build.md`; run **`stages/03.1r-build-on-real.md`** (verify the real tables are readable, then build the read-only components on them).
>
> **Data-write opt-in.** If — and only if — the opening message / `source-tables.md` header says the user opted into letting the demo add its own supporting data, you MAY generate **auxiliary** tables into the demo's **OWN** catalog/schema (clearly separated) so write-needing capabilities work. **Even then, the user's real tables above remain strictly READ-ONLY — never written to.** Absent that opt-in, create no tables at all.

**B — Build a Genie Code workshop.** Instead of building the resources, you write a hands-on workshop (one HTML page of Genie Code prompts, shipped with a kit folder) that an attendee follows to build the solution live. Flow B is selected by a `Mode: workshop` line in the system prompt or by a workshop opening message. **Read `DEMO_SKILL_DIR/stages/genie-workshop.md` now and follow it instead of stages 0–5** — no gates, nothing provisioned, and the mode persists for the project (later messages, including edits, stay in flow B). The rest of this file still applies.

**C — Architecture first** *(alternate start).* The user wants to draw the architecture before any story. Their text may be a brief, pasted meeting notes, or a transcript.
- **Skip stages 0–1** — no story/`resources.json`/`README.md`/specs/build yet.
- Read the **`databricks-architecture` skill** (`.claude/skills/databricks-architecture/SKILL.md`) — flat `nodes`/`edges` schema + component catalog + reference diagrams.
- **The user uploaded a diagram** (an image under `context/uploads/` — open it with Read) → skip the next bullet: **redraw that diagram**, following the architecture skill's `reference/redraw.md` (every node, edge, label and box from the image; nothing added).
- **Extract the components** the text implies (sources, pipeline, serving, dashboards/apps, agents), map each to a real catalog id. Start from the minimal example in that skill's SKILL.md section 5 (The format) (or `reference/architecture-complete.jsonc` for the full platform) when intent matches, then patch in the named sources.
- **Write ONLY `architecture.md`** at the project root (schema in a fenced ```json block), then **stop** with a one-liner inviting review/edit on the Architecture tab. The story comes later — the user clicks "Generate the solution from this architecture", which kicks off stage 1 *constrained to* the components they kept.

## Paths

Your system prompt defines `PROJECT`, `SKILLS`, `DEMO_SKILL_DIR`, and `DEMO_SKILL` as absolute paths. This skill refers to sibling files like `DEMO_SKILL_DIR/stages/*.md`, `DEMO_SKILL_DIR/app/app.md`, `DEMO_SKILL_DIR/references/*`.

**When spawning subagents**, substitute every placeholder (`DEMO_SKILL_DIR/…`, `PROJECT/…`, `SKILLS/…`) with its real absolute path before sending — the subagent has no system prompt defining them. The full spawn prompt is in `DEMO_SKILL_DIR/stages/03.1-build.md` → Step 2.

---

## Usage tracking

Each stage fires one tracking event so we can see how the skill is used. Calls are inlined per stage below — run them as a single Bash command, ignore the result, move on. Opt out via `DBDEMOS_TRACKER_DISABLED=1`.

---

## Efficiency

Don't overthink mechanical work (writing files, generating data) — call the real tools and execute, don't narrate when you think.

**Subagent policy.** A subagent is used in Stage 3.1 (build) **for the App** — it's the longest task (~5 min) and runs in parallel while the parent builds everything else on main. Otherwise stages 0, 1, 2, and 4 run entirely on the main loop, and within Stage 3 only the App is delegated. The full spawn prompt is in `DEMO_SKILL_DIR/stages/03.1-build.md` → Step 2.

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
./architecture.md     # Architecture diagram schema (JSON) — built on demand (see Architecture Diagram), not by default
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
  "resource_suffix": "a3f2c1",
  "created_resources": {
    "workspace_folder": "/Workspace/Users/<your-email>/luxebeauty_demo_a3f2c1",
    "catalog": "luxebeauty",
    "schema": "demo_c360_a3f2c1",
    "warehouse_id": "abc123def456...",
    "pipeline_id": "12ab34cd-5678-...",
    "metric_view_name": "luxebeauty.demo_c360_a3f2c1.mv_returns",
    "dashboard_id": "01efab12cd34...",
    "genie_space_id": "abc123...",
    "documents_volume": "/Volumes/luxebeauty/demo_c360_a3f2c1/documents_a3f2c1",
    "ml_model_name": "luxebeauty.demo_c360_a3f2c1.customer_premium_classifier",
    "mlflow_experiment_path": "/Workspace/Users/<your-email>/luxebeauty/experiments/premium_classifier_a3f2c1",
    "app": {
      "name": "luxebeauty-demo-a3f2c1",
      "id": "app-luxebeauty-1234",
      "deployment_note": "Deployed via `databricks apps deploy` — see app.md Step 6"
    },
    "lakebase_project_id": "<uid from `databricks postgres get-project | jq -r .uid`>",
    "lakebase_project_slug": "dbdemos-asset-generator",
    "lakebase_database": "dbgen_luxebeauty_a3f2c1"
  }
}
```

**`resource_suffix` — append it to EVERY resource name.** The generator seeds a top-level `resource_suffix` (a short id, e.g. `a3f2c1`) into `resources.json` at project creation, and it's also in your system prompt. The default `schema` already ends with it (`demo_<slug>_<suffix>`); you must likewise suffix the *name* of every workspace-level resource you create — pipeline, dashboard, Genie space, documents volume, serving endpoint, job, app, ML model, MLflow experiment. This is what keeps two forks of the same template, built on one shared workspace, from colliding on a single shared name (the failure mode: one fork's pipeline reclaims the other's tables, and the recorded IDs go dead). It is **required, not cosmetic**. The catalog is shared and is NOT suffixed — only names that live in a shared namespace are. Never invent a different suffix; use the one already in `resources.json`.

Notes on the trickier keys:
- **Multiple resources of the same type (e.g. a 2nd dashboard added when iterating).** Add another key that ENDS IN THE SAME CANONICAL SUFFIX with a descriptive prefix — e.g. a second dashboard is `labor_economics_dashboard_id` (NOT `dashboard_2` or `second_dashboard`), a second Genie space is `pipeline_health_genie_space_id`, a second job is `recovery_job_id`. The suffix (`_dashboard_id`, `_genie_space_id`, `_job_id`, …) is what the UI link-builder AND the cross-workspace ownership reconcile match on — a key that doesn't end in the canonical suffix is invisible to both, so the resource gets no link/tile and is NEVER re-homed to you (it stays owned by the deployer SP). This is essential on ITERATE turns: when you add a resource to an already-built demo, record it with a suffix-matching key so it's granted to the triggering user like everything else.
- **`documents_volume`** — full UC path `/Volumes/<catalog>/<schema>/<volume>` of the dedicated managed volume holding the demo's PDFs. It is attached to the Genie agent (`genie_space_id`); present only when `unstructured-documents` is built.
- **Legacy keys.** Knowledge Assistant and Supervisor Agent are deprecated: never create them for a new demo. Existing projects may still carry `knowledge_assistant_*` and `multi_agent_supervisor_*` keys; leave those as they are.
- **`mlflow_experiment_path`** — required when the demo trains an ML model. Full workspace path passed to `mlflow.set_experiment(...)`. Without it the MLflow Experiment tile never appears in the resources grid (the UI resolves the path → numeric experiment_id via the SDK).
- **`app` is nested** (`app.name`, `app.id`, `app.deployment_note`). **Record `app.name` as soon as the app's initial setup is done (scaffold + config) — do NOT wait for deploy.** `app.name` alone marks the app capability "built" in the UI, so a preview-only app that never deploys still counts as complete. Add `app.id`/`app.url` later, only after `databricks apps deploy`. If the deploy fails or is intentionally skipped, keep `app.name` and put the explanation in `deployment_note`.
- **Lakebase keys are three flat fields**, not nested. See `app.md` for `lakebase_setup_db.sh` which prints them.

- **buildable**: capabilities that require actual Databricks resources (pipelines, dashboards, agents, apps, etc.)
- **talking_track**: capabilities mentioned in the demo narrative but don't require resource creation
- **created_resources**: filled during build phase — keys match the resource type (e.g., `pipeline_id`, `dashboard_id`, `genie_space_id`)

Capability IDs come from `DEMO_SKILL_DIR/references/platform_architecture.md`.

When the user provides exact capabilities, use those directly — don't override with pattern suggestions.

### Architecture Diagram

Don't write `./architecture.md` by default. Build it **on demand** — when the user asks for an architecture diagram (or starts architecture-first) — always by reading the **`databricks-architecture` skill** (`.claude/skills/databricks-architecture/SKILL.md`).

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

When the project already has files (`README.md`, `resources.json`, `specifications/`), don't restart from stage 0. (On a workshop project, flow B, also read `stages/genie-workshop.md` → "Changing an existing workshop".) Instead:

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

1. **Find example** — check `DEMO_SKILL_DIR/references/blocks/capabilities/<slug>.md` if you need to know more about it and always `DEMO_SKILL_DIR/references/example-luxebeauty/specifications/` for an existing spec of the same capability. Mirror its shape if you don't have a lot of instructions.
2. **Story fit** — does the existing demo arc justify this component? If no, extend the README story beat before writing the spec.
3. **Upstream prerequisites** — does this need new data, a new column, a new dashboard viz, a new model output? If so, patch the upstream specs (`01-lakeflow.md`, etc.) first, regenerate the data, update and re run the sdp pipeline if required and only then write the new component spec.
4. **Write the new component spec when required** — under `specifications/`, following the standards in `stages/02-write-specs.md`.
5. **Build it** — follow `stages/03.1-build.md` for the build order (data → pipeline → consumption layers).
6. **App-specific path** — if the new component is an app, ALSO read `DEMO_SKILL_DIR/app/app.md` end-to-end (it walks the clone-template → specialize → deploy flow that's specific to the React/Node app, not the rest of the demo).
7. **Update `resources.json`** — add the new resource's IDs / endpoints / paths to `created_resources` so the UI tiles light up and the capabilities after the addition/changes.

---

## Brand personalization (`brand/brand.json`)

To personalize a demo to a **real company**, if the user gives you one, search the web for its official website, proper name, and main color palette, and write `brand/brand.json` (everything brand-related lives in the `brand/` folder at the project root):

```json
{ "company": "Rolls-Royce", "palette": ["#10069F", "#C0A062"], "website": "https://www.rolls-roycemotorcars.com", "company_logo": "company_logo.svg", "company_official_website_screenshot": "website.png" }
```

`company_logo` and `company_official_website_screenshot` (both optional) are **bare filenames relative to the `brand/` folder** (i.e. `brand/company_logo.svg`, `brand/website.png`) — the app builder uses the logo in the app header and the screenshot as visual inspiration. The user can ask you to skip this whole step and fill in the info themselves — then just read `brand/brand.json` if it's present. No `brand/brand.json` = not brand-personalized; that's fine. The app builder consumes it at the end of app generation (see `DEMO_SKILL_DIR/app/app.md`).

**When brand-personalized, weave the company name into the story too** — the app's big title, the README persona/company, and the narrative should name the real company (e.g. "<Company> Returns Console", not "LuxeBeauty"). The demo should read as *that company's* solution end to end, not a generic story with a recolored app. The full app-side brand match (palette across all tokens, logo in header + favicon + title, real-site-driven layout) is the LAST step of `DEMO_SKILL_DIR/app/app.md`.

---

## Stage 0 — Capture Intent

**Before assessing anything, check for a captured brief.** If `context/source-brief.md` exists (the user pasted a substantial spec on the home page) OR there are files under `context/uploads/`, **read them in full first** — that content is the authoritative statement of intent, higher-fidelity than any summary you'd write. When a real brief is present:

- **Treat it as "Detailed"** (below) unless it's genuinely thin — the user has already done the thinking; don't re-ideate or propose alternatives.
- **Lossless intake is the rule.** Preserve the brief's specifics — named entities, personas, metrics, numbers, data sources, requirements, and phrasing — through every stage. Your job is to *realize* the spec, not to compress it into a tidier story. A long, careful spec must produce a correspondingly rich demo; if you find yourself dropping details to fit the README template, the template yields, not the spec.
- **`context/source-brief.md` stays the source of truth.** The `README.md` you write in Stage 1 is a *derived* artifact (a presenter's summary), not a replacement for the brief. At every later stage, if the README and the brief disagree or the README is thinner, **re-read `context/source-brief.md`** and defer to it. Never let your own summary become the thing you build from.

First, assess the user's input — how much is already decided?

**Vague** ("retail demo", "something with IoT"): full ideation needed.
1. Propose 2–3 story ideas combining domain terminology with the pattern's arc. Title format: "[Domain]'s [challenge]". Keep it brief. If the user does a followup, consider you're now a Moderate
   ```
   1. **Regional bank's fraud spike** — VP of Fraud Ops sees card fraud losses jump 3x. Traces it to compromised POS terminals at a merchant chain.
   2. **Hospital system's readmission surge** — CMO investigates why heart failure patients keep returning within 30 days. Uncovers a discharge protocol gap.
   3. **Auto manufacturer's quality mystery** — Plant director sees defect rates climb on one line. Traces it to a worn bearing in Station 7.
   Suggested stack: synthetic-data-gen, sdp, aibi-dashboards, genie  + lakeflow-connect, genie-code, genie-one, unity-catalog
   
   Pick one, combine ideas, or describe something else / add capabilities.
   ```

**Moderate** ("fraud detection demo for a bank using data from xx, with dashboards + Genie to investigate suspicious transactions"): story direction is clear but needs fleshing out.
1. Propose a short story (~3-5 sentences, see below). Confirm it against `platform_architecture.md`, ask questions if something isn't clear — no need to propose alternatives.

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

**Read `DEMO_SKILL_DIR/stages/02-write-specs.md` now** and follow it. Outputs: `specifications/*.md`. Includes the coherence pass at the end.

**Mental model before you start:** write `01-lakeflow.md` first (everything else depends on it). Then write the remaining top-level specs (02 / 03 / 04, only the ones this demo uses). Then, if the demo includes a Databricks App, write `specifications/app/*.md`. Sequential — one Write per file. **Don't ruminate, don't say "now I'll write X" — open the Write tool and write.** Coherence review at the end.

**Track this stage:** run `python3 DEMO_SKILL_DIR/tools/track.py SPECS_WRITTEN <demo-slug>` once specs are all written; ignore the result and move on.

**Gate — ask the user before continuing unless instructed otherwise:**
Say for example (don't mention / describe all the files)
```
Demo specifications are ready in `./specifications/`  .
Would you like me to build the demo resources now?

Reply "yes" to start building, or "no" to stop here.
```

Then stop and wait for the user's reply.

## Stage 3 — Build 

If the user confirms, **read `DEMO_SKILL_DIR/stages/03.1-build.md` now** and follow it. It covers: build-order gates, subagent parallelization, how to spawn a build subagent, app generation, and sync rules between specs and built resources.

**Mental model before you start:** build time dominates this stage. The pipeline is the only sequential gate (raw data → SDP → tables exist). Once tables exist, fan out — Genie/Dashboard (with its documents volume, if any) and the App run in parallel. Never loop through resources one at a time on the main thread.

**Track this stage:** run `python3 DEMO_SKILL_DIR/tools/track.py BUILD_COMPLETE <demo-slug>` once `resources.json.created_resources` is populated; ignore the result and move on.

## Stage 4 — Package as a DAB (optional)

When the user asks you to create a DAB, read `DEMO_SKILL_DIR/references/dab/dab.md` and create the DAB specification. **Author + verify only — don't deploy.** Write the bundle, scripts, and `dab_instructions.md` and validate them; do NOT run `bundle deploy` / `bundle run` or the deploy scripts unless the user explicitly asks to deploy (they mutate a workspace). The bundle describes **this** project — take its shape from the example, but every name/description/comment comes from this project's own `README.md` / `resources.json` / `specifications/`; don't carry an example's or another demo's story into it.

## Stage 5 — Hand off to a client (optional)

After a demo is built and packaged as a DAB, the user may ask to make it **"client-ready"** or **"handoff-ready"**. When they do, read `DEMO_SKILL_DIR/references/client-handoff/client-handoff.md` and follow it. It produces a self-contained, IP-stripped ZIP that runs on synthetic data first, then a bundled Genie Code adaptation skill walks the client through pointing the demo at their own tables. This stage is optional and runs after Stage 4; it works on a copy, so the original demo is never modified.

---

## Reference Materials

Browse `DEMO_SKILL_DIR/references/` for worked examples showing file format, detail level, and how files connect. Two examples ship for flows A/C — pick the one that matches the build's capability set (flow B uses `example-luxebeauty-workshop/` instead):

- **`example-luxebeauty/`** — full-stack reference (SDP bronze→silver→gold, metric view, ML premium classifier — `ml/premium_train_score.py`, plus `ml/premium_train_score_with_feature_store.py` used only when `feature-store` is selected — Genie with attached PDF documents, app with tiered offers). Use when the build includes any of `sdp` / `metric-views` / `ml-training-serving`.
- **`example-luxebeauty-simple/`** — Simple-tab set (in-script synth → raw→silver→gold, no SDP; AI/BI + Genie; optional App + Lakebase; no ML). Use when the build sticks to that subset. Ships two **syntax-reference** artifacts (rewrite fully per demo — they show shape, not content): `data_generation/generate_data.py` (self-contained Spark: `spark.range` + `F.when` + broadcast joins → raw Delta → `spark.sql` CTAS for silver/gold/constraints) and `dashboard/dashboard.json` (populated Lakeview: 5-stop palette, frame descriptions, sankey top-N, color pins).

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
