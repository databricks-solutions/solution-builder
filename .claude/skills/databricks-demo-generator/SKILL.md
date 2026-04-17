---
name: databricks-demo-generator
description: Generate comprehensive specification files for building Databricks assets, demos or end 2 end projects. Use when users want to create a new demo, design a demo story, or need help structuring demo components, create an entire project. This skill creates prompts that another agent will execute to build the actual demo.
---

# Databricks Demo Generator

A skill for creating and building compelling Databricks demos that Technical Solution Architects will show to enterprise customers across any industry.

## Purpose

This skill has two parts:

1. **Part 1 - Generate Instructions**: Create markdown files describing the demo story, architecture, and component specs. These are functional specs (what to do, not how) that guide implementation.

2. **Part 2 - Build Resources**: If the user opts in, build the actual Databricks resources following the instruction files. Keep instructions in sync with any changes made during building.

---

## Quick Reference

| Phase | What | Output |
|-------|------|--------|
| 1. Capture | Understand request, browse context blocks, search demo bank | Selected story direction |
| 2. Design | Define story arc, personas, key moments | Story spec |
| 3. Components & Context Load | Select products + batch-read all references in one turn | Component list + all refs in context |
| 4. Generate plan | Write resources.json + README.md + architecture.md **in one turn, parallel Writes, no reads** | `./resources.json`, `./README.md`, `./architecture.md` |
| 5. **User Review** | User confirms story is good | Approval to continue |
| 6. Generate Details | Write detailed instruction files | `./instructions/` folder |
| 7. Review | Coherence check across all files | Verified instructions |
| 8. Build (opt) | Create Databricks resources | Working demo |

---

## Tool-Use Efficiency (read this first — applies to every phase)

The agent runtime executes multiple tool calls from a single assistant response **concurrently**. Latency is dominated by LLM round-trips, not per-tool time. Batch aggressively:

- **Reads are always parallel-safe.** When you need more than one reference file (domain block + pattern block + N capability blocks + `platform_architecture.md` + `architecture.md` schema reference), emit all `Read` calls in the same response — not one-per-turn.
- **Independent writes are parallel-safe.** `resources.json`, `README.md`, and `architecture.md` do not depend on each other's file contents — only on the plan in your context. Emit them as parallel `Write` calls in one turn.
- **Instruction files that share no data contract** can be written in parallel within a turn. But Phase 6 has hard dependencies across files (e.g., the dashboard spec's table references must match the pipeline spec's Gold tables) — those must be **staged**, not parallelized. See Phase 6 for the staging rules; do not parallelize `03-pipelines.md` with `05-dashboard.md` even though neither reads the other's file at write time, because doing so lets the LLM invent table names that don't match.
- **When in doubt**: if tool call B doesn't need the *result* of tool call A, issue them in the same response.

