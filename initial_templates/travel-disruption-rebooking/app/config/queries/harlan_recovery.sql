-- Winter Storm Harlan, live: AutoProtect baseline vs the plans the IROPS desk has committed (Delta write-back).
-- @param catalog STRING = retail_consumer_goods
-- @param schema STRING = travel_disruption_copilot
SELECT flight_number, destination, pax, special_assistance_pax, onward_long_haul_pax,
       ap_same_day, ap_special_assistance_overnight, ap_misconnects,
       desk_plan_committed, desk_same_day, desk_misconnects, desk_partner_spend_usd, desk_total_cost_usd,
       autoprotect_total_cost_usd, approved_by
FROM IDENTIFIER(:catalog || '.' || :schema || '.v_harlan_recovery')
ORDER BY desk_plan_committed DESC, ap_special_assistance_overnight DESC, pax DESC
