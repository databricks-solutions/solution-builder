---
name: Anomaly Detection & Root Cause Investigation
category: pattern
suggested_capabilities: [aibi-dashboards, genie, knowledge-assistant, supervisor-agent, sdp, notebooks-eda]
---

## Narrative Arc

1. **Normalcy** -- Establish a baseline period where the metric behaves predictably.
2. **Disruption** -- A visible spike or anomaly appears in the KPI dashboard.
3. **Investigation** -- The hero drills into the anomaly using conversational queries (Genie) and document search (Knowledge Assistant).
4. **Discovery** -- A root cause is identified, often combining structured data evidence with unstructured intelligence (reports, memos, policies).
5. **Resolution** -- The hero takes corrective action: flags affected entities, triggers alerts, or deploys a predictive model to prevent recurrence.

## Data Shape

| Layer | Abstract Entity | Role |
|-------|----------------|------|
| Fact table | Events / Transactions | High-volume timestamped records that carry the metric of interest |
| Dimension | Entities | The actors or objects involved (customers, patients, machines, products) |
| Dimension | Categories / Segments | Groupings that allow drill-down (region, department, product line) |
| Aggregate | Metric rollups | Pre-computed Gold-layer summaries for dashboard performance |
| Unstructured | Intelligence documents | Reports, memos, policies that explain context behind the numbers |

The data must include a **baseline period** (normal behavior) and an **anomaly window** (the spike). Ideally 6-12 months of history with the anomaly concentrated in the most recent period.

## Wow Moment Pattern

The demo becomes compelling when the audience watches a single question unravel the mystery. The hero asks a natural-language question ("Why did X spike this week?"), and the system traces from aggregate metrics down to specific causal entities -- a compromised vendor, a staffing gap, a faulty component lot. The transition from "we see the problem" to "we know exactly why" should happen in under 60 seconds.

## Investigation / Discovery Flow

1. **Dashboard scan** -- Visual identification of the anomaly via time-series charts and KPI cards.
2. **Dimensional drill-down** -- Filter by segment, category, or geography to isolate the anomaly cluster.
3. **Conversational query** -- Ask Genie natural-language questions to explore hypotheses.
4. **Document retrieval** -- Ask Knowledge Assistant for contextual intelligence (reports, regulations, prior incidents).
5. **Entity identification** -- Pinpoint the specific records, accounts, or assets affected.
6. **Action** -- Export a list, trigger a workflow, or deploy a model for ongoing detection.

## Example Walkthrough Beats (5-Act Structure)

| Act | Beat | What Happens |
|-----|------|-------------|
| 1 - Setup | Baseline context | Dashboard shows 6 months of stable KPI behavior with clear trendlines |
| 2 - Inciting Incident | Anomaly surfaces | A dramatic spike appears in the most recent period; KPI card turns red |
| 3 - Investigation | Drill and query | Hero filters dashboard, asks Genie 2-3 questions, narrows to a cluster |
| 4 - Revelation | Root cause found | Knowledge Assistant surfaces a document that explains the why; hero connects data evidence to narrative cause |
| 5 - Resolution | Action taken | Hero identifies affected entities, quantifies impact, and initiates corrective action via the multi-agent supervisor |

## Suggested Databricks Components

- **Lakeflow Declarative Pipeline** -- Bronze/Silver/Gold medallion architecture with streaming tables for near-real-time metric updates.
- **AI/BI Dashboard** -- Time-series anomaly visualization, KPI cards with thresholds, dimensional breakdowns.
- **Genie Space** -- Natural-language SQL exploration against Gold-layer tables for ad-hoc investigation.
- **Knowledge Assistant** -- RAG-powered document search across intelligence reports, policies, and incident records.
- **Multi-Agent Supervisor** -- Orchestrates routing between structured data queries and unstructured document retrieval.
- **ML Notebook** -- Anomaly detection or classification model (isolation forest, gradient boosted trees) for automated scoring.
