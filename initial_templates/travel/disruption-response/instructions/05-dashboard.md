# Dashboard Creation

## Task

Create an AI/BI Dashboard that shows the OTP decline and enables drill-down analysis.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `SkyWest Operations Command Center` |
| **Description** | "Real-time flight operations and delay analytics dashboard" |

---

## Layout

**5-Second Test**: OTP decline must be immediately obvious (red gauge showing 62% vs 85% target).

### Row 1: Executive KPIs (Full Width)

| Metric | Display | Source |
|--------|---------|--------|
| On-Time Performance | `62%` (red, gauge) | gold_otp_summary |
| Target | `85%` | Constant |
| Total Delay Minutes | `47,500` | gold_otp_summary |
| Affected Passengers | `12,400` | gold_otp_summary |

### Row 2: Trend Analysis (2 Columns)

**Left: Daily OTP Trend**
- Line chart showing last 30 days
- Baseline ~85%, drop to 62% starting 2 weeks ago
- Target line at 85%

**Right: Delays by Code**
- Bar chart: Code 41 (APU), Code 63 (Crew), Code 81 (Weather), etc.
- Code 41 (APU) dramatically higher than others (5x normal)

### Row 3: Investigation Details (2 Columns)

**Left: Delays by Aircraft**
- Table: Tail Number, Aircraft Type, Delay Count, Total Minutes
- N7xx series aircraft at top

**Right: APU Delays by Aircraft**
- Scatter plot: Aircraft vs APU delay frequency
- Clear cluster of N7xx aircraft with APU-FW-v3.2.1

### Row 4: Fleet Health (Full Width)

**Aircraft Status Grid**
- Cards for each aircraft in affected fleet
- N7xx series showing APU warning indicators
- Shows current status, last APU event, firmware version

---

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7/30/90 days | Last 14 days |
| Delay Code | All, 41 (APU), 63 (Crew), 81 (Weather) | All |
| Aircraft Type | All, CRJ-200, CRJ-700, E175 | All |
| Hub | All hubs | All |

---

## Key Visual Story

The dashboard must show:
1. **Anomaly**: 62% OTP vs 85% target (23-point drop)
2. **Delay Code**: Code 41 (APU) is 5x normal
3. **Aircraft**: N7xx series (45 aircraft) affected
4. **Software**: All on APU-FW-v3.2.1

---

## Validation

| Test | Expected |
|------|----------|
| Open dashboard | OTP decline immediately visible |
| Filter to Code 41 | N7xx aircraft dominate |
| Drill into aircraft | Firmware version pattern visible |
