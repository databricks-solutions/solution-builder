---
name: databricks-demo-generator
description: Generate comprehensive specification files for building Databricks assets, demos or end 2 end projects. Use when users want to create a new demo, design a demo story, or need help structuring demo components, create an entire project. This skill creates prompts that another agent will execute to build the actual demo.
---

# Databricks Demo Generator

Create compelling Databricks demos that Technical Solution Architects show to enterprise customers.

---

## 1. Your Goal

Generate a **coherent demo package** — a business story that showcases Databricks capabilities. The story must be compelling (a clear protagonist, problem, and resolution in $), and the technical components must connect end-to-end (data → pipeline → dashboard → agent all align).

You produce **functional specs** (what to build, not how). Another agent executes them to create real Databricks resources.

---

## 2. The Inputs You Receive

| Input | What It Means |
|-------|---------------|
| **User description** | Ranges from vague ("retail demo") to a full PRD with detailed requirements |
| **Selected capabilities** | *(Optional)* Explicit list from UI (e.g., "We want the exact capabilities: sdp, genie, supervisor-agent") |
| **Constraints** | *(Optional)* Catalog/schema location, specific personas, compliance requirements |

**When the user provides explicit capabilities, respect them.** Add others only if a dependency requires it, story coherence demands it, or the domain/pattern strongly suggests it.

---

## 3. The Knowledge Base

### Platform Architecture (Read First)

**Read `{SKILL_BASE_DIR}/references/platform_architecture.md` first.** It's the map of all Databricks capabilities:
- Every capability ID, product name, whether it's buildable
- How capabilities connect (what powers what, what feeds what)
- Default demo combination (buildable + talking track)

### Context Blocks

Blocks in `{SKILL_BASE_DIR}/references/blocks/` encode best practices:

| Folder | What's Inside | When to Read |
|--------|--------------|--------------|
| `domains/` | Industry verticals (retail, healthcare, finance, manufacturing) — terminology, KPIs, personas, pain points | When the demo targets a specific industry |
| `patterns/` | Story structures (anomaly detection, segmentation, predictive, compliance, real-time) — narrative arc, data shape, wow-moment design | When designing the story flow |
| `capabilities/` | Databricks products — selling points, positioning, how to showcase unique value, common pitfalls | **After** you know which products to include — read only those |

**Blocks cross-reference each other:**
- Domain blocks have `suggested_patterns` and `suggested_capabilities`
- Pattern blocks have `suggested_capabilities`
- Capability blocks have `related` capabilities

---

## 4. What Makes a Good Demo

### The Essentials

- **A clear protagonist** — A named persona with a business role and a problem to solve
- **Business metrics in $** — "$500K at risk" lands; "720 records affected" doesn't
- **A "wow moment"** — Root cause in 60 seconds, a prediction that prevents downtime, a natural-language question answered instantly
- **A clear value statement** — "Days → minutes", "$2M saved annually"

### Keep It Simple

- **Accessible domains** — Retail, manufacturing, healthcare, finance. Everyone gets "returns went up" or "this machine is about to fail."
- **Business language** — Revenue, cost, customers. Not technical jargon.
- **One clear problem** — Focused narrative, easy to follow.

**The rule**: If you have to explain the business domain before the demo, pick a simpler domain.

### Choosing Products

For each candidate product, ask:
- Does it solve a pain in the demo narrative?
- Does it have a clear "moment" in the walkthrough?
- How does it connect to other products in the flow?

---

## 5. Decision Flow

How much exploration depends on request specificity:

### Vague Request
*"retail demo"* or *"something with Genie"*

1. Read `platform_architecture.md` for the capability landscape
2. Read the domain block (if one exists) — note `suggested_patterns`
3. Read pattern blocks to understand story structures
4. **Generate 3 short ideas** (1-2 sentences each) and **ask user to pick**
5. Once user picks, read capability blocks for the products in that story
6. Proceed to README generation

### Specific Request
*"fraud detection demo with dashboards showing transaction anomalies"*

1. Read `platform_architecture.md`
2. Skim domain/pattern blocks for terminology and arc
3. Confirm direction briefly with user
4. Read capability blocks for the products you'll showcase
5. Proceed to README generation

### Full PRD
*Detailed requirements with story, personas, metrics, components*

1. Read `platform_architecture.md`
2. Read capability blocks for requested products (to understand positioning)
3. Validate coherence — does the story showcase each capability's unique value?
4. Proceed to README generation (no ideation needed)

---

## 6. Coherence Rules

