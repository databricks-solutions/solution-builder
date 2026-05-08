```json
{
  "name": "Harvestly Loyalty Segmentation",
  "columns": [
    {
      "nodes": [
        { "id": "src-shopify", "label": "Shopify", "icon": "inputData", "tier": "source", "desc": "Orders" },
        { "id": "src-loyalty", "label": "Loyalty Platform", "icon": "inputData", "tier": "source", "desc": "Members + Tier" },
        { "id": "src-klaviyo", "label": "Klaviyo", "icon": "inputData", "tier": "source", "desc": "Email + Redemptions" },
        { "id": "src-docs", "label": "Marketing Playbook", "icon": "unstructuredData", "tier": "source", "desc": "PDF Memos", "row": 3.5 }
      ]
    },
    {
      "group": { "label": "SDP Pipeline", "tier": "sdp" },
      "nodes": [
        { "id": "bronze", "label": "Bronze Layer", "icon": "deltaTable", "tier": "bronze", "desc": "Raw" },
        { "id": "silver", "label": "Silver Layer", "icon": "deltaTable", "tier": "silver", "desc": "Joined" },
        { "id": "gold", "label": "Gold Layer", "icon": "deltaTable", "tier": "gold", "desc": "Segmented" },
        { "id": "volume", "label": "Playbook Volume", "icon": "unstructuredData", "tier": "bronze", "desc": "Unstructured", "row": 3.5 }
      ]
    },
    {
      "nodes": [
        { "id": "warehouse", "label": "SQL Warehouse", "icon": "sqlWarehouse", "tier": "compute", "desc": "Serverless" }
      ]
    },
    {
      "nodes": [
        { "id": "dashboard", "label": "AI/BI Dashboard", "icon": "dashboard", "tier": "analytics", "desc": "Loyalty Cockpit" },
        { "id": "genie", "label": "AI/BI Genie", "icon": "genie", "tier": "ai", "desc": "Segment Q&A", "row": 1.5 },
        { "id": "ka", "label": "Knowledge Assistant", "icon": "knowledgeAssistant", "tier": "ai", "desc": "Playbook", "row": 2.5 }
      ]
    },
    {
      "nodes": [
        { "id": "mas", "label": "Multi-Agent Supervisor", "icon": "multiAgentSupervisor", "tier": "ai", "desc": "Routing", "row": 1 }
      ]
    },
    {
      "bars": [
        { "id": "db-one", "label": "Databricks One", "tier": "interface", "vertical": true }
      ]
    },
    {
      "nodes": [
        { "id": "user", "label": "Users", "icon": "businessUser", "tier": "consumer", "desc": "End Users", "row": 1 }
      ]
    }
  ],
  "edges": [
    { "from": "src-shopify", "to": "bronze", "label": "Lakeflow Connect", "animated": true },
    { "from": "src-loyalty", "to": "bronze", "animated": true },
    { "from": "src-klaviyo", "to": "bronze", "animated": true },
    { "from": "src-docs", "to": "volume", "label": "Auto Loader", "animated": true },
    { "from": "bronze", "to": "silver", "animated": true },
    { "from": "silver", "to": "gold", "animated": true },
    { "from": "gold", "to": "warehouse" },
    { "from": "warehouse", "to": "dashboard" },
    { "from": "warehouse", "to": "genie" },
    { "from": "volume", "to": "ka" },
    { "from": "genie", "to": "mas" },
    { "from": "ka", "to": "mas" },
    { "from": "dashboard", "to": "db-one" },
    { "from": "mas", "to": "db-one" },
    { "from": "db-one", "to": "user" }
  ],
  "bars": [
    { "label": "Databricks Workflows — Orchestration", "tier": "orchestration", "startColumn": 1, "endColumn": 4 },
    { "label": "Unity Catalog — Governance & Security", "tier": "governance", "startColumn": 0, "endColumn": 6 }
  ]
}
```
