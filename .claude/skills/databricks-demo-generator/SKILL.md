---
name: databricks-demo-generator
description: Generate comprehensive specification files for building Databricks assets, demos or end 2 end projects. Use when users want to create a new demo, design a demo story, or need help structuring demo components, create an entire project. This skill creates prompts that another agent will execute to build the actual demo.
---

# Databricks Demo Generator

A skill for creating and building compelling Databricks demos that Technical Solution Architects will show to enterprise customers across any industry.

## Purpose

Generate a **coherent demo package** — a business story that showcases Databricks capabilities. The story must be compelling (a clear protagonist, problem, and resolution in $), and the technical components must connect end-to-end (data → pipeline → dashboard → agent all align). One key value of this skill: everything generated is fully coherent — the synthetic data serves the story and works as input for every downstream consumer (dashboards, apps, Genie spaces, agents).

This skill has two parts:

1. **Part 1 - Generate Specifications**: Create markdown files describing the demo story, architecture, and component specs. These are functional specs (what to do, not how) that guide implementation.
2. **Part 2 - Build Resources**: If the user opts in, build the actual Databricks resources following the spec files. Keep specs in sync with any changes made during building.

---

## Quick Reference

| Phase | What | Output |
|-------|------|--------|
| 1. Capture Intent | Understand request, browse domain/pattern blocks, ideate if needed | Selected story direction |
| 2. Design Story & Generate Files | Design story, load refs, write `resources.json` + `README.md` + `architecture.md` (parallel) | Top-level files |
| 3. User Review | User confirms story is good | Approval to continue |
| 4. Generate Detailed Specs | Write specification files in staged order (`specifications/*.md`) | Spec files |
| 5. Coherence Review | Verify end-to-end: data → pipeline → dashboard → agent all align | Verified specs |
| 6. Build (opt) | Create Databricks resources using ai-dev-kit skills | Working demo |

---

## Tool-Use Efficiency (read this first — applies to every phase)

Latency is dominated by LLM round-trips, not tool execution. Tool calls in the same response run concurrently. Batch aggressively:

- **Reads are always parallel-safe.** Need domain block + pattern block + 3 capability blocks + `platform_architecture.md`? Emit all 6 `Read` calls in one response — not one per turn.
- **Independent writes are parallel-safe.** `resources.json`, `README.md`, and `architecture.md` don't depend on each other — write all three in one turn.
- **Sequential when semantically dependent.** Dashboard spec must reference exact table names from the pipeline spec → write pipeline first, read it, then write dashboard. Don't parallelize across semantic dependencies even if neither file reads the other at write time.

**When in doubt**: if tool call B doesn't need the *result* of tool call A, issue them together.

---

## Project Structure

```
./README.md           # Story overview, products showcased, walkthrough
./architecture.md     # Architecture diagram schema (JSON) for visual rendering
./META-PROMPT.md      # Build instructions for the AI (generic, do not write it, copy it from template)
./resources.json      # Selected capabilities + created resource IDs
./specifications/     # Detailed specs per component - The exact files depend on what the demo includes — there is no fixed list
```

### resources.json

Source of truth for what capabilities the demo includes. Created during spec phase with capabilities, updated during build with resource IDs. Structure mirrors `{DEMO_SKILL}/references/example-luxebeauty/resources.json`.
**After build** (populated with created resource IDs - do not add links here):
```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {
    "workspace_folder": "/Workspace/Users/.../luxebeauty_demo",
    "pipeline_id": "17bed323-f405-4645-a559-7605171f5b41",
    "dashboard_id": "01efab12cd34...",
    "genie_space_id": "abc123...",
    "knowledge_assistant_id": "ka-456...",
    "multi_agent_supervisor_id": "mas-789...",
    "app_name": "luxebeauty-demo"
  }
}
```

- **buildable**: Capabilities that require actual Databricks resources (pipelines, dashboards, agents, apps, etc.)
- **talking_track**: Capabilities mentioned in the demo narrative but don't require resource creation
- **created_resources**: Filled during build phase — keys match the resource type (e.g., `pipeline_id`, `dashboard_id`, `genie_space_id`)

Capability IDs come from `{DEMO_SKILL}/references/platform_architecture.md`.

When the user provides exact capabilities, use those directly — don't override with pattern suggestions.

### Architecture Diagram

Read `{DEMO_SKILL}/references/architecture.md` for the schema format (icons, tiers, columns, edges, groups). Generate the architecture as JSON in `./architecture.md` — the UI renders it automatically.

---

## Context Blocks & Platform Architecture

**Always start by reading `{DEMO_SKILL}/references/platform_architecture.md`** — it shows the complete Databricks platform capabilities with dependencies, all product IDs and categories, and when to use each capability.

