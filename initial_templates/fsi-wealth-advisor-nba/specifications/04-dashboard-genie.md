# 04 — Wealth-desk dashboard, Genie agent (tables + policy documents)

## AI/BI dashboard `dashboard/wealth_desk.lvdash.json` ("Calder Pine - Wealth Desk: Money in Motion & Next Best Action")
Schema-less datasets (DAB `dataset_catalog` / `dataset_schema`), published with embedded credentials.
- **Money in motion**: KPIs (money in motion $920M, CDs maturing ≤ 60 days $119M, AUM at risk $167M, refi window $378M,
  targeted vs generic conversion 30.2% / 7.4%), money in motion by signal, sweep cash trend, rates (Fed funds, CD renewal,
  mortgage, online bank vs sweep), AUM at risk by advisor, top-25 households firm-wide.
- **Next best action & suitability**: conversion by approach/speed, retention after a bereavement/inheritance, complaints on
  accepted offers by suitability, today's scored actions by status, conversion by action, **desk activity** (live
  `advisor_decisions` on top of the last 2 weeks of offers).

## Genie agent `genie/genie_space.json` ("Calder Pine - Wealth Desk")
Serialized v2, 18 tables sorted, column descriptions, text instructions (money-in-motion definition excluding refi and
concentrated positions, conversion, retention, suitability, complaints, tables-vs-documents routing), 6 sample questions each
with verified example SQL (answers in the top-level README) + 1 policy question answered from the documents.

## Documents (the Genie agent's `data_sources.volumes`, answered in Agent mode)
Source: `/Volumes/<catalog>/<schema>/policy_docs/` ← `src/policy_docs/*.md`: Best Interest & Suitability policy (Reg BI care
obligation, rules S1–S6, product matrix, complaint lesson), Vulnerable Client & Bereavement policy (FINRA 2165/4512,
12-month rule, bereavement playbook), Required Product Disclosures (D-codes), Client Communications (FINRA 2210, required
footer), Lending & Rollover playbooks (refi window math, SBLOC advance rates, PTE 2020-02). The agent cites policy + section
+ regulation.
