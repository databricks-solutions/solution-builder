-- Mitigation plans booked from the app and written back to Delta (sop_plan_decisions).
-- @param catalog STRING = manufacturing
-- @param schema STRING = supply_planning_copilot
SELECT plan_id, exposure_id, plant_id, component_id, action_summary, CAST(plan_cost AS DOUBLE) AS plan_cost,
       CAST(revenue_protected AS DOUBLE) AS revenue_protected, booked_by, CAST(booked_at AS STRING) AS booked_at
FROM IDENTIFIER(:catalog || '.' || :schema || '.sop_plan_decisions')
ORDER BY booked_at DESC
LIMIT 20
