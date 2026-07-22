```json
[
  {
    "name": "Healthcare CFO — Budget Variance & Comp Controls",
    "story": "The GL (Oracle ERP), HRIS/payroll, timekeeping and staffing-vendor invoices flow through one governed Lakeflow + Genie pipeline into the lakehouse, where AI_FORECAST projects opex to year-end. A two-page FP&A dashboard and Genie sit on top; Unity Catalog column-masking (comp controls) governs who sees compensation detail. The CFO reaches it all through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "entry"],
    "nodes": [
      { "id": "src-erp", "type": "source", "col": "sources", "row": 1, "label": "Oracle ERP", "icon": "file:vendor/oracle", "desc": "GL + budget" },
      { "id": "src-hris", "type": "source", "col": "sources", "row": 2, "label": "HRIS / Payroll", "icon": "file:vendor/sap", "desc": "Comp + headcount" },
      { "id": "src-timekeeping", "type": "source", "col": "sources", "row": 3, "label": "Timekeeping", "icon": "inputData", "desc": "Employed vs. agency hours" },
      { "id": "src-invoices", "type": "source", "col": "sources", "row": 4, "label": "Staffing Invoices", "icon": "pdfLogo", "desc": "Agency vendor bills" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Bronze → silver → gold medallion — the variance + AI_FORECAST transforms that turn the raw GL, staffing, comp and revenue feeds into the governed Gold tables." },

      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of GL, staffing, comp + revenue for BI + AI — with AI_FORECAST projecting opex to year-end." },

      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "desc": "FP&A cockpit — board narrative (forecast-vs-budget + a hospital map pinning the overrun to two sites) + guided drill-down to the contract-labor root cause." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Why is Nursing over budget? — plain-language variance Q&A on the same Gold tables." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" }, "desc": "The Databricks Data + AI platform — one governed foundation for all data + AI." },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality — including column-masking comp controls: Finance sees full comp, managers see headcount only." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-erp", "src-hris", "src-timekeeping", "src-invoices", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-erp", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e2", "from": "src-hris", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-timekeeping", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e4", "from": "src-invoices", "to": "lakeflow-genie-block@in-direct", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },

      { "id": "e8", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e9", "from": "genie-one", "to": "genie" }
    ]
  }
]
```
