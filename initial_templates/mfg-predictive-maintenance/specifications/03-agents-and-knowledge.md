# 03 — Agents: the Genie agent (tables + manuals) + the PdM Copilot

## Plant manuals — the Genie agent's documents volume (Agent mode)
Source: UC volume `/Volumes/manufacturing/predictive_maintenance_copilot/manuals/` — 8 synthetic plant PDFs rendered
from `src/documents/md/*.md` (`src/documents/render_pdfs.py`):
ES-ROB-014 (FANUC reducer lubrication: **Vigo RE0 only**, wrong-grease symptoms, corrective procedure: purge ×2 / J3
reducer replacement 8 h, 2 techs) · RP-VIB-002 (vibration zones, 2× baseline rule) · **CAPA-0117** (RA-203 J3 seizure,
same root cause) · SOW-CIS-2025 (contractor: substitutions need written approval) · MPS-004 (priorities, windows,
downtime-cost / cost-avoided accounting) · TS-CNC-021 · MM-PRS-009 · SAF-LOTO-003 (distractors).
Listed in the Genie agent's `data_sources.volumes` by `src/deploy/deploy_genie.py`, which waits until all 8 are indexed.

## Genie agent — `TechRobotics Plant Reliability Genie`
Tables: assets, asset_health_current, asset_reliability_12m, asset_risk_scores, failure_events,
maintenance_work_orders, maintenance_windows, oee_daily, plant_performance_metrics (metric view), spare_parts.
Text instructions define OEE / MTBF / MTTR / risk tiers / the OEM grease rule and route numbers to the tables / procedures to the manuals; 7 verified SQL examples; 7 sample
questions (one answered from the manuals). Deployed by `src/deploy/deploy_genie.py` from `genie/genie_space.json` (serialized v2, tables sorted).

## PdM Copilot (app agent, OpenAI Agents SDK on `databricks-gpt-5-4`, `app/server/agent/pdmops.ts`)
Tools: `get_fleet_risk`, `get_asset_details`, `find_pm_batch` (Lakebase mirror) · `ask_data` (the Genie agent: analytics + manuals) ·
`check_parts`, `list_windows` · **`book_work_order` (WRITE)**.
Modes: A diagnose → A2 scope ("who else?") → B plan (table, STOP for approval) → book (one call per asset).
Every turn is traced to MLflow (`/Shared/mfg-predictive-maintenance/pdm-copilot-agent-traces`).
