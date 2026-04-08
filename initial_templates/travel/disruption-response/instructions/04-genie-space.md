# Genie Space Creation

## Task

Create a Genie Space for natural language queries against the operations data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `SkyWest Operations Analytics` |
| **Description** | "Analyze delays, on-time performance, aircraft reliability, and maintenance data." |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_otp_summary | KPIs and trends |
| gold_delay_analysis | Delay code analysis |
| gold_aircraft_reliability | Aircraft-level analysis |
| silver_delays | Individual delay records |
| silver_flights | Flight details |
| bronze_aircraft | Aircraft information |

---

## Sample Questions

```
"Why are we delayed so much this week?"
"Which delay codes are most common?"
"Show me OTP by aircraft type"
"Which aircraft have the worst reliability?"
"What's the trend for APU-related delays?"
```

---

## Key Demo Query Logic

**"Why so many delays?"**:
1. Compare to target: gold_otp_summary → 62% vs 85% target
2. Find dominant delay code: Code 41 (APU) at 5x normal
3. Find affected aircraft: N7xx series (45 aircraft)
4. Check software: All on APU-FW-v3.2.1
5. Summarize: OTP 23 points below → APU delays → N7xx fleet → software update → suggest checking engineering docs

---

## Validation

| Question | Expected Result |
|----------|-----------------|
| "Why so many delays?" | Identifies OTP drop, code 41, N7xx aircraft, v3.2.1 |
| "Which aircraft have issues?" | N7xx series |
