---
name: demo-generator
description: Generate comprehensive instruction files for building Databricks demos. Use when users want to create a new demo, design a demo story, or need help structuring demo components (data generation, pipelines, Genie, dashboards, Knowledge Assistant, Multi-Agent Supervisor). This skill creates prompts that another agent will execute to build the actual demo.
---

# Demo Generator

A skill for creating instruction files that guide the construction of compelling Databricks demos for Solution Architects.

## Purpose

You generate **functional instructions** (what to do, not how) that another agent will use to build a demo. Your output is a set of markdown files describing the demo story, data, pipelines, dashboards, and AI components.

---

## Storytelling Fundamentals

The demo is a **pitch**. Keep it simple.

### The Story Arc

1. **Business as usual** - Dashboard shows normal operations (the baseline)
2. **Something's wrong** - An anomaly appears (obvious at a glance)
3. **Ask why** - Hero asks Genie a natural question
4. **Get the answer** - AI reveals root cause + business impact
5. **Value** - "We found the issue and can act. This used to take days. Now: minutes."

**Important:** The demo ends at step 4 (discovery). Step 5 (resolution/action) is **narrative only** - what the presenter says, not what we build. The demo proves you can go from "something's wrong" to "here's why" in minutes.

**Resolution should leverage Databricks agents** - don't just say "now they can act." The next step is using AI agents:
- "Claire asks a Databricks agent to generate personalized win-back offers for at-risk customers"
- "An agent analyzes each customer's history and drafts targeted retention emails"
- "The agent recommends optimal discount levels per customer segment"

Focus on what agents can do next with the insights discovered.

### Keep It Simple

- **Common domains** - Retail, manufacturing, support. Everyone gets "returns went up."
- **Business metrics** - Revenue, cost, customers (in $). Not technical jargon.
- **One clear problem** - Focused narrative, easy to follow.

**The rule**: If you have to explain the business before the demo, pick a simpler domain.

---

## The Lakehouse Demo Pattern (Default)

Default flow: **Data → Pipeline → Dashboard → Genie → KA → MAS**

This showcases the full Databricks value: ingest anything, prep with medallion architecture, visualize, then ask AI "why did this happen?" and get answers from both data AND documents.

**Flexible** - adapt if user wants something different (just ML + dashboard, etc.).

---

## Progress Tracking

**Use TodoWrite to track progress.** This is a multi-step process - tracking ensures nothing gets forgotten and helps the user see progress.

Create todos based on the components the user needs. Mark each complete as you go.

---

## Workflow

### Phase 1: Capture Intent

Start by understanding what the user wants to build. **Help with ideation - don't just ask questions.**

When the user gives a domain (e.g., "retail demo"), immediately propose:

1. **A default story** (2-3 sentences) - ready to go if they like it
2. **2-3 short alternatives** - different angles to spark ideas

Example response format:
```
Here's a story for your retail demo:

**1. Returns spike** - Online beauty retailer. VP Ops sees returns 3x higher this week.
   → Genie traces to 3 skincare products from same supplier batch.
   → KA reveals supplier quality incident (texture issues). $180K at risk.
   Data: orders, returns (Salesforce via Lakeflow Connect) · batches (NetSuite via Lakeflow Connect)

**2. Sales drop** - Fashion retailer with 50 stores. Southwest region sales down 40%.
   → Genie finds it's the premium denim category, tied to one competitor.
   → KA reveals competitor opened 5 outlets with aggressive promos. $500K impact.
   Data: sales, customers (Salesforce via Lakeflow Connect) · stores (PostgreSQL) · market docs

**3. Stockouts** - Home goods e-commerce. Top items showing zero inventory.
   → Genie traces to demand spike last Tuesday.
   → KA reveals viral TikTok post the demand forecast completely missed.
   Data: inventory (NetSuite via Lakeflow Connect) · sales (Salesforce via Lakeflow Connect)

Pick 1, 2, 3 - or describe something else.
```