`{DEMO_SKILL}/references/blocks/` contains reusable context. Explore them for: ideation (user has a vague use-case, you need to know common industry use-cases / best practices) or to better understand how to position Databricks features / how they work

| Folder | What's Inside | When to Read |
|--------|--------------|--------------|
| `domains/` | Industry verticals (retail, healthcare, finance, manufacturing) — terminology, KPIs, personas, pain points | When the demo targets a specific industry |
| `patterns/` | Story structures (anomaly detection, segmentation, predictive, compliance, real-time) — narrative arc, data shape, wow-moment design | When designing the story flow |
| `capabilities/` | Databricks products — selling points, positioning, how to showcase unique value, common pitfalls | When you need deep product knowledge for spec writing |

Blocks cross-reference each other: domain blocks have `suggested_patterns` and `suggested_capabilities`, pattern blocks have `suggested_capabilities`, capability blocks have `related`.

---

## Storytelling Fundamentals

The demo is a **Databricks Pitch**. Keep it simple.

Regardless of pattern, every demo needs a great story. A great demo has:
- **A clear protagonist** — Named persona with a business role and a problem
- **Business metrics in $** — "$500K at risk" lands; "720 records" doesn't
- **A wow moment** — The point where the platform does something impressive (root cause in 60 seconds, prediction prevents downtime, NL question returns a complete answer)
- **A clear value statement** — "Days → minutes", "$2M saved annually"

### Keep It Simple

- **Accessible domains** — Retail, manufacturing, healthcare, finance. Everyone gets "returns went up" or "this machine is about to fail."
- **Business language** — Revenue, cost, customers (in $). Not technical jargon.
- **One clear problem** — Focused narrative, easy to follow.

**The rule**: If you have to explain the business domain before the demo, pick a simpler domain.

---

## Modifying an Existing Project

When the project already has files (`README.md`, `resources.json`, `specifications/`), don't restart from Phase 1. Instead:

1. **Read existing state** — `README.md`, `resources.json`, and any `specifications/*.md` files
2. **Understand the user's request** — what they want to change (story, capabilities, a specific spec, a built resource)
3. **Make targeted changes** — update only the affected files. Keep everything else consistent.
4. **Propagate changes downstream** — if you change the story or data schema, update all specs that reference those values. If you change a spec, update the built resource if it exists.

The coherence contract still applies: every change must ripple through all dependent files.

---

## Part 1: Generate Specifications

### Phase 1: Capture Intent

First, assess the user's input — how much is already decided?

**Vague** ("retail demo", "something with IoT"): Full ideation needed.
1. Check `{DEMO_SKILL}/references/blocks/domains/` for a matching domain block — read it for terminology, KPIs, personas, pain points. Note its `suggested_patterns` and `suggested_capabilities`. No match? Use general knowledge.
2. Browse `{DEMO_SKILL}/references/blocks/patterns/` — use the domain's `suggested_patterns` to pick the best fit. Read it for the narrative arc, data shape, wow moment, and suggested capabilities.
3. Propose 2-3 story ideas combining domain terminology with the pattern's arc. Title format: "[Domain]'s [problem]". Keep it brief — no product names yet.
   ```
   1. **Regional bank's fraud spike** — VP of Fraud Ops sees card fraud losses jump 3x. Traces it to compromised POS terminals at a merchant chain.
   2. **Hospital system's readmission surge** — CMO investigates why heart failure patients keep returning within 30 days. Uncovers a discharge protocol gap.
   3. **Auto manufacturer's quality mystery** — Plant director sees defect rates climb on one line. Traces it to a worn bearing in Station 7.

   Pick one, combine ideas, or describe something else.
   ```

**Moderate** ("fraud detection demo for a bank, dashboards + Genie to investigate suspicious transactions"): Story direction is clear but needs fleshing out.
1. Read domain block if one exists. Read the matching pattern block.
2. Confirm capabilities from the platform_architecture.md and capabilities block when more details are required — no need to propose alternatives.

**Detailed** (full PRD with protagonist, catalyst, narrative arc already defined): The user has done the thinking. Skip ideation — go straight to databricks features / capabilities, generate the story for validation, then specs.

### Phase 2: Design the Story & Generate Files

Once the direction is clear, two things happen: design the story, then write all files.

#### Designing the Story

Nail down the specifics. The exact structure depends on the story pattern, but should define (unless instructed otherwise):

1. **The Protagonist** — Company name, industry, persona name and role, what they care about
2. **The Setup** — What's normal, what context the audience needs
3. **The Catalyst** — What triggers the demo flow (a spike, a question, a prediction, an alert)
4. **The Journey** — How the protagonist uses the platform to get from question to answer
5. **The Resolution** — What they learn, the business impact (in $), what action they take
6. **The Value** — One-sentence "so what" that lands with the audience

