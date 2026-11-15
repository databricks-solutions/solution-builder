# 04 — AI/BI dashboard + Genie

## Dashboard "Aeralis IROPS - Disruption Recovery" (`dashboard/irops_disruption_recovery.lvdash.json`, schema-less datasets)
**Page 1 — Winter Storm Harlan (live):** KPIs (passengers disrupted, AutoProtect home-today rate, special assistance overnight, missed
long-haul connections, rebookings committed by the desk, home-today rate after desk plans); AutoProtect outcome mix by passenger need;
flights where AutoProtect hurt most; cancelled-flight table; messages by intent × urgency (AI Functions); recovery by flight (desk plans
from `v_harlan_recovery`); special-assistance passengers — AutoProtect vs desk (`v_harlan_pax_status`, updates on every commit).
**Page 2 — IROPS history:** same-day rate and cost per disrupted passenger by month × handling method; AutoProtect vs pilot bars
(same day, cost / pax, NPS); IROPS events table.

## Genie space "Aeralis IROPS - Disruption Operations" (`genie/genie_space.json`, serialized v2, tables sorted)
17 tables/views; text instructions define disrupted / same day / overnight / special assistance / misconnect / cost per pax / NPS /
"the pilot", and that the data ends 13 Feb 2026. Sample questions (verified answers):
| Question | Answer |
|---|---|
| How many passengers did Winter Storm Harlan disrupt, and how many did AutoProtect get out the same day? | 5,266; 821 (15.6%) |
| How many special-assistance passengers and unaccompanied minors did AutoProtect leave overnight? | 248 of 283; 14 of 17 |
| Which cancelled flights have the most special-assistance passengers left overnight by AutoProtect? | AE 98 (23), AE 99 (15), AE 97 (14), AE 1418 (13, + 12 misconnects), AE 1360 (13) |
| Compare AutoProtect with the desk-priority pilot since December… | 43.9% vs 66.3% same day; $120 vs $85; NPS −27.9 vs +15.0 |
| Show the monthly misconnect rate for AutoProtect | 70–80% every month (Jan 2025 – Feb 2026) |
| What are Harlan passengers messaging about, and how many messages were escalated? | rebook 429, complaint 231, hotel/care 177, refund 136…; 122 escalated |
