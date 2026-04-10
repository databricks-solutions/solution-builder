# Genie Space Creation

## Task

Create a Genie Space for natural language queries against the quality data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `Lakeside Quality Analytics` |
| **Description** | "Analyze readmission rates, discharge protocols, quality metrics, and patient outcomes." |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_readmission_rates | KPIs and trends |
| gold_protocol_performance | Protocol-level analysis |
| gold_monthly_quality | Monthly trends |
| silver_readmissions | Individual readmissions |
| bronze_discharge_protocols | Protocol details |

---

## Sample Questions

```
"Why are readmissions so high this month?"
"Which protocols have the worst outcomes?"
"What's the readmission rate for heart failure?"
"Show me readmission trends by DRG"
"What's driving our CMS penalty exposure?"
```

---

## Key Demo Query Logic

**"Why are readmissions high?"**:
1. Compare to target: gold_readmission_rates → 18% vs 9% target
2. Find affected DRG: Heart failure (291-293) at 24%
3. Identify common protocol: DISCH-HF-2025-03
4. Get excess count: ~156 excess readmissions
5. Summarize: 2x target → heart failure → new protocol → suggest checking protocol documentation

---

## Validation

| Question | Expected Result |
|----------|-----------------|
| "Why are readmissions high?" | Identifies spike, heart failure, DISCH-HF-2025-03 |
| "Which protocol has issues?" | DISCH-HF-2025-03 |
