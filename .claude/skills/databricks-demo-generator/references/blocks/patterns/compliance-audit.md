---
name: Compliance Audit & Regulatory Monitoring
category: pattern
suggested_capabilities: [sdp, aibi-dashboards, genie, knowledge-assistant, supervisor-agent, notebooks-eda]
---

## Narrative Arc

1. **Regulatory pressure** -- Establish the stakes: fines, license risk, reputational damage from non-compliance.
2. **Scale problem** -- Show that manual review cannot keep pace with the volume of activities and complexity of rules.
3. **Automated detection** -- Rules engine and ML models flag potential violations from structured data; AI extracts signals from unstructured documents.
4. **Investigation** -- The compliance officer triages alerts, cross-referencing data findings with policy documents and regulatory guidance.
5. **Resolution** -- Violations are confirmed or cleared, an audit trail is generated, and systemic gaps are identified for remediation.

## Data Shape

| Layer | Abstract Entity | Role |
|-------|----------------|------|
| Fact table | Activities / Transactions | The regulated events being monitored (trades, payments, clinical actions, emissions) |
| Fact table | Alerts / Flags | System-generated violation candidates with rule ID, severity, and status |
| Dimension | Entities | The actors under compliance scrutiny (accounts, employees, facilities, counterparties) |
| Dimension | Rules / Policies | The compliance rules being evaluated, with thresholds and effective dates |
| Reference | Regulatory filings | Prior audit results, regulatory submissions, consent orders |
| Unstructured | Policy documents | Regulatory texts, internal policies, procedure manuals, training materials |
| Unstructured | Evidence artifacts | Contracts, communications, disclosures that serve as audit evidence |

The data should include both compliant and non-compliant activity. Violations should be realistic but clearly identifiable -- a mix of obvious red flags and subtle patterns that require cross-referencing multiple data sources. Historical audit outcomes provide training labels for ML models.

## Wow Moment Pattern

The demo becomes compelling when the AI finds something a human reviewer would have missed. The hero shows a transaction that passed all deterministic rules but, when cross-referenced with a policy document and entity history by the multi-agent system, reveals a clear violation. The transition from "our rules said this was fine" to "but the AI caught what the rules missed" demonstrates the value of combining structured rule checks with unstructured document intelligence. A second wow moment is the automatic generation of an audit-ready summary with citations.

## Investigation / Discovery Flow

1. **Compliance dashboard** -- Overview of alert volumes, violation rates, and coverage metrics across rule categories.
2. **Alert triage** -- Filter and prioritize alerts by severity, rule type, or entity; identify clusters of related violations.
3. **Transaction review** -- Genie enables natural-language exploration of the flagged activities and their context.
4. **Policy cross-reference** -- Knowledge Assistant retrieves the specific regulatory text or internal policy relevant to each alert.
5. **Evidence assembly** -- Multi-agent supervisor coordinates data retrieval and document search to build a complete case file.
6. **Disposition and reporting** -- Violations are confirmed or dismissed with documented rationale; audit trail is generated.

## Example Walkthrough Beats (5-Act Structure)

| Act | Beat | What Happens |
|-----|------|-------------|
| 1 - Setup | Regulatory landscape | Dashboard shows compliance posture: alert volumes, open cases, coverage by rule category, penalty exposure |
| 2 - Inciting Incident | Anomalous cluster | A spike in alerts for a specific rule category or entity group demands attention |
| 3 - Investigation | Multi-source review | Hero triages top alerts, uses Genie to examine transaction details, asks Knowledge Assistant for the applicable regulation |
| 4 - Discovery | Hidden violation | AI cross-references structured data with policy documents to surface a subtle violation that deterministic rules missed |
| 5 - Resolution | Audit-ready output | Hero confirms the violation, generates an audit summary with data citations and regulatory references, and identifies the systemic gap for remediation |

## Suggested Databricks Components

- **Lakeflow Declarative Pipeline** -- Ingestion of transaction feeds and document stores; rule evaluation in the Silver layer; alert generation and case management in the Gold layer.
- **AI/BI Dashboard** -- Compliance posture overview, alert volume trends, violation heatmaps by rule category, entity risk scores, and case status tracking.
- **Genie Space** -- Ad-hoc exploration of flagged transactions and entity histories ("Show me all wire transfers over $10K for this account in the last 90 days").
- **Knowledge Assistant** -- RAG-powered retrieval of regulatory texts, internal compliance policies, prior audit findings, and procedural manuals.
- **Multi-Agent Supervisor** -- Orchestrates between data queries and document retrieval to build complete investigation packages for each alert.
- **ML Notebook** -- Anomaly detection for unusual activity patterns; NLP classification for document-level compliance signals; risk scoring models.
- **Unity Catalog** -- Governance layer ensuring audit trail, data lineage, and access controls across all compliance data.
