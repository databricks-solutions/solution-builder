```json
[
  {
    "name": "AI/BI Marketing Campaign Effectiveness",
    "story": "Paid + owned channel data — TikTok Ads, Google Ads, Instagram (Meta) and the email platform — plus the creatives dimension flow through one governed Lakeflow + Genie pipeline into the lakehouse. A metric view defines spend / conversions / ROAS once; an AI/BI dashboard and Genie sit on top, and Genie traces the late-2025 revenue drop to one underperforming creative in two markets. The Head of Growth reaches it all through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "entry"],
    "nodes": [
      { "id": "src-tiktok", "type": "source", "col": "sources", "row": 1, "label": "TikTok Ads", "icon": "file:vendor/tiktok", "desc": "Paid social spend + performance" },
      { "id": "src-google", "type": "source", "col": "sources", "row": 2, "label": "Google Ads", "icon": "file:vendor/google-ads", "desc": "Search + display campaigns" },
      { "id": "src-meta", "type": "source", "col": "sources", "row": 3, "label": "Instagram (Meta)", "icon": "file:vendor/meta", "desc": "Paid social spend + performance" },
      { "id": "src-email", "type": "source", "col": "sources", "row": 4, "label": "Email Platform", "icon": "file:vendor/mailchimp", "desc": "Owned channel sends + revenue" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Bronze → silver → gold medallion — joins per-channel performance to the creatives dimension (flagging the underperforming creative) into the governed Gold tables." },

      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of multi-channel spend, conversions + revenue — the metric view defining ROAS / conversion rate lives here." },

      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "desc": "Marketing performance — ROAS trend, a world map with Germany & France going red, and channel × market breakdowns." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Why did revenue drop while spend held? — Genie names the 'Fall Sale - v2 (DE/FR)' creative in the Q4 Growth Push campaign, TikTok, DE + FR." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality across the marketing data + AI." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-tiktok", "src-google", "src-meta", "src-email", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-tiktok", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e2", "from": "src-google", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-meta", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e4", "from": "src-email", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },

      { "id": "e8", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e9", "from": "genie-one", "to": "genie" }
    ]
  }
]
```
