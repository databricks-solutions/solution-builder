---
name: Unity Catalog
category: uc-governance
disabled: false
buildable: false
skill: databricks-unity-catalog
---

# Unity Catalog

**Unified, open governance** for all data, AI models, metrics and dashboards across clouds and formats.

## Pain

Each warehouse, lake, BI tool, ML platform has its own ACLs and catalog. "Who can see this?" or "where did this KPI come from?" takes weeks. Audits (GDPR, SOX, DORA) become multi-month fire drills. Security blocks new use cases because exposure is unclear.

## Key Features

- **Fine-grained access** — column/row-level security, dynamic data masking
- **ABAC** — policies based on tags, not just roles
- **Data classification** — automatic PII/sensitive data tagging
- **Automated lineage** — trace any metric back to source tables and transformations
- **Audit logs** — every access, query, permission change logged
- **Data quality monitoring** — detect drift, anomalies, freshness issues
- **Cross-cloud federation** — one catalog across AWS, Azure, GCP

## Position

Any mention of compliance, sensitive data, regulators, cross-cloud, or "we have 5 warehouses." Always show lineage + fine-grained access at least once.

## Implementation

The `databricks-unity-catalog` ai-dev-kit skill covers implementation details. Specs should specify WHAT to build and WHY (demo story), not HOW.

## Demo Tips

- **Foundation of everything** — UC underpins the entire platform
- Usually in the "platform" or "closing" section
- Show **lineage** — trace from dashboard -> metric -> tables -> sources
- **Fine-grained access**: "same data, different views based on role"
- Great for regulated industries (FSI, Healthcare) — audit trail, compliance
- Architecture: UC spans the entire stack as the governance layer
- Don't over-invest time unless governance is the focus — it's a foundation, not the star

## When to Emphasize

- Regulated industry (FSI, Healthcare, PubSec)
- Multiple clouds or data sources
- Compliance requirements (GDPR, SOX, DORA)
- Data democratization concerns (who can see what)

## URL

https://www.databricks.com/product/unity-catalog
