---
name: databricks-demo-generator
description: Generate comprehensive instruction files for building Databricks demos. Use when users want to create a new demo, design a demo story, or need help structuring demo components (data generation, pipelines, Genie, dashboards, Knowledge Assistant, Multi-Agent Supervisor). This skill creates prompts that another agent will execute to build the actual demo.
---

# Databricks Demo Generator

A skill for creating and building compelling Databricks demos for Solution Architects.

## Purpose

This skill has two parts:

1. **Part 1 - Generate Instructions**: Create markdown files describing the demo story, data, pipelines, dashboards, and AI components. These are functional specs (what to do, not how) that guide implementation.

2. **Part 2 - Build Resources**: If the user opts in, build the actual Databricks resources following the instruction files. Keep instructions in sync with any changes made during building.

---

## Quick Reference

| Phase | What | Output |
|-------|------|--------|
| 1. Capture | Understand request, search demo bank | Selected story direction |
| 2. Design | Define hero, disruption, quest, resolution | Story spec |
| 3. Components | Select Databricks products | Component list |
| 4. Generate README | Write story overview | `./README.md` |
| 5. **User Review** | User confirms story is good | Approval to continue |
| 6. Generate Details | Write detailed instruction files | `./instructions/` folder |
| 7. Review | Coherence check across all files | Verified instructions |
| 8. Build (opt) | Create Databricks resources | Working demo |

---

## Project Structure

Each demo project has this structure:
```
./README.md           # Story overview (hero, disruption, quest, resolution, walkthrough)
./META-PROMPT.md      # Build instructions for the AI
./instructions/       # Detailed specs (content varies based on demo components)
  resources.json      # Tracks created Databricks resource IDs
```

The `./instructions/` folder contains detailed specs for each component in the demo. The exact files depend on what the demo includes (data, pipelines, dashboards, AI components, etc.).

---

## Workflow Overview

**Part 1a:** Capture Intent → Design Story → Select Components → **Generate README.md** → **Ask User to Review**

**Part 1b (after approval):** Generate detailed instructions in `./instructions/` → Coherence Review

**Part 2 (optional):** Read META-PROMPT → Build each component → Keep instructions in sync

**Use TodoWrite to track progress.** Multi-step process - tracking ensures nothing gets forgotten.

---

## Storytelling Fundamentals

The demo is a **pitch**. Keep it simple.

### The Story Arc

The demo follows a classic three-act structure *(default pattern - adapt to user requirements)*:

| Act | What Happens | Demo Moment |
|-----|--------------|-------------|
| **Setup** (optional) | How data flows in | Mention Lakeflow, SDP, UC |
| **Act 1: Dashboard** | Baseline + anomaly visible | "Revenue normal... but returns are 3x" |
| **Act 2: Investigation** | Ask why → get answer | Genie finds lot, KA finds incident |
| **Act 3: Platform** | Zoom out - what made this possible | Recap products, governance |
| **Closing** | Value statement | "Days → minutes. That's Databricks." |

**Key rule:** Act 2 is the live demo (interactive). Acts 1, 3, and Closing are mostly narration with visuals.

**Resolution should leverage Databricks agents** - don't just say "now they can act." Focus on what agents can do next:
- "Claire asks a Databricks agent to generate personalized win-back offers for at-risk customers"
- "An agent analyzes each customer's history and drafts targeted retention emails"

### Keep It Simple

- **Common domains** - Retail, manufacturing, support. Everyone gets "returns went up."
- **Business metrics** - Revenue, cost, customers (in $). Not technical jargon.
- **One clear problem** - Focused narrative, easy to follow.

**The rule**: If you have to explain the business before the demo, pick a simpler domain.

### What Makes a Good Demo Story

- A clear baseline/anomaly pattern
- A root cause that can be traced
- Business impact in $ terms
- A "smoking gun" document for the KA

---

## Product Positioning

Demos showcase the Databricks platform. **Read `{SKILL_BASE_DIR}/references/databricks_products.md`** to understand what each product does, what pain it solves, and how to position it.

### Default Demo Stack (adapt to user needs)

```
Lakeflow Connect → SDP → DW/SQL Dashboard → Genie → Agents (MAS/KA) → Apps
                              ↑
                        Unity Catalog (governance across everything)
```

This is a starting point. Users may want different products, fewer products, or additional ones. Follow their lead.

