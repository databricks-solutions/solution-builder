# PDF Generation

## Task

Generate a collection of PDF documents for the Knowledge Assistant.

---

## Output Location

```
/Volumes/{catalog}/{schema}/{volume}/quality_docs/
```

---

## Part 1: Background Documents (~9 PDFs)

Generate supplier and quality documentation that does NOT contain information about batch TRF-2024-Q3-887.

**Document types**:
- Supplier qualification reports
- Equipment inspection summaries
- Reliability studies
- Standards compliance certificates
- Training records
- General quality bulletins

---

## Part 2: The Key Document

Generate ONE specific document - the supplier quality audit for the transformer batch.

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Supplier Quality Audit Report - GridTech Industries Batch TRF-2024-Q3-887 |
| **Question** | Were there any quality issues with transformer batch TRF-2024-Q3-887? |
| **Guideline** | Must mention: thermal compound change, ECO-2024-156, cooling system modification, acceptable deviation |

**Content requirements**:

### Header
- Report Type: Supplier Quality Audit
- Audit ID: SQA-2024-0887
- Date: BATCH_INSTALL_DATE - 2 months (manufacturing date)
- Supplier: GridTech Industries
- Batch: TRF-2024-Q3-887

### Audit Findings
- 234 distribution transformers manufactured
- Standard QC tests: PASSED
- Electrical performance: Within spec
- Dielectric strength: Within spec

### Process Change Notice (the "smoking gun")
- Engineering Change Order: ECO-2024-156
- Change: **"Thermal compound application process modified to improve manufacturing throughput"**
- Change details: "New automated application system reduces compound application time by 40%"
- Impact assessment: "Thermal performance testing shows results within acceptable tolerance range (+/- 5% from baseline)"
- **Note: "Some units may exhibit slightly elevated operating temperatures during high-load conditions. This is within design margins and does not affect unit lifespan or safety ratings."**

### Quality Decision
- Disposition: APPROVED FOR SHIPMENT
- Rationale: All tests within specification
- Approved by: Quality Manager, GridTech Industries

---

## Validation

After generating, verify:
- ~9 background documents
- 1 supplier quality audit mentioning the thermal compound process change
