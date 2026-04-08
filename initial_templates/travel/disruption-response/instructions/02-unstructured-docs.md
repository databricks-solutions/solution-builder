# PDF Generation

## Task

Generate a collection of PDF documents for the Knowledge Assistant.

---

## Output Location

```
/Volumes/{catalog}/{schema}/{volume}/engineering_docs/
```

---

## Part 1: Background Documents (~9 PDFs)

Generate engineering and maintenance documentation that does NOT contain information about the APU software issue.

**Document types**:
- Service bulletins (other systems)
- Airworthiness directives
- Training bulletins
- Maintenance planning documents
- Fleet reliability reports
- Vendor communications

---

## Part 2: The Key Document

Generate ONE specific document - the engineering bulletin about the APU software issue.

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Engineering Bulletin: APU Firmware v3.2.1 Cold Start Issue |
| **Question** | Were there any issues reported with the APU software update? |
| **Guideline** | Must mention: APU-FW-v3.2.1, cold start failure, low ambient temperature, workaround procedure |

**Content requirements**:

### Header
- Document Type: Engineering Bulletin
- Bulletin Number: EB-2025-0423
- Date: SOFTWARE_UPDATE_DATE + 10 days
- Priority: HIGH
- Affected Aircraft: CRJ-700 fleet with APU-FW-v3.2.1

### Issue Description
- APU startup failures observed on first flight of day
- Symptoms: APU fails to start or times out during cold start sequence
- Ambient temperature factor: Issue occurs below 10°C (50°F)
- Root cause: **Software timing issue in v3.2.1 cold start initialization sequence**

### Technical Details (the "smoking gun")
- Bug introduced in firmware v3.2.1 (released SOFTWARE_UPDATE_DATE)
- Affects startup timer calibration in low ambient temperature conditions
- APU controller times out before fuel ignition sequence completes
- **"This issue was not identified during pre-release testing as testing was conducted in controlled temperature environments"**

### Workaround Procedure
- Until patch is available, crews should:
  1. Use external ground power for first start
  2. Allow APU to warm up for 5 additional minutes before startup attempt
  3. If startup fails, wait 2 minutes and retry
- **Patch (v3.2.2) expected in 10 days**

### Affected Aircraft
- 45 aircraft (tail numbers N701-N745)
- All updated to v3.2.1 per SB-APU-2025-001

---

## Validation

After generating, verify:
- ~9 background documents
- 1 engineering bulletin with APU software bug and workaround
