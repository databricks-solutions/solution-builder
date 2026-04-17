---
name: Customer Segmentation & Predictive Targeting
category: pattern
suggested_capabilities: [aibi-dashboards, genie, sdp, knowledge-assistant, supervisor-agent]
---

## Narrative Arc

1. **Flat world** -- The organization treats all entities uniformly, missing hidden structure in the data.
2. **Segmentation reveal** -- Analysis exposes distinct behavioral clusters with dramatically different profiles.
3. **Prediction layer** -- A model scores each entity for likelihood of a target outcome (churn, conversion, risk).
4. **Activation** -- Segments and scores are surfaced through dashboards, apps, or downstream APIs for operational use.
5. **Impact** -- The hero demonstrates measurable lift from segment-aware actions versus the old uniform approach.

## Data Shape

| Layer | Abstract Entity | Role |
|-------|----------------|------|
| Fact table | Interactions / Events | Behavioral signals over time (purchases, visits, claims, sessions) |
| Dimension | Entities | The subjects being segmented (customers, patients, accounts, devices) |
| Dimension | Attributes | Static or slowly changing properties (demographics, plan type, geography) |
| Feature store | Engineered features | Aggregated behavioral metrics per entity (recency, frequency, monetary, tenure) |
| Labels | Outcome flags | Known outcomes for supervised models (churned, converted, defaulted) |
| Unstructured | Profiles / Notes | Qualitative context that enriches segment interpretation |

The data should span enough history to capture behavioral patterns -- typically 6-24 months of interaction data. Entity counts should be large enough (thousands to millions) that manual inspection is impractical, motivating the need for algorithmic segmentation.

## Wow Moment Pattern

The demo becomes compelling at the "reveal" -- when a scatter plot, heatmap, or segment comparison shows that what looked like a homogeneous population actually contains 4-6 dramatically different groups. The audience should feel the shift from "we treat everyone the same" to "we can see exactly who needs what." A second wow moment comes when a prediction score is shown live -- a specific entity's risk or value score updating in real time.

## Investigation / Discovery Flow

1. **Aggregate overview** -- Dashboard shows population-level metrics that mask underlying variation.
2. **Segmentation analysis** -- ML notebook or dashboard reveals distinct clusters with profiling charts.
3. **Segment deep-dive** -- Genie allows natural-language exploration of each segment's characteristics.
4. **Predictive scoring** -- Model scores individual entities; high-value or high-risk entities surface.
5. **Context enrichment** -- Knowledge Assistant provides qualitative background on segment behaviors or policies.
6. **Activation** -- Scored entities are exported, pushed to a CRM, or served through an application endpoint.

## Example Walkthrough Beats (5-Act Structure)

| Act | Beat | What Happens |
|-----|------|-------------|
| 1 - Setup | Uniform treatment | Dashboard shows aggregate metrics; everything looks average and unremarkable |
| 2 - Inciting Incident | Hidden structure | Segmentation analysis reveals 4-6 distinct clusters with divergent behavior profiles |
| 3 - Deep Dive | Segment profiling | Hero uses Genie to explore each segment: "What are the top traits of high-risk customers?" |
| 4 - Prediction | Scoring deployed | ML model scores every entity; dashboard updates with risk/value tiers and individual scores |
| 5 - Activation | Targeted action | Hero demonstrates segment-specific actions -- different outreach for each group, with projected lift metrics |

## Suggested Databricks Components

- **Lakeflow Declarative Pipeline** -- Ingestion and feature engineering through Bronze/Silver/Gold layers; feature tables in the Gold layer.
- **AI/BI Dashboard** -- Segment comparison charts, distribution plots, KPI cards per cohort, and individual entity scorecards.
- **Genie Space** -- Ad-hoc natural-language queries against segment tables ("Show me high-value customers in the Northeast who haven't purchased in 90 days").
- **ML Notebook** -- Clustering (k-means, DBSCAN) for unsupervised segmentation; gradient boosted trees or logistic regression for supervised scoring.
- **Knowledge Assistant** -- Contextual retrieval of segment definitions, targeting policies, and compliance guidelines.
- **Multi-Agent Supervisor** -- Orchestrates between data exploration (Genie) and policy/context retrieval (Knowledge Assistant).
- **Model Serving** -- Real-time scoring endpoint for individual entity predictions.
