# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Story**: SkyWest Airlines regional carrier experiencing OTP collapse. 45 CRJ-700 aircraft received APU firmware update v3.2.1 that introduced a cold start bug in low ambient temperatures, causing delay code 41 (APU) events at 5x normal rate.

**Affected aircraft** (deterministic — must exist with these exact values):

| Attribute | Value |
|-----------|-------|
| Tail numbers | N701–N745 (45 aircraft) |
| Aircraft type | CRJ-700 |
| Firmware | APU-FW-v3.2.1 |
| Update window | SOFTWARE_UPDATE_DATE (= NOW - 2 weeks) |
| Delay code | 41 (APU/Ground Power) |
| Symptom | APU fails to start on first departure of day (cold start) |
| OTP affected | ~62% vs 85% target |
| OTP unaffected | ~85% (normal) |
| Delayed flights (code 41) | 312 |
| Impact | ~12,400 passengers, ~47,500 delay minutes |

**IATA delay codes**: 41 APU/Ground Power, 42 Aircraft defect, 43 Maintenance, 81 Documentation, 93 Crew scheduling.

**Normal delay distribution**: Weather ~30%, Maintenance ~20%, Crew ~15%, ATC ~25%, Other ~10%.

**Engineering bulletin** (smoking gun document): ESB-2025-APU-047. Root cause: firmware v3.2.1 reduced fuel flow during cold start initialization; cold start fuel enrichment table not updated for new timing parameters. Affects OAT below 5°C after >4hr ground soak. Fix: v3.2.2.

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, SOFTWARE_UPDATE_DATE = NOW - 2 weeks, Delay spike = NOW - 5 to 10 days.

---

## A. Synthetic Data Generation

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| aircraft.parquet | ~180 | Tail N7xx format. Types: CRJ-200, CRJ-700, E175 |
| flights.parquet | ~500K | Status: completed/cancelled/diverted |
| delays.parquet | ~80K | ~8% normal rate. Affected aircraft: code 41 at 5x normal, 312 delayed flights, first departure of day |
| maintenance_events.parquet | ~20K | Types: scheduled/unscheduled/MEL. ATA codes: 49 APU, 24 Electrical, 73 Engine Fuel |
| software_deployments.parquet | ~500 | Systems: APU, FMS, ACARS. Key: 45 aircraft → APU-FW-v3.2.1 on SOFTWARE_UPDATE_DATE |
| crew_assignments.parquet | ~200K | Roles: Captain, FO, FA |

### Table Schemas

**aircraft**: `tail_number` (PK, N7xx), `aircraft_type`, `manufacturer`, `delivery_date`, `total_cycles`, `total_hours`, `base_station`

**flights**: `flight_id` (PK), `flight_number`, `tail_number` (FK), `origin`, `destination`, `scheduled_departure`, `actual_departure`, `scheduled_arrival`, `actual_arrival`, `status`

**delays**: `delay_id` (PK), `flight_id` (FK), `delay_code`, `delay_code_description`, `delay_minutes`, `delay_category` (weather/maintenance/crew/ATC/other)

**maintenance_events**: `event_id` (PK), `tail_number` (FK), `event_date`, `event_type`, `system_code` (ATA chapter), `description`, `downtime_hours`, `technician`

- N7xx aircraft: multiple APU events, system_code 49, descriptions: "APU failed to start" / "APU startup timeout" / "APU cold start failure"

**software_deployments**: `deployment_id` (PK), `tail_number` (FK), `system`, `software_version`, `deployment_date`, `deployed_by`, `notes`

- Key: 45 aircraft, system=APU, version=APU-FW-v3.2.1, date=SOFTWARE_UPDATE_DATE, notes="Routine firmware update per SB-APU-2025-001"

**crew_assignments**: `assignment_id` (PK), `flight_id` (FK), `crew_member_id`, `role`, `duty_start`, `duty_end`

---

## B. PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/engineering_docs/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Service bulletins (other systems), airworthiness directives, training bulletins, maintenance planning docs, fleet reliability reports, vendor communications. NO mention of APU v3.2.1 cold start issue.

**Key document**: Engineering Service Bulletin ESB-2025-APU-047. Date: SOFTWARE_UPDATE_DATE + 10 days. Priority: URGENT. Affected: CRJ-700 fleet with APU-FW-v3.2.1.

