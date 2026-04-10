---
name: ABAC
category: governance
disabled: false
---

# Attribute-Based Access Control (ABAC)

**Policy-based access control** using tags and attributes rather than explicit role assignments.

## Pain

Traditional RBAC doesn't scale: every new data product means updating role assignments. PII scattered across tables requires manual tracking. Compliance audits involve spreadsheet reconciliation.

## Key Features

- **Tag-based policies** - access based on data classification tags (e.g., `pii:ssn`, `pii:address`)
- **Row filters** - hide rows based on UDF + tag + group membership
- **Column masks** - mask sensitive columns dynamically per user/group
- **Catalog-wide inheritance** - one policy covers all tagged data across schemas/tables
- **Principal-based exceptions** - `TO group EXCEPT admins` pattern

## Position

Large enterprises with complex data access requirements. FSI: PII handling, need-to-know access. Healthcare: PHI protection. "Same table, same query, different result based on policies + tags."

## Demo Tips

**Setup:** Create governed tags in UI, apply to columns, create UDFs for filter/mask logic, create policies. Best to load as a Databricks Notebook in the workspace, adding comments

**Quick demo flow:**
```sql
-- 1. Tag columns
ALTER TABLE profiles ALTER COLUMN SSN SET TAGS ('pii' = 'ssn');
ALTER TABLE profiles ALTER COLUMN Address SET TAGS ('pii' = 'address');

-- 2. Create mask UDF
CREATE FUNCTION mask_ssn(ssn STRING) RETURNS STRING RETURN '***-**-****';

-- 3. Create row filter UDF (hide EU rows)
CREATE FUNCTION non_eu_address(addr STRING) RETURNS BOOLEAN
RETURN NOT (LOWER(addr) LIKE '%eu%' OR LOWER(addr) LIKE '%europe%');

-- 4. Create policies
CREATE POLICY mask_ssn_policy ON CATALOG demo
  COLUMN MASK mask_ssn TO `restricted` EXCEPT `admins`
  FOR TABLES MATCH COLUMNS has_tag_value('pii','ssn') AS col ON COLUMN col;

CREATE POLICY hide_eu ON CATALOG demo
  ROW FILTER non_eu_address TO `restricted` EXCEPT `admins`
  FOR TABLES MATCH COLUMNS has_tag_value('pii','address') AS col USING COLUMNS (col);
```

**Demo moment:** Side-by-side: admin sees all rows + real SSN, restricted user sees filtered rows + masked SSN. Same query, different result = ABAC in action.

## URL

https://docs.databricks.com/aws/en/data-governance/unity-catalog/abac/
