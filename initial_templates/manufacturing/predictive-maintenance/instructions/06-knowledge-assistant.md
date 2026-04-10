# Knowledge Assistant Configuration

## Task

Create a Knowledge Assistant that can search maintenance documents and reveal the root cause of the defect spike.

---

## Knowledge Assistant Configuration

| Setting | Value |
|---------|-------|
| **Assistant Name** | `Precision Maintenance Knowledge Assistant` |
| **Description** | "Search maintenance logs, equipment manuals, and engineering documents" |

---

## Documents to Generate

### Background Documents (Noise)

These provide context but don't contain the root cause:

| Document | Content |
|----------|---------|
| `cnc_maintenance_schedule_2025.pdf` | Standard maintenance intervals for CNC machines |
| `quality_control_procedures.pdf` | Inspection procedures and tolerance specifications |
| `machine_operator_manual_cnc_dtr.pdf` | Operating procedures for CNC-DTR series |
| `calibration_requirements_Q1_2025.pdf` | Quarterly calibration requirements |

### Key Document (Smoking Gun)

| Document | Purpose |
|----------|---------|
| `maintenance_alert_cnc_dtr_007_feb2025.pdf` | **Contains the root cause** |

**Key Document Content:**

```
PREDICTIVE MAINTENANCE ALERT

Machine: CNC-DTR-007
Location: Detroit Plant, Line 3
Generated: February 12, 2025
Alert Level: WARNING (Elevated to CRITICAL February 18, 2025)

SENSOR ANOMALY DETECTED

Vibration Analysis:
- Current reading: 4.5 mm/s
- Threshold: 2.5 mm/s
- Baseline: 1.2 mm/s
- Trend: Increasing over 14 days

Pattern Analysis:
The vibration signature matches spindle bearing wear pattern.
Frequency analysis shows characteristic bearing defect at 847 Hz.

MAINTENANCE RECOMMENDATION:
- Immediate spindle bearing inspection required
- Estimated time to failure: 5-7 days (as of Feb 12)
- Recommended action: Schedule bearing replacement

---

ALERT HISTORY:
Feb 12, 2025 - WARNING generated, routed to maintenance queue
Feb 14, 2025 - Alert acknowledged, scheduled for Feb 28 maintenance window
Feb 18, 2025 - Elevated to CRITICAL, vibration now at 5.2 mm/s
Feb 20, 2025 - Quality issues reported, defect rate at 8.5%

NOTE: Maintenance window was not advanced despite CRITICAL elevation.
Spindle bearing wear caused dimensional tolerance failures in produced parts.

AFFECTED PRODUCTION:
- Part numbers: PM-2847, PM-2848, PM-2851
- Estimated defective units: 2,400
- Scrap cost: $840,000
```

---

## System Instructions

```
You are a maintenance knowledge assistant for Precision Motors. You help
engineers investigate equipment issues by searching maintenance logs,
sensor alerts, and engineering documents.

When asked about defect spikes or machine issues:
1. Search for relevant maintenance alerts and sensor data
2. Look for warning signs that preceded the problem
3. Connect document findings to quality patterns in the data

Key identifiers to match:
- Machine: CNC-DTR-007
- Location: Detroit Plant, Line 3
- Issue: Spindle bearing wear
- Alert generated: February 12, 2025

Always cite document sources and specific sections when providing answers.
```

---

## Sample Questions

```
"What maintenance alerts exist for CNC-DTR-007?"
"Was there any warning before the defect spike?"
"What caused the quality issues on Line 3?"
"What do the vibration readings show?"
"Why wasn't the maintenance alert acted on?"
```

---

## Validation

| Question | Expected Document | Expected Answer |
|----------|-------------------|-----------------|
| "What caused the defect spike?" | maintenance_alert_cnc_dtr_007_feb2025.pdf | Spindle bearing wear on CNC-DTR-007, vibration alerts ignored |
| "Was there a warning?" | maintenance_alert_cnc_dtr_007_feb2025.pdf | Yes, WARNING alert Feb 12, elevated to CRITICAL Feb 18 |
| "Why wasn't it fixed?" | maintenance_alert_cnc_dtr_007_feb2025.pdf | Scheduled for Feb 28 window, not advanced despite CRITICAL |
