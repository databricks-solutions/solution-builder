---
name: Unity Catalog
category: uc-governance
disabled: false
buildable: false
skill: databricks-unity-catalog
---

# Unity Catalog

## What It Does

Unified governance layer for all data, AI models, metrics, and dashboards. One place for access control, lineage, auditing, and discovery across the entire Lakehouse.

Each warehouse, lake, BI tool, ML platform has its own ACLs and catalog. "Who can see this?" or "where did this KPI come from?" takes weeks. Audits (GDPR, SOX, DORA) become multi-month fire drills. Security blocks new use cases because exposure is unclear.

## When to Use in a Demo

- Present in every demo as the governance foundation, but rarely the centerpiece.
- Usually surfaces in the "platform" or "closing" section, or as the spanning layer in the architecture diagram.
- Make it the focus only when the customer's primary pain is governance, compliance, or data democratization.

Key capabilities: fine-grained access (column/row-level security, dynamic masking), ABAC (tag-based policies), automatic data classification, automated lineage, audit logs, data quality monitoring, cross-cloud federation.

## Key Configuration Decisions

### 1. Catalog & Schema Naming

Name the demo catalog after the customer or use case — not generic names like `demo` or `test`.

| Pattern | Example | When |
|---------|---------|------|
| Customer-branded | `luxebeauty` | Single-customer demo |
| Use-case-branded | `fraud_detection` | Industry template |
| Environment-scoped | `luxebeauty_dev`, `luxebeauty_prod` | Showing SDLC isolation |

Use schemas to separate pipeline stages: `bronze`, `silver`, `gold`. This directly mirrors the medallion architecture the pipeline builds.

### 2. Always Use Managed Tables and Volumes

Every demo table must be managed. No external tables, no external locations, no DBFS mounts. Managed tables give you auto-compaction, auto-optimize, and full governance out of the box — and avoid the complexity of storage credentials in a demo.

Same for volumes: use managed volumes for synthetic data, PDFs, images. External volumes only if the demo story specifically requires showing an external landing zone.

### 3. Grant Structure for the Demo Story

Design grants to illustrate role-based access, not just to make things work:

- **Create at least two personas** (e.g., `analyst` and `data_engineer`) so you can show different views of the same data.
- **Use groups, not individual users** — mirrors the real-world best practice and looks more credible.
- **Grant `BROWSE` on the catalog broadly** — this lets you show the discovery experience ("anyone can find data, but only authorized roles can query it").
- **Reserve `MODIFY` for service principals** — pipelines write to production tables, humans don't. Say this explicitly in the demo narrative.
- **Show column-level or row-level security** when the domain has sensitive data (PII in healthcare, account numbers in FSI). One masking policy on one column is enough to land the point.

### 4. Lineage as a Demo Moment

Always include at least one lineage walkthrough: dashboard → metric → Gold table → Silver → Bronze → source. This is consistently impressive to customers and costs nothing extra to set up — it's automatic when using UC-managed objects.

Plan the pipeline so the lineage graph tells a clean story. Avoid orphan tables or dead-end branches.

### 5. What to Skip

Do not include in demo instructions:
- Metastore creation or configuration — the workspace already has one.
- SCIM provisioning, IdP federation, or account-level admin setup — enterprise deployment concerns, not demo scope.
- External locations or storage credentials — adds complexity with no demo payoff.
- Cross-region or Delta Sharing setup — only if the demo story explicitly requires multi-region.
- Data quality monitors — covered by the DAS skill if needed; don't prescribe setup details here.

## Implementation

The `databricks-unity-catalog` Databricks Agent Skill (DAS) covers implementation details. Specs should specify WHAT to build and WHY (demo story), not HOW.

## Demo Tips

- Show **lineage** — trace from dashboard back to source. Always lands.
- Show **fine-grained access** — "same data, different views based on role."
- Show **BROWSE + access requests** — "anyone can discover what exists and request access without a ticket."
- For regulated industries, call out the **audit trail** — every query and permission change is logged automatically.
- Architecture: UC spans the entire stack as the governance layer.
- Keep it brief unless governance is the primary focus. Two minutes, two features, move on.

## When to Emphasize

- Regulated industry (FSI, Healthcare, PubSec)
- Multiple clouds or data sources
- Compliance requirements (GDPR, SOX, DORA)
- Data democratization concerns (who can see what)

## URL

https://www.databricks.com/product/unity-catalog
