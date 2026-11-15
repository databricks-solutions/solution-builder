-- Early-warning board: every AI failure mode x attributable supplier, last 90 days vs the prior 12 months (per 1,000 bike-years).
-- @param catalog STRING = manufacturing
-- @param schema STRING = warranty_copilot
SELECT signal_id, failure_mode, failure_mode_label, supplier_name, claims_90d, claims_base,
       CAST(rate_90d_per_1k_unit_years AS DOUBLE) AS rate_90d, CAST(baseline_rate_per_1k_unit_years AS DOUBLE) AS baseline_rate,
       CAST(rate_ratio AS DOUBLE) AS rate_ratio, CAST(cost_90d AS DOUBLE) AS cost_90d, is_signal, chargeable,
       CAST(dealer_code_agreement AS DOUBLE) AS dealer_code_agreement
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_early_warning')
ORDER BY is_signal DESC, rate_ratio DESC
