# Genie Space Creation

## Task

Create a Genie Space for natural language queries against the operations data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `Precision Operations Analytics` |
| **Description** | "Analyze defect rates, machine performance, sensor data, and quality metrics." |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_defect_rates | KPIs and trends |
| gold_machine_health | Machine-level analysis |
| gold_daily_quality | Daily quality trends |
| silver_quality | Individual inspection records |
| silver_sensor_trends | Sensor data |
| bronze_machines | Machine details |

---

## Sample Questions

```
"Why are defects so high this week?"
"Which machines have quality issues?"
"Show me sensor data for CNC-DTR-007"
"What's the defect trend for Detroit plant?"
"Which parts have the highest reject rate?"
```

---

## Key Demo Query Logic

**"Why are defects high?"**:
1. Compare to target: gold_defect_rates → 8.5% vs 2.8% target
2. Find affected machine: CNC-DTR-007 at 12%
3. Check sensor data: Vibration trending up (1.8 → 4.5 mm/s)
4. Identify defect type: Dimensional tolerance failures
5. Summarize: 3x defects → CNC-DTR-007 → vibration anomaly → suggest checking maintenance logs

---

## Validation

| Question | Expected Result |
|----------|-----------------|
| "Why are defects high?" | Identifies spike, CNC-DTR-007, vibration issue |
| "Which machine has issues?" | CNC-DTR-007 |
