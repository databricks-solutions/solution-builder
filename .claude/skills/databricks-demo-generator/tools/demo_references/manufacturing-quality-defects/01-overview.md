# Manufacturing Quality Defects Demo

## The Story

**Company:** TitanAuto Parts - Tier 1 automotive supplier manufacturing precision engine components

**Hero:** Maria Chen, VP of Quality Operations

**The Problem:** Maria sees defect rate spike from 0.8% baseline to 3.2% (4x normal) over the past week. This threatens a $2.4M shipment to their largest customer and risks losing the account.

**The Investigation:**
1. Dashboard shows defect spike concentrated in "connecting rod" product line
2. Maria asks Genie: "Why are connecting rod defects so high this week?"
3. Genie traces to CNC Machine #7 in Building B, Batch IDs starting with "CR-2024-03"
4. Maria asks Knowledge Assistant: "What's happening with CNC Machine 7?"
5. KA reveals maintenance report: worn spindle bearing causing 0.003mm tolerance drift

**The Resolution:**
- Root cause: Spindle bearing wear beyond tolerance threshold
- Impact: $2.4M shipment at risk, 847 defective parts need rework
- Action: Maria asks agent to schedule emergency maintenance and generate rework plan

**Key Numbers:**
- Baseline defect rate: 0.8%
- Current defect rate: 3.2% (4x spike)
- Affected batch: CR-2024-03-XX series
- Parts at risk: 847 units
- Revenue at risk: $2.4M
- Machine: CNC-B-007

## Timeline

- **Historical baseline:** 6 months of normal operations (0.8% defect rate)
- **Event start:** March 11, 2024 - defects begin rising
- **Current date:** March 18, 2024 - defect rate at peak
- **Maintenance due date (missed):** March 8, 2024

## Components

| Component | Purpose |
|-----------|---------|
| Data Generation | Production runs, quality inspections, machine telemetry, maintenance logs |
| Pipeline | Bronze/Silver/Gold with quality metrics aggregation |
| Dashboard | Quality KPIs with defect rate trend, machine breakdown |
| Genie Space | Query production and quality data |
| Knowledge Assistant | Search maintenance docs, equipment manuals |
| Multi-Agent Supervisor | Route between data questions and document questions |
| ML Notebook | Predictive maintenance model for equipment failure |

## Build Order

1. Generate data (production, inspections, machines, maintenance)
2. Create pipeline (Bronze → Silver → Gold)
3. Build dashboard (quality metrics, trends)
4. Configure Genie Space
5. Generate documents and configure KA
6. Set up Multi-Agent Supervisor
7. Train/deploy ML model for predictive maintenance
