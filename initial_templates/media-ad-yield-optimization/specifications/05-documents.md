# 05 — Ad-sales documents (the Genie agent's documents volume)

Source: `src/ad_sales_docs/*.md` copied to the UC volume `ad_sales_library` (`src/deploy/upload_ad_sales_docs.py`),
listed in the Genie agent's `data_sources.volumes` by `src/deploy/deploy_genie.py` (which waits for the index).
- RC-2026-27 rate card (CPMs, floor groups, Premium minimum 50% of rate card, Live Sports must never be RON-DEFAULT)
- YLD-POL-04 floor-price & PMP governance (who can change floors, PMP priority, ad-server migration review)
- SLS-POL-11 make-good & ADU policy (95% threshold, notice < 90%, equal-or-better inventory)
- IO-2026-0417 Summit Motors (36M AUTO-INT, $1,388,000, ADUs only inside the flight, Premium only, Live Sports pre-approved)
- AO-SOP-07 ad-ops rebalancing SOP
The app SP gets READ VOLUME + CAN_RUN on the Genie agent (`src/deploy/grant_app_access.py`); answers come in Agent mode.
