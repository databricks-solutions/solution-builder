```json
[
  {
    "name": "AI/BI Customer Support — AI Efficiency",
    "story": "Support tickets (Zendesk), the CRM/booking system and the AI Support Copilot's own release + usage logs flow through one governed Lakeflow + Genie pipeline into the lakehouse. A metric view defines resolution time / cost per case / CSAT once; an AI/BI dashboard and Genie sit on top, and Genie traces the mid-2025 efficiency jump to the Copilot's GA launch. The VP of Support reaches it all through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "entry"],
    "nodes": [
      { "id": "src-tickets", "type": "source", "col": "sources", "row": 1, "label": "Zendesk", "icon": "file:vendor/zendesk", "desc": "Support tickets + resolution" },
      { "id": "src-crm", "type": "source", "col": "sources", "row": 2, "label": "Salesforce", "icon": "file:vendor/salesforce", "desc": "Customer + booking context" },
      { "id": "src-copilot", "type": "source", "col": "sources", "row": 3, "label": "AI Support Copilot", "icon": "text", "desc": "GA releases + deflection usage" },
      { "id": "src-csat", "type": "source", "col": "sources", "row": 4, "label": "CSAT Surveys", "icon": "inputData", "desc": "Post-case satisfaction" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Bronze → silver → gold medallion — joins tickets, Copilot usage/releases and CSAT into the governed Gold tables the metric view reads." },

      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of tickets, deflections + CSAT for BI + AI — the metric view defining resolution time / cost per case / CSAT lives here." },

      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "desc": "Support scorecard — resolution time (~26h → ~11h), cost per case, CSAT, and daily AI deflections climbing from the GA date." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Why did support get more efficient? — Genie traces the gain to the Copilot's 2025-06-02 GA launch and rising adoption." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality across the support data + AI." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-tickets", "src-crm", "src-copilot", "src-csat", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-tickets", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e2", "from": "src-crm", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-copilot", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e4", "from": "src-csat", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },

      { "id": "e8", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e9", "from": "genie-one", "to": "genie" }
    ]
  }
]
```
