# Northwind Federal Bank — BSA/AML Program Policy (v7.2, effective 1 July 2026)

Owner: BSA Officer (Chief Compliance Office). Approved by the Board Risk Committee. Fictional document for demo purposes.

## 1. Purpose and scope
This policy implements the Bank Secrecy Act (31 U.S.C. 5311 et seq.), its implementing regulations (31 CFR Chapter X) and FinCEN guidance for all Northwind Federal retail, small-business and commercial deposit relationships.

## 2. Transaction monitoring and alert handling
- The transaction-monitoring system (TMS) generates alerts from rules scenarios (structuring, high cash vs. profile, high-risk jurisdiction wires, rapid movement of funds, large round-dollar wires).
- **Alert triage SLA:** every alert must be triaged (dispositioned or escalated to a case) within **10 calendar days** of generation.
- Alerts are prioritised by the **ML alert-risk score** (probability an alert results in a SAR). The rules score is retained for model-risk comparison but is not the primary sort order since policy v7.0.
- Alerts on parties that belong to the same entity-resolution network (shared address, phone, device or funds transfers) **must be investigated together as one case**. Closing linked alerts in isolation is a QA finding.

## 3. SAR decisioning
- A SAR must be filed when the bank knows, suspects or has reason to suspect a transaction of **$5,000 or more** involves funds from illegal activity, is designed to evade BSA reporting (including structuring), has no business or apparent lawful purpose, or uses the bank to facilitate criminal activity (31 CFR 1020.320).
- **Filing deadline:** within **30 calendar days** of initial detection of facts that may constitute a basis for filing. If no suspect is identified, the deadline may be extended by 30 days, but never beyond **60 days** total.
- For ongoing activity, a continuing-activity SAR is filed every 90 days (within 120 days of the prior filing).
- Violations requiring immediate attention (e.g. terrorist financing, ongoing money laundering schemes) must be reported by phone to law enforcement in addition to the SAR.

## 4. Decision rights (four-eyes)
| Decision | Who may decide | Second review |
|---|---|---|
| Close alert — no SAR | Level 1 investigator | QA sample 10% |
| File SAR (single subject, < $250K) | Level 2 investigator | BSA Officer delegate |
| File SAR (network / multi-subject, or >= $250K) | Level 2 investigator | **BSA Officer** approval |
| Escalate to BSA Officer | Any investigator | — |
- Any case involving **three or more linked subjects**, wires to a high-risk jurisdiction above $100K, or a PEP must be escalated to the BSA Officer.

## 5. Confidentiality
SAR existence and content are confidential (31 U.S.C. 5318(g)(2)). Never disclose a SAR or tip off a subject. Account exit decisions for SAR subjects are made by the Relationship Exit Committee.

## 6. Record keeping
SARs and supporting documentation are retained for **five years** from filing. Every investigator action, draft and decision is recorded in the case audit trail.
