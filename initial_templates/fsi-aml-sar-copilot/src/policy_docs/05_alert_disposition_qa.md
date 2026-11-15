# Alert Disposition & Quality Assurance Procedure (Procedure AD-01)

Fictional internal procedure for Northwind Federal Bank.

## Disposition codes
- **Close — no SAR (false positive):** activity explained by the customer profile, history, peer comparison or documentation. The rationale must reference the specific evidence (e.g. "cash consistent with 12-month average of $62K/month for a full-service restaurant; single home branch; CTRs filed").
- **Escalate to case:** activity not explained; open a case and link all related alerts (including alerts on linked parties).
- **File SAR:** case meets the SAR standard (see BSA/AML Program Policy §3).

## Minimum evidence before closing an alert
1. 90-day transaction review of the subject account(s).
2. Check of linked parties (entity-resolution network) — if any linked party has an open or recent alert, alerts must be reviewed together.
3. KYC profile comparison (expected activity vs. actual).
4. Prior alerts and SARs on the subject.

## QA findings (examples)
- Linked alerts closed individually without network review (most common finding in 2026 H1 QA: 23% of structuring closures).
- Closure rationale copied from template without subject-specific facts.
- SAR filed after day 30 without documented extension justification.

## Productivity benchmarks
- Median analyst time to close a false-positive alert: 1.4 hours. Industry false-positive rates for rules-based TMS are typically 90–95%.
- Target: at least 50% of investigator hours on alerts with ML risk score >= 40.
