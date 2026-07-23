```json
[
  {
    "name": "AI/BI Sales Pipeline Review",
    "story": "Scattered sales data — Salesforce (accounts / pipeline / reps), the ERP (actual orders & revenue), Finance targets, and the product catalog (launches) — flows through one governed Lakeflow + Genie pipeline into the lakehouse, where AI_FORECAST projects quarter-end revenue. A metric view defines revenue vs. target once; an AI/BI dashboard and Genie sit on top, and Genie traces the Q2 2026 surge to the new EMEA Fragrance launch. The VP of Sales reaches it all through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "entry"],
    "nodes": [
      { "id": "src-crm", "type": "source", "col": "sources", "row": 1, "label": "Salesforce", "icon": "file:vendor/salesforce", "desc": "Accounts / pipeline / reps" },
      { "id": "src-erp", "type": "source", "col": "sources", "row": 2, "label": "ERP Orders", "icon": "file:vendor/sap", "desc": "Actual orders + revenue" },
      { "id": "src-finance", "type": "source", "col": "sources", "row": 3, "label": "Finance Targets", "icon": "inputData", "desc": "Company-wide quarterly target" },
      { "id": "src-catalog", "type": "source", "col": "sources", "row": 4, "label": "Product Catalog", "icon": "text", "desc": "Product lines + launch dates" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Bronze → silver → gold medallion — unifies CRM, ERP orders, targets and launches into orders_enriched + the governed Gold tables." },

      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of pipeline, orders, targets + launches — with AI_FORECAST projecting quarter-end revenue (~$33M vs a ~$21.5M target)." },

      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "desc": "Sales cockpit — forecast vs. target, revenue by region × product line, and the EMEA Fragrance ramp." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Are we going to hit the number, and why the surge? — Genie traces it to the 2026-05-04 EMEA Fragrance launch." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality across CRM, ERP, Finance + catalog data." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-crm", "src-erp", "src-finance", "src-catalog", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-crm", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e2", "from": "src-erp", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-finance", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e4", "from": "src-catalog", "to": "lakeflow-genie-block@in-direct", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },

      { "id": "e8", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e9", "from": "genie-one", "to": "genie" }
    ]
  }
]
```