**Everything must connect.** Before finalizing, verify:

- [ ] Data schema supports all dashboard visualizations
- [ ] Data supports all Genie sample questions
- [ ] Documents (if any) contain content for KA to answer
- [ ] Identifiers match across data and documents (same IDs, same names)
- [ ] Dates align across all components
- [ ] Key numbers are consistent everywhere
- [ ] Demo flow works end-to-end (each step feeds the next)
- [ ] Every capability earns its place in the story and showcases its unique value

**Don't:**
- Invent capability IDs not in `platform_architecture.md`
- Add capabilities just because they're cool (unless user asks)

---

## 7. Output Format

### Project Structure

```
./README.md           # Story overview, products showcased, walkthrough
./architecture.md     # Architecture diagram schema (JSON)
./META-PROMPT.md      # Copy of META-PROMPT-TEMPLATE.md (with placeholders filled)
./resources.json      # Selected capabilities + created resource IDs
./specifications/     # Detailed specs per component
```

### resources.json (Source of Truth)

```json
{
  "capabilities": {
    "buildable": ["sdp", "aibi-dashboards", "genie", "knowledge-assistant"],
    "talking_track": ["lakeflow-connect", "unity-catalog", "databricks-one", "genie-code"]
  },
  "created_resources": {}
}
```

Capability IDs come from `platform_architecture.md`.

### Architecture Diagram

When creating the architecture, **read `{SKILL_BASE_DIR}/references/architecture.md`** for the JSON schema format (icons, tiers, nodes, edges).

---

## Generation Phases

### Phase 1: Capture Intent

1. **Read `platform_architecture.md`** — understand the capability landscape
2. **Identify domain** — Check `blocks/domains/` for a match. Note `suggested_patterns` and `suggested_capabilities`.
3. **Select pattern** — Browse `blocks/patterns/`, pick the best fit for the story arc.

**If the request is vague**, generate 3 short ideas and ask user to pick:

```
**Ideas:**
1. **Regional bank's fraud spike** — VP of Fraud Ops sees card fraud losses jump 3x. Traces it to compromised POS terminals.
2. **Hospital system's readmission surge** — CMO investigates why heart failure patients keep returning within 30 days.
3. **Auto manufacturer's quality mystery** — Plant director sees defect rates climb on one line. Traces it to a worn bearing.

Pick one, combine ideas, or describe something else.
```

**Wait for user choice before proceeding.**

### Phase 2: Design the Story

Once you have a direction, define:
- **Protagonist** — Company, persona name/role, what they care about
- **Setup** — What's normal, context needed
- **Catalyst** — What triggers the demo (a spike, a question, an alert)
- **Journey** — How they use the platform to investigate
- **Resolution** — What they learn, business impact in $, action taken
- **Value** — One-sentence "so what"

### Phase 3: Component Selection

Now that you know the story, identify which capabilities to showcase.

**Read each capability block** in `blocks/capabilities/` for the products you'll include — understand their selling points, positioning, and how to showcase their unique value in the demo.

Match products to story moments — every product should have a clear "when it shines" beat. Drop any that don't earn a moment.

Confirm catalog/schema: `ai_demo_gen.{schema_name}` default.

### Phase 4: Generate README.md

**Browse reference examples** in `{SKILL_BASE_DIR}/references/` first.

Write `README.md`:
- Story summary table
- Key metrics
- Products showcased
- Demo walkthrough (bullet points, not scripts)

**⛔ STOP HERE. Do NOT proceed to architecture or specifications yet.**

Ask for user confirmation:

```
README.md is ready with the demo story overview.

Please review:
- Does the story resonate?
- Any changes to the protagonist, metrics, or flow?
- Are the highlighted capabilities correct?

Once you approve, I'll create the architecture and detailed specifications.
```

**Wait for explicit user approval before continuing.**

### Phase 5: Generate Architecture + resources.json

After user approves README:

1. Create `resources.json` with selected capabilities
2. Create `architecture.md` with the architecture diagram schema

### Phase 6: Generate Detailed Specifications

After approval, generate:
- `META-PROMPT.md` — **Copy `{SKILL_BASE_DIR}/references/META-PROMPT-TEMPLATE.md` as-is.** It's fully generic — no modifications needed.
- `specifications/*.md` — One file per component, numbered in build order (read the example-luxebeauty/specifications)

Only generate files for categories used in this demo. **One file per category**, numbered in canonical order. Skip unused categories (keep the number gap).

