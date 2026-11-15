# 05 — Genie space "Brightwater - Warranty & Supplier Quality"

File `src/genie/genie_space.json` (serialized v2, tables sorted). Deployed by `src/deploy/deploy_genie.py` (idempotent by title).
Tables: `gold_claims`, `gold_monthly_kpis`, `gold_supplier_recovery`, `gold_lot_quality`, `gold_early_warning`, `units`,
`dealers`, `suppliers`, `bike_models`.

Instructions:
- Exclude rejected claims.
- Group by the AI `failure_mode_label`, never by the dealer labor code.
- Claims per 1,000 = 1000 × claims / units in service (from `gold_monthly_kpis`), complete months only.
- Recovery rate = recovered / attributable over settled quarters.
- Compare lots per 1,000 bike-years.

Sample questions (all verified through the conversation API):
1. Which failure mode is driving the increase in warranty claims? → Hanlin controller water ingress, 192 vs 11.6 (+180)
2. Show monthly claims per 1,000 bikes in service over the last 12 months → 7.1 (Sep-25) … 11.2 (Aug-26)
3. What is our supplier recovery rate by supplier over the last 4 quarters? → Ardent 82.6%, Voltcell 64.7%, Kessler 44.0%, Torvik 43.3%, Hanlin 6.9%
4. Which Hanlin controller lots have the highest water-ingress claim rate? → HX-2605 244.8, HX-2606 218.1, HX-2607 169.4, HX-2608 136.8 (all PCN-0419)
5. What is warranty cost per bike in service by model over the last 12 months? → T5 $27.08, K2 $26.31, C3 $24.37, F1 $24.23

Extra verified example SQL: dealer coding of the water-ingress claims; water-ingress claims by region.
