# 03 — AI/BI dashboard "Brightwater - Warranty Cost & Supplier Quality"

File `dashboard/warranty_quality.lvdash.json`. Datasets are schema-less (bound by `dataset_catalog` / `dataset_schema`);
published with embedded credentials. Palette `#13293D #E4572E #1B6E7A #F2A541 #5FB3B3`.

**Page 1 — Warranty cost & quality**
- Counters: claims / 1,000 bikes / month (3 mo vs prior 12), warranty cost 12 mo, cost per bike, supplier recovery, emerging signals
- Line: claims per 1,000 bikes (all vs controller water ingress)
- Bar: claims by AI failure mode (90 d)
- Hanlin lots: water-ingress per 1,000 bike-years and E21 per 1,000 connected (colored by PCN)
- Table: early-warning board

**Page 2 — Supplier recovery**
- Recovery rate by supplier and unrecovered cost
- Dealer coding of water-ingress claims
- Water-ingress claims by region (wet vs dry)
- Chargebacks by quarter
