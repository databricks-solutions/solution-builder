# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `SkyWest Operations Command Center` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| OTP gauge | gold_otp_summary | date | otp_pct |
| Delay minutes KPI | gold_otp_summary | date | total_delay_minutes |
| Daily OTP trend | gold_otp_summary | date, delay_category | otp_pct |
| Delays by code | gold_delay_analysis | aircraft_type, software_version | delay_code, delay_code_description, delay_count |
| Delays by aircraft | gold_aircraft_reliability | aircraft_type, software_version | tail_number, delay_count, total_delay_minutes |
| APU delays scatter | gold_aircraft_reliability | software_version | tail_number, delay_code_41_count |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 14 days) | Delay Code | Aircraft Type │
├─────────────────────────────────────────────────────────────────┤
│ [OTP 62% ⚠️ gauge] [Target 85%] [Delay Min 47,500] [Pax 12,400]│
├─────────────────────────────────────────────────────────────────┤
│ Daily OTP Trend (line, 30d)     │  Delays by Code (bar)         │
│ Baseline ~85%, drop to 62%      │  Code 41 APU dramatically     │
│ Target line at 85%              │  higher (5x normal)            │
├─────────────────────────────────────────────────────────────────┤
│ Delays by Aircraft (table)      │  APU Delays Scatter            │
│ N7xx series at top              │  N7xx cluster with v3.2.1      │
├─────────────────────────────────────────────────────────────────┤
│ FLEET HEALTH GRID (full width)                                   │
│ Cards per aircraft: status, last APU event, firmware version     │
│ N7xx series showing APU warning indicators                       │
└─────────────────────────────────────────────────────────────────┘
```

**5-Second Test**: OTP decline immediately obvious — red gauge showing 62% vs 85% target.

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_otp_summary | Last 14 days |
| Delay Code | delay_code | gold_delay_analysis | All |
| Aircraft Type | aircraft_type | gold_delay_analysis, gold_aircraft_reliability | All |

All filters affect ALL widgets.

### Validation

OTP gauge red at 62%. Trend shows drop from ~85% starting 2 weeks ago. Code 41 bar dominates. Filter to Code 41 → N7xx aircraft dominate. Drill into aircraft → firmware version pattern visible.

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `SkyWest Operations Analytics` Genie Space.

### Tables

gold_otp_summary (KPIs/trends), gold_delay_analysis (delay code analysis), gold_aircraft_reliability (aircraft-level), silver_delays (individual delay records), silver_flights (flight details), bronze_aircraft (aircraft info).

### Instructions

```
You analyze SkyWest Airlines operations data for the Ops Control team.

BASELINES: OTP target 85%, normal delay code 41 rate ~3% of all delays, anomaly = 5x normal.

INVESTIGATION FLOW for "Why are we delayed so much?":
1. gold_otp_summary → AVG(otp_pct) recent vs historical → 62% vs 85% target
2. gold_delay_analysis → ORDER BY delay_count DESC → Code 41 (APU) at 5x normal
3. gold_aircraft_reliability → WHERE delay_code_41_count high → N7xx series (45 aircraft)
4. gold_aircraft_reliability → software_version → all on APU-FW-v3.2.1
5. Conclude: "OTP 23 points below target → APU delays → N7xx fleet → software update. Suggest checking engineering documents for bulletins about v3.2.1."
```

### Sample Questions

"Why are we delayed so much this week?" / "Which delay codes are most common?" / "Show me OTP by aircraft type" / "Which aircraft have the worst reliability?" / "What's the trend for APU-related delays?"

### Validation

"Why so many delays?" → identifies OTP drop, code 41, N7xx aircraft, v3.2.1. "Which aircraft have issues?" → N7xx series.

Add genie_space_id to `resources.json`.
