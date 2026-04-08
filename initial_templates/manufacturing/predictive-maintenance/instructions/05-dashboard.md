# Dashboard Creation

## Task

Create an AI/BI Dashboard that shows the defect rate spike and enables drill-down analysis.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `Precision Motors Quality Operations` |
| **Description** | "Real-time defect monitoring and predictive maintenance dashboard" |

---

## Layout

**5-Second Test**: Defect rate spike must be immediately obvious (red alert, gauge showing 8.5% vs 2.8% target).

### Row 1: Executive KPIs (Full Width)

| Metric | Display | Source |
|--------|---------|--------|
| Current Defect Rate | `8.5%` (red, gauge) | gold_defect_rates |
| Target | `2.8%` | Constant |
| Scrap Cost (MTD) | `$1.2M` | gold_defect_rates |
| OEE | `67%` (yellow) | gold_machine_health |

### Row 2: Trend Analysis (2 Columns)

**Left: Daily Defect Rate**
- Line chart showing last 30 days
- Baseline ~2.8%, spike to 8.5% starting 10 days ago
- Target line at 2.8%

**Right: Defects by Machine**
- Bar chart: CNC-DTR-007, CNC-DTR-003, CNC-DTR-012, etc.
- CNC-DTR-007 dramatically higher than others (12%)

### Row 3: Investigation Details (2 Columns)

**Left: Defect Type Distribution**
- Pie chart: Dimensional, Surface, Assembly, Material
- Dimensional tolerance failures dominate (65%)

**Right: Sensor Trend - CNC-DTR-007**
- Multi-line chart: Vibration, Temperature, Spindle Speed
- Vibration trending up (1.8 → 4.5 mm/s)

### Row 4: Machine Health (Full Width)

**Machine Status Grid**
- Cards for each CNC machine
- CNC-DTR-007 in red with vibration alert
- Shows current metrics and last maintenance date

---

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7/30/90 days | Last 30 days |
| Plant | Detroit, Chicago, Austin | All |
| Machine Type | CNC, Press, Assembly | All |
| Shift | Day, Night, All | All |

---

## Key Visual Story

The dashboard must show:
1. **Anomaly**: 8.5% defect rate vs 2.8% target (3x spike)
2. **Machine**: CNC-DTR-007 is the primary source (12% rate)
3. **Type**: Dimensional tolerance failures dominate
4. **Sensor**: Vibration trending up (spindle bearing wear)

---

## Validation

| Test | Expected |
|------|----------|
| Open dashboard | Defect spike immediately visible |
| Filter to CNC machines | CNC-DTR-007 dominates |
| Drill into sensor data | Vibration anomaly visible |
