-- Detection rule efficacy over the 90-day window: volume, true positives, TP rate, and the ATT&CK technique each rule covers.
-- @param catalog STRING = cybersecurity
-- @param schema STRING = threat_hunting_copilot
SELECT a.rule_name, a.source, a.technique_id, t.technique_name,
       count(*) AS alerts,
       count_if(a.disposition = 'true_positive') AS true_positives,
       round(100 * count_if(a.disposition = 'true_positive') / nullif(count_if(a.disposition <> 'open'), 0), 1) AS tp_rate_pct,
       count_if(a.disposition = 'false_positive') AS false_positives
FROM IDENTIFIER(:catalog || '.' || :schema || '.siem_alerts') a
LEFT JOIN IDENTIFIER(:catalog || '.' || :schema || '.attack_techniques') t ON t.technique_id = a.technique_id
WHERE a.rule_id LIKE 'R-%'
GROUP BY ALL ORDER BY alerts DESC
