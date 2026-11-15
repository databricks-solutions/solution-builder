-- Pend rate + first-pass-clean rate by requesting practice group (provider
-- education vs gold-card candidates).
-- @param catalog STRING = healthcare_lifesciences
-- @param schema STRING = prior_auth_automation
SELECT
  p.practice_group,
  count(*) AS requests,
  round(100 * avg(CASE WHEN r.pend_count > 0 THEN 1 ELSE 0 END), 1) AS pend_pct,
  round(100 * avg(CASE WHEN r.criteria_met_on_first_review THEN 1 WHEN r.criteria_met_on_first_review = false THEN 0 END), 1) AS first_pass_clean_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.pa_requests') r
JOIN IDENTIFIER(:catalog || '.' || :schema || '.providers') p ON p.provider_id = r.provider_id
WHERE r.final_outcome <> 'Open'
GROUP BY ALL
ORDER BY pend_pct DESC
