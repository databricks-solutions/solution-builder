---
name: LuxeBeauty Returns Intelligence
description: Build a complete Databricks demo where a cosmetics retailer investigates a 3x returns spike using Dashboard, Genie, Knowledge Assistant, and Multi-Agent Supervisor. Includes synthetic data, medallion pipeline, and a full walkthrough script.
---

# LuxeBeauty Returns Intelligence

## Purpose

Build and deploy a production-quality demo on Databricks. The demo tells one story: **Claire Dubois, VP of Operations at LuxeBeauty Co., sees a 3x spike in product returns on her Monday dashboard, asks "Why do I have so many returns?", and in two questions gets the complete answer** — structured data reveals WHAT happened, an incident document reveals WHY, and together they tell her WHAT TO DO.

This is a vetted, tested package. The instructions in the supporting files have been validated end-to-end. Follow them precisely unless customizing for a specific audience.

**Demo Duration**: 5–7 minutes
**Industry**: Retail & CPG

---

## The Story

### Company Profile

- **Company**: LuxeBeauty Co. — Direct-to-consumer cosmetics e-commerce
- **Persona**: Claire Dubois, VP of Operations
- **Manufacturing**: Single facility in Lyon, France
- **Scale**: ~80 SKUs across Skincare, Makeup, and Haircare; ~900 orders/week

### The Story Arc

1. **Business as usual** — Claire opens her Monday dashboard. Revenue ($3.8M), orders (~924), items sold (~1,450) all look normal.
2. **Something's wrong** — Weekly returns: $180K. That's 3x the normal $60K. Three Skincare products show ~30% return rates vs 8% baseline.
3. **Ask why** — Claire asks the Multi-Agent Supervisor: "Why do I have so many returns?" Genie traces it to 3 SKUs from lot LOT-2025-0212, with customer complaints about texture.
4. **Get the answer** — She asks about the lot. The Knowledge Assistant finds incident report PIR-2025-0212: a homogenizer pressure issue caused texture defects, but QC released the lot anyway.
5. **Value** (narrative only) — "In two questions, Claire went from 'Why?' to the complete answer. Data tells you WHAT happened. Documents tell you WHY. Together, they tell you WHAT TO DO."

**The demo ends at step 4 (discovery).** Step 5 is what the presenter says — not what we build. Resolution should reference Databricks agents: "Claire asks an agent to generate personalized win-back offers for the ~720 affected customers."

### Key Numbers

| Metric | Value |
|--------|-------|
| Normal weekly returns | ~$60K |
| Spike week returns | ~$180K (3x normal) |
| Affected lot | LOT-2025-0212 (produced Feb 12, 2025) |
| Affected products | SKU-1001 ($68), SKU-1002 ($55), SKU-1003 ($42) |
| Units in lot | 2,400 |
| Return rate for lot | ~30% (vs 8% normal) |
| Returns from lot | ~720 |
| Spike week | March 17–23, 2025 |

### Timeline

| Date | Event |
|------|-------|
| **Feb 12, 2025** | Homogenizer HMG-03 pressure fluctuation. Lot LOT-2025-0212 produced. QC notes "minor texture variations" — lot released. |
| **Feb 12 – Mar 15** | Products from affected lot ship gradually (~2,400 units across 3 SKUs) |
| **Feb 20 – Mar 25** | Returns accumulate as customers notice texture issues |
| **Mar 24, 2025** | Claire sees spike in Monday dashboard → **DEMO STARTS HERE** |

---

## Databricks Components

**Default stack**: Data Gen → SDP Pipeline → Dashboard → Genie → KA → MAS

| Component | Name | Purpose |
|-----------|------|---------|
| Catalog | `luxebeauty` | Unity Catalog namespace |
| Schema | `analytics` | All tables and views |
| Volume | `raw_data` | Parquet files + incident PDFs |
| Pipeline | `luxebeauty_operations` | Bronze → Silver → Gold medallion |
| Dashboard | `LuxeBeauty Weekly Operations` | KPI cards, trend charts, products table |
| Genie Space | `LuxeBeauty Operations Analytics` | Natural language queries on structured data |
| Knowledge Assistant | `LuxeBeauty Incidents` | Retrieval over incident report PDFs |
| Multi-Agent Supervisor | `LuxeBeauty Operations Assistant` | Routes to Genie or KA, synthesizes answers |

---

## Workflow

### Phase 1: Configure

Before building, confirm deployment targets:

1. **Catalog and schema** — Default: `luxebeauty.analytics`. Ask user to confirm or specify different location.
2. **Check existing resources** — If catalog/schema/volume already exist with data, ask whether to overwrite or use a different name.
3. **Verify local environment** — Python 3.12 required for Databricks Connect. If not available: `uv venv --python 3.12`.

### Phase 2: Build

Follow the build order strictly. Each step depends on the previous one.

**Use TodoWrite to track progress.** Create a todo for each step and mark complete as you go.

| Step | What | Instruction File | Skill to Load |
|------|------|------------------|---------------|
| 1 | Create catalog, schema, volume | `project-structure.md` | — |
| 2 | Generate synthetic data → upload parquet to volume | `data-schema.md` | `databricks-synthetic-data-gen` or `databricks-data-generation` |
| 3 | Generate incident PDFs → upload to volume | `data-schema.md` (PDF section) | `databricks-unstructured-pdf-generation` |
| 4 | Create SDP pipeline → run it | `architecture.md` (Pipeline section) | `databricks-spark-declarative-pipelines` |
| 5 | **Validate pipeline data** | `data-schema.md` (Validation section) | — |
| 6 | Create Genie Space | `architecture.md` (Genie section) | `databricks-genie` |
| 7 | Create AI/BI Dashboard | `architecture.md` (Dashboard section) | `databricks-aibi-dashboards` |
| 8 | Create Knowledge Assistant | `architecture.md` (KA section) | `databricks-agent-bricks` |
| 9 | Create Multi-Agent Supervisor | `architecture.md` (MAS section) | `databricks-agent-bricks` |
| 10 | **Test end-to-end demo flow** | `walkthrough.md` | — |