### Product Stack in Overview

When generating the demo overview, include a **Product Stack** section explaining which products are showcased and why. For each product:

| Field | Description |
|-------|-------------|
| **Role in Demo** | What it does in this specific demo |
| **Pain Solved** | Business problem it addresses (reference `databricks_products.md` for positioning) |
| **Demo Moment** | Presales talking point - what to say when this product appears |

See `README.md` in the reference example for the format.

### Choosing Products

Products should connect to the story. Ask:
- Does this product solve a pain in the demo narrative?
- Does it have a clear "moment" in the walkthrough?
- How does it connect to other products in the flow?

**Examples of customization:**
- ML story → add Notebooks + MLflow
- Document-heavy → emphasize Vector Search + KA
- Security use case → include Lakewatch
- Operational app → add Databricks Apps + Lakebase

But always follow user input - they know their audience.

---

## Part 1: Generate Instructions

### Phase 1: Capture Intent

Start by understanding what the user wants to build. **Help with ideation - don't just ask questions.**

When the user gives a domain (e.g., "retail demo"):

#### Step 1: Search Reference Demos

First, search the demo reference bank for existing demos that match. Use the `tools/` folder inside this skill's base directory:

```bash
python {SKILL_BASE_DIR}/tools/search_demos.py "retail"
```

This returns the top 3 matching reference demos (mocked vector search for now).

#### Step 2: Present Options

