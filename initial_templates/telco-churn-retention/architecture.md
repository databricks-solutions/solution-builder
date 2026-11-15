```json
[
 {
  "name": "Retention Desk",
  "story": "Network OSS KPIs, billing, CRM/care and call transcripts land through Lakeflow into governed bronze-silver-gold tables. AI Functions read every care call (sentiment, intent, cancel threat); an XGBoost churn model registered in Unity Catalog scores every account with SHAP drivers. Scores and call insights sync to Lakebase, where the Retention Desk app and its next-best-offer agent (margin guardrail as code) stage offers and record accept/decline, written back to Delta. The CMO dashboard and Genie read the same tables through Genie One. Out of scope: real-time scoring endpoint, campaign execution systems.",
  "aspect": "16:9",
  "theme": "slide",
  "direction": "horizontal",
  "options": {
   "trademarkLogos": false
  },
  "frame": {
   "title": "Veridian Mobile \u2014 Churn Retention Desk"
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
    "id": "src-oss",
    "type": "source",
    "col": "sources",
    "row": 3,
    "label": "Network KPIs",
    "icon": "sensorSource"
   },
   {
    "id": "src-billing",
    "type": "source",
    "col": "sources",
    "row": 1,
    "label": "Billing",
    "icon": "inputData"
   },
   {
    "id": "src-crm",
    "type": "source",
    "col": "sources",
    "row": 2,
    "label": "CRM + care",
    "icon": "unstructuredData"
   },
   {
    "id": "src-calls",
    "type": "source",
    "col": "sources",
    "row": 4,
    "label": "Care calls",
    "icon": "pdfLogo"
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
    "label": "Churn risk model"
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
    "label": "Retention Desk"
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
    "label": "CMO dashboard"
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
    "from": "src-oss",
    "to": "lakeflow@in-zerobus",
    "flow": true
   },
   {
    "id": "e2",
    "from": "src-billing",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e3",
    "from": "src-crm",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e4",
    "from": "src-calls",
    "to": "lakeflow@in-direct",
    "flow": true
   },
   {
    "id": "e5",
    "from": "lakeflow",
    "to": "model",
    "flow": true,
    "label": "Features"
   },
   {
    "id": "e6",
    "from": "lakeflow",
    "to": "ai-fn",
    "flow": true,
    "label": "Transcripts"
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
    "label": "Call insights"
   },
   {
    "id": "e10",
    "from": "app",
    "to": "lakebase",
    "label": "Offers + decisions",
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
