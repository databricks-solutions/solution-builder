# 01 — Network telemetry, planted signals and the Lakeflow pipeline

**Customer:** Halcyon Wireless (fictional Mountain-West regional carrier) · **Schema:** `telecommunications.network_ops_copilot` (variables `catalog` / `schema`).

## Topology (reference Delta tables, `data_generation/generate_data.py`)
- `cell_sites` — 500 sites × 3 sectors (A/B/C) in Denver Metro (260), Boulder (60), Fort Collins (60), Colorado Springs (90), Pueblo (30). Each site homes on ONE aggregation router (`agg_router_id`), backhaul `fiber` | `fiber+microwave` | `microwave`, subscribers served, critical facility, battery runtime, generator.
- `transport_nodes` — CORE-DEN-01/02, 14 aggregation routers (30–68 sites each), MW-PUE-HUB. `transport_links` — each router: PRIMARY fiber `xe-0/1/0 → CORE-DEN-01` and diverse SECONDARY `xe-0/1/1 → CORE-DEN-02` (LAG ae1) with the physical route.
- `enterprise_site_coverage` (10 accounts, SLA tier + restore SLA), `field_technicians` (18, skill + drive time per market), `planned_activity` (maintenance, events, 811 excavation, weather, utility outages), `trouble_tickets` (1,300 closed tickets, 12 months, free-text resolution notes), `care_contacts_daily`.

## Raw streaming telemetry → `/Volumes/<cat>/<schema>/raw_telemetry/` (gzipped JSON)
`ran_kpis/` hourly per-cell counters (1,500 cells × 28 days ≈ 1.0M rows, 3 corrupt records), `alarms/` (~4,200 alarm records), `optics/` 15-minute port counters (56 ports × 14 days).

## Lakeflow Spark Declarative Pipeline (`src/pipeline/*.sql`, serverless, full refresh from the setup job)
| Layer | Tables |
|---|---|
| Bronze (Auto Loader `read_files` STREAM) | `bronze_ran_kpis`, `bronze_alarms`, `bronze_optics` |
| Silver (typed, expectations, topology join) | `silver_ran_kpis` (drops null cell / out-of-range rates), `silver_alarms` (+ market, `agg_router_id`, `is_active`), `silver_optics` |
| Gold (MVs) | `gold_cell_kpi_daily`, `gold_site_status` (is_down at the latest hour), `gold_alarm_windows` (per router per 15 min), `gold_network_hourly` |

## Planted signals (relative to the run day D-0; NOW = D-0 08:40, Mountain time)
1. **Alarm storm** — 05:55:12 LOS on BOTH ends of LNK-0407 (AGG-DEN-04 primary; 811 notice CO811-262710455 = boring at W 38th Ave on its route). Failover to LNK-0408 whose optic has decayed −7.8 → −21.6 dBm over 12 days (4 "Rx power low" minor warnings D-3…D-0, auto-acknowledged). CRC errors under load, BFD/LAG down 05:57:40 → router isolated → **64 of 68 sites down** (4 with microwave backup survive), **457 alarms**, ~99.7k subscribers, Front Range Regional Hospital + Jefferson Emergency Communications (platinum). Fastest restore = transport tech cleans/replaces the backup optic at Wheat Ridge Hut (~1 h); splice ~5 h.
2. **Slow burn** — BLD-047-B dropped-call rate 0.55% → ~2.6% over 21 days, VSWR 1.25 → 1.86 (alarm at 2.0): no alarm; complaints rise. Only the KPI anomaly model sees it.
3. **Decoys** — DEN-205 congestion D-1 evening (concert EVT-2291), FTC-019 outage in maintenance window CR-88213, PUE-007 microwave fade during NWS warning, COS-042 on battery (real — generator needed), DEN-221-A rising uplink interference.
