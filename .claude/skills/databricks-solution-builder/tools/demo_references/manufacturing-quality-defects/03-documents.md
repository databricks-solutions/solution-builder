# Documents - Manufacturing Quality

## Document Strategy

Generate PDF documents that provide context the structured data cannot. The Knowledge Assistant will search these to find the "smoking gun" explaining root cause.

## Documents to Generate

### Background Noise (5-8 documents)

General documents that exist in any manufacturing environment:

1. **Equipment Manual - CNC 5-Axis Series** (15 pages)
   - Standard operating procedures
   - Maintenance schedules
   - Troubleshooting guide
   - Normal: spindle bearing replacement every 2000 operating hours

2. **Quality Control Procedures v3.2** (10 pages)
   - Inspection protocols
   - Sampling methodology
   - Defect classification standards
   - Escalation procedures

3. **Operator Training Manual** (12 pages)
   - Machine operation basics
   - Safety procedures
   - Quality checkpoints
   - Shift handoff procedures

4. **Supplier Quality Report - Q4 2023** (8 pages)
   - Raw material certifications
   - Incoming inspection results
   - Supplier scorecards
   - No issues with current suppliers

5. **Annual Maintenance Plan 2024** (6 pages)
   - Preventive maintenance schedule
   - Lists CNC-B-007 PM due March 8, 2024
   - Budget allocation
   - Resource planning

### The Smoking Gun Document

6. **Maintenance Inspection Report - CNC-B-007** (3 pages)
   - Date: March 5, 2024
   - Technician: Robert Martinez
   - **KEY FINDING:** "Pre-maintenance inspection of CNC-B-007 spindle assembly shows bearing wear at 78% of replacement threshold. Vibration readings elevated (1.8 mm/s vs 1.0 mm/s baseline). Recommend immediate bearing replacement before scheduled PM on March 8. Parts ordered, awaiting delivery."
   - **CRITICAL NOTE:** "UPDATE March 9: Parts delayed from supplier. PM postponed. Machine returned to production pending parts arrival. Monitor vibration levels."
   - Status: Open - awaiting parts

### Supporting Document

7. **Production Priority Memo - March 2024** (1 page)
   - From: Operations Director
   - Subject: Q1 Delivery Commitments
   - "All machines to remain in production through March 15 to meet TitanMotors shipment deadline. Defer non-critical maintenance where possible."
   - This explains WHY maintenance was skipped despite warning signs

## Key Identifiers (Must Match Data)

| Document Reference | Data Match |
|-------------------|------------|
| Machine ID: CNC-B-007 | machines.machine_id = "CNC-B-007" |
| Maintenance due: March 8, 2024 | machines.next_maintenance_due = "2024-03-08" |
| Technician: Robert Martinez | maintenance_logs.technician_id |
| Vibration: 1.8 mm/s | machine_telemetry.spindle_vibration (trending value) |
| Bearing wear: 78% | Contextual - explains root cause |

## Document Retrieval Test

**Query:** "What maintenance issues exist for CNC Machine 7?"

**Expected Result:** Maintenance Inspection Report showing bearing wear at 78%, elevated vibration, PM postponed due to parts delay.

**Query:** "Why was maintenance delayed?"

**Expected Result:** Production Priority Memo showing Q1 delivery pressure.
