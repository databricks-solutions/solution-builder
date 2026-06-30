# Stage 02 — Generate Detailed Specs + Coherence Review

Runs after stage 1 (`README.md` + `resources.json` + `architecture.md` approved by user). Produces functional specs that the stage-3 build agent can execute without ambiguity to create the Databricks resources.

## What you're producing

You are producing the specification files for the demo.
Here is a default layout example, but it can vary / be quite different based on the user request:
```
PROJECT/
├── META-PROMPT.md              (copied verbatim from template — do not author, `cat DEMO_SKILL_DIR/references/META-PROMPT-TEMPLATE.md > PROJECT/META-PROMPT.md`)
├── specifications/
│   ├── 01-lakeflow.md          synthetic data + PDFs (optional) + (SDP bronze→silver→gold or just a few SQL queries to load the tables) + validation
│   ├── 02-uc-governance.md     metric views, ABAC, data quality monitors, classification  (optional)
│   ├── 03-ml-*.md              ML model (train + UC register + batch-score to gold table) (optional, only if `ml-training-serving`)
│   ├── 04-ai-bi.md             dashboard (layout/filters/widgets) + Genie space            (optional)
│   ├── 05-agent-bricks.md      Knowledge Assistant + Multi-Agent Supervisor               (optional)
│   └── app/*.md                Databricks App spec — file structure flexible              (only if `databricks-apps`)
```

### Pick the matching reference example

Before you start writing, check `resources.json` capabilities and read the matching example:

- **Simple demo** — capabilities are a subset of:
  `synthetic-data-gen`, `aibi-dashboards`, `genie`, `databricks-apps`, `lakebase`,
  plus the talking-track set (`lakeflow-connect`, `unity-catalog`, `genie-one`, `genie-code`).
  No `sdp`, no `metric-views`, no `ml-training-serving`, no `knowledge-assistant`, no `supervisor-agent`.
  → Reference: **`DEMO_SKILL_DIR/references/example-luxebeauty-simple/specifications/`**
  (synth → gold tables directly, no SDP / KA / MAS / ML; 2 spec files at the top level + the `app/` subset).
  Two canonical artifacts ship alongside the simple spec, ready to lift verbatim into the spec text:
  - **`example-luxebeauty-simple/data_generation/generate_data.py`** — self-contained Python (pandas → Parquet on UC Volume → inline `spark.sql` CTAS for raw + gold + constraints). When writing `01-lakeflow.md`, reference this file so the build agent can use it as the starting skeleton.
  - **`example-luxebeauty-simple/dashboard/dashboard.json`** — the shipped Lakeview JSON with the 5-stop palette, frame descriptions, and category/source color pins already wired. When writing `04-ai-bi.md`, reference this file so the build agent can use it as the layout starting point.

  **These are examples, not templates.** They exist so you (and the build agent) can see the *syntax* and the file *shape* — what a working Parquet-drop synth looks like, what a populated Lakeview JSON looks like with the right encoding fields. **Everything in them must change per demo**: the story (persona, narrative, hero numbers), the schema (entities, columns, IDs), the widgets (which charts, what they show, what they're titled), positions, types, color pins, descriptions, dataset SQL — all of it. Treat the files as "this is the *kind* of thing you produce", not "fill in the blanks".

- **Full demo** — any of `sdp`, `metric-views`, `ml-training-serving`, `knowledge-assistant`, `supervisor-agent` is selected.
  → Reference: **`DEMO_SKILL_DIR/references/example-luxebeauty/specifications/`**
  (full bronze→silver→gold SDP pipeline, metric view, hidden-premium ML classifier, KA over PDFs, MAS routing).

Read the matching example for **format and detail level**, never for narrative — the LuxeBeauty story is not yours.

## Don't think too hard — call the tools

Spec writing is **execution**, not deliberation. README + resources.json are in context. Read the matching luxebeauty file for format → one `Write` per spec → next file. No prose drafts, no "Now I'll draft…" narration.

**Stop the moment you catch yourself doing any of these — they generate the bulk of wasted thinking:**

1. **Restating README facts to yourself.** Entity count, IDs, costs, timeline, baselines are in the README. Quote them into the spec once; don't paraphrase them in your reasoning ("I'm settling on N…", "the failure was 3 weeks ago…", "the cost was $X…").
2. **Doing the build agent's job.** Specs = **WHAT**, not **HOW**. Not yours at spec time: SQL bodies, threshold tuning, GBT vs RF, dashboard pixel layouts, React components, ML hyperparameters, class-imbalance strategies. Spec says "anomaly score: 0–1 z-score, 30-day rolling baseline, target ≈ 0.8 for the affected entity" — done.
3. **Re-verifying what the skill already stated.** Directories are pre-seeded, META-PROMPT is copied, catalog/schema are in `resources.json`. Every "let me check…" instinct is a smell — trust the skill.

In doubt: pick a reasonable value, write it, move on. Build agent fine-tunes.

## The one dependency rule

`01-lakeflow.md` defines the data sources for the story (table/column/ID names). Every other spec consumes those names, so 01 is written first. Your job is to WRITE all the specification files respecting the story and capabilities selected.
Important: 
- if SDP capability is selected, describe the table creation using a SDP typically bronze/silver/glod
- if SDP is NOT selected, then DO NOT run sdp / mention the sdp in the lakeflow skill, instead instruct to run a few simple, interactive SQL queries to quikcly create the tables required for the downstream resources.

**Pre-seeded by project creation**: these might have been created for you: `PROJECT/specifications/` already exists, `PROJECT/specifications/app/` exists if `databricks-apps` is in capabilities, and `PROJECT/META-PROMPT.md` is already copied from the template. Skip those steps; just write the spec files.

Typical order: 

1. Write `01-lakeflow.md`.
2. Write 02 / 03 / 04 / 05 — only the ones this demo uses (check `resources.json` capabilities; skip any whose subject the demo doesn't include). The table above lists what goes in each; deviate / add / merge as the story demands. Note the order: 03 is ML because both AI/BI (dashboard tiles reading prediction tables) and agents (tool calls to Genie over predictions) can consume model output — so ML is specced before either of them. Skip 03 entirely if the demo has no ML.
3. **If `databricks-apps` is in `resources.json` capabilities**, write the app spec into `PROJECT/specifications/app/*.md` — see "App spec" section below for what goes in it.
4. **Coherence review** — see below.
5. Return to SKILL.md for the next stage.

## Spec-writing standards

Functional specs — **what** to build, not **how**. Each file must be unambiguous for another agent to execute.

- **Story alignment (the one rule that overrides all the others).** Every spec serves the demo story end-to-end. Before writing anything in a spec, hold the whole arc in mind: the data the pipeline produces → the gold tables → the dashboard widgets → the Genie questions → the KA docs → the agent's tool chain → the app pages → the closing line in the README walkthrough. Each piece must feed the next. A column you add must show up where it's needed; a Genie question must be answerable by the data; a KA doc must contain the phrase the demo flow asks about; the app's "fix it" button must mutate a table that's actually present. If you can't trace a spec decision back to a moment in the README walkthrough, it doesn't belong. Every spec should be read as *"how does this serve the story?"* — not *"what does this product technically support?"*.
- **Deterministic values**: exact IDs, names, numbers that must be reproduced.
- **Schemas**: column names, types, relationships, counts. Correct but high-level — avoid over-specifying types you'll regret.
- **The event**: distributions and anomalies that make the data interesting. The story's catalyst (`stages/01-design-story.md` → Catalyst) committed to two rules — specs enforce them:
  - **Signal visible to the eye.** When the dashboard renders, anyone in the room should point at the anomaly without squinting. Realistic noise + a subtle event = invisible chart. If signal-to-noise is borderline, dial the event up or the noise down. Make the trade-off explicit (e.g. *"the lot's return spike must dominate baseline daily variance"*).
  - **Temporal realism — peak in the past, avoid at the chart edge.** Build-up → peak → decay back toward baseline. Anchor the peak ~2–4 weeks ago with explicit timestamps (`SPIKE_PEAK = NOW − 3 weeks`, `DECAY_START = NOW − 2 weeks`). A spike at the rightmost edge looks like a cliff, not a story.
- **Coherence contracts**: which columns/tables are consumed downstream (gold-table dimensions must match dashboard filters, KPI definitions must match Genie answers, KA document content must contain what the demo flow asks about, identifiers must match across data and PDFs).
- **Dashboard**: read the capability block `DEMO_SKILL_DIR/references/blocks/capabilities/aibi-dashboards.md` — it covers widget types, encoding rules, theme + color pinning, frame descriptions, sankey top-N bucketing, the symbol-map nested-coordinates pattern, and all the silent-failure pitfalls. Prefer charts that group/color by a key dimension (region, category, segment). Bar charts stacked/grouped by the filter dimension; line charts colored by region or category. **`databricks-aibi-dashboards`** (the ai-dev-kit skill) handles HOW to emit the JSON during Stage 3; this spec stays WHAT-only.
- **Genie / MAS**: make sure it's all connected to the data, and typically to the KA (pdf docs) if the MAS + KA capabilities are selected
- **Shared values defined once**: affected SKUs, lot, persona, baseline metrics live in `01-lakeflow.md`. Later specs reference "from 01" instead of restating.

## App spec

**Skip this section unless `databricks-apps` is in `resources.json` capabilities.**

The Databricks App for this demo starts from a generic template at `DEMO_SKILL_DIR/app/app_template/`. During Stage 3 (build), the template is copied into `PROJECT/app/` and customized per spec. You are **not writing a spec from scratch** — you are writing a spec that describes how to adapt this template to this demo's story.

**But the template is a starting point, not a cage.** The spec describes the app *this demo* needs — which may have fewer components than the template (e.g. the **Simple demo**: Genie as the data tool instead of MAS, no KA, no ML tiering), more/different ones (a second entity, an extra page, a tool the template lacks), or an **entirely different shape** (different pages, navigation, and primary interaction, no operations-queue at all). If the demo calls for that, **spec a wholesale rewrite of the pages and layout** — the build agent will redraw `HomeView`, the operations page, the routes and sidebar, keeping only the reusable plumbing (chat dock + streaming, MLflow tracing, OBO auth, Delta→Lakebase sync, config substitution). Spec the app the *story* needs; don't shrink the story to fit the template's screens.

You don't need to scan the template's source code. `TEMPLATE_MAP.md` describes what ships (surfaces, agent tools, Lakebase schema, streaming infra) — that's all you need.
You are free to change the app especialy the operational part, and change/add menus so that it's easy to understand, eyes catching (visual components are the best), aligned with the story.

### Read these before writing the app spec

- `DEMO_SKILL_DIR/app/app_template/TEMPLATE_MAP.md` — **most important.** Functional summary of what ships, the canonical demo arc, what to preserve vs. rewrite. Authoritative; do not scan source code.
- `DEMO_SKILL_DIR/app/app.md` — how the template is copied + customized during build.
- Worked-example folder — **pick the matching one** (see "Pick the matching reference example" above):
  - Full-stack demo → `DEMO_SKILL_DIR/references/example-luxebeauty/specifications/app/` (MAS + KA + ML tier-split).
  - Simple demo → `DEMO_SKILL_DIR/references/example-luxebeauty-simple/specifications/app/` (single-agent Genie tool, flat 10% offer, no premium tiering).

  **LuxeBeauty's returns domain is not yours.** Read for format, file count, density. Never copy narrative, persona, tool names, or page content.

### What to write

- **Location:** `PROJECT/specifications/app/*.md`.
- **File structure is flexible.** Luxebeauty has 4 files (overview+home+assistant / operations / analytics+dashboard / data model); adapt as needed.
- **You decide** file count, names, pages, tools, demo flow — derived from this demo's README + 01-lakeflow.

### Scope rules

- Domain/story matches this demo's README; the template is example/inspiration only, from a different use case.
- Aim for **1 operations page** with a precise spec.
- Focus areas: narrative coherence (persona/story/starter questions/scripted demo chain align with README + data specs) · agent behavior (tools, 3-phase action chain adapted to domain) · pages (what each shows, how it maps to Databricks capabilities) · data model (Delta→Lakebase mirror, entity shape, append-only audit).
- Not a full app. Focused subset: something is wrong → user asks the agent why → agent has tools to fix it (tools mock external calls). Keep it simple.
- Adaptability: no MAS → Genie or pure agent; no dashboard → remove page; no KA → MAS routes to Genie only.
- **Design the page from the persona, not from the template.** The template ships a particular page shape that fits its own story; reusing it verbatim with renamed columns produces an app that looks like the template no matter how the data is labeled. Ask: *what does this persona stare at all day?* The answer drives the primary visualization — a map, a grid, a chart, a schematic, a timeline, or a queue depending on the domain. Imagine the screenshot in the demo recording: if it would read as *"a table with rows"*, redesign until it reads as *"this is a {domain} app"* at a glance.

### Data must enable a visual, eye-catching app

The app's primary page needs data shaped for **a strong visual hook**, not just rows in a table. When designing `01-lakeflow.md` and the gold tables this app will sync to Lakebase, make sure the schema supports the visualization the app will use:

- If the page is a map or geospatial grid → entities need stable IDs, positions (or cluster/site labels), and a health/status field.
- If the page is a chart or sparkline → entities need a time series with enough density and a clearly visible anomaly inside the window.
- If the page is a heat map / scorecard → entities need a numeric metric with a wide value spread so colors are differentiated.
- Any page → the affected entity (the one the demo's story spotlights) must be **immediately distinguishable** from the rest of the fleet/cohort by a single column the UI can color/badge/highlight.

Cross-check during coherence review: open the app's data model in your head and ask *"if I render this on screen, does the anomaly the story is about jump out, or does it require squinting?"* If it requires squinting, the data spec needs more contrast — either bigger relative gaps or a derived flag column the UI can color by.

## Coherence review

Before the build gate, verify everything connects. Edit where needed.

- [ ] Data generation math is coherent with story metrics.
- [ ] Data supports every dashboard widget (columns, aggregations, filter dimensions) and every Genie question.
- [ ] Documents (if any) contain what KA queries expect.
- [ ] Identifiers match across data and documents (lot IDs, SKUs, dates).
- [ ] Key numbers are consistent everywhere (same amounts, same rates).
- [ ] Demo flow works end-to-end (each step feeds the next) and highlights Databricks features.
- [ ] Specs are functional (WHAT), not technical (HOW).

**Final review question**: *"Is this a great, coherent story? Is the data there to support every downstream consumer? Did I follow all user instructions?"*

Once coherence is done, return to SKILL.md for the stage-2 build-or-stop gate.