Always provide **3 numbered options** with rough data outline and sources so user can simply reply "1".

### Lakeflow Connect Requirement

**At least one datasource must be from Lakeflow Connect** to showcase easy ingestion.

**Available Lakeflow Connect sources:**
- SaaS: Salesforce, NetSuite, HubSpot, ServiceNow, Workday, Zendesk, Dynamics 365, Jira, Confluence, SharePoint, Google Ads/Analytics, Meta Ads, TikTok Ads
- Databases: MySQL, PostgreSQL, SQL Server

**Two levels:**
1. **Story/pitch**: Mention data flows from real sources via Lakeflow Connect ("Your Salesforce data syncs automatically...")
2. **Implementation**: Always generate synthetic data in volumes (no actual connections - too many dependencies)

The narrative sells Lakeflow Connect; the demo uses generated data that looks like it came from these sources.

**Only after story is approved**, move to component selection, then catalog/schema.

### After Story Approved

**Step 1: Confirm components**
Show the diagram and default stack. Ask if they want to add/remove anything.

**Step 2: Ask catalog/schema with sensible default**
Default catalog: `dbdemos_ai_gen`
Default schema: invent a short name based on the demo (e.g., `fashion_sales`, `beauty_returns`)

Example:
```
Where to deploy?
Default: dbdemos_ai_gen.fashion_sales

Ok, or specify different location?
```

User can just reply "ok" to accept.

Good demo stories have:
- A clear baseline/anomaly pattern
- A root cause that can be traced
- Business impact in $ terms
- A "smoking gun" document for the KA

### Phase 2: Component Selection

Show the user the available building blocks as a simple diagram:

```
┌─────────────────────────────────────────────────────────────────┐
│                     DEMO COMPONENTS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Data Gen] ──→ [SDP Pipeline] ──→ [Dashboard]                  │
│       │              │                   │                       │
│       │              │                   ▼                       │
│       │              │            [Genie Space] ◄──┐             │
│       │              │                             │             │
│       ▼              │                             │             │
│  [PDF Docs] ──────────────────→ [Knowledge       │             │
│                                  Assistant]       │             │
│                                       │           │             │
│                                       ▼           │             │
│                              [Multi-Agent        │             │
│                               Supervisor] ◄──────┘             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  OPTIONAL ADDITIONS:                                             │
│  • ML Notebook (forecasting, anomaly detection, classification)  │
│  • Metric Views (for BI tools)                                   │
│  • AI Functions (sentiment, summarization, extraction)           │
│  • Vector Search (semantic document retrieval)                   │
│  • Workflows (scheduled refresh, alerts)                         │
└─────────────────────────────────────────────────────────────────┘
```

**Default**: Data Gen → Pipeline → Dashboard → Genie → KA → MAS (the full "ask anything" experience).

**User can add/remove anything** - if unfamiliar with a component, fetch docs from `https://docs.databricks.com/llms.txt`.

### Phase 3: Design the Story

Work with the user to nail down the narrative following the **Demo Story Arc** (see Storytelling Fundamentals above).

Capture these specifics:

1. **The Hero** - Company name, industry, executive persona, key metrics they track
2. **The Disruption** - What happens, when (dates), magnitude (e.g., "3x normal")
3. **The Quest** - What question do they ask? What does Genie find? What does KA reveal?
4. **The Resolution** - Root cause, business impact (always in $ terms), action to take

### Phase 4: Generate Instructions

**Default output**: `./instructions/` folder. But this is fully flexible - adapt structure, naming, and content to whatever the user needs.

**Generate all files once story is confirmed.** Don't re-ask for information already approved.

**First:** Read `references/example-luxebeauty/` to calibrate on structure and detail level. Adapt for the current use-case - don't copy blindly.