Show both AI-generated ideas AND reference demos. Example *(all options should follow format of #1 and A - abbreviated here)*:

```
**Generated Ideas:**
**1. Returns spike** - Online beauty retailer. VP Ops sees returns 3x higher this week.
   → Genie traces to 3 skincare products from same supplier batch.
   → KA reveals supplier quality incident (texture issues). $180K at risk.
   Data: orders, returns (Salesforce via Lakeflow Connect) · batches (NetSuite via Lakeflow Connect)
**2. Sales drop** - ...
**3. Stockouts** - ...

**Reference Demos (from demo bank):**
**A. Manufacturing Quality Defects** - Automotive parts manufacturer sees 4x defect spike.
   → Traces to CNC machine with worn bearing. ML predicts equipment failures.
   Components: Full stack + ML Notebook
**B. Healthcare Patient Readmissions** - ...
**C. Financial Services Fraud** - ...

Pick 1-3 for generated, A-C for reference, or describe something else.
```

#### Step 3: If User Picks a Reference Demo

If the user selects a reference demo (A, B, or C), fetch the full spec:

```bash
python {SKILL_BASE_DIR}/tools/get_demo.py "manufacturing-quality-defects"
```

This returns all instruction files concatenated. Use this as your baseline instead of reading `{SKILL_BASE_DIR}/references/example-luxebeauty/`.

Then:
1. **Ask catalog/schema** (same as normal flow)
2. **Present the full use-case** - show the complete story, data model, components
3. **Ask: "Use as-is or customize?"**
   - As-is: Write instruction files directly from reference
   - Customize: Adapt company name, industry details, specific numbers, then write

After this, continue to Part 2 (building) if user wants.

#### Lakeflow Connect Requirement

**At least one datasource must be from Lakeflow Connect** to showcase easy ingestion.

**Available sources:**
- SaaS: Salesforce, NetSuite, HubSpot, ServiceNow, Workday, Zendesk, Dynamics 365, Jira, Confluence, SharePoint, Google Ads/Analytics, Meta Ads, TikTok Ads
- Databases: MySQL, PostgreSQL, SQL Server

**Two levels:**
1. **Story/pitch**: Mention data flows from real sources via Lakeflow Connect
2. **Implementation**: Generate synthetic data (no actual connections - too many dependencies)

The narrative sells Lakeflow Connect; the demo uses generated data that looks like it came from these sources.

### Phase 2: Design the Story

Once the user picks a direction, nail down the specifics:

1. **The Hero** - Company name, industry, executive persona, key metrics they track
2. **The Disruption** - What happens, when (dates), magnitude (e.g., "3x normal")
3. **The Quest** - What question do they ask? What does Genie find? What does KA reveal?
4. **The Resolution** - Root cause, business impact (always in $ terms), action to take

### Phase 3: Component Selection

After story is approved, confirm the building blocks:

**Default flow:** Data Gen → Pipeline → Dashboard → Genie → KA → MAS (the full "ask anything" experience)

**Optional additions:** ML Notebook, Metric Views, AI Functions, Vector Search, Workflows

Ask user to confirm or modify. If unfamiliar with a component, fetch docs from `https://docs.databricks.com/llms.txt`.

Then ask for catalog/schema with a sensible default:
```
Where to deploy?
Default: dbdemos_ai_gen.beauty_returns

Ok, or specify different location?
```

### Phase 4: Generate README.md

**First:** Read `{SKILL_BASE_DIR}/references/example-luxebeauty/README.md` to understand the structure and detail level expected.

Generate `./README.md` with:
- Story overview (hero, disruption, quest, resolution)
- Product stack and what each product does in the demo
- Key numbers and dates
- Complete walkthrough with talk track

This is the "pitch deck" - the human-readable summary of the entire demo.

### Phase 5: User Review Checkpoint

**IMPORTANT: Stop and ask for user approval before generating detailed instructions.**

After writing README.md, say:
```
I've created the demo story in README.md with:
- [Brief summary of the story]
- [Key products being showcased]
- [The investigation flow]

**Should I go ahead and generate the detailed instruction files?**

Reply "yes" to continue, or let me know what to change.
```

**Wait for user confirmation before proceeding.** This checkpoint lets them review the story before committing to detailed specs.

### Phase 6: Generate Detailed Instructions

After user approves, generate the remaining files:

**At project root:**
- **META-PROMPT.md** - Build instructions for the AI: local project structure, build order, resource tracking, troubleshooting.

**In `./instructions/` folder:**
1. **Data layer (01)** - Table schemas, distributions, relationships, the event encoded
2. **Documents (02)** - PDF specs (background noise + key document with the "smoking gun")
3. **Pipeline layer (03)** - Bronze/Silver/Gold definitions, validation
4. **Genie (04)** - Config with smart instructions, sample questions, domain knowledge
5. **Dashboard (05)** - Layout, KPIs, the visual story (anomaly obvious at a glance)
6. **KA (06)** - Config, instructions, identifiers matching structured data
7. **MAS (07)** - Routing logic

Generate all files, then do coherence review.

#### Writing Good Instructions

Each file should be clear enough that another agent can execute without ambiguity.

**Data Generation:**
- Schema with column names, types, descriptions
- Distributions that create realistic patterns (not uniform random)
- The "event" encoded in the data (the spike, drop, anomaly)
- Relationships between tables that support tracing from symptom to cause

**Dashboard:**
- Layout that tells the visual story
- KPIs in business terms ($, customers, %)
- The anomaly must be obvious at a glance (5-second test)
- Filters for drilling down

**Genie Space:**
- Instructions that guide smart analysis (not just "answer questions")
- Sample questions that drive the demo narrative
- Domain knowledge: baselines, thresholds, what's normal vs abnormal

**Knowledge Assistant:**
- What documents to generate (background noise + the key document)
- The "smoking gun" content that explains root cause
- Identifiers that match the structured data exactly

**Walkthrough:**
- Read like a pitch script, not a technical manual
- Include talk track (actual words to say)
- Follow the story arc: baseline → disruption → question → answer → value
- Short sentences, clear flow, no jargon

### Phase 5: Coherence Review

**The hardest and most important step.** This is what makes or breaks the demo.

Check **twice**:
1. **Incrementally** - after each layer, quick sanity check
2. **Final review** - load ALL generated files together

**Incremental checks:**
- After Data: Does data contain everything for the story? Key identifiers defined?
- After Analytics: Can dashboard show the anomaly? Can Genie answer sample questions?
- After AI: Does key document have the smoking gun? Identifiers match between data and docs?

**Final coherence review checklist:**
- [ ] Data supports all dashboard visualizations
- [ ] Data supports all Genie sample questions
- [ ] Documents support KA queries (smoking gun present)
- [ ] Identifiers match across data and documents
- [ ] Dates align across all components
- [ ] Key numbers are consistent (same values in data, dashboard, narrative)
- [ ] Investigation flow works end-to-end
- [ ] Instructions are functional (WHAT to do), not technical (HOW to do it)

**Final review prompt**: "Let me load all instructions and verify: Is this a great, coherent story? Is all data there to support requirements? Did I follow all user instructions?"

### Part 1 Output

After coherence review, provide:

**1. Narrative Summary:**
```
**Your Demo: [Company Name] - [Problem]**

Story: [Hero] sees [anomaly] on dashboard. Asks "[question]".
→ Genie finds: [what data reveals]
→ KA reveals: [root cause from documents]
→ Impact: [$ amount]
→ Resolution: [agent-powered next step]

Location: [catalog.schema]
```

**2. README.md** in the instructions folder (see `{SKILL_BASE_DIR}/references/example-luxebeauty/META-PROMPT.md` for format).

**3. Transition prompt:**
```
Demo instructions are ready in `./instructions/`.

Would you like me to build the demo resources now?
(Requires ai-dev-kit: https://github.com/databricks-solutions/ai-dev-kit)

Reply "yes" to start building, or "no" to stop here.
```

---

## Part 2: Build Resources

If the user confirms, build the actual Databricks resources.

### Starting the Build

Read the `README.md` (meta-prompt) in the instructions folder and follow it to build each component in order.

### Critical: Keep Instructions in Sync

**The instruction files are your product requirements.** They must ALWAYS reflect the current state of the demo - including any changes made during building.

**When the user requests changes during building:**

Any change - data tweaks, dashboard layout, new components, story pivots, bug fixes - follows the same rule: **update the instruction file first, then apply to the resource.**

Examples: user says "make data more realistic" → update data markdown → regenerate data. User says "add ML model" → create new component markdown → build it.

**Why this matters:**

If we delete all Databricks resources and ask you to rebuild from the instruction files alone, you must be able to recreate the demo exactly - including every incremental change the user made.

The instruction files are the **single source of truth**. The actual resources are just an implementation of those specs.

**Sync workflow:** User requests change → Update instruction file FIRST → Apply to resource → Confirm in sync

Never change a resource without updating its instruction file. Never let instructions drift from reality.

---

## Reference Materials

**Before generating any instructions, read the files in `{SKILL_BASE_DIR}/references/example-luxebeauty/`** to understand the structure and level of detail expected.

### example-luxebeauty/ (Structure Template)

Complete worked example showing file format, level of detail, and how files connect. Use it to understand:
- How detailed each file should be
- How to encode the "event" in data
- How to write Genie/KA instructions
- How to structure the walkthrough

### tools/demo_references/ (Story Bank)

Pre-built story templates for different industries. Use `search_demos.py` to find relevant templates, then adapt for your use case.

### Workflow

1. **Always read example-luxebeauty first** for structure
2. **Optionally search demo_references** for a relevant story
3. **Combine**: structure from example + story from bank (if applicable)

Adapt for each use-case - don't copy blindly.

---

## Key Principles

1. **Story first** - Start with "what question does the user ask?" not "what components do we need?"
2. **5-second test** - Dashboard anomaly must be obvious at a glance
3. **Business metrics** - KPIs in $ (revenue, cost, impact). A CFO cares about "$500K at risk", not "720 records"
4. **Connect the dots** - Data shows WHAT happened, documents show WHY, together: WHAT TO DO
5. **Functional instructions** - Describe outcomes, not implementation. No API calls or code.

---

## Handling Unknown Components

When the user requests a Databricks feature you're not familiar with:

1. Fetch documentation from `https://docs.databricks.com/llms.txt`
2. Understand what value it adds to the demo
3. Design how data flows to/from this component
4. Write functional instructions (what it should do, inputs, outputs)

Don't refuse - learn and adapt.

---

## Flexibility

Everything in this skill is a **default**. The user is in control:

- User wants different components? Follow their lead.
- User wants different file structure? Adapt.
- User wants a completely different story pattern? Do it.
- User wants to skip the walkthrough? Fine.
- User has specific requirements that contradict these defaults? User wins.

**Your job**: Help the user create a great demo, whatever that looks like for them.

---

## Skill Directory Paths

**Important:** All paths in this skill (tools, references) are relative to the skill's base directory, which is provided at the top of the skill prompt as "Base directory for this skill: ...".

When running commands or reading reference files, use the skill base directory:
- Tools: `{SKILL_BASE_DIR}/tools/search_demos.py`
- Tools: `{SKILL_BASE_DIR}/tools/get_demo.py`
- References: `{SKILL_BASE_DIR}/references/example-luxebeauty/`

For example, if the base directory is `/path/to/.claude/skills/databricks-demo-generator`, run:
```bash
python /path/to/.claude/skills/databricks-demo-generator/tools/search_demos.py "retail"
```
