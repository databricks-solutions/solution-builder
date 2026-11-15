```json
[
  {
    "name": "Grid Ops Copilot \u2014 heat-wave overload",
    "story": "SCADA feeder/transformer telemetry, NWS weather, asset + DGA lab results and DR/DER program data land in the lakehouse. A temperature-aware load-forecast model projects every transformer 48 h ahead; gold tables score asset health and cost three relief options. Operators see it in the control-room app, where the GridOps agent (tools over the gold tables + Genie) explains the risk, ranks the options and \u2014 after approval \u2014 writes the dispatched action back to Delta. Dashboard + Genie serve reliability (SAIDI/SAIFI) analytics.",
    "aspect": "16:9",
    "theme": "slide",
    "direction": "horizontal",
    "columns": [
      "sources",
      "data",
      "work",
      "entry"
    ],
    "nodes": [
      {
        "id": "src-scada",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "SCADA",
        "icon": "sensorSource"
      },
      {
        "id": "src-weather",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "NWS weather",
        "icon": "inputData"
      },
      {
        "id": "src-assets",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Asset + DGA",
        "icon": "dbTable"
      },
      {
        "id": "src-dr",
        "type": "source",
        "col": "sources",
        "row": 4,
        "label": "DR / DER",
        "icon": "inputData"
      },
      {
        "id": "lakeflow",
        "type": "lakeflow-block",
        "col": "data",
        "row": 1,
        "params": {
          "gold_desc": "Health, forecast, options"
        }
      },
      {
        "id": "ml",
        "type": "ml-training-serving",
        "col": "data",
        "row": 3,
        "label": "Load forecast"
      },
      {
        "id": "sql-lakehouse",
        "type": "sql-lakehouse",
        "col": "work",
        "row": 1
      },
      {
        "id": "ai-bi-dashboard",
        "type": "ai-bi-dashboard",
        "col": "work",
        "row": 3
      },
      {
        "id": "genie",
        "type": "genie",
        "col": "work",
        "row": 2
      },
      {
        "id": "app",
        "type": "databricks-apps-work",
        "col": "work",
        "row": 4,
        "label": "Grid Ops app"
      },
      {
        "id": "genie-one",
        "type": "genie-one",
        "col": "entry",
        "rot": 90
      },
      {
        "id": "platform-box",
        "type": "box",
        "z": -1,
        "pad": 40,
        "wraps": [
          "lakeflow",
          "ml",
          "sql-lakehouse",
          "ai-bi-dashboard",
          "genie",
          "app",
          "genie-one"
        ]
      },
      {
        "id": "db-platform",
        "type": "db-platform",
        "pin": {
          "at": "top-left",
          "to": "platform-box"
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "src-scada",
        "to": "lakeflow@in-zerobus",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-weather",
        "to": "lakeflow@in-lakeflow-connect",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-assets",
        "to": "lakeflow@in-lakeflow-connect",
        "flow": true
      },
      {
        "id": "e4",
        "from": "src-dr",
        "to": "lakeflow@in-direct",
        "flow": true
      },
      {
        "id": "e5",
        "from": "lakeflow",
        "to": "sql-lakehouse",
        "flow": true
      },
      {
        "id": "e6",
        "from": "lakeflow@b",
        "to": "ml@t",
        "label": "48 h forecast"
      },
      {
        "id": "e7",
        "from": "sql-lakehouse",
        "to": "ai-bi-dashboard"
      },
      {
        "id": "e8",
        "from": "sql-lakehouse",
        "to": "genie"
      },
      {
        "id": "e9",
        "from": "ml",
        "to": "app",
        "label": "risk + options"
      },
      {
        "id": "e12",
        "from": "genie-one",
        "to": "app"
      }
    ]
  }
]
```
