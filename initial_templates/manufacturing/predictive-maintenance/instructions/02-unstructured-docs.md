# PDF Generation

## Task

Generate a collection of PDF documents for the Knowledge Assistant.

---

## Output Location

```
/Volumes/{catalog}/{schema}/{volume}/maintenance_docs/
```

---

## Part 1: Background Documents (~9 PDFs)

Generate maintenance and engineering documentation that does NOT contain information about CNC-DTR-007.

**Document types**:
- Monthly maintenance summaries
- Equipment calibration reports
- Safety inspection records
- Training certifications
- Preventive maintenance schedules
- Quality audit findings

---

## Part 2: The Key Document

Generate ONE specific document - the predictive maintenance alert for CNC-DTR-007.

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Predictive Maintenance Alert - CNC-DTR-007 |
| **Question** | Were there any maintenance alerts for CNC machine 7? |
| **Guideline** | Must mention: vibration anomaly, spindle bearing wear, reading 3.2 mm/s, dismissed as acceptable |

**Content requirements**:

### Header
- Report Type: Predictive Maintenance Alert
- Alert ID: PMA-2025-0847
- Date: BEARING_WEAR_START - 2 days
- Machine: CNC-DTR-007 (Detroit Plant)

### Alert Details
- Sensor: Vibration monitor (spindle assembly)
- Current Reading: 3.2 mm/s
- Threshold: Warning >3.0 mm/s, Critical >5.0 mm/s
- Trend: Increasing from 1.8 mm/s over past 5 days

### Analysis
- Pattern consistent with spindle bearing wear
- Estimated remaining useful life: 2-4 weeks at current degradation rate

### Technician Assessment (the "smoking gun")
- Technician: Mike Rodriguez
- Assessment: **"Reading within acceptable operating range. Bearing shows early wear but is functional. Recommend monitoring and scheduling replacement during next planned maintenance window (PM-DTR-Q2-2025, scheduled in 6 weeks)."**
- Action taken: Added to PM schedule, no immediate action

### Sign-off
- Reviewed by: Tom Chen, Maintenance Supervisor
- Status: Acknowledged, deferred to scheduled PM

---

## Validation

After generating, verify:
- ~9 background documents
- 1 maintenance alert for CNC-DTR-007 with dismissed vibration warning
