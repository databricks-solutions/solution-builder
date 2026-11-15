-- Today's queue by triage lane, with the decisions the desk has issued so far (Delta write-back, uw_decisions).
-- @param catalog STRING = financial_services
-- @param schema STRING = commercial_underwriting_copilot
SELECT q.triage_lane,
       COUNT(*) AS submissions,
       ROUND(SUM(q.sov_tiv) / 1e6, 1) AS tiv_musd,
       SUM(CAST(q.band_as_submitted = 'Low' AND q.band_verified = 'High' AS INT)) AS hidden_high_risk,
       COUNT(d.decision_id) AS decisions_issued,
       ROUND(SUM(COALESCE(d.total_premium, 0)), 0) AS premium_issued
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_submission_queue') q
LEFT JOIN IDENTIFIER(:catalog || '.' || :schema || '.v_uw_decisions_latest') d ON d.submission_id = q.submission_id
GROUP BY q.triage_lane
ORDER BY submissions DESC
