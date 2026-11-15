```json
[
 {
  "name": "Metadata Copilot",
  "story": "Vendor metadata feeds, scene descriptions (transcripts + audio description), contract credits and viewing telemetry land in governed Delta tables. AI Functions (ai_query with a JSON schema) read every title's scenes and propose genres, moods, themes, keywords, a synopsis and every content warning with its evidencing scene, mapped onto the Orbitline+ taxonomy. Vector Search indexes title profiles (more like this) and scenes (clips to repurpose). The Genie agent answers from the gold tables and the Metadata & Content Standards Guide documents. The Metadata Copilot app mirrors the library into Lakebase, where editors review the AI proposal and publish it (write-back + audit trail); the content-strategy dashboard and Genie read the same gold tables through Genie One. Out of scope: video/audio ingestion and speech-to-text, pushing published metadata to the CMS.",
  "aspect": "16:9",
  "theme": "slide",
  "direction": "horizontal",
  "options": { "trademarkLogos": false },
  "frame": { "title": "Orbitline+ — Content Metadata Copilot" },
  "columns": ["sources", "data", "intel", "serve", "entry"],
  "nodes": [
   { "id": "src-feed", "type": "source", "col": "sources", "row": 1, "label": "Vendor feed", "icon": "inputData" },
   { "id": "src-scenes", "type": "source", "col": "sources", "row": 2, "label": "Scene text", "icon": "unstructuredData" },
   { "id": "src-credits", "type": "source", "col": "sources", "row": 3, "label": "Credits", "icon": "pdfLogo" },
   { "id": "src-views", "type": "source", "col": "sources", "row": 4, "label": "Viewing", "icon": "sensorSource" },
   { "id": "lakeflow", "type": "lakeflow-genie-block", "col": "data", "row": 1 },
   { "id": "ai-fn", "type": "information-extraction", "col": "intel", "row": 1, "label": "AI Functions" },
   { "id": "vs", "type": "vector-search", "col": "intel", "row": 2, "label": "Vector Search" },
   { "id": "genie", "type": "genie", "col": "intel", "row": 3, "label": "Genie Agent" },
   { "id": "app", "type": "databricks-apps-work", "col": "serve", "row": 1, "label": "Copilot app" },
   { "id": "lakebase", "type": "lakebase", "col": "serve", "row": 2 },
   { "id": "dash", "type": "ai-bi-dashboard", "col": "serve", "row": 3, "label": "Dashboard" },
   { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },
   { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
   { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" } },
   { "id": "platform-box", "type": "box", "wraps": ["lakeflow", "ai-fn", "vs", "genie", "app", "lakebase", "dash", "genie-one"] }
  ],
  "edges": [
   { "id": "e1", "from": "src-feed", "to": "lakeflow@in-lakeflow-connect", "flow": true },
   { "id": "e2", "from": "src-scenes", "to": "lakeflow@in-direct", "flow": true },
   { "id": "e3", "from": "src-credits", "to": "lakeflow@in-direct", "flow": true },
   { "id": "e4", "from": "src-views", "to": "lakeflow@in-zerobus", "flow": true },
   { "id": "e5", "from": "lakeflow", "to": "ai-fn", "flow": true, "label": "Scenes" },
   { "id": "e6", "from": "lakeflow", "to": "vs", "flow": true },
   { "id": "e7", "from": "lakeflow", "to": "genie", "flow": true },
   { "id": "e8", "from": "ai-fn", "to": "app", "flow": true, "label": "AI proposals" },
   { "id": "e9", "from": "vs", "to": "app", "label": "Look-alikes + clips" },
   { "id": "e10", "from": "genie", "to": "app", "label": "Data + cited rules" },
   { "id": "e11", "from": "app", "to": "lakebase", "label": "Approved metadata", "arrow": "both" },
   { "id": "e12", "from": "lakeflow", "to": "dash", "flow": true },
   { "id": "e13", "from": "genie-one", "to": "app" },
   { "id": "e14", "from": "genie-one", "to": "dash" }
  ]
 }
]
```
