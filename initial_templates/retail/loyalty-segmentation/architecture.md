```json
[
  {
    "name": "Harvestly Loyalty Segmentation",
    "story": "Shopify, the loyalty platform and Klaviyo flow through one governed Lakeflow + Genie pipeline into the lakehouse; the Marketing Playbook PDFs land on a UC Volume. A dashboard, Genie and a Knowledge Assistant sit on top, and a Supervisor Agent composes a per-segment campaign plan the VP of Customer Marketing reaches through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "agents", "entry", "user"],
    "nodes": [
      { "id": "src-shopify", "type": "source", "col": "sources", "row": 1, "label": "Shopify", "ingest": "lakeflow-connect", "desc": "Orders" },
      { "id": "src-loyalty", "type": "source", "col": "sources", "row": 2, "label": "Loyalty Platform", "ingest": "lakeflow-connect", "desc": "Members + Tier" },
      { "id": "src-klaviyo", "type": "source", "col": "sources", "row": 3, "label": "Klaviyo", "ingest": "lakeflow-connect", "desc": "Email + Redemptions" },
      { "id": "src-playbook", "type": "source", "col": "sources", "row": 4, "label": "Marketing Playbook", "icon": "pdfLogo", "ingest": "direct", "desc": "PDF memos" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Declarative bronze → silver → gold — Genie Code describes the segmentation transforms, Lakeflow runs them at scale." },

      { "id": "lakehouse", "type": "lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of the segmented 800K-member base for BI + AI." },
      { "id": "playbook-volume", "type": "uc-volume", "col": "compute", "row": 2, "label": "Playbook Volume", "desc": "Where the raw Marketing Playbook PDFs land." },

      { "id": "aibi-dashboards", "type": "aibi-dashboards", "col": "work", "row": 1, "desc": "Loyalty Cockpit — margin vs. incremental revenue by segment." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Segment Q&A — Champions / New Loyalists / Cooling Off / Win-Back." },
      { "id": "knowledge-assistant", "type": "knowledge-assistant", "col": "work", "row": 3, "desc": "Grounded, cited tactics from the Customer Marketing Playbook." },

      { "id": "supervisor-agent", "type": "supervisor-agent", "col": "agents", "desc": "Routes to Genie + the Knowledge Assistant and composes a per-segment campaign plan." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },
      { "id": "user", "type": "logo", "col": "user", "icon": "file:persona/user", "text": "End user", "caption": "bottom" },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" }, "desc": "The Databricks Data + AI platform — one governed foundation for all data + AI." },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality across every table and volume." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-shopify", "src-loyalty", "src-klaviyo", "src-playbook", "lakeflow-genie-block", "lakehouse", "playbook-volume", "aibi-dashboards", "genie", "knowledge-assistant", "supervisor-agent", "genie-one", "user"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-shopify", "to": "lakeflow-genie-block", "flow": true },
      { "id": "e2", "from": "src-loyalty", "to": "lakeflow-genie-block", "flow": true },
      { "id": "e3", "from": "src-klaviyo", "to": "lakeflow-genie-block", "flow": true },
      { "id": "e4", "from": "src-playbook", "to": "playbook-volume", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "lakehouse", "flow": true },
      { "id": "e6", "from": "lakehouse", "to": "aibi-dashboards", "flow": true },
      { "id": "e7", "from": "lakehouse", "to": "genie", "flow": true },
      { "id": "e8", "from": "playbook-volume", "to": "knowledge-assistant", "flow": true },

      { "id": "e9", "from": "genie", "to": "supervisor-agent", "flow": true },
      { "id": "e10", "from": "knowledge-assistant", "to": "supervisor-agent", "flow": true },

      { "id": "e11", "from": "user", "to": "genie-one" },
      { "id": "e12", "from": "genie-one", "to": "supervisor-agent" },
      { "id": "e13", "from": "genie-one", "to": "aibi-dashboards" }
    ]
  }
]
```