Content must include:
- **Issue**: APU start failures on first flight of day; OAT below 5°C + ground time >4hr
- **Root cause**: v3.2.1 optimized start sequence timing reduced fuel flow during initial light-off; cold start fuel enrichment table not updated for new timing parameters; **"not identified during pre-release testing as testing was conducted in controlled temperature environments"**
- **Interim procedure**: (1) Pre-heat APU compartment if ground time >4hr in cold conditions (2) Use GPU instead of APU when available below 5°C (3) Allow 3 start attempts with 2-min cooling between attempts
- **Permanent fix**: Firmware v3.2.2 — restores original cold start fuel enrichment table + adds dynamic OAT compensation
- **Impact**: Delay code 41 events increased 5x; 12,400 passengers, 47,500 delay minutes

---

## C. SDP Pipeline

Create pipeline `skywest_ops_analytics`, catalog `skywest_airlines`, target schema `ops_control`.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | OTP, delay minutes, passengers affected by date | gold_otp_summary |
| Dashboard investigation | Delay code breakdown, aircraft-level drill-down | gold_delay_analysis + gold_aircraft_reliability |
| Genie investigation | Trace delays → aircraft → firmware → engineering docs | gold_* + silver_delays + silver_flights |

### Source → Bronze (1:1 ingestion)

aircraft/flights/delays/maintenance_events/software_deployments/crew_assignments.parquet → bronze_{table_name}

### Bronze → Silver (joins)

**silver_flights**: flights JOIN aircraft (→ aircraft_type) JOIN software_deployments (→ software_version) JOIN delays (→ delay_code, delay_minutes, delay_category). Columns: flight_id, tail_number, aircraft_type, software_version, origin, destination, scheduled_departure, actual_departure, status, delay_code, delay_minutes, delay_category.

**silver_delays**: delays JOIN flights (→ tail_number, origin, destination) JOIN aircraft (→ aircraft_type) JOIN software_deployments (→ software_version). Columns: delay_id, flight_id, tail_number, aircraft_type, software_version, delay_code, delay_code_description, delay_minutes, delay_category.

**silver_aircraft_health**: aircraft JOIN software_deployments (→ current version) JOIN maintenance_events (→ recent maintenance). Columns: tail_number, aircraft_type, software_version, deployment_date, total_maintenance_events, last_maintenance_date, unscheduled_count.

### Silver → Gold (aggregations)

**gold_otp_summary** — dims: date, delay_category. Metrics: flight_count, on_time_count, delayed_count, otp_pct, total_delay_minutes.

**gold_delay_analysis** — dims: delay_code, delay_code_description, aircraft_type, software_version. Metrics: delay_count, avg_delay_minutes, flights_affected.

**gold_aircraft_reliability** — dims: tail_number, aircraft_type, software_version. Metrics: flight_count, delay_count, otp_pct, delay_code_41_count, total_delay_minutes.

### Filter Coherence Matrix

| Filter | gold_otp_summary | gold_delay_analysis | gold_aircraft_reliability |
|--------|-----------------|--------------------|--------------------------| 
| date | ✅ | — (cumulative) | — (cumulative) |
| delay_category | ✅ | — | — |
| aircraft_type | — | ✅ | ✅ |
| software_version | — | ✅ | ✅ |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_otp_summary | date, delay_category | flight_count, on_time_count, delayed_count, otp_pct, total_delay_minutes |
| gold_delay_analysis | aircraft_type, software_version | delay_code, delay_code_description, delay_count, avg_delay_minutes, flights_affected |
| gold_aircraft_reliability | aircraft_type, software_version | tail_number, flight_count, delay_count, otp_pct, delay_code_41_count |

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query/Method | Expected |
|-------|-------------|----------|
| Affected aircraft count | `SELECT COUNT(*) FROM bronze_software_deployments WHERE software_version='APU-FW-v3.2.1'` | 45 |
| Code 41 flights | `SELECT COUNT(*) FROM silver_delays WHERE delay_code='41' AND software_version='APU-FW-v3.2.1'` | 312 |
| OTP affected | `SELECT otp_pct FROM gold_aircraft_reliability WHERE software_version='APU-FW-v3.2.1'` | ~62% |
| OTP unaffected | `SELECT AVG(otp_pct) FROM gold_aircraft_reliability WHERE software_version!='APU-FW-v3.2.1'` | ~85% |
| Code 41 spike | `SELECT delay_count FROM gold_delay_analysis WHERE delay_code='41' AND software_version='APU-FW-v3.2.1'` | 5x vs other versions |
| Column names | `DESCRIBE gold_otp_summary` / `DESCRIBE gold_delay_analysis` | Match specs above |

Add pipeline_id to `resources.json`.
