"""Hardcoded end-to-end scenarios.

Each scenario drives a single project from creation through the agent until it
reaches a target stage. To add a new scenario, append a Scenario to SCENARIOS.
Capability slugs must match filenames in
.claude/skills/databricks-solution-builder/references/blocks/capabilities/.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# Stage ordering must match backend.models.ProjectStage
STAGE_ORDER = [
    "DRAFTING",
    "SUMMARIZED",
    "ARCHITECTED",
    "SPECIFICATION",
    "BUILT",
    "BUNDLED",
]


def stage_index(stage: str) -> int:
    try:
        return STAGE_ORDER.index(stage)
    except ValueError:
        return -1


@dataclass
class Scenario:
    slug: str
    description: str
    capabilities: list[str]
    initial_prompt: str
    drive_messages: list[str] = field(default_factory=list)
    target_stage: str = "BUILT"
    timeout_seconds: int = 60 * 60  # 60 min default per scenario

    def __post_init__(self) -> None:
        if stage_index(self.target_stage) < 0:
            raise ValueError(f"unknown target_stage: {self.target_stage}")


SCENARIOS: list[Scenario] = [
    Scenario(
        slug="financial-services",
        description=(
            "Real-time fraud detection demo for a retail bank. "
            "Generate synthetic credit-card transactions, surface anomalies in a "
            "Genie space, and visualize trends in an AI/BI dashboard."
        ),
        capabilities=["genie", "aibi-dashboards", "synthetic-data-gen"],
        initial_prompt=(
            "Build a fraud-detection demo for a retail bank. "
            "Use synthetic credit-card transactions, an anomaly-detection pattern, "
            "a Genie space for ad-hoc questions, and an AI/BI dashboard for the trend view."
        ),
        drive_messages=[
            "Looks good — proceed to architect the pipeline and produce architecture.md.",
            "Now write the specifications for each component (specifications/*.md).",
            "Build it: write the SQL/Python and capture deployed resource IDs in resources.json.",
        ],
        target_stage="BUILT",
    ),
    Scenario(
        slug="healthcare",
        description=(
            "Patient-readmission risk demo for a hospital network. "
            "Combine clinical notes (discharge-summary PDFs answered by a Genie agent) with a "
            "tabular ML model for 30-day readmission risk."
        ),
        capabilities=["unstructured-documents", "genie", "ml-training-serving"],
        initial_prompt=(
            "Build a patient-readmission risk demo. "
            "A Genie agent answers questions over discharge-summary PDFs in a dedicated documents volume, "
            "and a tabular ML model scores 30-day readmission risk on synthetic patient data."
        ),
        drive_messages=[
            "Proceed: architect the components and produce architecture.md.",
            "Write the per-component specifications under specifications/.",
            "Build it now — generate the code, training notebook, and resources.json.",
        ],
        target_stage="BUILT",
    ),
    Scenario(
        slug="manufacturing-machinery",
        description=(
            "Warranty optimization demo for a heavy-machinery OEM (Manufacturing > Machinery sub-vertical). "
            "Synthetic warranty claims + telemetry land in Delta, a Genie space answers quantitative "
            "warranty-cost questions, the same Genie agent answers from claims-triage policy PDFs, "
            "and a Databricks App gives field service a UI to inspect claims."
        ),
        capabilities=["synthetic-data-gen", "genie", "unstructured-documents", "databricks-apps"],
        initial_prompt=(
            "Build a warranty-optimization demo for a heavy-machinery OEM (Manufacturing > Machinery sub-vertical). "
            "Use synthetic-data-gen to create warranty claims and machine-telemetry tables in Delta, "
            "stand up a Genie agent over the Gold warranty tables for ad-hoc cost/failure-mode questions, "
            "attach a dedicated documents volume of claims-triage policy PDFs to the same Genie agent, "
            "and ship a Databricks App (FastAPI + React) where a field-service manager can inspect a claim."
        ),
        drive_messages=[
            "Looks good — proceed to architect the pipeline and produce architecture.md.",
            "Now write the specifications for each component (specifications/*.md) — synthetic data tables, Genie agent with the documents volume, and the Databricks App.",
            "Build it: write the SQL/Python for synthetic data, the PDFs + volume upload, the Genie agent config, the app code, and capture deployed resource IDs (including documents_volume) in resources.json.",
        ],
        target_stage="BUILT",
    ),
    Scenario(
        slug="retail",
        description=(
            "Demand-forecasting demo for an omnichannel retailer. "
            "Stream point-of-sale events into Delta, aggregate into a Lakebase OLTP store, "
            "and serve a forecast model via Model Serving."
        ),
        capabilities=["lakebase", "ml-training-serving", "sdp"],
        initial_prompt=(
            "Build a demand-forecasting demo for an omnichannel retailer. "
            "Use a Lakeflow Spark Declarative Pipeline (SDP) to ingest synthetic POS events into Delta, "
            "land aggregates in Lakebase for fast lookups, and serve a Prophet-style forecast via Model Serving."
        ),
        drive_messages=[
            "Proceed: produce architecture.md.",
            "Write the per-component specifications.",
            "Build it: generate the SDP pipeline, the Lakebase sync, the forecast notebook, and resources.json.",
        ],
        target_stage="BUILT",
    ),
]


def get_scenarios(slugs: list[str] | None) -> list[Scenario]:
    if not slugs:
        return list(SCENARIOS)
    by_slug = {s.slug: s for s in SCENARIOS}
    out: list[Scenario] = []
    for slug in slugs:
        if slug not in by_slug:
            raise SystemExit(
                f"unknown scenario slug: {slug!r}. "
                f"available: {', '.join(by_slug)}"
            )
        out.append(by_slug[slug])
    return out
