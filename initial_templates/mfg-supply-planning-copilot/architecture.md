# Supply Planning Copilot Architecture

S&OP supply planning and inventory optimization for Corvane Motion Systems (fictional): AI_FORECAST demand, BOM explosion, 13-week stock-out projection, priced mitigations, plan booking with write-back.

```json
[
  {
    "name": "Supply Planning Copilot Platform",
    "story": "Corvane Motion Systems (fictional industrial-components maker, plants Dayton / Monterrey / Wroclaw). ERP orders, inventory, POs and BOM plus supplier and forwarder emails land in Unity Catalog. AI_FORECAST projects 13 weeks of demand, the BOM explodes it into component requirements, and the projection against on-hand + POs at revised ETA surfaces stock-outs with revenue at risk. ai_extract turns supplier emails (Yantian port delay) into structured signals. The Supply Planning Copilot app (Lakebase) prices every mitigation, the agent proposes the cheapest plan with policy citations (the Genie agent over the policy manual) and the planner books it; the booked plan is written back to Delta for the AI/BI dashboard and Genie.",
    "aspect": "16:9",
    "frame": {
      "title": "Supply Planning Copilot",
      "subtitle": "Corvane Motion Systems: S&OP supply planning and inventory optimization"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": [
      "sources",
      "ingest",
      "data",
      "serve",
      "experience"
    ],
    "nodes": [
      {
        "id": "src-erp",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "ERP",
        "icon": "text",
        "desc": "Orders, POs, BOM"
      },
      {
        "id": "src-email",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Emails",
        "icon": "text",
        "desc": "Supplier delays"
      },
      {
        "id": "lakeflow-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 1,
        "label": "Setup job"
      },
      {
        "id": "ai-extract",
        "type": "information-extraction",
        "col": "ingest",
        "row": 2,
        "label": "ai_extract"
      },
      {
        "id": "medallion",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "ERP + emails",
          "silver_desc": "AI_FORECAST x BOM",
          "gold_desc": "Projection, exposures",
          "metric_views": true
        }
      },
      {
        "id": "policy-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 2,
        "label": "Policy docs"
      },
      {
        "id": "dashboard",
        "type": "ai-bi-dashboard",
        "col": "experience",
        "row": 1,
        "label": "Supply health"
      },
      {
        "id": "genie",
        "type": "genie",
        "col": "serve",
        "row": 2,
        "label": "Genie Agent"
      },
      {
        "id": "app",
        "type": "databricks-apps-work",
        "col": "serve",
        "row": 1,
        "label": "Planner console"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "experience",
        "row": 2,
        "label": "Plans + audit"
      },
      {
        "id": "governance-block",
        "type": "governance-block",
        "pin": {
          "at": "top-left",
          "to": "platform-box"
        },
        "params": {
          "access_control": true,
          "ai_gateway": true,
          "genie_ontology": false
        }
      },
      {
        "id": "db-platform",
        "type": "db-platform",
        "pin": {
          "at": "top-right",
          "to": "platform-box"
        }
      },
      {
        "id": "platform-box",
        "type": "box",
        "wraps": [
          "medallion",
          "policy-volume",
          "dashboard",
          "genie",
          "app",
          "lakebase"
        ]
      }
    ],
    "edges": [
      {
        "id": "e-erp-job",
        "from": "src-erp",
        "to": "lakeflow-job",
        "label": "Weekly extract",
        "flow": true
      },
      {
        "id": "e-email-extract",
        "from": "src-email",
        "to": "ai-extract",
        "label": "Raw emails",
        "flow": true
      },
      {
        "id": "e-job-medallion",
        "from": "lakeflow-job",
        "to": "medallion",
        "label": "Load",
        "flow": true
      },
      {
        "id": "e-extract-medallion",
        "from": "ai-extract",
        "to": "medallion",
        "label": "PO delays",
        "flow": true
      },
      {
        "id": "e-medallion-genie",
        "from": "medallion@out-mv",
        "to": "genie",
        "label": "Governed tables",
        "flow": true
      },
      {
        "id": "e-medallion-app",
        "from": "medallion@out-gold",
        "to": "app",
        "label": "Exposures",
        "flow": true
      },
      {
        "id": "e-volume-genie",
        "from": "policy-volume",
        "to": "genie",
        "label": "Policy docs",
        "flow": true
      },
      {
        "id": "e-genie-app",
        "from": "genie",
        "to": "app",
        "label": "Data + cited rules"
      },
      {
        "id": "e-agent-lakebase",
        "from": "app",
        "to": "lakebase",
        "label": "Proposed plan"
      },
      {
        "id": "e-app-dashboard",
        "from": "app",
        "to": "dashboard",
        "label": "Embeds"
      }
    ]
  },
  {
    "name": "Plan an exposure",
    "story": "Detail: how one stock-out exposure becomes a booked plan. The projection finds HX-220 at Dayton short in week 2; the engine prices every lever (transfer E&O stock from Monterrey, alternate foundry, air expedite, safety stock); the agent simulates, checks the policy and stages the cheapest plan; the planner books it and it is written back to Delta.",
    "aspect": "16:9",
    "frame": {
      "title": "From stock-out to booked plan",
      "subtitle": "Inside the Supply Planning Copilot"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": [
      "detect",
      "price",
      "decide",
      "book"
    ],
    "nodes": [
      {
        "id": "s-forecast",
        "type": "shape",
        "shape": "rounded",
        "col": "detect",
        "row": 1,
        "text": "AI_FORECAST\nx BOM"
      },
      {
        "id": "s-projection",
        "type": "shape",
        "shape": "rounded",
        "col": "detect",
        "row": 2,
        "text": "Projection at\nrevised ETA"
      },
      {
        "id": "s-levers",
        "type": "shape",
        "shape": "rounded",
        "col": "price",
        "row": 1,
        "text": "Price levers:\ntransfer, alternate, air"
      },
      {
        "id": "s-sim",
        "type": "shape",
        "shape": "rounded",
        "col": "price",
        "row": 2,
        "text": "Simulate plan\n13 weeks"
      },
      {
        "id": "s-policy",
        "type": "shape",
        "shape": "document",
        "col": "decide",
        "row": 1,
        "text": "Policy check\n(Genie agent)"
      },
      {
        "id": "s-propose",
        "type": "shape",
        "shape": "hexagon",
        "col": "decide",
        "row": 2,
        "text": "Agent stages\ncheapest plan"
      },
      {
        "id": "s-book",
        "type": "shape",
        "shape": "rounded",
        "col": "book",
        "row": 1,
        "text": "Planner books\nthe plan"
      },
      {
        "id": "s-delta",
        "type": "shape",
        "shape": "cylinder",
        "col": "book",
        "row": 2,
        "text": "Lakebase +\nDelta write-back"
      }
    ],
    "edges": [
      {
        "id": "f1",
        "from": "s-forecast",
        "to": "s-projection",
        "label": "Requirements"
      },
      {
        "id": "f2",
        "from": "s-projection",
        "to": "s-levers",
        "label": "Stock-out wk 2"
      },
      {
        "id": "f3",
        "from": "s-levers",
        "to": "s-sim",
        "label": "Options"
      },
      {
        "id": "f4",
        "from": "s-sim",
        "to": "s-policy",
        "label": "Cost, approver"
      },
      {
        "id": "f5",
        "from": "s-policy",
        "to": "s-propose",
        "label": "Cited rules"
      },
      {
        "id": "f6",
        "from": "s-propose",
        "to": "s-book",
        "label": "Proposal"
      },
      {
        "id": "f7",
        "from": "s-book",
        "to": "s-delta",
        "label": "Write"
      }
    ]
  }
]
```
