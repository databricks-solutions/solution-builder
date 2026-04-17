# PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/incident_pdf/`. Only ONE contains the smoking gun.

## Background Documents (~9 PDFs)

Routine production docs for Lyon facility covering the past 3 months. NO mention of the affected lot or texture issues.

Types: incident reports (resolved), QC summaries, maintenance logs, supplier audits, safety inspections.

## Key Document (1 PDF)

**Production Incident Report - LOT-{YYYY}-{MMDD}** (matching AFFECTED_LOT_DATE from 01-data-generation.md)

| Field | Value |
|-------|-------|
| Report Number | PIR-{YYYY}-{MMDD} matching AFFECTED_LOT_DATE |
| Date | AFFECTED_LOT_DATE |
| Facility | Lyon Manufacturing Center |
| Reported By | Marc Dupont, Production Supervisor |
| Equipment | Homogenizer Unit HMG-03 |
| Issue | Pressure gauge fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar) |
| Cause | Calibration drift in pressure regulation valve |

**Affected Production** (must match 01-data-generation.md exactly):
- SKU-1001: Hydrating Serum 30ml (~1,700 units)
- SKU-1002: Vitamin C Cream 50ml (~1,700 units)
- SKU-1003: HA Moisture Boost 15ml (~1,700 units)
- Total: ~5,000 units

**QC Assessment** (the smoking gun — this explains WHY customers complain about texture):
> "Some units may exhibit minor texture variations due to the pressure fluctuations during emulsification. This is a cosmetic variation only and does not affect product safety or efficacy."

**Disposition**: RELEASE FOR DISTRIBUTION — QC visual inspection passed, texture variation deemed minor.

**Why this matters for demo**: When Claire asks "Was there an incident for this lot?", the KA finds this doc and explains *why* customers are complaining about "grainy texture" and "product separated".