Sequential is correct when later work depends on earlier results — either literally (a query needs a previous query's output) or semantically (a later spec must name entities the earlier spec defines). Don't default to sequential out of habit, but don't over-parallelize across semantic dependencies either.

---

## Project Structure

Each demo project has this structure:
```
./README.md           # Story overview, products showcased, walkthrough
./architecture.md     # Architecture diagram schema (JSON) for visual rendering
./META-PROMPT.md      # Build instructions for the AI
./resources.json      # Selected capabilities + created resource IDs
./specifications/     # Detailed specs per component
```

The `./instructions/` folder contains detailed specs for each component in the demo. The exact files depend on what the demo includes — there is no fixed list.

### resources.json

This file is the **source of truth** for what capabilities the demo includes. Create it at the start with the selected capabilities, then update it during build with created resource IDs.

**Initial structure** (created during specification phase):
```json
{
  "capabilities": {
    "buildable": ["sdp", "ai-bi-dashboards", "genie", "knowledge-assistant", "supervisor-agent"],
    "talking_track": ["lakeflow-connect", "unity-catalog", "databricks-one", "genie-code"]
  },
  "created_resources": {}
}
```

**After build** (populated with created resource IDs):
```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {
    "catalog": "luxebeauty",
    "schema": "analytics",
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
- **created_resources**: Filled during build phase with resource IDs — these are surfaced as clickable links in the UI

**Capability IDs** come from `{SKILL_BASE_DIR}/references/platform_architecture.md` which lists all available capabilities with their IDs, descriptions, and whether they're buildable.

When the user provides exact capabilities (e.g., `We want the exact capabilities: sdp, genie, databricks-apps`), use those directly — don't override with pattern suggestions.

### Architecture Diagram

When the user asks to create or update the demo architecture diagram, **read `{SKILL_BASE_DIR}/references/architecture.md`** for the schema format. This reference explains:
- Available icons (dashboard, genie, deltaTable, vectorSearch, lakebase, etc.)
- Available tiers/colors (source, bronze, silver, gold, ai, consumer, etc.)
- How to structure columns, nodes, edges, groups, and foundation bars

Generate the architecture as a JSON schema in `./architecture.md`. The UI will automatically render it as an interactive diagram.

---

## Context Blocks — The Knowledge Base

The blocks in `{SKILL_BASE_DIR}/references/blocks/` are the foundation of every demo. Each block encodes the **best way to use Databricks** for that specific capability, industry, or story pattern. The demo generation workflow is: **select blocks → compose them → generate specs**.

| Folder | What's Inside | What It Encodes |
|--------|--------------|-----------------|
| `domains/` | Industry verticals (retail, healthcare, finance, manufacturing) | Terminology, KPIs with baselines, named personas, data entities, regulations, pain points |
| `patterns/` | Story structures (anomaly detection, segmentation, predictive, compliance, real-time) | Narrative arc, data shape, wow-moment guidance, investigation flow, suggested capabilities |
| `capabilities/` | Databricks products (dashboards, Genie, pipelines, KA, model serving, etc.) | How to configure the product for a demo, common pitfalls, positioning guidance, example specs |

### How Blocks Connect

Blocks cross-reference each other:
- **Domain blocks** have `suggested_patterns` and `suggested_capabilities` — telling you which story patterns and products fit that industry
- **Pattern blocks** have `suggested_capabilities` — telling you which products that story structure needs
- **Capability blocks** have `related` — telling you which other capabilities they connect to

### Block Composition Workflow

1. **Domain** (if applicable) → Read the matching domain block for industry terminology, KPIs, personas, and data entities. If no domain block matches, rely on general knowledge.
2. **Pattern** → The domain's `suggested_patterns` narrows the options. Read the pattern block for the story arc, data shape, and wow-moment design.
3. **Capabilities** → The pattern's `suggested_capabilities` tells you which products to include. Read each capability block for configuration guidance and demo positioning.

This gives the LLM everything it needs: **domain-authentic language** (from the domain block), **a proven story structure** (from the pattern block), and **product-specific best practices** (from the capability blocks).

---

## Storytelling Fundamentals

The demo is a **pitch**. Keep it simple.

### Story Patterns

Different demos call for different story structures. The pattern blocks in `{SKILL_BASE_DIR}/references/blocks/patterns/` describe several, including:

- **Anomaly detection / root cause investigation** — A metric spikes, the hero investigates, traces to a root cause. Classic "what happened and why?"
- **Customer segmentation / targeting** — The hero discovers hidden patterns in customer behavior and acts on them. "Who should we target and how?"
- **Predictive maintenance / forecasting** — A model predicts what's about to happen, the hero prevents it. "What's going to break next?"
- **Compliance / audit** — Regulations require proof. The hero demonstrates governance and traceability. "Can we prove we're compliant?"
- **Real-time monitoring / alerting** — Something is happening NOW. The hero responds in real time. "What's happening right now?"

**Read the matching pattern block** if one fits — it has the narrative arc, data shape, wow-moment guidance, and suggested components. If the user's demo doesn't fit any pattern, design a custom story arc.

### What Makes a Good Demo Story

Regardless of pattern:

- **A clear protagonist** — A named persona with a business role and a problem to solve
- **Business metrics** — KPIs in $ (revenue, cost, risk, time saved). A CFO cares about "$500K at risk", not "720 records"
- **A "wow moment"** — The point where the audience sees the platform do something impressive. This could be: tracing a root cause in 60 seconds, a prediction that prevents downtime, a natural-language question that returns a complete answer, or an agent that takes action autonomously.
- **A clear value statement** — "Days → minutes", "$2M saved annually", "100% audit coverage"

### Keep It Simple

- **Accessible domains** — Retail, manufacturing, healthcare, finance. Everyone gets "returns went up" or "this machine is about to fail."
- **Business language** — Revenue, cost, customers (in $). Not technical jargon.
- **One clear problem** — Focused narrative, easy to follow.

**The rule**: If you have to explain the business domain before the demo, pick a simpler domain.

---

## Product Positioning

**Read the capability files in `{SKILL_BASE_DIR}/references/blocks/capabilities/`** to understand what each product does, what pain it solves, and how to position it.

### Choosing Products

Products should connect to the story. For each candidate product, ask:
- Does this product solve a pain in the demo narrative?
- Does it have a clear "moment" in the walkthrough?
- How does it connect to other products in the flow?

### Full Platform Architecture

For a comprehensive view of how ALL 19 products work together in a single demo, **read `{SKILL_BASE_DIR}/references/platform_architecture.md`**. It shows:
- Complete architecture diagram with data flow
- All products with their IDs and categories
- Example: "Regional Bank Fraud Investigation" using every capability
- How Dashboard → Genie → KA → Supervisor Agent → App connect

**Unity Catalog** is a foundation across all patterns (governance, lineage, permissions).

### Products Showcased Section

When generating the README, include a **Products Showcased** table — a simple two-column table showing each product and what it does in *this specific demo*. Keep it brief (one sentence per product).

---

## Part 1: Generate Instructions

### Phase 1: Capture Intent & Select Blocks

Start by understanding what the user wants to build. **Help with ideation — don't just ask questions.**

#### Step 1: Identify the Domain

When the user gives a domain (e.g., "retail demo"), check `{SKILL_BASE_DIR}/references/blocks/domains/` for a matching domain block. If one exists, read it — it has the terminology, KPIs, personas, and pain points you'll need. Note its `suggested_patterns` and `suggested_capabilities`.

If no domain block matches (e.g., "telecom demo"), proceed with general knowledge.

#### Step 2: Select the Story Pattern

Browse `{SKILL_BASE_DIR}/references/blocks/patterns/` and pick the pattern that best fits the user's scenario. Use the domain's `suggested_patterns` to narrow options. Read the selected pattern block — it defines the narrative arc, data shape, wow moment, and which capabilities to use.

If the user has a specific story in mind that doesn't fit any pattern, design a custom arc.

#### Step 3: Generate Ideas

Using the domain context and pattern structure, generate 3 story ideas. Each idea should combine the domain's terminology/personas with the pattern's narrative arc. Keep it brief — this is ideation, no product names yet.

**Title format**: "[Domain]'s [problem]" — tells you who and what at a glance.

```
**Ideas:**
1. **Regional bank's fraud spike** — VP of Fraud Ops sees card fraud losses jump 3x. Traces it to compromised POS terminals at a merchant chain.
2. **Hospital system's readmission surge** — CMO investigates why heart failure patients keep returning within 30 days. Uncovers a discharge protocol gap.
3. **Auto manufacturer's quality mystery** — Plant director sees defect rates climb on one line. Traces it to a worn bearing in Station 7.

Pick one, combine ideas, or describe something else.
```

#### Step 4: (Optional) Check Reference Demos

If the user wants to see pre-built examples, search the demo bank:

```bash
python {SKILL_BASE_DIR}/tools/search_demos.py "retail"
```

Reference demos can be used as-is or customized. Fetch a full spec with:

```bash
python {SKILL_BASE_DIR}/tools/get_demo.py "manufacturing-quality-defects"
```

### Phase 2: Design the Story

Once the user picks a direction, nail down the specifics. The exact structure depends on the story pattern, but always define:

1. **The Protagonist** — Company name, industry, persona name and role, what they care about
2. **The Setup** — What's normal, what context the audience needs
3. **The Catalyst** — What triggers the demo flow (a spike, a question, a prediction, an alert)
4. **The Journey** — How the protagonist uses the platform to get from question to answer
5. **The Resolution** — What they learn, the business impact (in $), what action they take
6. **The Value** — One-sentence "so what" that lands with the audience

### Phase 3: Component Selection & Context Load

The pattern block's `suggested_capabilities` gives you the starting set. **Match products to story moments** — each product should have a clear "when it shines" moment in the walkthrough. Drop any that don't earn a moment; add any the user requests.

If the demo involves external data sources, **Lakeflow Connect** is a natural fit. At the story level, mention the real sources; at implementation time, use synthetic data.

Then confirm catalog/schema with a sensible default:
```
Where to deploy?
Default: ai_demo_gen.{schema_name}

Ok, or specify different location?
```

#### Context Load — one turn, all reads in parallel

Before moving to Phase 4, load the references needed to write the three top-level output files **in a single response with parallel `Read` calls**. Do NOT defer any of these to Phase 4 — Phase 4 is writes-only.

Read all of these together:

- `{SKILL_BASE_DIR}/references/architecture.md` — the diagram schema (icons, tiers, columns, edges, groups). Needed to write `./architecture.md`.
- `{SKILL_BASE_DIR}/references/example-luxebeauty/README.md` — style/structure reference for `./README.md` (tone, table shape, "Products Showcased" table, walkthrough bullet style).
- `{SKILL_BASE_DIR}/references/example-luxebeauty/resources.json` — structure reference for `./resources.json`.
- `{SKILL_BASE_DIR}/references/platform_architecture.md` — if not already in context from earlier phases.

Four reads → ONE assistant response. After this turn you have every reference you need to write all three output files.

**Do NOT read individual capability blocks in this phase.** The README's Products Showcased section is a one-line-per-product table — you can write it from the capability IDs plus your general Databricks knowledge. Capability blocks are deep positioning docs, only needed in Phase 6 when writing detailed instruction files. Reading them here adds multiple turns of latency for information you won't use.

If you catch yourself wanting to do a Read inside Phase 4, go back and add it to this batch instead.

### Phase 4: Generate resources.json + README.md + architecture.md — PARALLEL WRITES ONLY

By now you have already read every reference in Phase 3's Context Load. **Do not read anything in this phase.** If you find yourself wanting to Read a reference file (example README, architecture schema, capability blocks) you missed one in Phase 3 — go back there and batch it in, don't sneak it in here.

**Emit all three files in a single assistant response using three parallel `Write` tool calls.** They share no file-level dependency — each is derived from the plan already in your context.

The three files to write in one turn:

**`./resources.json`** — selected capabilities. The user's message will include an AUTHORITATIVE CAPABILITY LIST — that list is the source of truth for what goes into resources.json. If the story text mentions a Databricks product (e.g., "Knowledge Assistant explains...") but that product is NOT in the authoritative list, DO NOT add it to resources.json or architecture.md. Treat such story mentions as narrative flavor; either rewrite the README sentence to not name the product, or drop it. Mirror the structure from `references/example-luxebeauty/resources.json`:
```json
{
  "capabilities": {
    "buildable": ["sdp", "ai-bi-dashboards", "genie", ...],
    "talking_track": ["lakeflow-connect", "unity-catalog", "databricks-one", "genie-code"]
  },
  "created_resources": {}
}
```

**`./architecture.md`** — JSON diagram schema following `references/architecture.md` (icons, tiers, columns, edges, groups, foundation bars). Node set and edges must match the products you'll list in README's Products Showcased and the capabilities you're writing to resources.json.

**`./README.md`** — same structure and tone as `references/example-luxebeauty/README.md`:
- **The Story** — Summary table (company, protagonist, problem, journey, resolution, impact)
- **Overview** — Short paragraph explaining the demo flow
- **Key Numbers** — Table of metrics (relevant baselines and values)
- **Products Showcased** — Table: product name + what it does in this demo (must match capabilities in resources.json you're writing this same turn)
- **Demo Walkthrough** — Concise bullet points for each phase of the demo (not long scripts)

Keep README scannable. The walkthrough should be bullet points a presenter can glance at, not a script to read verbatim.

**Coherence across the three files is your responsibility in a single turn**: Products Showcased table ↔ architecture nodes ↔ resources.json capabilities must all name the same set of products.

### Phase 5: User Review Checkpoint

**IMPORTANT: Stop and ask for user approval before generating detailed instructions.**

After writing README.md, say:
```
I've created the demo story in README.md with:
- [Brief summary of the story]
- [Key products being showcased]
- [The demo flow]

**Should I go ahead and generate the detailed instruction files?**

Reply "yes" to continue, or let me know what to change.
```

**Wait for user confirmation before proceeding.**

### Phase 6: Generate Detailed Specifications

After approval, generate:
- `META-PROMPT.md` — **Copy `{SKILL_BASE_DIR}/references/META-PROMPT-TEMPLATE.md` as-is.** It's fully generic — no modifications needed.
- `specifications/*.md` — One file per category, numbered in build order (read the example-luxebeauty/specifications)

Only generate files for categories used in this demo. **One file per category**, numbered in canonical order. Skip unused categories (keep the number gap).

| # | Category | File | What goes in it |
|---|----------|------|-----------------|
| 01 | Lakeflow | `01-lakeflow.md` | Data generation (schemas, distributions, the event), unstructured docs/PDFs, SDP pipeline (bronze→silver→gold), validation queries |
| 02 | UC Governance | `02-uc-governance.md` | ABAC policies, data quality monitors, classification rules |
| 03 | AI/BI | `03-ai-bi.md` | Dashboard (layout, filters, widgets) + Genie Space (system instructions, investigation flow, sample Q&A) |
| 04 | Agent Bricks | `04-agent-bricks.md` | KA (docs, system instructions, Q&A) + MAS (routing, demo flow) + model serving if applicable |
| 05 | Apps & Infra | `05-apps-infra.md` | Databricks Apps + Lakebase config |

**Staging rule**: Specifications must be written in stages, not all at once — downstream categories (AI/BI, Agent Bricks) reference tables, columns, and document IDs that upstream categories (Lakeflow) define. Parallelize *within* a stage, serialize *across* stages.

| Stage | Files (parallel within stage) | Depends On |
|-------|-------------------------------|------------|
| **A — Foundations** | `META-PROMPT.md`, `01-lakeflow.md` | Nothing (derived from plan in context) |
| **B — Governance** | `02-uc-governance.md` | Stage A (table names from pipeline spec) |
| **C — Consumption** | `03-ai-bi.md`, `04-agent-bricks.md` | Stages A–B (Gold table names, columns, document IDs) |
| **D — Apps** | `05-apps-infra.md` | Stages A–C (all components it connects to) |

**Before each stage after A, read the files the previous stage wrote.** They are the source of truth for names — dashboard dataset SQL must reference only tables defined in the pipeline spec with exact, fully-qualified names (`{CATALOG}.{SCHEMA}.table_name`).

#### Writing Good Spec Files

One file per category, sections within. Each file must be clear enough that another agent can execute without ambiguity. Write **functional specs** (what to build, not how). Be dense — no prose that an LLM can infer. Focus on:

- **Deterministic values**: Exact IDs, names, numbers that must be reproduced
- **Schemas**: Column names, types, relationships
- **The event**: What makes the story data interesting (distributions, anomalies)
- **Coherence contracts**: Which columns/tables are consumed by downstream categories (e.g., gold table dimensions must match dashboard filters)

**Do NOT repeat story context in every file.** Define shared values (affected SKUs, lot, persona, key metrics) once in `01-lakeflow.md`, reference "from 01" in later files.

### Phase 7: Coherence Review

**The hardest and most important step.** Check that everything connects:

- [ ] Data supports all dashboard visualizations
- [ ] Data supports all Genie sample questions
- [ ] Documents (if any) support KA queries — key content is present
- [ ] Identifiers match across data and documents
- [ ] Dates align across all components
- [ ] Key numbers are consistent everywhere
- [ ] The demo flow works end-to-end (each step feeds the next)
- [ ] Instructions are functional (WHAT to do), not technical (HOW to do it)

**Final review prompt**: "Is this a great, coherent story? Is all data there to support requirements? Did I follow all user instructions?"

### Part 1 Output

After coherence review, provide:

**1. Narrative Summary:**
```
**Your Demo: [Company Name] — [Problem]**

Story: [Protagonist] sees [catalyst]. Asks "[question]".
→ [What the platform reveals, step by step]
→ Impact: [$ amount]
→ Resolution: [action taken]

Location: [catalog.schema]
```

**2. Transition prompt:**
```
Demo specifications are ready in `./specifications/`.
Would you like me to build the demo resources now?

Reply "yes" to start building, or "no" to stop here.
```

---

## Part 2: Build Resources

If the user confirms, build the actual Databricks resources.

### Building with ai-dev-kit Skills

**All building uses ai-dev-kit CLI skills — not MCP tools.** Before each build step, load the relevant skill:

| Building... | Load This Skill |
|-------------|----------------|
| Synthetic data | `databricks-synthetic-data-gen` |
| PDF documents | `databricks-unstructured-pdf-generation` |
| SDP / DLT pipeline | `databricks-spark-declarative-pipelines` |
| Genie Space | `databricks-agent-bricks` (Genie section) |
| AI/BI Dashboard | `databricks-aibi-dashboards` |
| Knowledge Assistant | `databricks-agent-bricks` (KA section) |
| Multi-Agent Supervisor | `databricks-agent-bricks` (MAS section) |
| ML Notebook | `databricks-model-serving` or `databricks-execution-compute` |
| Model Serving endpoint | `databricks-model-serving` |
| Databricks App | `databricks-app-python` |
| Vector Search index | `databricks-vector-search` |

For each capability: load skill → read spec file → create resource → validate → update `resources.json` with resource ID.

### Build-Order Gates — Do Not Skip

Consumption resources (dashboards, Genie spaces, Knowledge Assistants, agents) depend on upstream data. Create them ONLY after their upstream data exists:

| Before building... | Required upstream state |
|--------------------|-------------------------|
| **AI/BI Dashboard** | Pipeline has run successfully AND every referenced table returns `COUNT(*) > 0` via `execute_sql`. |
| **Genie Space** | Every table listed in the Genie config exists and has rows. |
| **Knowledge Assistant** | Source documents uploaded and vector index has finished syncing. |
| **Multi-Agent Supervisor** | Every downstream tool has a valid `*_id` in `resources.json.created_resources`. |

**If a gate fails, STOP and fix the upstream resource — do not proceed.**

**Keep spec files in sync.** If you change a resource, update its spec file first.

---

## Reference Materials

**Before generating instructions, browse `{SKILL_BASE_DIR}/references/`** to understand the expected structure and level of detail.

### Reference Examples

The `references/` folder contains worked examples showing file format, level of detail, and how files connect. Use the example closest to your demo's pattern to understand:
- How detailed each file should be
- How to encode key events in data
- How to write component instructions
- How to structure the walkthrough

**Adapt — don't copy.** Every demo should be tailored to its story and audience.

### Demo Bank

Pre-built story templates for different industries in `tools/demo_references/`. Use `search_demos.py` to find relevant templates, then adapt for your use case.

---

## Key Principles

1. **Story first** — Start with "what question does the protagonist ask?" not "what components do we need?"
2. **5-second test** — The key insight must be obvious at a glance on any dashboard
3. **Business metrics** — KPIs in $ (revenue, cost, impact). "$500K at risk" lands; "720 records affected" doesn't.
4. **Match products to moments** — Every showcased product should have a clear "when it shines" beat in the walkthrough
5. **Functional instructions** — Describe outcomes, not implementation. No API calls or code in instruction files.

---

## Handling Unknown Components

When the user requests a Databricks feature you're not familiar with:

1. Check if a capability block exists in `{SKILL_BASE_DIR}/references/blocks/capabilities/`
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

---

## Skill Directory Paths

All paths in this skill are relative to the skill's base directory. When running commands or reading files:
- Tools: `{SKILL_BASE_DIR}/tools/search_demos.py`, `{SKILL_BASE_DIR}/tools/get_demo.py`
- References: `{SKILL_BASE_DIR}/references/`
- Context blocks: `{SKILL_BASE_DIR}/references/blocks/`
