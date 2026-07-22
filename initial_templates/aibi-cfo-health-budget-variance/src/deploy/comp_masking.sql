-- =====================================================================
-- Comp Controls — Unity Catalog column masking (01-lakeflow.md Section E)
-- =====================================================================
-- The compensation table is genuinely sensitive HR/finance data. Governance hook:
--   • Finance (group `finance`)       sees full comp detail (salary + total comp + $/hr)
--   • Operations managers (`ops_managers`) see headcount + non-sensitive columns only;
--     the salary/comp columns come back MASKED (NULL)
-- Same table, same query, different result — masked by POLICY, not separate tables.
--
-- We use a direct COLUMN MASK function bound to the three sensitive columns. (An
-- ABAC tag-based policy — ALTER COLUMN ... SET TAGS + CREATE POLICY ... FOR TABLES
-- MATCH COLUMNS has_tag_value(...) — is an equivalent option where enabled; the
-- direct function below is the portable form that works on any UC metastore.)
--
-- {{CATALOG}} / {{SCHEMA}} are substituted by the DAB sql_task parameters.
-- The two demo groups (`finance`, `ops_managers`) must exist at the ACCOUNT level and
-- have members assigned to the workspace; see dab_instructions.md.

-- 1) The mask: return the real value only for members of the `finance` group; NULL
--    for everyone else. headcount is NOT masked, so managers still see the heads.
CREATE OR REPLACE FUNCTION `{{CATALOG}}`.`{{SCHEMA}}`.mask_comp(v DOUBLE)
  RETURNS DOUBLE
  COMMENT 'Comp-control column mask: full value for the finance group, NULL otherwise.'
  RETURN CASE WHEN is_account_group_member('finance') THEN v ELSE NULL END;

-- 2) Bind the mask to the three sensitive comp columns on the compensation table.
--    base_salary_usd, total_comp_usd, blended_hourly_cost_usd are masked;
--    role, department, headcount stay visible to everyone.
ALTER TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation
  ALTER COLUMN base_salary_usd SET MASK `{{CATALOG}}`.`{{SCHEMA}}`.mask_comp;
ALTER TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation
  ALTER COLUMN total_comp_usd SET MASK `{{CATALOG}}`.`{{SCHEMA}}`.mask_comp;
ALTER TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation
  ALTER COLUMN blended_hourly_cost_usd SET MASK `{{CATALOG}}`.`{{SCHEMA}}`.mask_comp;

-- 3) Also tag the sensitive columns with a governance tag so the sensitivity is
--    discoverable in Catalog Explorer / lineage (documentation + ABAC-ready).
--    NOTE: `sensitivity` may be a GOVERNED tag key with an allowed-value list on some
--    metastores (e.g. field-eng allows salary/pii/pci/... but not a free-form 'comp').
--    We use 'salary' — the allowed value that fits compensation. If your metastore has
--    no tag policy, any value (e.g. 'comp') works; adjust to a permitted value if the
--    ALTER ... SET TAGS statement is rejected. Tagging is optional for the mask to work
--    (step 2 is what enforces masking) — these three statements are safe to skip.
ALTER TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation
  ALTER COLUMN base_salary_usd SET TAGS ('sensitivity' = 'salary');
ALTER TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation
  ALTER COLUMN total_comp_usd SET TAGS ('sensitivity' = 'salary');
ALTER TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation
  ALTER COLUMN blended_hourly_cost_usd SET TAGS ('sensitivity' = 'salary');

-- 4) Grant both demo groups SELECT so the difference comes ONLY from the mask —
--    "same table, same query, different result".
GRANT SELECT ON TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation TO `finance`;
GRANT SELECT ON TABLE `{{CATALOG}}`.`{{SCHEMA}}`.compensation TO `ops_managers`;

-- Demo moment: as a `finance` member, SELECT * FROM compensation shows real salaries;
-- as an `ops_managers` member the identical query returns NULL salary/comp columns but
-- the real headcount.
