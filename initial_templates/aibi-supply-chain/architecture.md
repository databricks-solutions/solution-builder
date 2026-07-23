```json
[
  {
    "name": "AI/BI Supply Chain Optimization",
    "story": "Manufacturing data — the ERP (orders + bill of materials), the inventory / warehouse system (on-hand stock), supplier master data (lead times), and the new market-launch feed — flows through one governed Lakeflow + Genie pipeline into the lakehouse, where an AI demand forecast projects component cover. A metric view defines weeks-of-cover once; an AI/BI dashboard and Genie sit on top, and Genie traces the Battery Cell crunch to a new EMEA market launch. The supply-chain planner reaches it all through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "entry"],
    "nodes": [
      { "id": "src-erp", "type": "source", "col": "sources", "row": 1, "label": "ERP (Orders + BOM)", "icon": "file:vendor/sap", "desc": "Demand + bill of materials" },
      { "id": "src-inventory", "type": "source", "col": "sources", "row": 2, "label": "Inventory / WMS", "icon": "inputData", "desc": "On-hand stock by plant" },
      { "id": "src-suppliers", "type": "source", "col": "sources", "row": 3, "label": "Supplier Master", "icon": "text", "desc": "Components + lead times" },
      { "id": "src-launches", "type": "source", "col": "sources", "row": 4, "label": "Market Launches", "icon": "text", "desc": "New-market openings" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Bronze → silver → gold medallion — rolls demand through the BOM against on-hand stock + lead times into the governed Gold tables." },

      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of demand, inventory, BOM + lead times — with an AI demand forecast and weeks-of-cover projections." },

      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "desc": "Component-cover board — weeks of cover, the projected Battery Cell stockout at Rotterdam, and the demand forecast vs. an 8-week lead time." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Why is the Battery Cell about to stock out? — Genie traces it to the City E-Bike's new EMEA market launch surging demand through the shared BOM." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality across ERP, inventory + supplier data." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-erp", "src-inventory", "src-suppliers", "src-launches", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-erp", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e2", "from": "src-inventory", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-suppliers", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e4", "from": "src-launches", "to": "lakeflow-genie-block@in-direct", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },

      { "id": "e8", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e9", "from": "genie-one", "to": "genie" }
    ]
  }
]
```
