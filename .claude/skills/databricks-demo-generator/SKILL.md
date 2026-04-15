---
name: databricks-demo-generator
description: Generate comprehensive instruction files for building Databricks demos. Use when users want to create a new demo, design a demo story, or need help structuring demo components. This skill creates prompts that another agent will execute to build the actual demo.
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
| 3. Components | Select Databricks products that fit the story | Component list |
| 4. Generate README | Write story overview | `./README.md` |
| 5. **User Review** | User confirms story is good | Approval to continue |
| 6. Generate Details | Write detailed instruction files | `./instructions/` folder |
| 7. Review | Coherence check across all files | Verified instructions |
| 8. Build (opt) | Create Databricks resources | Working demo |

---

## Project Structure

Each demo project has this structure:
```
./README.md           # Story overview, products showcased, walkthrough
./architecture.md     # Architecture diagram schema (JSON) for visual rendering
./META-PROMPT.md      # Build instructions for the AI
./instructions/       # Detailed specs (content varies based on demo components)
  resources.json      # Tracks created Databricks resource IDs
```

The `./instructions/` folder contains detailed specs for each component in the demo. The exact files depend on what the demo includes — there is no fixed list.

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

### Common Product Combinations

These are starting points — adapt based on what the story needs:

| Demo Pattern | Typical Stack |
|-------------|---------------|
| Investigation / root cause | Lakeflow Connect → SDP → Dashboard → Genie → KA → MAS |
| Segmentation / targeting | SDP → Dashboard → Genie → AI Functions → Notebooks |
| Predictive / forecasting | SDP → Notebooks → MLflow → Model Serving → Dashboard |
| Real-time monitoring | Streaming → SDP → Dashboard → Genie → Databricks Apps |
| Document-heavy / RAG | Vector Search → KA → MAS → Databricks Apps |
| Operational app | SDP → Lakebase → Databricks Apps → Model Serving |

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

### Phase 3: Component Selection

The pattern block's `suggested_capabilities` gives you the starting set. **Read each selected capability block** in `{SKILL_BASE_DIR}/references/blocks/capabilities/` — each one encodes the best way to configure that product for a demo, including common pitfalls and positioning guidance.

**Match products to story moments** — each product should have a clear "when it shines" moment in the walkthrough. Drop any that don't earn a moment; add any the user requests.

If the demo involves external data sources, **Lakeflow Connect** is a natural fit. At the story level, mention the real sources; at implementation time, use synthetic data.

Then confirm catalog/schema with a sensible default:
```
Where to deploy?
Default: ai_demo_gen.{schema_name}

Ok, or specify different location?
```

### Phase 4: Generate README.md

**Browse the reference examples** in `{SKILL_BASE_DIR}/references/` to understand the structure and detail level expected. Pick the example closest to your demo's pattern.

Generate `./README.md` with:
- **The Story** — Summary table (company, protagonist, problem, journey, resolution, impact)
- **Overview** — Short paragraph explaining the demo flow
- **Key Numbers** — Table of metrics (relevant baselines and values)
- **Products Showcased** — Table: product name + what it does in this demo
- **Demo Walkthrough** — Concise bullet points for each phase of the demo (not long scripts)

Keep it scannable. The walkthrough should be bullet points a presenter can glance at, not a script to read verbatim.

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

### Phase 6: Generate Detailed Instructions

After user approves, generate the remaining files.

**At project root:**
- **META-PROMPT.md** — Build instructions for the AI: project structure, build order, resource tracking, validation steps. Use the reference examples as a structural guide, but customize catalog/schema names, build steps, and validation checks for this specific demo.

**In `./instructions/` folder:**
Generate one instruction file per component. The exact files depend on what the demo includes — **only generate files for components that are part of this demo**. Number them in build order.

Common instruction file types (include only what's needed):

| Component | File | When to Include |
|-----------|------|-----------------|
| Data generation | `01-data-generation.md` | Almost always — most demos need synthetic data |
| Documents / PDFs | `02-unstructured-docs.md` | When the demo has a Knowledge Assistant or document search |
| Pipeline (SDP) | `03-pipelines.md` | When the demo has Bronze/Silver/Gold data transformation |
| Pipeline validation | `03b-pipeline-validation.md` | When pipeline is complex enough to warrant dedicated validation |
| Genie Space | `04-genie-space.md` | When the demo includes natural language data exploration |
| Dashboard | `05-dashboard.md` | When the demo has visual analytics |
| Knowledge Assistant | `06-knowledge-assistant.md` | When the demo has document-based Q&A |
| Multi-Agent Supervisor | `07-multi-agent-supervisor.md` | When the demo orchestrates multiple AI components |
| ML Notebook | `08-ml-notebook.md` | When the demo includes model training or scoring |
| Model Serving | `09-model-serving.md` | When the demo deploys a model endpoint |
| Databricks App | `10-databricks-app.md` | When the demo has a custom web application |
| Vector Search | `11-vector-search.md` | When the demo needs semantic search / embeddings |

#### Writing Good Instructions

Each file should be clear enough that another agent can execute without ambiguity. Write **functional specs** (what to build, not how to build it):

- **Data**: Schema with column names, types, descriptions. Distributions that create realistic patterns. The "event" encoded in the data. Relationships between tables.
- **Dashboard**: Layout that tells the visual story. KPIs in business terms. The key insight must be obvious at a glance (5-second test). Filters for drilling down.
- **Genie**: Instructions that guide smart analysis. Sample questions that drive the demo narrative. Domain knowledge: baselines, thresholds, what's normal vs abnormal.
- **KA**: What documents to generate. The key content that explains the "why." Identifiers that match the structured data exactly.
- **Walkthrough**: Read like a pitch script. Include talk track. Follow the story arc. Short sentences, clear flow, no jargon.

#### Parallelization for Speed

Read all reference files in parallel at the start. Write independent instruction files in parallel when they don't share dependencies.

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
Demo instructions are ready in `./instructions/`.

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

Each skill uses the **Databricks CLI** (`databricks` commands via Bash) and **Python SDK** for resource creation. Do NOT use MCP tools (`mcp__databricks__*`) — use the skills instead.

### Starting the Build

Read `META-PROMPT.md` for the build order and follow it step by step. For each step:
1. Load the relevant skill from the table above
2. Read the corresponding instruction file
3. Follow the skill's guidance to create the resource
4. Validate the result per the instruction file's criteria
5. Update `resources.json` with the created resource ID

### Critical: Keep Instructions in Sync

**The instruction files are your product requirements.** They must ALWAYS reflect the current state of the demo — including any changes made during building.

**Sync workflow:** User requests change → Update instruction file FIRST → Apply to resource → Confirm in sync

Never change a resource without updating its instruction file. Never let instructions drift from reality.

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
4. Write functional instructions (what it should do, inputs, outputs)

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
