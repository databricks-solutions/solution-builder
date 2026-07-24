# Data Layer - Manufacturing Quality

## Schema Overview

```
production_runs ←──┬──→ quality_inspections
       │           │
       │           └──→ defect_details
       │
       └──→ machines ←──→ maintenance_logs
                │
                └──→ machine_telemetry
```

## Tables

### production_runs
Production batches from MES system (Simulated: Salesforce via Lakeflow Connect)

| Column | Type | Description |
|--------|------|-------------|
| run_id | STRING | Unique run identifier |
| batch_id | STRING | Batch identifier (e.g., CR-2024-03-001) |
| product_line | STRING | Product category (connecting_rod, piston, crankshaft) |
| machine_id | STRING | Machine that produced this run |
| operator_id | STRING | Operator on shift |
| start_time | TIMESTAMP | Production start |
| end_time | TIMESTAMP | Production end |
| units_produced | INT | Total units in run |
| shift | STRING | Day/Night shift |

**Distribution:**
- 6 months of data (~180 days)
- 3-5 production runs per machine per day
- 8 CNC machines total
- Product mix: 60% connecting rods, 25% pistons, 15% crankshafts

### quality_inspections
QC inspection results (Simulated: NetSuite via Lakeflow Connect)

| Column | Type | Description |
|--------|------|-------------|
| inspection_id | STRING | Unique inspection ID |
| run_id | STRING | FK to production_runs |
| inspection_time | TIMESTAMP | When inspection occurred |
| inspector_id | STRING | QC inspector |
| units_inspected | INT | Sample size |
| units_passed | INT | Units meeting spec |
| units_failed | INT | Units with defects |
| inspection_type | STRING | Visual, dimensional, stress_test |

**Distribution:**
- Every production run gets inspected
- Normal: 99.2% pass rate (0.8% defect)
- **THE EVENT:** March 11-18, CNC-B-007 connecting rod runs: 96.8% pass rate (3.2% defect)

### defect_details
Individual defect records

| Column | Type | Description |
|--------|------|-------------|
| defect_id | STRING | Unique defect ID |
| inspection_id | STRING | FK to quality_inspections |
| defect_type | STRING | tolerance_drift, surface_finish, dimensional, crack |
| severity | STRING | Critical, Major, Minor |
| measurement_value | DOUBLE | Actual measured value |
| spec_min | DOUBLE | Specification minimum |
| spec_max | DOUBLE | Specification maximum |
| defect_location | STRING | Where on part defect found |

**Distribution:**
- Normal: mix of defect types, no pattern
- **THE EVENT:** 85% of CNC-B-007 defects are "tolerance_drift" type, measurement_value ~0.003mm outside spec

### machines
Equipment master data

| Column | Type | Description |
|--------|------|-------------|
| machine_id | STRING | Unique machine ID (e.g., CNC-B-007) |
| machine_type | STRING | CNC_5axis, CNC_3axis, grinding, etc. |
| building | STRING | Building location (A, B, C) |
| install_date | DATE | When installed |
| last_maintenance | DATE | Last preventive maintenance |
| next_maintenance_due | DATE | Scheduled PM date |
| status | STRING | Active, maintenance, offline |

**Key data:**
- CNC-B-007: last_maintenance = 2024-01-08, next_maintenance_due = 2024-03-08 (MISSED!)

### maintenance_logs
Maintenance history

| Column | Type | Description |
|--------|------|-------------|
| log_id | STRING | Unique log ID |
| machine_id | STRING | FK to machines |
| maintenance_date | DATE | When performed |
| maintenance_type | STRING | Preventive, corrective, emergency |
| technician_id | STRING | Who performed |
| description | STRING | Work performed |
| parts_replaced | STRING | Components replaced |
| downtime_hours | DOUBLE | Machine downtime |

### machine_telemetry
IoT sensor data from machines

| Column | Type | Description |
|--------|------|-------------|
| telemetry_id | STRING | Unique record ID |
| machine_id | STRING | FK to machines |
| timestamp | TIMESTAMP | Reading time |
| spindle_vibration | DOUBLE | Vibration level (mm/s) |
| spindle_temperature | DOUBLE | Temperature (°C) |
| spindle_load | DOUBLE | Load percentage |
| coolant_flow | DOUBLE | Flow rate (L/min) |
| power_consumption | DOUBLE | kW usage |

**Distribution:**
- Readings every 5 minutes
- Normal vibration: 0.5-1.2 mm/s
- **THE EVENT:** CNC-B-007 vibration trending up from 1.0 to 2.3 mm/s over past 3 weeks (bearing wear signature)

## The Event Encoding

The defect spike is caused by:
1. **Missed maintenance** on CNC-B-007 (due March 8, not performed)
2. **Spindle bearing wear** visible in telemetry (vibration increase)
3. **Tolerance drift** in connecting rod dimensions (0.003mm outside spec)
4. **Concentrated in batches** CR-2024-03-XXX from March 11 onward

## Relationships for Tracing

```
High defect rate (dashboard)
    → Filter by product_line = "connecting_rod"
    → Filter by date range = March 11-18
    → Join to production_runs → machine_id = CNC-B-007
    → Join to defect_details → defect_type = "tolerance_drift"
    → Check machines table → next_maintenance_due = March 8 (missed!)
    → Check telemetry → spindle_vibration trending up
```
