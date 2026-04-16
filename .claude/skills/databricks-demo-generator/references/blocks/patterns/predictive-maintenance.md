---
name: Predictive Maintenance & Failure Prevention
category: pattern
suggested_capabilities: [sdp, aibi-dashboards, genie, notebooks-eda, knowledge-assistant, supervisor-agent]
---

## Narrative Arc

1. **Reactive baseline** -- The organization operates in break-fix mode; failures are expensive surprises.
2. **Signal detection** -- Telemetry data reveals precursor patterns that precede failures by hours or days.
3. **Model training** -- Historical failure data trains a survival or classification model linking sensor signatures to failure probability.
4. **Early warning** -- The model flags an asset currently showing precursor signals, days before expected failure.
5. **Proactive intervention** -- Maintenance is scheduled during a planned window, avoiding catastrophic unplanned downtime and demonstrating ROI.

## Data Shape

| Layer | Abstract Entity | Role |
|-------|----------------|------|
| Fact table | Sensor readings | High-frequency time-series data (temperature, vibration, pressure, voltage, RPM) |
| Fact table | Maintenance logs | Historical work orders, repairs, part replacements with timestamps |
| Fact table | Failure events | Labeled incidents with failure mode, severity, and root cause |
| Dimension | Assets / Equipment | The machines, vehicles, or infrastructure being monitored |
| Dimension | Asset metadata | Make, model, age, location, operating environment, maintenance schedule |
| Aggregate | Health scores | Rolling window aggregations and derived health indices per asset |
| Unstructured | Maintenance manuals / Specs | OEM documentation, inspection checklists, safety bulletins |

Sensor data should be high-frequency (minutes or seconds) over weeks to months. The dataset needs both healthy operation periods and pre-failure degradation curves. A small percentage of assets (5-15%) should have experienced actual failures to provide training labels.

## Wow Moment Pattern

The demo peaks when the audience sees a specific asset flagged as "failure likely within 72 hours" while it still appears to be operating normally. The hero overlays current sensor readings against the known degradation signature, and the audience watches the curves converge. The contrast between "looks fine on the surface" and "the data says otherwise" is the emotional hook. A second wow moment is the cost calculation: planned maintenance at $X versus unplanned downtime at 10-50X.

## Investigation / Discovery Flow

1. **Fleet overview** -- Dashboard shows asset health scores across the entire population; most are green.
2. **Alert triage** -- A few assets show yellow or red health scores; hero selects one for investigation.
3. **Sensor deep-dive** -- Time-series charts show the degradation trend across multiple sensor channels.
4. **Pattern matching** -- Genie compares current readings to historical failure signatures ("Has this asset shown this pattern before?").
5. **Context retrieval** -- Knowledge Assistant surfaces the relevant maintenance manual section and prior work orders for the asset.
6. **Decision and action** -- Hero schedules proactive maintenance, estimates cost savings, and demonstrates the feedback loop that improves the model.

## Example Walkthrough Beats (5-Act Structure)

| Act | Beat | What Happens |
|-----|------|-------------|
| 1 - Setup | Fleet status | Dashboard shows a fleet of assets with health scores; most are healthy, establishing normalcy |
| 2 - Inciting Incident | Early warning | One asset's health score drops to amber; prediction model estimates failure within 72 hours |
| 3 - Investigation | Sensor forensics | Hero examines time-series data, asks Genie to compare this asset's readings to known failure patterns |
| 4 - Confirmation | Evidence convergence | Knowledge Assistant surfaces the maintenance manual showing this degradation signature matches a known failure mode; historical data confirms the pattern |
| 5 - Resolution | Proactive fix | Hero schedules maintenance in the next planned window, shows cost avoidance calculation (planned vs. unplanned), and demonstrates how the outcome feeds back into model improvement |

## Suggested Databricks Components

- **Lakeflow Declarative Pipeline** -- Streaming ingestion of sensor data through Auto Loader; Bronze (raw telemetry), Silver (cleaned and aligned), Gold (feature aggregations and health scores).
- **AI/BI Dashboard** -- Fleet health overview, individual asset drill-down with time-series charts, failure probability gauges, cost impact KPIs.
- **Genie Space** -- Natural-language queries against asset telemetry and maintenance history ("Which assets have shown vibration anomalies in the last 7 days?").
- **ML Notebook** -- Survival analysis, time-series classification, or gradient boosted model for remaining useful life (RUL) estimation.
- **Knowledge Assistant** -- RAG search across maintenance manuals, OEM specifications, safety bulletins, and historical work orders.
- **Multi-Agent Supervisor** -- Routes between telemetry data queries (Genie) and document retrieval (Knowledge Assistant) for complete asset context.
