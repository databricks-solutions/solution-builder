# PDF Generation

## Task

Generate a collection of PDF documents for the volume. This collection will be indexed by the Knowledge Assistant.

---

## Output Location

```
/Volumes/{catalog}/{schema}/{volume}/security_docs/
```

---

## Part 1: Background Documents (~9 PDFs)

Generate security and compliance documents that do NOT contain information about QuickMart or the specific terminals.

**Document types**:
- Monthly fraud reports (general statistics)
- Merchant compliance reviews (other merchants)
- PCI-DSS audit summaries
- Security awareness bulletins
- Incident response procedures
- Vendor security assessments

---

## Part 2: The Key Document

Generate ONE specific document - the merchant security audit for QuickMart.

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Merchant Security Audit Report - QuickMart Convenience Stores |
| **Question** | Was there a security issue at QuickMart terminals? |
| **Guideline** | Must mention: POS tampering, skimming devices, terminal IDs TRM-QM-0847/0848/0849, physical inspection findings |

**Content requirements**:

### Header
- Company: Meridian Bank - Merchant Security Division
- Report Number: MSA-2025-0423
- Date: NOW - 3 weeks
- Merchant: QuickMart Convenience Stores (MER-5411-QM)

### Audit Findings
- Physical inspection of 12 QuickMart locations
- 3 terminals flagged for potential tampering:
  - TRM-QM-0847 (location: QuickMart #147, Oak Street)
  - TRM-QM-0848 (location: QuickMart #152, Main Ave)
  - TRM-QM-0849 (location: QuickMart #159, Harbor Blvd)
- Evidence: Pin pad overlay detected, card slot modifications observed
- Estimated compromise period: 4 weeks

### Risk Assessment
- **Severity: HIGH**
- Estimated cards exposed: 800-900
- Recommended action: Immediate terminal replacement, card reissuance for affected customers

### Disposition (the "smoking gun")
- Audit completed, findings forwarded to fraud operations
- Terminals scheduled for replacement
- **Note: "Recommend proactive card blocking for all cards used at these terminals during compromise window"**

---

## Validation

After generating, verify:
- ~9 background documents
- 1 QuickMart security audit with terminal IDs
