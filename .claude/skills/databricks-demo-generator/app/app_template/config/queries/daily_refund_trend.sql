-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ FORK CHECKLIST — every .sql under config/queries/ must be REPLACED.  ║
-- ║                                                                      ║
-- ║ The queries that ship with the template are LuxeBeauty examples      ║
-- ║ (returns / refunds / production lots). For YOUR demo:                ║
-- ║                                                                      ║
-- ║   1. Delete this file and the other examples if they don't fit       ║
-- ║      your story, OR rewrite the SELECT to hit your domain tables.    ║
-- ║   2. Update catalog + schema in the FROM clause to match the ones    ║
-- ║      your synth + SDP wrote to. The default                          ║
-- ║      `ai_demo_gen.demo_demo_project` below is a template placeholder ║
-- ║      — no such schema exists. Until you fix this, every analytics    ║
-- ║      widget in /analytics will log TABLE_OR_VIEW_NOT_FOUND.          ║
-- ║   3. Update the AnalyticsView component                              ║
-- ║      (client/src/analytics/AnalyticsView.tsx) so the queryKey list   ║
-- ║      matches whatever files you keep here.                           ║
-- ║                                                                      ║
-- ║ Aim for 2-4 queries that map to the story's key numbers.             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Daily refund $ trend (last 30 days).
SELECT
  return_date,
  CAST(ROUND(SUM(refund_amount_usd), 2) AS DOUBLE) AS total_refund_usd
FROM ai_demo_gen.demo_demo_project.silver_returns
WHERE return_date >= date_sub(current_date(), 30)
GROUP BY return_date
ORDER BY return_date
