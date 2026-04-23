# Stage 02 — Generate Detailed Specs + Coherence Review

Run this after the stage-1 user-review gate (user approved the story). Produces the `specifications/*.md` files and copies `META-PROMPT.md`, then does a coherence pass before the build-handoff gate.

## Generate the spec files

### 1. Copy META-PROMPT.md (don't write it)

```bash
cp SKILL_DIR/references/META-PROMPT-TEMPLATE.md PROJECT/META-PROMPT.md
```

It's fully generic. Do not author a new one.

### 2. Write `specifications/*.md` in dependency order

One file per category, numbered in build order. Read `SKILL_DIR/references/example-luxebeauty/specifications/*.md` for format + density reference.
Only the subagent in charge of the app should read `example-luxebeauty/specifications/app/*.md` files

**Only generate files for categories the demo actually uses. Skip unused categories.**

Downstream specs reference tables, columns, and IDs that upstream specs define. **Read the previous spec before writing the next** — this is the one place where sequential reads are unavoidable, because the content of N+1 depends on N.

| File(s) | What goes in it | Depends on |
|---------|-----------------|------------|
| `META-PROMPT.md` (cp, don't write), `01-lakeflow.md` | Data generation (schemas, distributions, the event), unstructured docs/PDFs, SDP pipeline (bronze→silver→gold), validation queries | Nothing |
| `02-uc-governance.md` | ABAC policies, data quality monitors, classification rules | lakeflow (table names) |
| `03-ai-bi.md`, `04-agent-bricks.md` | Dashboard (layout, filters, widgets) + Genie Space (instructions, Q&A). KA (docs, instructions, Q&A) + MAS (routing, demo flow) + model serving | lakeflow + governance (gold tables, columns, doc IDs) |
| `specifications/app/*.md` | App spec — read only when an app is required. Spawn a subagent (see below) as soon as `01-lakeflow.md` is written. | lakeflow |

### 3. Writing good spec files

Each file must be clear enough for another agent to execute without ambiguity. Write **functional specs** (what to build, not how). Focus on:

- **Deterministic values**: exact IDs, names, numbers that must be reproduced.
- **Schemas**: column names, types, relationships, counts. Must be correct — so keep it high-level to avoid spec errors.
- **The event**: what makes the story data interesting (distributions, anomalies).
- **Coherence contracts**: which columns/tables are consumed downstream (e.g. gold-table dimensions must match dashboard filters).
- **Temporal realism**: the story's key event (spike, anomaly, incident) must be clearly in the **past** — NOT at the rightmost edge of charts. Place the peak ~2–4 weeks ago with a realistic decay curve (build-up → peak → gradual return toward baseline). Define explicit time anchors, e.g. `SPIKE_PEAK = NOW − 3 weeks, DECAY_START = NOW − 2 weeks`. This produces dashboards where the anomaly is a visible bump in historical data, not a cliff edge.
- **Dashboard color**: charts should group/color by a key dimension (region, category, segment) so the dashboard is visually rich. Bar charts stacked/grouped by the filter dimension; line charts colored by region or category. A monochrome dashboard is a missed opportunity — color reveals which segment drives the anomaly.

Define shared values (affected SKUs, lot, persona, metrics) once in `01-lakeflow.md`, reference "from 01" in later files.

## App specification subagent (only if `databricks-apps` in resources.json)

Spawn a **subagent** as soon as `01-lakeflow.md` is written — it runs in parallel with the other specs. First **read `SKILL_DIR/stages/subagents.md`** — it has the shared prompt structure (framing, speed rules, scope boundaries, completion format). This section only fills in the app-spec-specific parts.

### App-spec subagent — specifics to include in the prompt

**Framing sentence** (for section 1 of the shared template):

> You are a subagent spawned by the `databricks-demo-generator` skill, executing **Stage 02 (spec generation)** — specifically, the app-spec write while the parent writes the other `specifications/*.md` in parallel. Your single job: write the `specifications/app/*.md` files for this demo's app. When done, return: the list of files you wrote + a one-line summary each.

**Reads — substitute absolute paths. Include SKILL.md** — the subagent's output must coordinate with the other specs the parent is writing, so it needs the flow overview.

**Critical framing for the subagent — include this verbatim in the prompt:**

> The Databricks App for this demo starts from a **generic template** (at `SKILL_DIR/app/app_template/`). During Stage 3 (build), the template is copied into `PROJECT/app/` and customized per spec. You are NOT writing a spec from scratch — you are writing a spec that **describes how to adapt this template** to this demo's story. Your spec and the template must fit together.
>
> You do NOT need to scan the template's actual source code. `TEMPLATE_MAP.md` already describes what the template ships with (surfaces, agent tools, Lakebase schema, streaming infra) — that's all you need. The luxebeauty app spec under `references/example-luxebeauty/specifications/app/` is the worked example showing what a spec looks like when that template has been adapted to a returns demo. Read `TEMPLATE_MAP.md` first so you understand the starting point, then read the luxebeauty spec to see how someone translated that starting point into a real demo, then design your own adaptation to this project's README.

Group the reads by purpose:

*Flow + standards:*
- `SKILL_DIR/SKILL.md` — flow overview; confirms Stage 2, sibling specs, coherence rules.
- `SKILL_DIR/stages/02-write-specs.md` — spec-writing standards (sections 3 "Writing good spec files" onward).

*The template you'll be adapting (read before designing anything):*
- `SKILL_DIR/app/app_template/TEMPLATE_MAP.md` — **the most important file.** Functional description of what the template ships with, the canonical demo arc it supports, surface-by-surface purpose, 3 tiers of what to preserve vs. rewrite, and minimal-viable-demo adjustments. This is your ground truth — the shape your spec must fit. Do not scan the template's source code; this map is the authoritative summary.
- `SKILL_DIR/app/app.md` — how the template gets copied and customized during build (Lakebase OAuth, env config, smoke test). Lets you write specs the build subagent can actually execute.

*A worked spec at the target density (reference, not a template to copy):*
- All files under `SKILL_DIR/references/example-luxebeauty/specifications/app/` — the luxebeauty demo's spec. Shows what a spec looks like *after* someone adapted the template to a specific story. **LuxeBeauty's domain (returns) is NOT yours — read for format, file count, and density of detail. Never copy the narrative, persona, tool names, or page content.**

*Your demo's sources of truth:*
- `PROJECT/README.md` — demo story, persona, products, walkthrough. **You read this — the parent will not paraphrase it for you.**
- `PROJECT/resources.json` — capabilities + current resource IDs (catalog, schema, warehouse_id).
- `PROJECT/specifications/01-lakeflow.md` — table names, schemas, data shape that the app will sync/query.

**Project state to inline:** catalog, schema, warehouse_id, workspace folder (pull from `resources.json`). Deterministic values only — do NOT paste story, persona, KPI numbers, page designs, tool lists, or demo flow. See `SKILL_DIR/stages/subagents.md` anti-patterns.

**Output location:** `PROJECT/specifications/app/*.md` — file structure is flexible (example has 4 files: overview+home+assistant, operations, analytics+dashboard, data model — adapt as needed). **The subagent picks file count, names, pages, tools, demo flow** — derived from README + 01-lakeflow. Do not pre-decide these in the prompt. Write all outputs in a SINGLE batched turn.

**Scope additions specific to app specs:**
- App domain/story must match this demo's README, the template is from another use case given only as example/inspiration. Aim for **1 operations page** with a precise spec.
- Focus areas (the subagent designs these): narrative coherence (persona/story/starter questions/scripted demo chain align with README and data specs) · agent behavior (tools, 3-phase action chain adapted to the domain) · pages (what each shows, how it maps to Databricks capabilities) · data model (Delta→Lakebase mirror, entity shape, append-only audit pattern).
- Avoid recreating a full, complete app. The app should be a subset, where typically we see something is wrong, ask about the agent why, and we have some AI brain with tools to fix it (the tools should mock external call). It should remain simple.
- Adaptability: no MAS → Genie or pure agent; no dashboard → remove page; no KA → MAS routes to Genie only.

After spawning, tell the user in one short line (e.g. *"Writing the app specs in the background — ~1 min. Continuing with the other specs meanwhile."*), then continue with the main-thread specs.

## Coherence review (the hardest and most important step) — PARENT ONLY

> **Subagents: skip this section.** It's the parent agent's responsibility, executed after all subagents have returned. If you're a subagent, stop reading here and return your result.

Before handing off to build, check that everything connects and do a last round of edits if needed:

- [ ] Data generation values are coherent with the story metrics; the math checks out.
- [ ] Data supports all dashboard visualizations (columns, aggregations, filter dimensions) and Genie questions.
- [ ] Documents (if any) contain the content KA queries expect.
- [ ] Identifiers match across data and documents (lot IDs, SKUs, dates).
- [ ] Key numbers are consistent everywhere (same amounts, same rates).
- [ ] The demo flow works end-to-end (each step feeds the next) and highlights Databricks features.
- [ ] Specs are functional (WHAT to do), not technical (HOW to do it).

**Final review prompt**: ask yourself — *"Is this a great, coherent story? Is all data there to support every downstream consumer? Did I follow all user instructions?"*

### Gate before the build handoff

**Do NOT ask the user about building while a spec-writing subagent is still running** — say you're waiting and stop the turn.

Once coherence review is done AND all subagents have reported back, return to SKILL.md to deliver the stage-2 build-or-stop gate prompt.