### Phase 3: Validate (After Each Layer)

**Incremental checks** — run after each build step:

- **After data generation (step 2)**: Verify LOT-2025-0212 has 3 rows in production_lots, ~2,400 order items, ~720 returns with texture complaints.
- **After pipeline (step 4–5)**: Verify gold_weekly_summary shows ~$180K returns for week of Mar 17. Verify gold_returns_by_lot shows LOT-2025-0212 with ~720 returns across 3 products.
- **After dashboard (step 7)**: 5-second test — show the dashboard and confirm the returns spike is immediately obvious without explanation.
- **After Genie (step 6)**: Ask "Why do I have so many returns?" — must identify LOT-2025-0212 and texture complaints.
- **After KA (step 8)**: Ask "Was there any incident reported for lot LOT-2025-0212?" — must find PIR-2025-0212.
- **After MAS (step 9)**: Run both questions through the supervisor — must route correctly.

### Phase 4: Test End-to-End

Run the full demo flow from `walkthrough.md`:

1. Open dashboard → see spike ($180K)
2. Ask "Why do I have so many returns?" → Genie finds LOT-2025-0212, texture complaints
3. Ask "Was there any incident for that lot?" → KA finds PIR-2025-0212, pressure issue
4. Verify the story holds: WHAT (spike) → WHY (equipment) → WHAT TO DO (contact customers, fix QC)

---

## Coherence Requirements

These are the make-or-break consistency checks. Every item must pass before the demo is ready.

### Identifiers Must Match Across All Components

| Identifier | Where It Must Appear |
|------------|---------------------|
| LOT-2025-0212 | production_lots table, order_items.lot_id, returns data, Genie response, incident PDF, KA response |
| SKU-1001, SKU-1002, SKU-1003 | products table, order_items, returns, dashboard products table, Genie response, incident PDF |
| PIR-2025-0212 | Incident PDF filename/title, KA response |
| Feb 12, 2025 | production_lots.production_date, incident PDF date, Genie response ("manufactured Feb 12") |
| ~$180K / ~$60K | gold_weekly_summary, dashboard KPI card, storyline, walkthrough talk track |
| ~30% / ~8% | Return rates in data, dashboard products table, storyline |

### Numbers Must Be Consistent

| Metric | Must Match In |
|--------|--------------|
| 2,400 units | production_lots quantity, incident PDF, storyline |
| ~720 returns | Returns count from data, Genie response, storyline |
| 3 affected products | Products table, Genie analysis, incident PDF, storyline |
| $68 / $55 / $42 | Products table prices, data-schema |

### The Investigation Flow Must Work

```
Dashboard ($180K spike) 
  → "Why do I have so many returns?" 
    → Genie: 3 products, LOT-2025-0212, texture complaints 
      → "Incident for that lot?" 
        → KA: PIR-2025-0212, homogenizer pressure, released anyway
```

If any link in this chain breaks, the demo fails.

---

## Quality Principles

1. **5-second test** — The dashboard spike must be immediately obvious. If someone has to study it, the visualization failed.
2. **Business metrics in $** — A CFO cares about "$180K in returns" and "$500K at risk", not "720 records with anomalous variance."
3. **Functional instructions** — Describe WHAT to build, not HOW. No API calls, no code snippets in instructions. Let the executing agent choose the best approach.
4. **Smoking gun pattern** — Structured data shows WHAT (spike, products, lot). One key document in a haystack of PDFs explains WHY. Together: WHAT TO DO.
5. **Fixed dates** — Dashboard queries use fixed date ranges (Feb–Mar 2025), not `CURRENT_DATE()`. The spike is always visible regardless of when the demo runs.
6. **Lakeflow Connect narrative** — The story mentions data flowing from Salesforce (orders, customers) and NetSuite (lots, inventory) via Lakeflow Connect. Implementation uses synthetic data. The narrative sells easy ingestion; the demo proves the analytics.

---

## Package Files

| File | Purpose |
|------|---------|
| **SKILL.md** (this file) | Master overview: story, workflow, coherence requirements, quality principles |
| **storyline.md** | Complete narrative arc with talk tracks for each act, persona details, wow moment |
| **architecture.md** | Mermaid diagram, component configurations (pipeline, Genie instructions, dashboard layout, KA config, MAS routing) |
| **data-schema.md** | Table schemas, distributions, the encoded event, PDF specs, validation queries |
| **project-structure.md** | Local directory layout, Databricks resources, pre-flight checklist, build order |
| **walkthrough.md** | Step-by-step demo script with navigation cues, time estimates, audience adaptations |

---

## Customization

Everything in this package is a **tested default**. Adapt freely:

- **Different catalog/schema** — Update all resource references
- **Different audience** — Swap talk tracks in walkthrough.md (C-suite vs technical)
- **Fewer components** — Skip KA/MAS for a dashboard-only demo; skip Genie for a pipeline-focused demo
- **Different industry framing** — The data model (orders/returns/lots) maps to many industries; rename the company and adjust the narrative

When customizing, re-run the coherence checks. Any change to identifiers, numbers, or dates must propagate across all files.
