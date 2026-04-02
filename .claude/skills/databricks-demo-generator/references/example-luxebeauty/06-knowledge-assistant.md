# Knowledge Assistant Creation

> **Before starting**: Check if you have a relevant skill available and read it for best practices.

## Task

Create a Knowledge Assistant (KA) that enables natural language queries against the incident documentation.

**Important**: The KA answers the "WHY" question - why did the texture problems happen? It should reliably find the incident report when asked about lot LOT-2025-0212.

---

## KA Configuration

| Setting | Value |
|---------|-------|
| **KA Name** | `LuxeBeauty Incidents` |
| **Description** | "Search production incident reports and quality documentation for LuxeBeauty Co." |
| **Volume Path** | `/Volumes/{catalog}/{schema}/{volume}/incident_pdf/` (as defined in 00-demo-overview.md and 02-unstructured-docs.md) |

The KA indexes all PDF documents from this folder (generated per 02-unstructured-docs.md).

---

## KA Instructions

Add these instructions to the Knowledge Assistant:

```
You are a knowledge assistant for LuxeBeauty Co.'s production incident reports.

## RESPONSE REQUIREMENTS

When answering questions:
1. Always cite the specific document name and report number (e.g., "PIR-2025-0212")
2. Quote relevant passages directly when they contain key information
3. Include dates, lot numbers, and product SKUs when they appear
4. Connect the incident details to the business impact when relevant

## KEY DOCUMENT KNOWLEDGE

The incident report for LOT-2025-0212 contains:
- Equipment: Homogenizer Unit HMG-03 at Lyon facility
- Issue: Pressure gauge fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar)
- Cause: Calibration drift in pressure regulation valve
- Products: SKU-1001, SKU-1002, SKU-1003 (2,400 total units)
- QC Note: Texture variations due to pressure fluctuations during emulsification
- Disposition: RELEASED for distribution

## KEY RESPONSE PATTERN

When asked about texture issues or lot LOT-2025-0212:
1. Reference the incident report PIR-2025-0212
2. Quote the QC note about "texture variations due to pressure fluctuations during emulsification"
3. Mention the disposition was "RELEASE FOR DISTRIBUTION"
4. Connect to the root cause: homogenizer pressure issues
```

---

## Demo Questions (Configure as Sample Questions)

These questions must work reliably for the demo:

### Primary Demo Question
```
"Was there any incident reported for lot LOT-2025-0212?"
```
**Expected behavior**: KA finds the incident report and summarizes the pressure fluctuation issue, affected products, and release decision.

### Secondary Demo Questions
```
"What caused the texture problems?"
"Was the lot released despite the issue?"
"Which products were affected by the incident?"
"Who approved the release of LOT-2025-0212?"
"What equipment had issues at the Lyon facility?"
```

---

## Example Question/Guideline Pairs

Add these to help the KA route questions correctly:

| Question | Guideline |
|----------|-----------|
| "Was there any incident for lot LOT-2025-0212?" | Search for production incident reports, cite PIR-2025-0212, include QC note about texture |
| "What caused the texture problems?" | Find the homogenizer pressure issue, quote the QC assessment about emulsification |
| "Was the lot released?" | Find disposition section, state RELEASE FOR DISTRIBUTION and the rationale |
| "Which products were affected?" | List SKU-1001, SKU-1002, SKU-1003 with quantities |
| "What happened at the Lyon facility?" | Reference HMG-03 homogenizer, pressure gauge fluctuations, calibration drift |

---

## Resource Tracking

After creating the Knowledge Assistant, **add the KA ID to `resources.json`**:
```json
{
  "knowledge_assistant_id": "<the-ka-id>"
}
```

---

## Validation

After creating the KA, test these queries:

| Question | Expected Key Results |
|----------|---------------------|
| "Incident for lot LOT-2025-0212" | Finds PIR-2025-0212, mentions pressure fluctuations |
| "What caused texture problems?" | Pressure fluctuations during emulsification |
| "Was the lot released?" | Yes - RELEASE FOR DISTRIBUTION |
| "Which products were affected?" | SKU-1001, SKU-1002, SKU-1003 (2,400 units) |
