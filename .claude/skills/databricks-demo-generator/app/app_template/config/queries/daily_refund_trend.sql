-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ FORK CHECKLIST — the .sql files under config/queries/ are examples.  ║
-- ║                                                                      ║
-- ║ These ship as LuxeBeauty examples (returns / refunds / lots). For    ║
-- ║ YOUR demo:                                                           ║
-- ║                                                                      ║
-- ║   1. Rewrite the SELECT to hit your domain tables (or delete the     ║
-- ║      file if it doesn't fit your story).                             ║
-- ║   2. Reference tables via IDENTIFIER() built from the :catalog and   ║
-- ║      :schema params — `FROM IDENTIFIER(:catalog || '.' || :schema    ║
-- ║      || '.my_table')`, NOT a hardcoded `catalog.schema.my_table`.    ║
-- ║      charts.ts binds :catalog/:schema at runtime from the demo's     ║
-- ║      config, so the same SQL resolves on any workspace.              ║
-- ║   3. Give type-generation a describe-time sample so it can resolve   ║
-- ║      the table shape at build:                                       ║
-- ║         -- @param catalog STRING = <your_catalog>                    ║
-- ║         -- @param schema  STRING = <your_schema>                     ║
-- ║      The sample is used ONLY during `DESCRIBE QUERY` at typegen;     ║
-- ║      the runtime still binds the real values. Point the sample at a  ║
-- ║      workspace where the tables already exist.                       ║
-- ║   4. Register the query: add its key → filename in charts.ts's       ║
-- ║      QUERY_FILES map, and reference it from AnalyticsView.tsx.        ║
-- ║                                                                      ║
-- ║ Aim for 2-4 queries that map to the story's key numbers.             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Daily refund $ trend (last 30 days).
-- @param catalog STRING = retail_consumer_goods
-- @param schema STRING = luxebeauty_demo
SELECT
  return_date,
  CAST(ROUND(SUM(refund_amount_usd), 2) AS DOUBLE) AS total_refund_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.silver_returns')
WHERE return_date >= date_sub(current_date(), 30)
GROUP BY return_date
ORDER BY return_date
