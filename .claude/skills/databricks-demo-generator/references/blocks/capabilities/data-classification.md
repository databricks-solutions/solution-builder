---
name: Data Classification
category: uc-governance
disabled: false
buildable: true
---

# Data Classification

**Automatic tagging** of sensitive data (PII, PHI, financial) across your lakehouse.

## Pain

Manual classification doesn't scale. New tables go untagged. PII leaks into dashboards. Compliance audits require manual inventory of sensitive data.

## Key Features

- **Auto-detection** — scans tables for PII patterns (SSN, email, phone, etc.)
- **Customizable rules** — define domain-specific sensitive data patterns
- **Continuous monitoring** — new data automatically classified
- **UC integration** — tags flow into governance policies

## Position

Compliance-heavy scenarios. FSI: PCI, PII tracking. Healthcare: PHI detection. Any "how do you know where your sensitive data is?" conversation.

## How It Works

- **Enable on tables/schemas**: Point at a catalog or schema, classification scans the data
- **Auto-detection finds patterns**: SSN, email, phone, credit card — built-in patterns match common PII/PHI/PCI formats
- **Tags applied automatically**: Detected sensitive columns get UC tags — no manual work
- **Custom rules**: Add patterns for domain-specific sensitive types (e.g., internal account IDs)
- **Continuous**: New tables and columns scanned automatically — classification stays current

## Demo Tips

- **Coming soon** — not yet available for demos
- Part of the Unity Catalog governance story
- Position as "automatic compliance" — find PII before it becomes a problem
- Great for regulated industries

## URL

https://docs.databricks.com/en/data-governance/unity-catalog/
