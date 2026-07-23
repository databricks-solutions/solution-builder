```json
[
  {
    "name": "AI/BI Portfolio Assistant",
    "story": "Portfolio data — daily market prices (Yahoo Finance), the holdings / positions book, the rebalance log, and the benchmark (Nasdaq-100) — flows through one governed Lakeflow + Genie pipeline into the lakehouse, where analysis tables compute return, Value at Risk and concentration. A metric view defines the fund KPIs once; an AI/BI dashboard and Genie sit on top, and Genie traces the flagship fund's outperformance and rising concentration to three reorganizations. The CIO reaches it all through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "entry"],
    "nodes": [
      { "id": "src-prices", "type": "source", "col": "sources", "row": 1, "label": "Market Prices", "icon": "text", "desc": "Daily prices (Yahoo Finance)" },
      { "id": "src-holdings", "type": "source", "col": "sources", "row": 2, "label": "Holdings Book", "icon": "inputData", "desc": "Positions per fund" },
      { "id": "src-rebalances", "type": "source", "col": "sources", "row": 3, "label": "Rebalance Log", "icon": "text", "desc": "Reorganizations + trades" },
      { "id": "src-benchmark", "type": "source", "col": "sources", "row": 4, "label": "Benchmark (QQQ)", "icon": "text", "desc": "Nasdaq-100 reference" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Bronze → silver → gold medallion — joins prices, holdings and rebalances into the return / VaR / concentration analysis tables." },

      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of prices, holdings + rebalances — the metric view defining cumulative return, VaR and concentration lives here." },

      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "desc": "Fund review — cumulative return vs. the Nasdaq-100 benchmark, Value at Risk, and core-AI concentration stepping up over time." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Why is the fund winning, and how did it get so concentrated? — Genie traces it to three rebalances capped by the 2025-08-04 AI pivot (~77% core-AI)." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality across market + portfolio data." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-prices", "src-holdings", "src-rebalances", "src-benchmark", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-prices", "to": "lakeflow-genie-block@in-direct", "flow": true },
      { "id": "e2", "from": "src-holdings", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-rebalances", "to": "lakeflow-genie-block@in-direct", "flow": true },
      { "id": "e4", "from": "src-benchmark", "to": "lakeflow-genie-block@in-direct", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },

      { "id": "e8", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e9", "from": "genie-one", "to": "genie" }
    ]
  }
]
```
