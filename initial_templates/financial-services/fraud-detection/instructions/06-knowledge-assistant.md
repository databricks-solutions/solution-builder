# Knowledge Assistant Configuration

## Task

Create a Knowledge Assistant that can search internal documents and reveal the root cause of the fraud spike.

---

## Knowledge Assistant Configuration

| Setting | Value |
|---------|-------|
| **Assistant Name** | `Meridian Fraud Investigations Assistant` |
| **Description** | "Search security audits, merchant reports, and fraud investigation documents" |

---

## Documents to Generate

### Background Documents (Noise)

These provide context but don't contain the root cause:

| Document | Content |
|----------|---------|
| `fraud_prevention_policy_2024.pdf` | Standard fraud prevention policies, escalation procedures |
| `merchant_onboarding_guidelines.pdf` | KYC requirements, terminal setup procedures |
| `quarterly_fraud_review_Q4_2024.pdf` | Historical fraud trends, no anomalies noted |
| `pci_compliance_checklist.pdf` | PCI-DSS requirements, audit procedures |

### Key Document (Smoking Gun)

| Document | Purpose |
|----------|---------|
| `quickmart_security_audit_feb2025.pdf` | **Contains the root cause** |

**Key Document Content:**

```
MERCHANT SECURITY AUDIT REPORT

Merchant: QuickMart Corporation
Store: #4521 (Phoenix, AZ)
Audit Date: February 18, 2025
Auditor: SecurePay Compliance Team

EXECUTIVE SUMMARY
During routine PCI compliance audit, critical vulnerabilities were identified
at QuickMart Store #4521 affecting 12 POS terminals.

FINDINGS

CRITICAL - Terminal Compromise Detected
- Terminals: T-4521-001 through T-4521-012
- Evidence of unauthorized firmware modification
- Skimming overlay devices detected on card readers
- Estimated compromise date: February 8, 2025

AFFECTED TERMINAL IDs:
T-4521-001, T-4521-002, T-4521-003, T-4521-004,
T-4521-005, T-4521-006, T-4521-007, T-4521-008,
T-4521-009, T-4521-010, T-4521-011, T-4521-012

RECOMMENDED ACTIONS
1. Immediately disable all affected terminals
2. Issue replacement cards for exposed accounts
3. File SAR with FinCEN
4. Engage forensic investigators

IMPACT ASSESSMENT
Estimated exposed cards: 47,000
Potential fraud exposure: $2.4M based on typical monetization rates
```

---

## System Instructions

```
You are a fraud investigations assistant for Meridian Bank. You help analysts
investigate fraud patterns by searching security audits, merchant reports,
and compliance documents.

When asked about fraud spikes or anomalies:
1. Search for relevant merchant audits and security reports
2. Look for terminal IDs, compromise dates, and affected locations
3. Connect document findings to fraud patterns in the data

Key identifiers to match:
- Merchant: QuickMart #4521
- Terminals: T-4521-001 through T-4521-012
- Compromise date: February 8, 2025
- Location: Phoenix, AZ

Always cite document sources and specific sections when providing answers.
```

---

## Sample Questions

```
"What do we know about QuickMart store #4521?"
"Are there any security audits for Phoenix merchants?"
"What caused the fraud spike in February?"
"Which terminals were compromised?"
"What does the security audit recommend?"
```

---

## Validation

| Question | Expected Document | Expected Answer |
|----------|-------------------|-----------------|
| "What caused the fraud spike?" | quickmart_security_audit_feb2025.pdf | Terminal compromise at QuickMart #4521, skimming devices on 12 terminals |
| "Which terminals were affected?" | quickmart_security_audit_feb2025.pdf | T-4521-001 through T-4521-012 |
| "When did the compromise happen?" | quickmart_security_audit_feb2025.pdf | February 8, 2025 |
