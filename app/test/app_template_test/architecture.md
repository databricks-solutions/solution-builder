```json
{
  "name": "LuxeBeauty Returns Intelligence Architecture",
  "columns": [
    {
      "nodes": [
        { "id": "src-shopify", "label": "Shopify", "icon": "inputData", "tier": "source", "desc": "Orders & Returns" },
        { "id": "src-zendesk", "label": "Zendesk", "icon": "inputData", "tier": "source", "desc": "Customer Comments" },
        { "id": "src-erp", "label": "ERP System", "icon": "inputData", "tier": "source", "desc": "Production Lots" },
        { "id": "src-docs", "label": "Manufacturing Reports", "icon": "unstructuredData", "tier": "source", "desc": "Incident PDFs", "row": 3.5 }
      ]
    },
    {
      "group": { "label": "SDP Pipeline", "tier": "sdp" },
      "nodes": [
        { "id": "bronze", "label": "Bronze Layer", "icon": "deltaTable", "tier": "bronze", "desc": "Raw Ingestion" },
        { "id": "silver", "label": "Silver Layer", "icon": "deltaTable", "tier": "silver", "desc": "Cleaned + ai_classify" },
        { "id": "gold", "label": "Gold Layer", "icon": "deltaTable", "tier": "gold", "desc": "Analytics Ready" },
        { "id": "doc-volume", "label": "Document Volume", "icon": "unstructuredData", "tier": "bronze", "desc": "PDF Reports", "row": 3.5 }
      ]
    },
    {
      "nodes": [
        { "id": "warehouse", "label": "SQL Warehouse", "icon": "sqlWarehouse", "tier": "compute", "desc": "Serverless" },
        { "id": "ml-notebook", "label": "ML Training", "icon": "notebooks", "tier": "compute", "desc": "XGBoost Premium", "row": 2 }
      ]
    },
    {
      "nodes": [
        { "id": "metric-views", "label": "Metric Views", "icon": "metricViews", "tier": "analytics", "desc": "Return Rate KPIs" },
        { "id": "dashboard", "label": "AI/BI Dashboard", "icon": "dashboard", "tier": "analytics", "desc": "Spike + City Map", "row": 1 },
        { "id": "genie", "label": "AI/BI Genie", "icon": "genie", "tier": "ai", "desc": "Why Returns?", "row": 2 },
        { "id": "premium-model", "label": "Premium Classifier", "icon": "mlModel", "tier": "ai", "desc": "Tier Customers", "row": 3 },
        { "id": "ka", "label": "Knowledge Assistant", "icon": "knowledgeAssistant", "tier": "ai", "desc": "Incident Reports", "row": 4 }
      ]
    },
    {
      "nodes": [
        { "id": "mas", "label": "Multi-Agent Supervisor", "icon": "multiAgentSupervisor", "tier": "ai", "desc": "Routes to Genie / KA", "row": 1 },
        { "id": "lakebase", "label": "Lakebase", "icon": "lakebase", "tier": "compute", "desc": "Managed Postgres", "row": 2.5 },
        { "id": "app", "label": "Databricks Apps", "icon": "databricksApps", "tier": "compute", "desc": "Returns Console", "row": 3.5 }
      ]
    },
    {
      "bars": [
        { "id": "db-one", "label": "Databricks One", "tier": "interface", "vertical": true }
      ]
    },
    {
      "nodes": [
        { "id": "user", "label": "Users", "icon": "businessUser", "tier": "consumer", "desc": "VP Operations", "row": 1.5 }
      ]
    }
  ],
  "edges": [
    { "from": "src-shopify", "to": "bronze", "label": "Lakeflow Connect", "animated": true },
    { "from": "src-zendesk", "to": "bronze", "animated": true },
    { "from": "src-erp", "to": "bronze", "animated": true },
    { "from": "src-docs", "to": "doc-volume", "label": "Auto Loader", "animated": true },
    { "from": "bronze", "to": "silver", "animated": true },
    { "from": "silver", "to": "gold", "animated": true },
    { "from": "gold", "to": "warehouse" },
    { "from": "warehouse", "to": "metric-views" },
    { "from": "warehouse", "to": "dashboard" },
    { "from": "warehouse", "to": "genie" },
    { "from": "warehouse", "to": "ml-notebook" },
    { "from": "ml-notebook", "to": "premium-model" },
    { "from": "doc-volume", "to": "ka" },
    { "from": "genie", "to": "mas" },
    { "from": "ka", "to": "mas" },
    { "from": "premium-model", "to": "mas" },
    { "from": "dashboard", "to": "db-one" },
    { "from": "mas", "to": "app" },
    { "from": "lakebase", "to": "app" },
    { "from": "app", "to": "db-one" },
    { "from": "db-one", "to": "user" }
  ],
  "bars": [
    { "label": "MLflow — Agent & Model Tracing", "tier": "orchestration", "startColumn": 2, "endColumn": 5 },
    { "label": "Unity Catalog — Governance & Security", "tier": "governance", "startColumn": 0, "endColumn": 6 }
  ]
}
```