**Match products to story moments** — Each product should have a clear "when it shines" moment in the walkthrough. Drop any from the story that don't earn a moment; add any the user requests.
Important: you must always keep the resources.json up to date with all the product capabilities the demo requires. Some technical products (data generation) can be in resources.json (we need them for implementation) and not appear in the README.md story (they don't have a wow effect in the story).

#### Context Load — one turn, all reads in parallel

Before writing files, load all references in a single response:

- `{DEMO_SKILL}/references/architecture.md` — diagram schema
- `{DEMO_SKILL}/references/example-luxebeauty/README.md` — style reference
- `{DEMO_SKILL}/references/platform_architecture.md` — if not already in context
- Any capability blocks you need for understanding product positioning (avoid reading them if it's clear from common knowledge, specific ones like dashboard can be valuable)

All reads in ONE turn. If you catch yourself wanting to Read during the write step, go back and add it to this batch.

#### Write resources.json + README.md + architecture.md — PARALLEL

Emit all three files in a single response using three parallel Write calls. They share no file-level dependency.

**`./resources.json`** — The user's message includes an AUTHORITATIVE CAPABILITY LIST when coming from the UI. That list is the source of truth. If the story mentions a product not in the list, rewrite the sentence or drop the reference — don't add it to resources.json.

**`./architecture.md`** — JSON diagram following the schema in `{DEMO_SKILL}/references/architecture.md`. Nodes and edges must match the products in README and resources.json.

**`./README.md`** — Same structure as `{DEMO_SKILL}/references/example-luxebeauty/README.md`:
- **The Story** — Summary table (company, protagonist, problem, journey, resolution, impact)
- **Overview** — Short paragraph
- **Key Numbers** — Metrics table
- **Products Showcased** — Product + what it does in this demo (must match resources.json)
- **Demo Walkthrough** — Concise bullet points a presenter can glance at

**Coherence across the three files is your responsibility** — you're writing all three from the same plan in context, so Products Showcased ↔ architecture nodes ↔ resources.json capabilities must all name the same set of products. The parallel writes work because coherence comes from your plan, not from reading one file to write the next.

### Phase 3: User Review Checkpoint

**Stop and ask for user approval before generating detailed specs.** Summarize the story, key products, and demo flow. Wait for confirmation.
After writing README.md, say:
```
I've created the demo story in README.md with:
- [VERY Brief summary of the story with products being showcased]
- [VERY SHORT The demo flow]

**Should I go ahead and generate the detailed specification files?**

Reply "yes" to continue, or let me know what to change.
```


### Phase 4: Generate Detailed Specifications

After approval, generate:
- `META-PROMPT.md` — **Copy `cp {DEMO_SKILL}/references/META-PROMPT-TEMPLATE.md {PROJECT}/META-PROMPT.md` as-is.** It's fully generic do not write it.
- `specifications/*.md` — One file per category, numbered in build order (read `{DEMO_SKILL}/references/example-luxebeauty/specifications/` for format and density reference)

Only generate files for categories used in this demo. Skip unused categories (keep the number gap).

| # | Category | File | What goes in it |
|---|----------|------|-----------------|
| 01 | Lakeflow | `01-lakeflow.md` | Data generation (schemas, distributions, the event), unstructured docs/PDFs, SDP pipeline (bronze→silver→gold), validation queries |
| 02 | UC Governance | `02-uc-governance.md` | ABAC policies, data quality monitors, classification rules |
| 03 | AI/BI | `03-ai-bi.md` | Dashboard (layout, filters, widgets) + Genie Space (system instructions, investigation flow, sample Q&A) |
| 04 | Agent Bricks | `04-agent-bricks.md` | KA (docs, system instructions, Q&A) + MAS (routing, demo flow) + model serving if applicable |
| 05 | Apps & Infra | `05-apps-infra.md` | Databricks Apps + Lakebase config |

**Staging rule**: Downstream specs reference tables, columns, and IDs that upstream specs define. Parallelize within a stage, serialize across.

| Stage | Files (parallel within stage) | Depends On |
|-------|-------------------------------|------------|
| **A — Foundations** | `META-PROMPT.md` (cp do not write), `01-lakeflow.md` | Nothing |
| **B — Governance** | `02-uc-governance.md` | Stage A (table names) |
| **C — Consumption** | `03-ai-bi.md`, `04-agent-bricks.md` | Stages A–B (Gold tables, columns, doc IDs) |
| **D — Apps** | `05-apps-infra.md` | Stages A–C |

**Before each stage after A, read the files the previous stage wrote.** They are the source of truth for names — dashboard dataset SQL must reference only tables defined in the pipeline spec with exact, fully-qualified names.

#### Writing Good Spec Files

Each file must be clear enough that another agent can execute without ambiguity. Write **functional specs** (what to build, not how). Focus on:

- **Deterministic values**: Exact IDs, names, numbers that must be reproduced
- **Schemas**: Column names, types, relationships, count must be correct so keep it high level to avoid spec errors.
- **The event**: What makes the story data interesting (distributions, anomalies)
- **Coherence contracts**: Which columns/tables are consumed downstream (e.g., gold table dimensions must match dashboard filters)
- **Temporal realism**: The story's key event (spike, anomaly, incident) should be clearly in the **past** — NOT at the rightmost edge of charts. Place the peak ~2-4 weeks ago with a realistic decay curve (build-up → peak → gradual return toward baseline). This produces dashboards where the anomaly is visually obvious as a bump in historical data, not a cliff edge. Define explicit time anchors (e.g., `SPIKE_PEAK = NOW - 3 weeks, DECAY_START = NOW - 2 weeks`).
- **Dashboard color**: Charts should group/color by a key dimension (region, category, segment) so the dashboard is visually rich. Bar charts stacked/grouped by the filter dimension; line charts colored by region or category. A monochrome dashboard is a missed opportunity — color reveals which segment drives the anomaly.

Define shared values (affected SKUs, lot, persona, metrics) once in `01-lakeflow.md`, reference "from 01" in later files.

### Phase 5: Coherence Review

**The hardest and most important step.** Check that everything connects and do a last round of edit if needed:

- [ ] The data generation file values are coherent with the story metrics, and the math checks out
- [ ] Data supports all dashboard visualizations (columns, aggregations, filter dimensions) and genie questions
- [ ] Documents (if any) contain the content KA queries expect
- [ ] Identifiers match across data and documents (lot IDs, SKUs, dates)
- [ ] Key numbers are consistent everywhere (same amounts, same rates)
- [ ] The demo flow works end-to-end (each step feeds the next) and highlight databricks features
- [ ] Specs are functional (WHAT to do), not technical (HOW to do it)

**Final review prompt**: Ask yourself: "Is this a great, coherent story? Is all data there to support every downstream consumer? Did I follow all user instructions?"

After coherence review, ask the user if they want to build:
```
Demo specifications are ready in `./specifications/`.
Would you like me to build the demo resources now?

Reply "yes" to start building, or "no" to stop here.
```

---

## Part 2: Build Resources (Phase 6)

If the user confirms, build the actual Databricks resources.

### Building with ai-dev-kit Skills

**All building uses ai-dev-kit CLI skills — not MCP tools.** Before each build step, load the relevant skill from the `{SKILLS}` directory (check your system prompt for the skill list)

For each capability: load skill → read spec file → create resource → validate → update `resources.json` with resource ID.

### Build-Order Gates — Do Not Skip

Consumption resources depend on upstream data. The dependency graph is in `{DEMO_SKILL}/references/platform_architecture.md`. The core rule: **never create a downstream resource before its upstream data exists and is verified**.

Before creating any dashboard, Genie space, KA, or agent: verify every table/document it references exists and has rows. If a gate fails, STOP and fix upstream — do not proceed.

**CRITICAL: Keep spec files in sync.** If you change a resource during build, or if the user ask you to change a resource, update its spec file first.

---

## Reference Materials

Browse `{DEMO_SKILL}/references/` for worked examples showing file format, detail level, and how files connect. The `example-luxebeauty/` folder is the primary reference — adapt the structure, don't copy the content.

---

## Key Principles

1. **Story first** — Start with "what question does the protagonist ask?" not "what components do we need?"
2. **Coherence above all** — Data, pipeline, dashboard, Genie, agents must all align. One broken link ruins the demo.
3. **5-second test** — The key insight must be obvious at a glance on any dashboard
4. **Business metrics in $** — Revenue, cost, impact. Not row counts.
5. **Match products to moments** — Every showcased product earns a clear beat in the walkthrough
6. **Functional specs** — Describe outcomes, not implementation. No API calls or code in spec files.

---

## Handling Unknown Components

When the user requests a Databricks feature you're not familiar with:

1. Check if a capability block exists in `{DEMO_SKILL}/references/blocks/capabilities/`
2. If not, fetch documentation from `https://docs.databricks.com/llms.txt`
3. Understand what value it adds to the demo
4. Write functional specs (what it should do, inputs, outputs)

Don't refuse — learn and adapt.

---

## Flexibility

Everything in this skill is a **default**. The user is in control:

- User wants different components? Follow their lead.
- User wants a different story pattern? Do it.
- User wants to skip the walkthrough? Fine.
- User has specific requirements that contradict these defaults? User wins.

**Your job**: Help the user create a great demo, whatever that looks like for them.