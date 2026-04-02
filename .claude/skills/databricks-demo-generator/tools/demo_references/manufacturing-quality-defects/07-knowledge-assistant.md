# Knowledge Assistant - Manufacturing Quality

## Configuration

**Name:** TitanAuto Maintenance & Procedures Assistant

**Description:** AI assistant that searches maintenance records, equipment manuals, and operational procedures to provide context that structured data cannot.

## Document Sources

Upload these generated PDFs to the Knowledge Assistant:

| Document | Type | Pages | Purpose |
|----------|------|-------|---------|
| Equipment Manual - CNC 5-Axis Series | Reference | 15 | Standard procedures |
| Quality Control Procedures v3.2 | Reference | 10 | QC protocols |
| Operator Training Manual | Reference | 12 | Operations context |
| Supplier Quality Report Q4 2023 | Report | 8 | Rule out supplier issues |
| Annual Maintenance Plan 2024 | Plan | 6 | Shows scheduled PMs |
| Maintenance Inspection Report - CNC-B-007 | Report | 3 | **SMOKING GUN** |
| Production Priority Memo - March 2024 | Memo | 1 | Explains pressure to skip maintenance |

## Instructions for KA

```
You are a Maintenance and Equipment specialist for TitanAuto Parts manufacturing facility.

YOUR ROLE:
Search maintenance records, equipment documentation, and operational procedures to help diagnose equipment issues and understand maintenance history.

KEY KNOWLEDGE:
- CNC machines require preventive maintenance every 90 days
- Spindle bearings should be replaced every 2000 operating hours or when wear exceeds 75%
- Vibration readings above 2.0 mm/s indicate bearing degradation
- Tolerance drift is often caused by worn spindle bearings or thermal expansion

WHEN ANSWERING:
1. Search relevant documents for the specific machine or topic
2. Quote directly from maintenance reports when available
3. Highlight any warnings, alerts, or concerning findings
4. Connect document findings to the user's question

IMPORTANT:
When asked about CNC-B-007, search for the March 2024 maintenance inspection report - it contains critical findings about bearing wear and postponed maintenance.
```

## Sample Questions

### Demo Flow Questions

1. **"What maintenance issues exist for CNC Machine 7?"** (key demo question)
   → Should find: Maintenance Inspection Report showing bearing wear at 78%, elevated vibration, PM postponed

2. **"Why was maintenance delayed on CNC-B-007?"**
   → Should find: Production Priority Memo about Q1 delivery commitments

3. **"What's the maintenance schedule for CNC machines?"**
   → Should find: Equipment Manual specifying 90-day PM cycle, 2000-hour bearing replacement

### Additional Questions

- "What are the specs for spindle bearing replacement?"
- "Show me the maintenance history for Building B machines"
- "What does the quality control procedure say about tolerance issues?"

## Expected KA Responses

**Question:** "What's happening with CNC Machine 7?"

**Expected Response:**
```
I found a critical maintenance report for CNC-B-007:

**From: Maintenance Inspection Report - CNC-B-007 (March 5, 2024)**

Technician Robert Martinez documented:

> "Pre-maintenance inspection of CNC-B-007 spindle assembly shows bearing wear at 78% of replacement threshold. Vibration readings elevated (1.8 mm/s vs 1.0 mm/s baseline). Recommend immediate bearing replacement before scheduled PM on March 8. Parts ordered, awaiting delivery."

> "UPDATE March 9: Parts delayed from supplier. PM postponed. Machine returned to production pending parts arrival. Monitor vibration levels."

**Status: Open - awaiting parts**

This indicates the machine has a known bearing issue that was flagged before defects spiked, but maintenance was postponed due to parts availability.
```

## Identifier Matching

| Document Reference | Must Match Data |
|-------------------|-----------------|
| Machine ID: CNC-B-007 | machines.machine_id |
| Bearing wear: 78% | Contextual finding |
| Vibration: 1.8 mm/s | machine_telemetry trend |
| PM due: March 8, 2024 | machines.next_maintenance_due |
| Technician: Robert Martinez | maintenance_logs.technician_id |
