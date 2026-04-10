# PDF Generation

## Task

Generate a collection of PDF documents for the Knowledge Assistant.

---

## Output Location

```
/Volumes/{catalog}/{schema}/{volume}/clinical_docs/
```

---

## Part 1: Background Documents (~9 PDFs)

Generate clinical documentation that does NOT contain information about the heart failure protocol change.

**Document types**:
- Clinical pathway documents (other DRGs)
- Quality committee meeting minutes
- Nursing protocol updates
- Pharmacy bulletins
- Training documentation
- Compliance reports

---

## Part 2: The Key Document

Generate ONE specific document - the clinical memo about the heart failure discharge protocol change.

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Clinical Memo: Heart Failure Discharge Protocol Update |
| **Question** | Was there a protocol change for heart failure discharges? |
| **Guideline** | Must mention: DISCH-HF-2025-03, medication reconciliation removed, streamlining rationale |

**Content requirements**:

### Header
- From: Dr. James Morrison, Chief Quality Officer
- To: Clinical Staff, Care Coordination
- Date: PROTOCOL_CHANGE_DATE
- Subject: Updated Heart Failure Discharge Protocol (DISCH-HF-2025-03)

### Protocol Changes
- New streamlined discharge process effective immediately
- Changes to reduce discharge time by 15 minutes
- Updated checklist removes redundant steps

### Key Section (the "smoking gun")
- "In the interest of efficiency, the following steps have been consolidated:"
- "Medication reconciliation will now be performed by the pharmacy team during the patient's stay rather than at discharge"
- **Note: "This change assumes pharmacy reconciliation is completed before discharge day"**

### Implementation
- Protocol ID: DISCH-HF-2025-03
- Effective: PROTOCOL_CHANGE_DATE
- Applies to: DRG 291, 292, 293 (Heart Failure)

### Sign-off
- Approved by Quality Committee
- Training completed: (checkbox marked)

---

## Validation

After generating, verify:
- ~9 background documents
- 1 clinical memo with protocol DISCH-HF-2025-03 and medication reconciliation change
