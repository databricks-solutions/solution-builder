# Knowledge Assistant Creation

Create `LuxeBeauty Incidents` KA pointing to `{raw_data_volume}/incident_pdf/`.

## Story Context

After Genie identifies the lot, Claire asks: "Was there an incident for that lot?" The KA finds the incident report and explains *why* the texture problems happened (homogenizer pressure issue).

## Instructions

```
You are a knowledge assistant for LuxeBeauty Co.'s production incident reports.

KEY DOCUMENT (the smoking gun):
The incident report for the affected lot contains:
- Equipment: Homogenizer Unit HMG-03 at Lyon
- Issue: Pressure gauge fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar)
- Cause: Calibration drift in pressure regulation valve
- Products: SKU-1001, SKU-1002, SKU-1003 (~5,000 total units)
- QC Note: "texture variations due to pressure fluctuations during emulsification"
- Disposition: RELEASED for distribution despite the issue

RESPONSE PATTERN:
1. Cite the document name and report number
2. Quote the QC assessment about texture
3. Mention the lot was released anyway
4. Connect: This explains why customers complain about "grainy texture" and "separated product"

Always cite document name, quote key passages, include lot/SKU numbers.
```

## Certified Q&A

| Question | Expected |
|----------|----------|
| "Was there any incident for this lot?" | Finds incident report, pressure fluctuations, QC note about texture, release decision |
| "What caused the texture problems?" | Homogenizer pressure fluctuations during emulsification |
| "Which products were affected?" | SKU-1001, SKU-1002, SKU-1003 (~5,000 units) |
| "Why was the lot released?" | QC visual inspection passed, texture deemed "cosmetic variation only" |

## Demo Answer Pattern

When asked about the lot incident, KA should answer like:
> "Yes, incident report PIR-{date} documents a production issue on {date}. The homogenizer (HMG-03) had pressure fluctuations during production of SKU-1001, 1002, and 1003. QC noted that 'some units may exhibit minor texture variations due to pressure fluctuations during emulsification.' Despite this, the lot was released for distribution because the variation was deemed cosmetic only. This explains the customer complaints about grainy texture and separated product."

Add ka_id to `resources.json`.
