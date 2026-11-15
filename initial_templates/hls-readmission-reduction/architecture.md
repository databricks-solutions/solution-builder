```json
[
 {
  "name": "Readmission Copilot",
  "story": "Discharge records, registration social history, discharge summaries and Larkspur's care-transition pathways land in governed Delta tables. AI Functions (ai_query with a typed schema) read every discharge note for social risks, medication changes and how follow-up was left; a 30-day readmission model registered in Unity Catalog scores every open discharge; the Genie agent answers from the gold tables and from the care-pathway and HRRP-primer documents; gold tables estimate the CMS HRRP excess readmission ratio and penalty. The Readmission Copilot app (Lakebase) ranks the worklist, builds each patient's transition plan and writes the approved outreach tasks back. The dashboard and Genie read the same gold tables.",
  "aspect": "16:9",
  "theme": "slide",
  "direction": "horizontal",
  "options": {
   "trademarkLogos": false
  },
  "frame": {
   "title": "Larkspur Health \u2014 Readmission Copilot"
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
    "id": "src-ehr",
    "type": "source",
    "col": "sources",
    "row": 1,
    "label": "EHR (ADT)",
    "icon": "inputData"
   },
   {
    "id": "src-adt",
    "type": "source",
    "col": "sources",
    "row": 2,
    "label": "Registration",
    "icon": "inputData"
   },
   {
    "id": "src-notes",
    "type": "source",
    "col": "sources",
    "row": 3,
    "label": "Notes",
    "icon": "unstructuredData"
   },
   {
    "id": "src-docs",
    "type": "source",
    "col": "sources",
    "row": 4,
    "label": "Pathways",
    "icon": "pdfLogo"
   },
   {
    "id": "lakeflow",
    "type": "lakeflow-genie-block",
    "col": "data",
    "row": 1
   },
   {
    "id": "ai-fn",
    "type": "information-extraction",
    "col": "intel",
    "row": 1,
    "label": "AI Functions",
    "desc": ""
   },
   {
    "id": "model",
    "type": "ml-model",
    "col": "intel",
    "row": 2,
    "label": "Risk model"
   },
   {
    "id": "genie",
    "type": "genie",
    "col": "intel",
    "row": 3,
    "label": "Genie Agent"
   },
   {
    "id": "app",
    "type": "databricks-apps-work",
    "col": "serve",
    "row": 1,
    "label": "Copilot app"
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
     "ai-fn",
     "model",
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
    "from": "src-ehr",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e2",
    "from": "src-adt",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e3",
    "from": "src-notes",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e4",
    "from": "src-docs",
    "to": "lakeflow@in-direct",
    "flow": true
   },
   {
    "id": "e5",
    "from": "lakeflow",
    "to": "ai-fn",
    "flow": true,
    "label": "Discharge notes"
   },
   {
    "id": "e6",
    "from": "lakeflow",
    "to": "model",
    "flow": true,
    "label": "History"
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
    "to": "lakebase",
    "flow": true,
    "label": "Risk worklist"
   },
   {
    "id": "e9",
    "from": "genie",
    "to": "app",
    "label": "Cited pathway steps"
   },
   {
    "id": "e10",
    "from": "app",
    "to": "lakebase",
    "label": "Plans + outreach tasks",
    "arrow": "both"
   },
   {
    "id": "e11",
    "from": "lakeflow",
    "to": "dash",
    "flow": true
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
   }
  ]
 }
]```