# 01 — Data & pipeline (synthetic telemetry → silver → gold)

**Catalog / schema:** `manufacturing.predictive_maintenance_copilot` (DAB variables `catalog` / `schema`).
**Built by:** job `[PdM Copilot] Setup` → tasks `generate_data` → `train_score_model` → `build_gold`.

## Plant
TechRobotics Industries, Greenville SC Plant 2 (precision servo actuators): 48 assets.
- Line 1 — Precision Machining: CNC-101..114 (Haas UMC-750, DMG MORI NLX 2500, Okuma GENOS)
- Line 2 — Robotic Assembly: RA-201..216 (FANUC M-20iD/25, R-2000iC/165F, ABB IRB 6700). **RA-207 = line bottleneck, $12,800/h**
- Line 3 — Press & Test: SP-301..308 servo presses, TS-309..312 EOL test stands
- Utilities: CMP-01..06 air compressors

## Silver tables (data_generation/generate_data.py, seed 42, relative to "now")
| table | rows | grain / notes |
|---|---|---|
| `assets` | 48 | registry: model, line, criticality, `downtime_cost_per_hour`, `is_bottleneck` (PK asset_id) |
| `sensor_readings` | ~420K | hourly per asset × 365 d: `vibration_rms_mm_s, temperature_c, motor_current_a, pressure_bar, speed_rpm, load_pct, machine_state` (RUNNING/IDLE/DOWN) |
| `maintenance_work_orders` | ~550 | CMMS history (Preventive / Corrective / Inspection) with **vendor, lubricant_used, notes** |
| `failure_events` | 30 | breakdowns: mode, component, downtime h, lost production + repair + scrap cost, root cause |
| `production_daily` | ~15K | per asset/day: planned, planned-down, unplanned-down (breakdowns + minor stops + changeovers), run time, total/good units |
| `spare_parts` | 22 | MRO crib + Charlotte regional DC qty, cost, lead time |
| `maintenance_windows` | 9 | next 3 weeks of planned line-down windows (capacity = 2 crews × window length) |
| `technicians` | 6 | crew roster with certifications |

PK constraints (RELY) on every dimension; FKs from telemetry / work orders / failures / production to `assets`.

## Planted signal
1. Three FANUC M-20iD robots (RA-207, RA-211, RA-214) had their quarterly reducer-grease PM by contractor
   **Carolina Industrial Services** with **Mobilgrease XHP 222 (EP2, substitute)** because Vigo RE0 was backordered
   (PO-88412). Dates: 17, 16 and 5 days ago.
2. RA-207: J3 vibration 1.5 → ~4.0 mm/s (2.6× baseline), temperature +11 °C over 16 days → model **94 Critical, ~3.5 d**.
3. RA-211: same curve, ~2 weeks behind (1.5×, +3 °C) → **Watch ~38**. RA-214: no drift yet → **Healthy 1** — only the
   maintenance history exposes it.
4. RA-203 failed exactly this way ~6 months ago (14.2 h, CAPA-0117) — the institutional memory the copilot surfaces.
5. RA-207 slowing throttles the whole of Line 2 → **Line 2 OEE ~79% → ~73%** in the last two weeks (dashboard + Genie).
6. Realism: ~30 historical failures (≈75% with a sensor precursor), benign excursions that never fail (false-alarm
   noise), minor stops + changeovers, seasonal temperature.

## Gold (src/pipeline/gold.sql)
- `oee_daily` — OEE = availability × performance × quality per line/day, + unplanned/planned downtime h
- `asset_reliability_12m` — failures, **MTBF** (operating hours from telemetry / failures), MTTR, cost
- `asset_health_current` — registry + ML risk + last PM (vendor, lubricant) + last-24 h sensors (feeds the app mirror)
- `plant_performance_metrics` — **UC metric view** (OEE, availability, performance, quality, downtime, scrap) by line/asset type/date

Production note: in a real plant, telemetry lands via **Zerobus / Lakeflow Connect** (OPC-UA historian → Delta) and the
gold layer runs as a **Lakeflow Declarative Pipeline**; the demo materializes it with plain Spark SQL for a 5-minute setup.
