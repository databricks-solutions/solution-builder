# 03 — AI/BI dashboard + Genie (SVP Ad Revenue, Jordan Ellis)

Dashboard "Aurora Crest - Ad Yield & Pricing" (`dashboard/ad_yield.lvdash.json`, schema-less datasets, bundle resource
with `embed_credentials: true`): page *Yield & revenue* (28-day KPIs, weekly revenue by channel, Live Sports eCPM vs
clearing, eCPM vs rate card, sell-through by platform, yield board) and page *Pacing & make-goods* (at-risk KPIs,
liability by IO, pacing table, avails actual vs ai_forecast, AUTO-INT spare avails, make-goods by month).

Genie space "Aurora Crest - Ad Yield & Pricing" (`src/genie/genie_space.json`, serialized v2, deployed by
`src/deploy/deploy_genie.py`): 17 tables, text instructions (definitions, which gold table answers what), 6 sample
questions, 7 example SQL queries.
