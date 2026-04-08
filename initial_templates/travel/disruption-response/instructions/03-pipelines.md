# Pipeline Creation

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `skywest_ops_analytics` |
| **Catalog** | `skywest_airlines` |
| **Target Schema** | `ops_control` |

---

## Pipeline Tables

### Bronze Layer

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_aircraft | aircraft.parquet | Raw aircraft data |
| bronze_flights | flights.parquet | Raw flight records |
| bronze_delays | delays.parquet | Raw delay records |
| bronze_maintenance_events | maintenance_events.parquet | Raw maintenance data |
| bronze_software_deployments | software_deployments.parquet | Raw deployment records |
| bronze_crew_assignments | crew_assignments.parquet | Raw crew data |

### Silver Layer

| Table | What It Contains |
|-------|------------------|
| silver_flights | Flights with aircraft, delay, software version context |
| silver_delays | Delays with flight, aircraft, maintenance context |
| silver_aircraft_health | Aircraft with software version, maintenance status |

**Key relationships**:
- silver_flights: flight + aircraft + software version + delays
- silver_delays: delay + flight + delay code + aircraft

### Gold Layer

| Table | Dimensions | Metrics |
|-------|------------|---------|
| gold_otp_summary | date, delay_category | flights, on_time_count, delayed_count, otp_pct |
| gold_delay_analysis | delay_code, aircraft_type, software_version | delay_count, avg_delay_min, flights_affected |
| gold_aircraft_reliability | tail_number, software_version | flights, delays, otp_pct, delay_code_distribution |

---

## Validation

After running pipeline:

| Check | Expected |
|-------|----------|
| OTP for aircraft with APU-FW-v3.2.1 | ~62% |
| OTP for other aircraft | ~85% |
| Delay code 41 frequency for affected aircraft | 5x normal |
