-- ATT&CK coverage matrix for the home page: every technique in the IR playbook with its tactic, its CDOR
-- detection coverage (full / partial / none) and how often the SIEM alerted on it (+ true positives).
-- @param catalog STRING = cybersecurity
-- @param schema STRING = threat_hunting_copilot
SELECT t.technique_id, t.technique_name, t.tactic, t.detection_coverage,
       count(a.alert_id) AS alerts,
       count_if(a.disposition = 'true_positive') AS true_positives
FROM IDENTIFIER(:catalog || '.' || :schema || '.attack_techniques') t
LEFT JOIN IDENTIFIER(:catalog || '.' || :schema || '.siem_alerts') a
  ON a.technique_id = t.technique_id AND a.rule_id LIKE 'R-%'
GROUP BY ALL
