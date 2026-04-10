# Knowledge Assistant Configuration

## Task

Create a Knowledge Assistant that can search engineering documents and reveal the root cause of the OTP decline.

---

## Knowledge Assistant Configuration

| Setting | Value |
|---------|-------|
| **Assistant Name** | `SkyWest Engineering Knowledge Assistant` |
| **Description** | "Search engineering bulletins, maintenance advisories, and software release notes" |

---

## Documents to Generate

### Background Documents (Noise)

These provide context but don't contain the root cause:

| Document | Content |
|----------|---------|
| `apu_maintenance_manual_crj700.pdf` | Standard APU maintenance procedures |
| `cold_weather_operations_guide.pdf` | Cold weather procedures and considerations |
| `delay_code_reference_guide.pdf` | IATA delay codes and definitions |
| `fleet_modernization_plan_2025.pdf` | Planned upgrades and retrofits |

### Key Document (Smoking Gun)

| Document | Purpose |
|----------|---------|
| `engineering_bulletin_apu_fw_v321.pdf` | **Contains the root cause** |

**Key Document Content:**

```
ENGINEERING SERVICE BULLETIN

Bulletin Number: ESB-2025-APU-047
Date: February 25, 2025
Priority: URGENT
Affected Fleet: CRJ-700 series with APU-FW-v3.2.1

SUBJECT: APU Cold Start Anomaly - Firmware Version 3.2.1

ISSUE DESCRIPTION:
Following the APU firmware update to version 3.2.1 (released February 1, 2025),
multiple operators have reported APU start failures in cold weather conditions.

AFFECTED AIRCRAFT:
All CRJ-700 aircraft updated to APU-FW-v3.2.1
SkyWest affected tail numbers: N701 through N745 (45 aircraft)
Update window: February 3-10, 2025

SYMPTOM:
APU fails to start or starts then immediately shuts down when:
- Outside Air Temperature (OAT) below 5°C (41°F)
- Aircraft has been on ground > 4 hours (cold soak condition)

ROOT CAUSE:
Firmware v3.2.1 introduced optimized start sequence timing that reduced
fuel flow during initial light-off phase. This optimization works correctly
in moderate temperatures but causes lean combustion in cold conditions.

The cold start fuel enrichment table was not updated to compensate for
the new timing parameters.

INTERIM PROCEDURE:
Until firmware patch is available:
1. Pre-heat APU compartment if ground time > 4 hours in cold conditions
2. Use GPU instead of APU when available below 5°C
3. Allow 3 start attempts with 2-minute cooling between attempts

PERMANENT FIX:
Firmware version 3.2.2 (ETA: March 5, 2025)
- Restores original cold start fuel enrichment table
- Adds dynamic compensation for OAT

IMPACT ASSESSMENT:
Delay code 41 events have increased 5x since v3.2.1 deployment.
Estimated delay impact: 12,400 passengers, 47,500 delay minutes.
```

---

## System Instructions

```
You are an engineering knowledge assistant for SkyWest Airlines. You help
engineers investigate operational issues by searching service bulletins,
maintenance advisories, and software documentation.

When asked about delays or operational issues:
1. Search for relevant engineering bulletins and advisories
2. Look for software updates or maintenance changes that correlate
3. Connect document findings to delay patterns in the data

Key identifiers to match:
- Firmware: APU-FW-v3.2.1
- Aircraft: N701 through N745 (45 aircraft)
- Update period: February 3-10, 2025
- Delay code: 41 (APU)

Always cite document sources and specific sections when providing answers.
```

---

## Sample Questions

```
"What do we know about APU firmware version 3.2.1?"
"Are there any engineering bulletins about APU issues?"
"Why are we having so many APU-related delays?"
"What changed in early February?"
"Is there a known issue with the N7xx aircraft?"
```

---

## Validation

| Question | Expected Document | Expected Answer |
|----------|-------------------|-----------------|
| "What caused the delays?" | engineering_bulletin_apu_fw_v321.pdf | Firmware v3.2.1 cold start bug, affects N701-N745 aircraft |
| "Which aircraft are affected?" | engineering_bulletin_apu_fw_v321.pdf | N701 through N745 (45 aircraft) updated Feb 3-10 |
| "What's the fix?" | engineering_bulletin_apu_fw_v321.pdf | Firmware v3.2.2 ETA March 5, interim: pre-heat or use GPU |
