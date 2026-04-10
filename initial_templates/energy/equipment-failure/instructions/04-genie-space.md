# Genie Space Creation

## Task

Create a Genie Space for natural language queries against the grid operations data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `Pacific Grid Operations Analytics` |
| **Description** | "Analyze outages, equipment reliability, sensor telemetry, and maintenance data." |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_outage_summary | KPIs and trends |
| gold_batch_reliability | Batch-level analysis |
| gold_monthly_reliability | Monthly trends |
| silver_outages | Individual outage records |
| silver_equipment_health | Sensor data |
| bronze_transformers | Equipment details |

---

## Sample Questions

```
"Why are we having so many outages?"
"Which equipment batches are failing?"
"Show me outage trends for this month"
"What's the reliability rate by manufacturer?"
"Which transformers have elevated temperatures?"
```

---

## Key Demo Query Logic

**"Why so many outages?"**:
1. Compare to baseline: gold_outage_summary → 47 vs 15 normal
2. Find common factor: All from batch TRF-2024-Q3-887
3. Check equipment health: Elevated temperatures before failures
4. Identify cause: Equipment failures (overheating)
5. Summarize: 3x outages → one batch → elevated temps → suggest checking supplier documentation

---

## Validation

| Question | Expected Result |
|----------|-----------------|
| "Why so many outages?" | Identifies spike, batch TRF-2024-Q3-887 |
| "Which batch has issues?" | TRF-2024-Q3-887 |
