```json
[
  {
    "name": "AI/BI Patient Genomics — Precision Oncology RWE",
    "story": "Real-world evidence data — the clinical EHR (treatment arm + survival outcomes), the genomics platform (gene-expression profiles + UMAP coordinates), and the tumor registry (cancer site + demographics) — flows through one governed Lakeflow + Genie pipeline into the lakehouse. A metric view defines survival lift once; an AI/BI dashboard and Genie sit on top, and Genie shows the responders share a molecular subtype, not an organ. The translational oncology lead reaches it all through Genie One.",
    "columns": ["sources", "pipeline", "compute", "work", "entry"],
    "nodes": [
      { "id": "src-ehr", "type": "source", "col": "sources", "row": 1, "label": "Clinical EHR", "icon": "inputData", "desc": "Treatment arm + 24-mo survival" },
      { "id": "src-genomics", "type": "source", "col": "sources", "row": 2, "label": "Genomics Platform", "icon": "text", "desc": "Gene-expression + UMAP (c1,c2)" },
      { "id": "src-registry", "type": "source", "col": "sources", "row": 3, "label": "Tumor Registry", "icon": "text", "desc": "Cancer site + demographics" },
      { "id": "src-cohort", "type": "source", "col": "sources", "row": 4, "label": "TCGA-style Cohort", "icon": "pdfLogo", "desc": "~10,000-patient RWE files" },

      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline", "desc": "Bronze → silver → gold medallion — joins EHR outcomes, gene-expression profiles and registry data into the governed Gold cohort tables." },

      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute", "row": 1, "desc": "One governed copy of the patient cohort — outcomes, molecular profiles + sites — with the metric view defining survival lift by subgroup." },

      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "desc": "RWE dashboard — overall survival lift, the by-cancer-site breakdown, and the UMAP responder cluster." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "desc": "Which subgroup benefits most from OncoTarget-1? — Genie points to the molecular gene-expression subtype (a UMAP cluster), not an organ." },

      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },

      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" }, "desc": "Unity Catalog governs access, lineage and quality across sensitive clinical + genomic data." },

      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["src-ehr", "src-genomics", "src-registry", "src-cohort", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
    ],
    "edges": [
      { "id": "e1", "from": "src-ehr", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e2", "from": "src-genomics", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-registry", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e4", "from": "src-cohort", "to": "lakeflow-genie-block@in-direct", "flow": true },

      { "id": "e5", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },

      { "id": "e8", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e9", "from": "genie-one", "to": "genie" }
    ]
  }
]
```
