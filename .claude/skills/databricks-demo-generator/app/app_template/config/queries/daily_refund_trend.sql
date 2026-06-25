-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ FORK CHECKLIST — the .sql files under config/queries/ are examples.  ║
-- ║                                                                      ║
-- ║ These ship as LuxeBeauty examples (returns / refunds / lots). For    ║
-- ║ YOUR demo:                                                           ║
-- ║                                                                      ║
-- ║   1. Rewrite the SELECT to hit your domain tables (or delete the     ║
-- ║      file if it doesn't fit your story).                             ║
-- ║   2. Write tables SCHEMA-RELATIVE — `FROM my_table`, NOT             ║
-- ║      `catalog.schema.my_table`. The server (server/routes/charts.ts) ║
-- ║      runs each query with the demo's catalog + schema as the         ║
-- ║      statement session context, so bare names resolve against        ║
-- ║      whatever your synth + SDP wrote to — on any workspace.           ║
-- ║   3. Register the query: add its key → filename in charts.ts's       ║
-- ║      QUERY_FILES map, and reference it from AnalyticsView.tsx.        ║
-- ║                                                                      ║
-- ║ Aim for 2-4 queries that map to the story's key numbers.             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Daily refund $ trend (last 30 days).
SELECT
  return_date,
  CAST(ROUND(SUM(refund_amount_usd), 2) AS DOUBLE) AS total_refund_usd
FROM silver_returns
WHERE return_date >= date_sub(current_date(), 30)
GROUP BY return_date
ORDER BY return_date