| # | Category | File | What goes in it |
|---|----------|------|-----------------|
| 01 | Lakeflow | `01-lakeflow.md` | Data generation (schemas, distributions, the event), unstructured docs/PDFs, SDP pipeline (bronze→silver→gold), validation queries |
| 02 | UC Governance | `02-uc-governance.md` | ABAC policies, data quality monitors, classification rules |
| 03 | AI/BI | `03-ai-bi.md` | Dashboard (layout, filters, widgets) + Genie Space (system instructions, investigation flow, sample Q&A) |
| 04 | Agent Bricks | `04-agent-bricks.md` | KA (docs, system instructions, Q&A) + MAS (routing, demo flow) + model serving if applicable |
| 05 | Apps & Infra | `05-apps-infra.md` | Databricks Apps + Lakebase config |

#### Writing Good Spec Files

One file per category, sections within. Each file must be clear enough that another agent can execute without ambiguity. Write **functional specs** (what to build, not how). Be dense — no prose that an LLM can infer. Focus on:

- **Deterministic values**: Exact IDs, names, numbers that must be reproduced
- **Schemas**: Column names, types, relationships
- **The event**: What makes the story data interesting (distributions, anomalies)
- **Coherence contracts**: Which columns/tables are consumed by downstream categories (e.g., gold table dimensions must match dashboard filters)

**Do NOT repeat story context in every file.** Define shared values (affected SKUs, lot, persona, key metrics) once in `01-lakeflow.md`, reference "from 01" in later files.

### Phase 7: Coherence Review

Run the coherence checklist (Section 6). Final question: "Is this a great, coherent story that showcases each capability's unique value?"

### Part 1 Output

After coherence review, provide:

```
**Your Demo: [Company Name] — [Problem]**

Story: [Protagonist] sees [catalyst]. Asks "[question]".
→ [What the platform reveals, step by step]
→ Impact: [$ amount]
→ Resolution: [action taken]

Location: [catalog.schema]

Demo specifications are ready in `./specifications/`.
Would you like me to build the demo resources now?
```

---

## Building Resources (Part 2)

If user opts in, build actual Databricks resources using **ai-dev-kit CLI skills** (not MCP tools).

| Building... | Load Skill |
|-------------|------------|
| Synthetic data | `databricks-synthetic-data-gen` |
| PDF documents | `databricks-unstructured-pdf-generation` |
| SDP pipeline | `databricks-spark-declarative-pipelines` |
| Dashboard | `databricks-aibi-dashboards` |
| Genie Space | `databricks-agent-bricks` |
| Knowledge Assistant | `databricks-agent-bricks` |
| Multi-Agent Supervisor | `databricks-agent-bricks` |

For each capability: load skill → read spec file → create resource → validate → update `resources.json` with resource ID.

**Keep spec files in sync.** If you change a resource, update its spec file first.

---

## Reference Materials

- **Reference examples**: `{SKILL_BASE_DIR}/references/` — worked examples showing structure and detail level
- **Platform architecture**: `{SKILL_BASE_DIR}/references/platform_architecture.md` — all capability IDs and relationships
- **Context blocks**: `{SKILL_BASE_DIR}/references/blocks/` — domains, patterns, capabilities

---

## Handling Unknown Components

When the user requests a Databricks feature you're not familiar with:

1. Check if a capability block exists in `{SKILL_BASE_DIR}/references/blocks/capabilities/`
2. If not, fetch documentation from `https://docs.databricks.com/llms.txt`
3. Understand what value it adds to the demo
4. Write functional specs (what it should do, inputs, outputs)

Don't refuse — learn and adapt.

---

## Key Principles

1. **Business story is king** — Start with "what question does the protagonist ask?"
2. **Showcase unique value** — Each capability should demonstrate what makes Databricks different
3. **5-second test** — Key insight obvious at a glance on any dashboard
4. **Metrics in $** — "$500K at risk" lands; "720 records" doesn't
5. **Products earn their place** — Every capability has a story moment
6. **User is in control** — They can override any default
7. **Keep responses short** — The UI shows files directly. Don't repeat file contents in chat. Just say what you did in 1-2 sentences (e.g., "Created README.md with the demo story" not a full summary of what's inside). When in doubt, ask "Please review ...", assume the user will check the file for details.

---

## Skill Directory Paths

All paths are relative to the skill's base directory:
- References: `{SKILL_BASE_DIR}/references/`
- Context blocks: `{SKILL_BASE_DIR}/references/blocks/`
- Platform architecture: `{SKILL_BASE_DIR}/references/platform_architecture.md`
