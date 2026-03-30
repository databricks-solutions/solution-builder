# LuxeBeauty Co. - Returns Intelligence Demo

## What to Build

Build a demo showcasing how a cosmetics retailer investigates a sudden spike in product returns. An executive sees the anomaly in a dashboard, asks "Why do I have so many returns?", and the Multi-Agent Supervisor combines structured data (Genie) with incident documentation (Knowledge Assistant) to reveal the root cause.

**Demo Duration**: 5-7 minutes

---

## How to Build This Demo

### Workflow: Local First, Then Deploy

Create all files locally in a project folder, then deploy to Databricks:

1. **Write code and configs locally** - Python scripts, SQL files, pipeline definitions
2. **Upload files to Databricks** - To volumes (data) and workspace (code)
3. **Create Databricks resources** - Pipelines, dashboards, Genie spaces, KA, MAS via APIs
4. **Validate after each step** - Query tables to confirm data is correct

### Local Project Structure

Create this folder structure locally:

```
luxebeauty_demo/
├── data_generation/
│   └── generate_data.py              # Script to generate synthetic parquet files
├── documents/
│   └── generate_incident_pdf.py      # Script to generate the incident report PDF
├── pipeline/
│   ├── transformations/
│   │   ├── 01_bronze_ingestion.py    # Bronze layer: raw parquet ingestion
│   │   ├── 02_silver_transformation.py # Silver layer: joins and enrichment
│   │   └── 03_gold_aggregation.py    # Gold layer: aggregations for analytics
│   └── exploration/
│       └── exploration_notebook.py   # Notebook to verify raw data
└── instructions/                     # These instruction files (for reference)
```

After running scripts locally, upload to the Databricks resources defined above (volumes for data, workspace folder for code).

---

## Databricks Infrastructure

### Resource Names

| Resource | Name |
|----------|------|
| **Catalog** | `luxebeauty` |
| **Schema** | `analytics` |
| **Workspace Folder** | `/Workspace/Users/{user}/ai_demos/luxebeauty_demo/` |

Derived paths:
- **Raw Data Volume**: `/Volumes/{catalog}/{schema}/raw_data/`

### Pre-flight Check

Before starting, verify:

**Local environment**:
- Python 3.12 is available (required for Databricks Connect compatibility)
- If not, use `uv` to create a virtual environment with Python 3.12: `uv venv --python 3.12`

**Databricks resources** (create if needed). If any already contain data, ask the user whether to overwrite or use a different name:
- Catalog and schema
- Volume (raw_data)
- Workspace folder

### Assets to Create

| Asset | Type | Name |
|-------|------|------|
| Pipeline | Spark Declarative Pipeline | `luxebeauty_operations` |
| Dashboard | AI/BI Dashboard | `LuxeBeauty Weekly Operations` |
| Genie Space | Genie | `LuxeBeauty Operations Analytics` |
| Knowledge Assistant | KA | `LuxeBeauty Incidents` |
| Multi-Agent Supervisor | MAS | `LuxeBeauty Operations Assistant` |

---

## The Demo Story

### Company Profile

- **Company**: LuxeBeauty Co. - D2C cosmetics e-commerce
- **Persona**: Claire Dubois, VP of Operations
- **Manufacturing**: Single facility in Lyon, France

### Timeline

| Date | Event |
|------|-------|
| **Feb 12, 2025** | Homogenizer equipment issue during production. Lot LOT-2025-0212 released after visual QC passes. |
| **Feb 12 - Mar 15** | Products from affected lot ship gradually (~2,400 units) |
| **Feb 20 - Mar 25** | Returns accumulate as customers notice texture issues |
| **Mar 24, 2025** | Claire sees spike in dashboard → **DEMO STARTS** |

**Note on dates**: The data uses fixed dates (Feb-Mar 2025). Dashboard queries should use these specific date ranges rather than `CURRENT_DATE()` to ensure the spike is always visible.

### Key Numbers

| Metric | Value |
|--------|-------|
| Normal weekly returns | ~$60K |
| Spike week returns | ~$180K (3x normal) |
| Affected lot | LOT-2025-0212 |
| Affected products | SKU-1001, SKU-1002, SKU-1003 |
| Units in lot | 2,400 |
| Return rate for lot | ~30% (vs 8% normal) |

### Affected Products

| SKU | Product Name | Price |
|-----|--------------|-------|
| SKU-1001 | Hydrating Serum 30ml | $68 |
| SKU-1002 | Vitamin C Cream 50ml | $55 |
| SKU-1003 | HA Moisture Boost 15ml | $42 |

---

## Demo Flow

### Step 1: Dashboard (30 seconds)

Claire opens dashboard. Everything normal except:
- **Weekly Returns: $180K** (usually ~$60K)
- Clear spike visible in trend chart

*Claire's reaction*: "Why do I have so many returns?"

### Step 2: Ask the MAS (2 minutes)

**Question 1**: "Why do I have so many returns this week?"

MAS routes to Genie, which finds:
- Returns 3x higher than normal
- 3 Skincare products account for 78% of returns
- All trace to lot LOT-2025-0212
- Customers report texture issues (grainy, separated)

### Step 3: Find Root Cause (2 minutes)

**Question 2**: "Was there any incident reported for lot LOT-2025-0212?"

MAS routes to KA, which finds:
- Homogenizer had pressure fluctuations on Feb 12
- QC noted "minor texture variations due to pressure fluctuations during emulsification"
- Lot was released because visual inspection passed

### Step 4: Resolution

Claire now knows:
- **What**: 3 products, $180K in returns, texture complaints
- **Why**: Equipment calibration issue caused emulsification problems
- **Action**: Contact remaining customers, review QC process

---

## Build Order

1. **Create catalog and schema** (as defined above)
2. **Create volume** (`raw_data`)
3. **Generate synthetic data** → upload to `raw_data` volume (see 01-data-generation.md)
4. **Generate incident PDFs** → upload to volume `incident_pdf/` folder (see 02-unstructured-docs.md)
5. **Create SDP pipeline** → run to create Bronze/Silver/Gold tables (see 03-pipelines.md)
6. **Validate pipeline data** → verify data matches story and dashboard requirements (see 03b-pipeline-validation.md)
7. **Create Genie Space** (see 04-genie-space.md)
8. **Create dashboard** → include Genie Space for natural language queries (see 05-dashboard.md)
9. **Create Knowledge Assistant** (see 06-knowledge-assistant.md)
10. **Create Multi-Agent Supervisor** (see 07-multi-agent-supervisor.md)
11. **Test demo flow** (see 08-walkthrough.md)

---

## Validation

After each step that creates tables or data, run validation queries to confirm the demo facts are present before moving to the next step.
