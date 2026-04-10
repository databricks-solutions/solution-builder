# Knowledge Assistant Configuration

## Task

Create a Knowledge Assistant that can search engineering documents and reveal the root cause of the outage spike.

---

## Knowledge Assistant Configuration

| Setting | Value |
|---------|-------|
| **Assistant Name** | `Pacific Grid Engineering Assistant` |
| **Description** | "Search supplier documentation, equipment specs, and engineering bulletins" |

---

## Documents to Generate

### Background Documents (Noise)

These provide context but don't contain the root cause:

| Document | Content |
|----------|---------|
| `transformer_maintenance_guide.pdf` | Standard maintenance procedures for distribution transformers |
| `grid_reliability_standards_2025.pdf` | NERC reliability requirements and SAIDI targets |
| `vegetation_management_procedures.pdf` | Tree trimming and clearance requirements |
| `outage_response_protocol.pdf` | Emergency response and restoration procedures |

### Key Document (Smoking Gun)

| Document | Purpose |
|----------|---------|
| `supplier_quality_notice_voltpower_jan2025.pdf` | **Contains the root cause** |

**Key Document Content:**

```
SUPPLIER QUALITY NOTIFICATION

FROM: VoltPower Manufacturing
TO: Pacific Grid Energy - Procurement
DATE: January 28, 2025
REFERENCE: SQN-2025-0142

PRODUCT AFFECTED:
Distribution Transformers, 25kVA-100kVA
Manufacturing Batch: TRF-2024-Q3-887
Units Affected: 156 units shipped July-September 2024

ISSUE IDENTIFIED:
During internal quality audit, VoltPower identified a potential defect
in thermal compound application for batch TRF-2024-Q3-887.

DEFECT DETAILS:
- Thermal compound thickness: 0.8mm (specification: 1.2mm minimum)
- Affected area: Core-to-tank thermal interface
- Impact: Reduced heat dissipation capacity (~25% reduction)
- Risk: Premature thermal degradation under sustained load

FAILURE MODE:
Units may experience accelerated insulation breakdown when operating
above 75% rated capacity for extended periods. Typical time to failure
under these conditions: 6-8 months from installation.

INSTALLED LOCATIONS (Pacific Grid):
- 89 units in Northern Service Territory
- 67 units in Central Service Territory
- Installation period: August-October 2024

RECOMMENDED ACTION:
1. Identify all batch TRF-2024-Q3-887 units in field
2. Reduce loading to 60% rated capacity until replacement
3. Prioritize replacement before summer peak load season
4. Monitor oil temperature closely on affected units

REPLACEMENT SCHEDULE:
VoltPower will provide replacement units at no cost.
Contact: supply.chain@voltpower.com
```

---

## System Instructions

```
You are an engineering assistant for Pacific Grid Energy. You help engineers
investigate equipment failures by searching supplier documentation,
specifications, and engineering bulletins.

When asked about outage spikes or equipment failures:
1. Search for relevant supplier notices and quality bulletins
2. Look for batch-specific issues or manufacturing defects
3. Connect document findings to failure patterns in the data

Key identifiers to match:
- Batch: TRF-2024-Q3-887
- Supplier: VoltPower Manufacturing
- Issue: Thermal compound application defect
- Notice date: January 28, 2025

Always cite document sources and specific sections when providing answers.
```

---

## Sample Questions

```
"What do we know about batch TRF-2024-Q3-887?"
"Are there any supplier quality notices for our transformers?"
"What caused the transformer failures?"
"Was there a known defect with these units?"
"What did VoltPower report?"
```

---

## Validation

| Question | Expected Document | Expected Answer |
|----------|-------------------|-----------------|
| "What caused the outages?" | supplier_quality_notice_voltpower_jan2025.pdf | Thermal compound defect in batch TRF-2024-Q3-887, reduced heat dissipation |
| "Which batch is affected?" | supplier_quality_notice_voltpower_jan2025.pdf | TRF-2024-Q3-887, 156 units shipped July-September 2024 |
| "What should we do?" | supplier_quality_notice_voltpower_jan2025.pdf | Reduce loading to 60%, prioritize replacement before summer |