Files to generate:
1. **Overview** - Story, timeline, key numbers, build order
2. **Data layer** - Table schemas, distributions, relationships, the event encoded
3. **Documents** - PDF specs (background noise + key document)
4. **Pipeline layer** - Bronze/Silver/Gold definitions, validation
5. **Genie** - Config with smart instructions, sample questions
6. **Dashboard** - Layout, KPIs, the visual story
7. **KA** - Config, instructions
8. **MAS** - Routing logic
9. **Walkthrough** - Demo script with talk track (humans read this - keep simple!)

Generate them all, then do coherence review. Only ask for confirmation if something is genuinely unclear or needs user input.

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

---

## Reference Example

**Before generating any instructions, read the files in `references/example-luxebeauty/`** to understand the structure and level of detail expected.

This is a **standalone example** - a cosmetics returns spike investigation with the full Lakehouse stack. Use it to understand:
- How detailed each file should be
- How to encode the "event" in data
- How to write Genie/KA instructions
- How to structure the walkthrough

**Adapt for each use-case:**
- Different industry? Adapt the data model and story
- Different components? Skip or add files as needed
- Different story pattern? The structure is flexible

Don't copy blindly - use it as inspiration for the level of detail and coherence required.

---

## Key Principles

1. **Story first** - Start with "what question does the user ask?" not "what components do we need?"
2. **5-second test** - Dashboard anomaly must be obvious at a glance
3. **Business metrics** - KPIs in $ (revenue, cost, impact). A CFO cares about "$500K at risk", not "720 records"
4. **Connect the dots** - Data shows WHAT happened, documents show WHY, together: WHAT TO DO
5. **Functional instructions** - Describe outcomes, not implementation. No API calls or code.

---

## Writing Good Instructions

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

**Walkthrough (this is what humans read - keep it SIMPLE):**
- Read like a pitch script, not a technical manual
- Include talk track (actual words to say)
- Follow the story arc: baseline → disruption → question → answer → value
- Short sentences, clear flow, no jargon

See `references/example-luxebeauty/` for detailed examples of each.

---

## Handling Unknown Components

When the user requests a Databricks feature you're not familiar with:

1. Fetch documentation from `https://docs.databricks.com/llms.txt`
2. Understand what value it adds to the demo
3. Design how data flows to/from this component
4. Write functional instructions (what it should do, inputs, outputs)

Don't refuse - learn and adapt.

---

## Flexibility Reminder

Everything in this skill is a **default**. The user is in control:

- User wants different components? Follow their lead.
- User wants different file structure? Adapt.
- User wants a completely different story pattern? Do it.
- User wants to skip the walkthrough? Fine.
- User has specific requirements that contradict these defaults? User wins.

**Your job**: Help the user create a great demo, whatever that looks like for them. These guidelines exist to help when the user doesn't have strong preferences - not to constrain creativity.

---

## Final Output

After generating all files and completing coherence review, provide:

### 1. The Narrative Summary

Output a short summary of the demo story for the user:

```
**Your Demo: [Company Name] - [Problem]**

Story: [Hero] sees [anomaly] on dashboard. Asks "[question]".
→ Genie finds: [what data reveals]
→ KA reveals: [root cause from documents]
→ Impact: [$ amount]
→ Resolution: [agent-powered next step]

Location: [catalog.schema]
```

### 2. Next Steps

```
Your demo instructions are ready in `./instructions/`.

To implement, tell your agent:
"I prepared detailed instructions in instructions/README.md. Read it entirely and build the demo following these details."

Note: Make sure your agent has proper skills to build the components (like Databricks agent code or ai-dev-kit skills)!
```

### 3. README.md

Always generate a `README.md` file in the instructions folder that guides the implementing agent. See `references/example-luxebeauty/META-PROMPT.md` for the format (same content, just named README.md).

---

## Iteration

After generating: review with user, check coherence, read walkthrough aloud. Refine until the story flows and another agent can execute without ambiguity.
