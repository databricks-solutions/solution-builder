# Data Generation

## Task

Generate synthetic parquet files and upload them to the raw data volume.

---

## Data Time Range

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | NOW | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| SOFTWARE_UPDATE_DATE | NOW - 2 weeks | When APU v3.2.1 deployed |
| Delay spike | NOW - 5 to 10 days | When delays peak |

---

## Output Location

```
{raw_data_volume}/
├── aircraft.parquet           (~180 rows)
├── flights.parquet            (~500,000 rows)
├── delays.parquet             (~80,000 rows)
├── maintenance_events.parquet (~20,000 rows)
├── software_deployments.parquet (~500 rows)
└── crew_assignments.parquet   (~200,000 rows)
```

---

## Table Schemas

### 1. aircraft (~180 rows)

| Column | Type | Description |
|--------|------|-------------|
| tail_number | STRING | Primary key (format: N7XX) |
| aircraft_type | STRING | "CRJ-200", "CRJ-700", "E175" |
| manufacturer | STRING | |
| delivery_date | DATE | |
| total_cycles | INT | |
| total_hours | INT | |
| base_station | STRING | |

**Affected aircraft**:
- 45 aircraft with tail numbers N7xx series
- All CRJ-700 type
- All updated to APU-FW-v3.2.1

---

### 2. flights (~500,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| flight_id | STRING | Primary key |
| flight_number | STRING | |
| tail_number | STRING | FK to aircraft |
| origin | STRING | Airport code |
| destination | STRING | Airport code |
| scheduled_departure | TIMESTAMP | |
| actual_departure | TIMESTAMP | |
| scheduled_arrival | TIMESTAMP | |
| actual_arrival | TIMESTAMP | |
| status | STRING | "completed", "cancelled", "diverted" |

---

### 3. delays (~80,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| delay_id | STRING | Primary key |
| flight_id | STRING | FK to flights |
| delay_code | STRING | IATA delay code |
| delay_code_description | STRING | |
| delay_minutes | INT | |
| delay_category | STRING | "weather", "maintenance", "crew", "ATC", "other" |

**IATA delay codes**:
- 41: APU/Ground Power
- 42: Aircraft defect
- 43: Maintenance
- 81: Documentation
- 93: Crew scheduling

**Normal delay distribution**: Weather ~30%, Maintenance ~20%, Crew ~15%, ATC ~25%, Other ~10%

**Affected aircraft delays**:
- N7xx aircraft showing code 41 (APU) at 5x normal rate
- 312 delayed flights from code 41
- Delays occur on first departure of day (cold start issue)

---

### 4. maintenance_events (~20,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| event_id | STRING | Primary key |
| tail_number | STRING | FK to aircraft |
| event_date | DATE | |
| event_type | STRING | "scheduled", "unscheduled", "MEL" |
| system_code | STRING | ATA chapter |
| description | STRING | |
| downtime_hours | DECIMAL(6,2) | |
| technician | STRING | |

**ATA system codes**:
- 49: APU
- 24: Electrical
- 73: Engine Fuel

**Key maintenance events**:
- Multiple APU-related events for N7xx aircraft
- System code: 49 (APU)
- Description variations: "APU failed to start", "APU startup timeout", "APU cold start failure"

---

### 5. software_deployments (~500 rows)

| Column | Type | Description |
|--------|------|-------------|
| deployment_id | STRING | Primary key |
| tail_number | STRING | FK to aircraft |
| system | STRING | "APU", "FMS", "ACARS" |
| software_version | STRING | |
| deployment_date | DATE | |
| deployed_by | STRING | |
| notes | STRING | |

**Key deployment**:
- 45 aircraft updated to APU-FW-v3.2.1
- Deployment date: SOFTWARE_UPDATE_DATE
- System: APU
- Notes: "Routine firmware update per SB-APU-2025-001"

---

### 6. crew_assignments (~200,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| assignment_id | STRING | Primary key |
| flight_id | STRING | FK to flights |
| crew_member_id | STRING | |
| role | STRING | "Captain", "FO", "FA" |
| duty_start | TIMESTAMP | |
| duty_end | TIMESTAMP | |

---

## Validation

| What to Check | Expected |
|---------------|----------|
| Aircraft with APU-FW-v3.2.1 | 45 (N7xx series) |
| Flights with delay code 41 | 312 |
| OTP for affected aircraft | ~62% vs 85% target |
| OTP for unaffected aircraft | ~85% (normal) |
| Pattern: first departure of day | Yes - cold start issue |
