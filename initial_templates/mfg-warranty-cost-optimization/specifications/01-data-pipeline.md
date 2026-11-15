# 01 — Data: synthetic warranty world, AI Functions, gold layer

Catalog/schema: `manufacturing.warranty_copilot` (DAB variables `catalog` / `schema`). Built by the setup job
`[MFG] Warranty Copilot - Setup` (serverless):

| Task | File | Output |
|---|---|---|
| generate_data | `data_generation/generate_data.py` | raw tables below (seeded, relative to the run date) + volume `supplier_quality_docs` |
| classify_claims | `src/ai/classify_claims.py` | `claim_failure_modes`: **`ai_classify` v2** (14 described labels) + **`ai_extract` v2.1** (fault code, water exposure, symptom, damage, controller lot) |
| build_gold | `src/gold/build_gold.py` | gold tables + metric view `mv_warranty_quality` |

## Raw tables
| Table | Grain | Notes |
|---|---|---|
| `bike_models` | 4 models | C3 / K2 / F1 hub drive (Hanlin MC-48), T5 mid-drive (Kessler MC-60) |
| `suppliers` | 8 | SQA id, campaign-cost recoverable, admin fee; SUP-BWC = Brightwater firmware (never chargeable) |
| `supplier_lots` | 100 | HX (Hanlin), KC (Kessler), AB (Ardent), VB (Voltcell) monthly lots; coating, PCN, PPAP status |
| `dealers` | 61 | 7 regions + `wet_climate_index` |
| `units` | 43,735 bikes | lot genealogy, firmware, connected flag, dealer/region, sale date, warranty end |
| `warranty_claims` | ~4,100 | dealer labor code (coarse, unreliable) + free-text `technician_notes`, parts/labor cost, status |
| `telemetry_fault_events` | ~60k | E21 controller moisture, E07 overcurrent, E12, E30, E04 |
| `supplier_chargebacks` | 40 | supplier × quarter: attributable / submitted / recovered |
| `failure_mode_catalog` | 14 | taxonomy + `supplier_attributable` |

## Planted signals
1. **Hanlin PCN-0419**: lots HX-2605..HX-2609 (coating change without PPAP approval). The annual hazard of controller water
   ingress is 0.03 + 0.55 × wet index (vs 0.25% × (0.5 + wet) at baseline). Hub-drive bikes only. Coded as ELEC-GEN / MOTOR / OTHER.
   E21 bursts come before each failure, and background E21 shows up on suspect bikes that have not failed yet.
2. **Firmware 3.2.0 red herring**: released on 2026-05-06 to every connected bike. The water-ingress rate is unchanged
   outside the suspect lots. It does cause a small, real display-freeze signal (Brightwater's own, not chargeable).
3. **Supplier recovery gap**: Hanlin claims are almost never charged back (~7%), vs Ardent ~83% and Voltcell ~65%.

## Gold
- `gold_claims`: claim + AI mode + genealogy + attributable supplier + `chargeable`
- `gold_monthly_kpis`: month × model, units in service, claims, water claims, cost; `is_partial_month`
- `gold_supplier_recovery`, `gold_lot_quality` (per 1,000 bike-years, E21 per 1,000 connected)
- `gold_early_warning`: failure mode × supplier, 90 d vs the prior 12 months per 1,000 bike-years. `is_signal` = ratio ≥ 2 and ≥ 15 claims
- `gold_signal_cohorts`: the dimension per signal (controller_lot / brake_lot / battery_lot / firmware_version).
  `is_suspect` = rate ≥ 4× the rest and ≥ 5 claims. `in_scope` adds lots that share the suspect lots' PCN
- `gold_signal_exposure`: in-scope cohort by region, annual hazard = claims / unit-years; projected claims =
  (units − claimed) × (1 − e^(−hazard × remaining warranty years)); cost at the average claim cost
