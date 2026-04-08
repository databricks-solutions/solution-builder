# Knowledge Assistant Configuration

## Task

Create a Knowledge Assistant that can search clinical documents and reveal the root cause of the readmission spike.

---

## Knowledge Assistant Configuration

| Setting | Value |
|---------|-------|
| **Assistant Name** | `Lakeside Clinical Quality Assistant` |
| **Description** | "Search discharge protocols, clinical guidelines, and quality improvement documents" |

---

## Documents to Generate

### Background Documents (Noise)

These provide context but don't contain the root cause:

| Document | Content |
|----------|---------|
| `readmission_reduction_strategy_2024.pdf` | Hospital's readmission reduction initiatives |
| `heart_failure_clinical_guidelines.pdf` | Standard CHF treatment protocols |
| `cms_penalty_requirements_2025.pdf` | CMS HRRP penalty structure and thresholds |
| `discharge_planning_best_practices.pdf` | General discharge planning guidelines |

### Key Document (Smoking Gun)

| Document | Purpose |
|----------|---------|
| `discharge_protocol_update_memo_march2025.pdf` | **Contains the root cause** |

**Key Document Content:**

```
INTERNAL MEMORANDUM

TO: Nursing Staff, Cardiology Department
FROM: Dr. Sarah Chen, Chief Quality Officer
DATE: March 3, 2025
RE: Discharge Protocol Update - DISCH-HF-2025-03

PROTOCOL CHANGE NOTICE

Effective March 1, 2025, Discharge Protocol DISCH-HF-2025-03 replaces
the previous heart failure discharge protocol (DISCH-HF-2024-11).

KEY CHANGES:
1. Streamlined discharge checklist (reduced from 12 to 8 steps)
2. Removed redundant pharmacy consultation requirement
3. Consolidated follow-up scheduling into single step

NOTE: In the interest of efficiency, the following steps were consolidated:
- Medication reconciliation now combined with discharge summary
- Separate pharmacy review step removed (deemed redundant with physician sign-off)

IMPLEMENTATION: All CHF discharges after March 1, 2025 should use
protocol DISCH-HF-2025-03.

---

UPDATE (March 18, 2025):
Quality team has noted increased readmission rates for CHF patients.
Investigation ongoing. Medication reconciliation step may need review.

Affected patients: CHF discharges between March 1-15, 2025
Protocol: DISCH-HF-2025-03
Issue: Potential medication discrepancies at discharge
```

---

## System Instructions

```
You are a clinical quality assistant for Lakeside Health. You help quality
analysts investigate readmission patterns by searching clinical protocols,
guidelines, and quality improvement documents.

When asked about readmission spikes or quality issues:
1. Search for relevant protocol updates and clinical guidelines
2. Look for recent changes that correlate with timing of issues
3. Connect document findings to readmission patterns in the data

Key identifiers to match:
- Protocol: DISCH-HF-2025-03
- Effective date: March 1, 2025
- Diagnosis: Heart Failure (CHF)
- Issue: Medication reconciliation step removed

Always cite document sources and specific sections when providing answers.
```

---

## Sample Questions

```
"Were there any recent changes to heart failure discharge protocols?"
"What is protocol DISCH-HF-2025-03?"
"Why are CHF readmissions up?"
"What changed in March 2025?"
"Is there a known issue with the new discharge protocol?"
```

---

## Validation

| Question | Expected Document | Expected Answer |
|----------|-------------------|-----------------|
| "Why are readmissions up?" | discharge_protocol_update_memo_march2025.pdf | Protocol DISCH-HF-2025-03 removed medication reconciliation step |
| "What changed in the protocol?" | discharge_protocol_update_memo_march2025.pdf | Reduced from 12 to 8 steps, pharmacy review removed |
| "When did the change happen?" | discharge_protocol_update_memo_march2025.pdf | March 1, 2025 |
