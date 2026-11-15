# AML / SAR Copilot: Northwind Federal Bank

> **Protect the Firm → AML monitoring & SAR automation.** An investigator console where an ML
> alert-risk model surfaces a money-laundering ring the rules engine buried. An agent assembles the
> evidence and drafts the FinCEN SAR narrative, and every decision is written back to governed Delta
> tables for compliance leadership. *Northwind Federal Bank is fictional.*

## The business story

Northwind Federal is a South Florida retail and commercial bank with about 3,000 customers in this demo slice.
Its rules-based transaction-monitoring system (TMS) raised **4,406 alerts in 12 months**, and volume is up
~40%. **88.3% of dispositioned alerts were false positives**, about 5,000 analyst hours a year. Meanwhile the share of SARs
filed after FinCEN's **30-day deadline** rose from 4.8% (Q4-25) to 24% (Q3-26). The rules engine weights the
KYC risk rating heavily. Cash-intensive restaurants and car washes are rated HIGH by policy, so they sit at the top of the
queue even though they are almost always legitimate.

**The planted signal: the Bayline ring (network `NET-290001`).**
* 9 linked parties: **Bayline Auto Exports LLC** (a used-vehicle exporter onboarded Feb-2026) and three shell LLCs
  registered at **the same suite (1420 Harbor Blvd, Suite 9)**. Five individual "mules" (a rideshare driver, a student,
  a warehouse associate, a server and a contractor) share phone numbers and **one online-banking device**.
* From 10-Aug-2026: **133 cash deposits of $8,200–$9,900** (just under the $10K CTR) at **7 branches**, $1,204,228 in
  total. The cash is swept to the hub within 1–3 days, and **$1,175,500 is wired to Golden Dunes General Trading FZE (UAE)
  and Pearl Delta Holdings Ltd (HK)**.
* Every party was onboarded LOW/MEDIUM risk, so the ring's 35 open alerts score 20–61 and sit at an average
  **rules rank #263 of 330**. Their August alerts were **already closed as "no SAR" in isolation**.
* The **ML alert-risk model** (GradientBoosting, hold-out AUC ≈0.93 vs ≈0.31 for the rule score alone, registered in
  Unity Catalog) learned from 12 months of dispositions what actually ends in a SAR: network, pass-through and
  multi-branch sub-threshold cash. It puts **all 35 ring alerts in the top 36** (34 of the top 35).

## Personas
| Persona | Uses |
|---|---|
| **Priya Raman, Head of the Financial Intelligence Unit** | Investigator console (Databricks App): queue, network, SAR copilot |
| **BSA Officer / Head of Financial Crimes Compliance** | AI/BI compliance dashboard + Genie agent (tables + the bank's policy library) |

## Demo script (about 8 minutes)
1. **Open the app → Alert queue.** Say: "330 alerts waiting, 88% historical false positives, 278 already past the 10-day
   triage SLA." Point at the red banner: *"The model surfaced a 9-party network the rules engine buried."* Click **Rules
   score (legacy)**. The top of the queue is convenience stores and restaurants (e.g. Bayfront Convenience, rule
   78, ML 0.9). Click **ML risk (default)** and Kevin Mbeki, Daniela Voss and Tatiana Brenes jump to the top. The small
   "rules #327" under each rank shows how far each alert moved.
2. **Click "View network".** The graph reads left to right: 5 individuals → 3 shell LLCs → Bayline hub → **$708K to the UAE
   and $468K to HK**. Dashed lines show the shared suite, phones and device. Hover a party to isolate its links. Say: "Each
   of these customers looks harmless on its own. Together they are a funnel."
3. **Click "Open top case" (Kevin Mbeki, e.g. AL-30158).** Show the reason codes ("10 cash deposits $8K–$10K… 9-party
   network… 100% of inflows moved out… cash 184x the KYC profile") and the 60-day cash chart for the whole network. Every
   red bar is a day with a sub-CTR deposit, and the dots are the wires.
4. **Click "Assemble evidence & draft SAR".** The copilot (Foundation Model API, `databricks-claude-sonnet-4-5`) calls
   `get_case_overview`, `get_cash_activity`, `get_fund_flows`, `get_linked_parties` and `get_alert_history` (governed SQL on
   Unity Catalog) in parallel. It then asks the **Genie agent**, which searches the AML policy library, about the filing deadline, the approval
   rules and the red flags (answers cite *BSA/AML Policy §3/§4*, *RF-03*, *HRJ-02*). After about 1–2 minutes it submits
   a **FinCEN-style narrative** (Introduction / Subjects / Chronology / Red flags / Bank actions / Conclusion), a red-flag
   list with policy cites, and a recommendation (typically **escalate**, because policy requires BSA Officer approval for
   networks of 3+ subjects and high-risk wires over $100K).
5. **Edit the narrative if needed, then click File SAR / Escalate / Close.** The decision covers **all 35 alerts in the network
   case**. It is written to `case_decisions` (with a generated BSA ID for a filing) and to the `case_audit_log` trail shown on the page
   (case opened → agent started → SAR drafted → decision). *To keep the flagship case fresh for the next demo, file the ring only
   in a live demo. Otherwise demo write-back on a false positive such as AL-30281, "Close — no SAR".*
6. **Decisions & audit page**, then **Compliance dashboard**, page 1: alert volume by outcome, FP rate, days-to-file versus the 30-day
   line, and the share of SARs filed late. Page 2: the *rules rank vs ML risk* scatter (the red cluster), the entity-network table and
   the **live write-back table**.
7. **Genie** (*AML-SAR Copilot - Compliance Analytics*). Ask: *"How does the rules engine rank the Bayline alerts compared with
   the ML model?"* (avg rules rank 263 vs ML rank 18 of 330), *"Where did the Bayline network wire money abroad?"* (Golden Dunes
   FZE, AE: 8 wires, $707,500; Pearl Delta, HK: 5 wires, $468,000), *"How many SARs missed the 30-day filing deadline by quarter?"*
   *"What decisions have investigators recorded in the Copilot app?"* and a policy question answered from the documents:
   *"What is the SAR filing deadline, and who must approve a SAR on a network case with 3 or more subjects?"*

## What's built
| Layer | Asset |
|---|---|
| Data (`financial_services.aml_sar_copilot`) | `customers` 3,009 · `accounts` 4,078 · `branches` 16 · `transactions` 632,167 · `customer_attributes` 9,027 · `alerts` 4,406 · `sar_cases` 195 |
| Gold | `gold_network_edges`, `gold_customer_network` (connected components), `gold_network_clusters`, `gold_alert_features` (18 features), `gold_alert_scores`, `gold_alert_queue` (ML rank, rules rank, reason codes) |
| ML | `aml_alert_risk_model` in UC, alias `@champion`, MLflow experiment under the demo folder |
| AI/BI | Dashboard *AML-SAR Copilot - Compliance Dashboard* (2 pages); Genie agent with instructions + 8 verified SQL answers, plus the 5 policy docs in the `aml_policy_docs` volume (searched in Agent mode) |
| App | `aml-sar-copilot`: queue, network graph, case page + SAR agent, decisions, embedded dashboard |
| Write-back | `case_decisions`, `case_audit_log`, `sar_drafts` (Delta, UC-governed) |

## Rebuild on any workspace
See `dab_instructions.md`. Deployment is three commands,
no hand edits (re-run the same three to upgrade):
```bash
databricks bundle deploy          # builds the app, deploys dashboard + app + setup job
databricks bundle run aml_sar_setup   # data, gold, model, Genie agent + docs, grants, demo_resources
databricks bundle run aml_app         # deploys + starts the app
```
