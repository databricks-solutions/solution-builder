# 02 — KPI anomaly model, alarm correlation and AI Functions

## KPI anomaly model (`src/ml/train_anomaly.py`)
- Features per cell-day from `gold_cell_kpi_daily`: each KPI vs the cell's OWN lagged baseline (median of days d-20..d-7) — dropped-call Δ, RRC Δ, SINR Δ, VSWR Δ, UL interference Δ, peak PRB Δ, availability gap — plus the 7-day slope of the dropped-call rate.
- `StandardScaler` + `IsolationForest(300 trees)` logged to MLflow (experiment `<workspace_folder>/kpi_anomaly_experiment`), registered as `<cat>.<schema>.cell_kpi_anomaly_model`, alias `@champion`.
- `anomaly_score` 0-100 = breadth (KPIs > 4 robust σ from the network that day) × Isolation-Forest percentile; `is_anomaly` ≥ 70; readable `top_factors` → `cell_health_daily` (last 8 days).
- Expected result: DEN-221-A (≈97), BLD-047-B (≈94), DEN-205-A/B/C (≈88); storm sites score ≤ 50 (a single deviating KPI — they are alarm incidents instead).

## Alarm correlation → `noc_incidents` (`src/correlation/build_incident_queue.py`)
Last 24 h of major/critical alarms: (1) ≥ 10 sites under one aggregation router in a 15-min window → one `alarm_storm` incident with the router's own + far-end core alarms; (2) remaining alarms per site (`power_alarm` / `backhaul_alarm` / `site_outage`); (3) anomaly cells on the last 2 days with no alarm incident → `kpi_anomaly`. Each row: sites, subscribers, enterprise accounts, critical facilities, alarm ids, suggested priority. Expected 7 incidents INC-24411…24417 (storm = INC-24417, P1).

## AI Functions
`trouble_ticket_insights` = `ai_classify(resolution_notes, ['early warning ignored','sudden failure','planned or external cause'])` over 1,300 tickets — powers "how many outages had an ignored early warning" (optics ≈ 60%, RF hardware ≈ 45%).
