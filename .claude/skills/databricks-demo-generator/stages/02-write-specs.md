# Stage 02 — Generate Detailed Specs + Coherence Review

Runs after stage 1 (`README.md` + `resources.json` + `architecture.md` approved by user). Produces functional specs that the stage-3 build agent can execute without ambiguity to create the Databricks resources.

## What you're producing

```
PROJECT/
├── META-PROMPT.md              (copied verbatim from template — do not author, `cat DEMO_SKILL_DIR/references/META-PROMPT-TEMPLATE.md > PROJECT/META-PROMPT.md`)
├── specifications/
│   ├── 01-lakeflow.md          synthetic data + PDFs + SDP bronze→silver→gold + validation
│   ├── 02-uc-governance.md     metric views, ABAC, data quality monitors, classification  (optional)
│   ├── 03-ai-bi.md             dashboard (layout/filters/widgets) + Genie space            (optional)
│   ├── 04-agent-bricks.md      Knowledge Assistant + Multi-Agent Supervisor + serving     (optional)
│   └── app/*.md                Databricks App spec — file structure flexible              (only if `databricks-apps`)
```

Reference at the target density: `DEMO_SKILL_DIR/references/example-luxebeauty/specifications/` (top-level + `app/`). Start by reading it for format and detail level, never for narrative — the LuxeBeauty story is not yours.

## Don't think too hard — call the tools

Spec writing is mainly **execution**, not deliberation. You have stage 1's `README.md` and `resources.json` in context. Create now spec files. Don't say "Writing the spec…" or "Now I'll draft 03-ai-bi…" — open the Write tool and write instead.

The right pattern for each file: read the matching luxebeauty reference if you need format reminders → emit one `Write` call → next file. One Write per file. No drafts in prose.

## The one dependency rule

`01-lakeflow.md` defines the data sources for the story (table/column/ID names). Every other spec consumes those names, so 01 is written first. Your job is to WRITE all the specification files respecting the story and capabilities selected.

**Pre-seeded by project creation**: these might have been created for you: `PROJECT/specifications/` already exists, `PROJECT/specifications/app/` exists if `databricks-apps` is in capabilities, and `PROJECT/META-PROMPT.md` is already copied from the template. Skip those steps; just write the spec files.

Typical order: 

1. Write `01-lakeflow.md`.
2. Write 02 / 03 / 04 — only the ones this demo uses (check `resources.json` capabilities; skip any whose subject the demo doesn't include). The table above lists what goes in each; deviate / add / merge as the story demands.
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
- **Dashboard**: review the aibi-dashboard.md for the widget list. Prefer charts group/color by a key dimension (region, category, segment). Bar charts stacked/grouped by the filter dimension; line charts colored by region or category. 
- **Genie / MAS**: make sure it's all connected to the data, and typically to the KA (pdf docs) if the MAS + KA capabilities are selected
- **Shared values defined once**: affected SKUs, lot, persona, baseline metrics live in `01-lakeflow.md`. Later specs reference "from 01" instead of restating.

## App spec

**Skip this section unless `databricks-apps` is in `resources.json` capabilities.**

The Databricks App for this demo starts from a generic template at `DEMO_SKILL_DIR/app/app_template/`. During Stage 3 (build), the template is copied into `PROJECT/app/` and customized per spec. You are **not writing a spec from scratch** — you are writing a spec that describes how to adapt this template to this demo's story.

You don't need to scan the template's source code. `TEMPLATE_MAP.md` describes what ships (surfaces, agent tools, Lakebase schema, streaming infra) — that's all you need.
You are free to change the app especialy the operational part, and change/add menus so that it's easy to understand, eyes catching (visual components are the best), aligned with the story.

### Read these before writing the app spec

- `DEMO_SKILL_DIR/app/app_template/TEMPLATE_MAP.md` — **most important.** Functional summary of what ships, the canonical demo arc, what to preserve vs. rewrite. Authoritative; do not scan source code.
- `DEMO_SKILL_DIR/app/app.md` — how the template is copied + customized during build.
- All files under `DEMO_SKILL_DIR/references/example-luxebeauty/specifications/app/` — worked example. **LuxeBeauty's returns domain is not yours.** Read for format, file count, density. Never copy narrative, persona, tool names, or page content.

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
