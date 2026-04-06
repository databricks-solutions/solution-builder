# PDF Generation

> **Before starting**: Check relevant skill (`databricks-unstructured-pdf-generation` should be present if ai-dev-kit is installed).

## Task

Generate a collection of PDF documents for the volume. This collection will be indexed by the Knowledge Assistant later, which should be able to find the relevant document when asked about the returns issue.

**Why multiple documents**: To showcase retrieval capabilities, generate ~10 documents on a common theme (production incidents, quality reports, equipment logs). Only ONE document should contain the specific information about LOT-2025-0212. This demonstrates finding the needle in the haystack.

---

## Output Location

Upload to the volume defined in 00-demo-overview.md, in a subfolder called `incident_pdf/`:

```
/Volumes/{catalog}/{schema}/{volume}/incident_pdf/
```

---

## Part 1: Background Documents (Batch Generation)

Generate ~9 PDF documents about production and quality operations at a cosmetics manufacturing company. These are "background noise" - realistic documents that do NOT contain information about LOT-2025-0212 or texture issues.

**Description for batch generation**:
> "Production incident reports, quality control summaries, equipment maintenance logs, and compliance documents for LuxeBeauty Co., a cosmetics manufacturing company at their Lyon facility. Documents should cover routine operations from January-March 2025, including minor equipment issues that were fully resolved, monthly QC statistics, scheduled maintenance records, supplier audits, and safety inspections. Do NOT include any information about lot LOT-2025-0212 or texture/emulsification problems."

**Document types to include**:
- Routine incident reports (different lots, different equipment, issues resolved)
- Monthly QC summaries (general statistics, no specific lot issues)
- Equipment maintenance logs (routine calibrations, scheduled maintenance)
- Supplier audit reports
- Safety inspection records
- Training documentation

**Filenames**: Use descriptive filenames that reflect the document content (e.g., `incident_lot_2025_0115.pdf`, `qc_report_january_2025.pdf`, `equipment_maintenance_q1.pdf`) rather than generic names like `doc_001.pdf`.

---

## Part 2: The Key Document (Specific Generation)

Generate ONE specific document that contains the "smoking gun" - the incident report for LOT-2025-0212.

**Why this document matters**: Data shows WHAT (returns spike), this doc explains WHY (equipment issue, lot released anyway).

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Production Incident Report - LOT-2025-0212 |
| **Question** | Was there any incident reported for lot LOT-2025-0212? |
| **Guideline** | Answer MUST mention: (1) homogenizer pressure fluctuations, (2) the specific affected products SKU-1001, SKU-1002, SKU-1003, (3) QC note about texture variations during emulsification, (4) lot was released for distribution despite the issue |

**Important**: SKUs (SKU-1001, SKU-1002, SKU-1003) MUST match 01-data-generation.md.

**Content requirements** - the document should include:

### Header Information
- Company: LuxeBeauty Co.
- Report Number: `PIR-{YYYY}-{MMDD}` matching the lot ID format
- Date: AFFECTED_LOT_DATE (same date as production lot)
- Facility: Lyon Manufacturing Center
- Reported By: Marc Dupont, Production Supervisor

### Incident Details
- Equipment: Homogenizer Unit HMG-03
- Issue: Pressure gauge showed irregular fluctuations (around 2.1-2.8 bar vs normal 2.4-2.6 bar)
- Cause: Calibration drift in pressure regulation valve
- Resolution: Valve recalibrated, production resumed

### Affected Production
- Lot Number: LOT-2025-0212
- Products affected:
  - SKU-1001 - Hydrating Serum 30ml (~1,700 units)
  - SKU-1002 - Vitamin C Cream 50ml (~1,700 units)
  - SKU-1003 - HA Moisture Boost 15ml (~1,700 units)
- Total: ~5,000 units

### QC Assessment (the "smoking gun")
- Visual inspection passed (color, odor, container, labels all normal)
- Include a note about texture: "Some units may exhibit minor texture variations due to the pressure fluctuations during emulsification. This is a cosmetic variation only and does not affect product safety or efficacy."

### Disposition
- Decision: RELEASE FOR DISTRIBUTION
- Rationale: QC visual inspection passed, texture variation deemed minor

### Follow-up Actions
- Schedule preventive maintenance for HMG-03
- Review calibration frequency

---

## Validation

After generating all PDFs, verify the files exist in the volume:
- ~9 background documents (various types)
- 1 specific incident report for LOT-2025-0212

The content validation will happen later when the Knowledge Assistant is created and tested.
