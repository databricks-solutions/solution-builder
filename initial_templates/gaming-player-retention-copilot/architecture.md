```json
[
 {
  "name": "Live-Ops Console",
  "story": "Game telemetry (sessions, matches, stage attempts) streams in through Zerobus; store purchases and matchmaking logs arrive through Lakeflow Connect; the chat moderation queue lands directly. Lakeflow builds governed bronze-silver-gold tables (retention cohorts, ARPDAU, stage funnel, queue waits). AI Functions classify every flagged chat line (harassment vs trash talk); XGBoost churn and LTV models registered in Unity Catalog score every active player with SHAP drivers. At-risk segments sync to Lakebase, where the Live-Ops Console and its copilot (plan engine as code) stage and schedule interventions within budget, written back to Delta. The live-ops dashboard and Genie read the same tables through Genie One. Out of scope: real-time scoring endpoint, the game's live-config service that executes the patch.",
  "aspect": "16:9",
  "theme": "slide",
  "direction": "horizontal",
  "options": {
   "trademarkLogos": false
  },
  "frame": {
   "title": "Emberline Studios — Hollowspire Live-Ops Console"
  },
  "columns": [
   "sources",
   "data",
   "intel",
   "serve",
   "entry"
  ],
  "nodes": [
   {
    "id": "src-telemetry",
    "type": "source",
    "col": "sources",
    "row": 3,
    "label": "Telemetry",
    "icon": "sensorSource"
   },
   {
    "id": "src-store",
    "type": "source",
    "col": "sources",
    "row": 1,
    "label": "Store",
    "icon": "inputData"
   },
   {
    "id": "src-mm",
    "type": "source",
    "col": "sources",
    "row": 2,
    "label": "Matchmaking",
    "icon": "file:vendor/postgresql"
   },
   {
    "id": "src-chat",
    "type": "source",
    "col": "sources",
    "row": 4,
    "label": "Chat reports",
    "icon": "unstructuredData"
   },
   {
    "id": "lakeflow",
    "type": "lakeflow-genie-block",
    "col": "data",
    "row": 1
   },
   {
    "id": "model",
    "type": "ml-model",
    "col": "intel",
    "row": 1,
    "label": "Churn + LTV"
   },
   {
    "id": "ai-fn",
    "type": "information-extraction",
    "col": "intel",
    "row": 2,
    "label": "AI Functions",
    "desc": ""
   },
   {
    "id": "genie",
    "type": "genie",
    "col": "intel",
    "row": 3
   },
   {
    "id": "app",
    "type": "databricks-apps-work",
    "col": "serve",
    "row": 1,
    "label": "Live-Ops app"
   },
   {
    "id": "lakebase",
    "type": "lakebase",
    "col": "serve",
    "row": 2
   },
   {
    "id": "dash",
    "type": "ai-bi-dashboard",
    "col": "serve",
    "row": 3,
    "label": "Dashboard"
   },
   {
    "id": "genie-one",
    "type": "genie-one",
    "col": "entry",
    "rot": 90
   },
   {
    "id": "db-platform",
    "type": "db-platform",
    "pin": {
     "at": "top-left",
     "to": "platform-box"
    }
   },
   {
    "id": "governance-block",
    "type": "governance-block",
    "pin": {
     "at": "top-right",
     "to": "platform-box"
    }
   },
   {
    "id": "platform-box",
    "type": "box",
    "wraps": [
     "lakeflow",
     "model",
     "ai-fn",
     "genie",
     "app",
     "lakebase",
     "dash",
     "genie-one"
    ]
   }
  ],
  "edges": [
   {
    "id": "e1",
    "from": "src-telemetry",
    "to": "lakeflow@in-zerobus",
    "flow": true
   },
   {
    "id": "e2",
    "from": "src-store",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e3",
    "from": "src-mm",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e4",
    "from": "src-chat",
    "to": "lakeflow@in-direct",
    "flow": true
   },
   {
    "id": "e5",
    "from": "lakeflow",
    "to": "model",
    "flow": true,
    "label": "Player features"
   },
   {
    "id": "e6",
    "from": "lakeflow",
    "to": "ai-fn",
    "flow": true,
    "label": "Chat"
   },
   {
    "id": "e7",
    "from": "lakeflow",
    "to": "genie",
    "flow": true
   },
   {
    "id": "e8",
    "from": "model",
    "to": "app",
    "flow": true
   },
   {
    "id": "e9",
    "from": "ai-fn",
    "to": "lakebase",
    "flow": true,
    "label": "Toxicity labels"
   },
   {
    "id": "e10",
    "from": "app",
    "to": "lakebase",
    "label": "Plans + schedule",
    "arrow": "both"
   },
   {
    "id": "e12",
    "from": "genie-one",
    "to": "app"
   },
   {
    "id": "e13",
    "from": "genie-one",
    "to": "dash"
   },
   {
    "id": "e11",
    "from": "lakeflow",
    "to": "dash",
    "flow": true
   }
  ]
 }
]
```
