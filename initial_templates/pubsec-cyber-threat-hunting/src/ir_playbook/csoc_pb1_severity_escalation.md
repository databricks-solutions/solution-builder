# Cascadia Security Operations Center (CSOC) — Incident Response Playbook
## Chapter 1 — Severity, escalation and notification (applies to the Cascadia Department of Revenue, CDOR)

Fictional agency playbook for a demonstration. Version 4.2, owner: Office of the CISO (Gloria Tran).

### PB-1.1 Severity matrix
| Severity | Definition | Contain within | Examples |
|---|---|---|---|
| SEV-1 Critical | Confirmed attacker activity with access to Federal Tax Information (FTI), taxpayer PII, or a domain controller; or active data exfiltration | 4 hours | compromised account reading taxpayer case files; DNS tunneling from an internal host |
| SEV-2 High | Confirmed compromise of an account or host without evidence of access to FTI/PII | 24 hours | credential compromise contained at the identity layer |
| SEV-3 Medium | Suspicious activity requiring investigation, no confirmed compromise | 3 business days | password spray with no successful sign-in |
| SEV-4 Low | Policy violation or benign true positive | 10 business days | unapproved software |

Any incident where a compromised identity accessed the share `\\FS-TAX-01\AuditCases` is SEV-1 because that share holds FTI.

### PB-1.2 Escalation
- SEV-1: page the incident commander and notify the CISO within 1 hour of confirmation. Open an IR case (IR-YYYY-NNNN) immediately.
- SEV-1 or SEV-2 involving FTI: notify the IRS Office of Safeguards and TIGTA within 24 hours of discovery (IRS Publication 1075 requirement). The CISO's office makes the call; the SOC supplies the timeline.
- SEV-1: notify the Cascadia Fusion Center (state cyber desk) within 24 hours.
- Personal information of Cascadia residents acquired by an unauthorized person: the Cascadia Data Breach Notification Act §5 requires notice to affected residents within 30 days of discovery and to the Attorney General when more than 500 residents are affected. Legal decides; the SOC documents records affected.
- Never contact the suspected account owner through the possibly-compromised channel (email, Teams). Use a phone call-back to the number in the HR record.

### PB-1.3 Case handling
- Every confirmed incident gets an IR case with: severity, affected identities and hosts, an ordered timeline with timestamps and data source, the MITRE ATT&CK techniques observed (PB-7), containment actions with owner and status, and records affected.
- Preserve evidence before remediation that destroys it (reimaging a host, deleting an account). Disable, do not delete.
- Tier 1 may close an alert as false positive only when the closure note states the evidence checked. "User travels often" is not sufficient evidence for an impossible-travel alert (see PB-2.3).
- MTTD (mean time to detect) is measured from first malicious activity to detection; MTTR (mean time to respond) from detection to containment. Both are reported monthly to the CISO.
