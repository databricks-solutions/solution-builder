-- Bronze Layer — streaming tables from raw Delta (the synth output).

CREATE OR REFRESH STREAMING TABLE bronze_customers
COMMENT 'Raw customers (incl. city, lat/lng, premium_status from synth)'
AS SELECT *, current_timestamp() AS _ingested_at
FROM stream(ai_demo_gen.demo_luxebeauty_test.raw_customers);

CREATE OR REFRESH STREAMING TABLE bronze_products
COMMENT 'Raw product catalog from ERP'
AS SELECT *, current_timestamp() AS _ingested_at
FROM stream(ai_demo_gen.demo_luxebeauty_test.raw_products);

CREATE OR REFRESH STREAMING TABLE bronze_production_lots
COMMENT 'Raw production lots from ERP'
AS SELECT *, current_timestamp() AS _ingested_at
FROM stream(ai_demo_gen.demo_luxebeauty_test.raw_production_lots);

CREATE OR REFRESH STREAMING TABLE bronze_orders
COMMENT 'Raw orders from Shopify (via Lakeflow Connect — talk track)'
AS SELECT *, current_timestamp() AS _ingested_at
FROM stream(ai_demo_gen.demo_luxebeauty_test.raw_orders);

CREATE OR REFRESH STREAMING TABLE bronze_returns
COMMENT 'Raw returns from Zendesk (via Lakeflow Connect — talk track)'
AS SELECT *, current_timestamp() AS _ingested_at
FROM stream(ai_demo_gen.demo_luxebeauty_test.raw_returns);
