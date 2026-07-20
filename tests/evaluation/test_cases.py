from __future__ import annotations

from evaluation.cases import load_cases
from tests.pipeline.scenarios import SCENARIOS


LEGACY = {
    "financial-services": {
        "capabilities": ["genie", "aibi-dashboards", "synthetic-data-gen"],
        "initial_prompt": "Build a fraud-detection demo for a retail bank. Use synthetic credit-card transactions, an anomaly-detection pattern, a Genie space for ad-hoc questions, and an AI/BI dashboard for the trend view.",
        "drive_messages": [
            "Looks good — proceed to architect the pipeline and produce architecture.md.",
            "Now write the specifications for each component (specifications/*.md).",
            "Build it: write the SQL/Python and capture deployed resource IDs in resources.json.",
        ],
    },
    "healthcare": {
        "capabilities": ["knowledge-assistant", "vector-search", "ml-training-serving"],
        "initial_prompt": "Build a patient-readmission risk demo. Knowledge Assistant over discharge-summary documents, vector search over the same corpus, and a tabular ML model that scores 30-day readmission risk on synthetic patient data.",
        "drive_messages": [
            "Proceed: architect the components and produce architecture.md.",
            "Write the per-component specifications under specifications/.",
            "Build it now — generate the code, training notebook, and resources.json.",
        ],
    },
    "manufacturing-machinery": {
        "capabilities": [
            "synthetic-data-gen",
            "genie",
            "supervisor-agent",
            "databricks-apps",
        ],
        "initial_prompt": "Build a warranty-optimization demo for a heavy-machinery OEM (Manufacturing > Machinery sub-vertical). Use synthetic-data-gen to create warranty claims and machine-telemetry tables in Delta, stand up a Genie space over the Gold warranty tables for ad-hoc cost/failure-mode questions, wire a multi-agent supervisor that routes between Genie (quantitative) and a claims-triage agent, and ship a Databricks App (FastAPI + React) where a field-service manager can inspect a claim and see the supervisor's recommendation.",
        "drive_messages": [
            "Looks good — proceed to architect the pipeline and produce architecture.md.",
            "Now write the specifications for each component (specifications/*.md) — synthetic data tables, Genie space, supervisor agent, and the Databricks App.",
            "Build it: write the SQL/Python for synthetic data, the Genie config, the supervisor agent definition, the app code, and capture deployed resource IDs in resources.json.",
        ],
    },
    "retail": {
        "capabilities": ["lakebase", "ml-training-serving", "sdp"],
        "initial_prompt": "Build a demand-forecasting demo for an omnichannel retailer. Use a Lakeflow Spark Declarative Pipeline (SDP) to ingest synthetic POS events into Delta, land aggregates in Lakebase for fast lookups, and serve a Prophet-style forecast via Model Serving.",
        "drive_messages": [
            "Proceed: produce architecture.md.",
            "Write the per-component specifications.",
            "Build it: generate the SDP pipeline, the Lakebase sync, the forecast notebook, and resources.json.",
        ],
    },
}


def test_four_canonical_cases_validate() -> None:
    cases = load_cases()
    assert [case.id for case in cases] == [
        "financial-services",
        "healthcare",
        "manufacturing-machinery",
        "retail",
    ]
    assert all(case.timeout_seconds == 3600 for case in cases)
    assert all(case.target_stage.value == "BUILT" for case in cases)


def test_pipeline_compatibility_preserves_existing_scenarios() -> None:
    assert len(SCENARIOS) == 4
    for scenario in SCENARIOS:
        expected = LEGACY[scenario.slug]
        assert scenario.capabilities == expected["capabilities"]
        assert scenario.initial_prompt == expected["initial_prompt"]
        assert scenario.drive_messages == expected["drive_messages"]
        assert scenario.target_stage == "BUILT"
        assert scenario.timeout_seconds == 3600
