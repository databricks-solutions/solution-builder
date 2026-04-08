"""
Constants for the template library feature.

Industries are Databricks verticals.
Capabilities match the product-selector.tsx frontend component.
"""

# Industries (Databricks verticals)
INDUSTRIES = [
    "Financial Services",
    "Healthcare & Life Sciences",
    "Retail & CPG",
    "Manufacturing",
    "Media & Entertainment",
    "Public Sector",
]

# Capabilities matching UI product-selector.tsx
CAPABILITIES = [
    # Data Processing
    {"id": "lakeflow-connect", "name": "Lakeflow Connect", "category": "Data Processing"},
    {"id": "sdp", "name": "SDP", "category": "Data Processing"},
    {"id": "lakeflow-jobs", "name": "Lakeflow Jobs", "category": "Data Processing"},
    {"id": "ai-query", "name": "AI Query", "category": "Data Processing"},
    # AI/BI
    {"id": "dashboards", "name": "Dashboards", "category": "AI/BI"},
    {"id": "genie", "name": "Genie", "category": "AI/BI"},
    {"id": "metric-views", "name": "Metric Views", "category": "AI/BI"},
    {"id": "databricks-sql", "name": "Databricks SQL", "category": "AI/BI"},
    # AI/GenAI and ML
    {"id": "vector-search", "name": "Vector Search", "category": "AI/GenAI and ML"},
    {"id": "knowledge-assistant", "name": "Knowledge Assistant", "category": "AI/GenAI and ML"},
    {"id": "supervisor-agent", "name": "Supervisor Agent", "category": "AI/GenAI and ML"},
    {"id": "model-training-mlflow", "name": "Model Training + MLflow", "category": "AI/GenAI and ML"},
    {"id": "model-serving", "name": "Model Serving", "category": "AI/GenAI and ML"},
    # Governance
    {"id": "unity-catalog", "name": "Unity Catalog", "category": "Governance"},
    {"id": "delta-sharing", "name": "Delta Sharing", "category": "Governance"},
    {"id": "abac", "name": "ABAC", "category": "Governance"},
    {"id": "data-classification", "name": "Data Classification", "category": "Governance"},
    {"id": "data-quality", "name": "Data Quality", "category": "Governance"},
    # Apps
    {"id": "databricks-apps", "name": "Databricks Apps", "category": "Apps"},
    {"id": "lakebase", "name": "Lakebase", "category": "Apps"},
]

# Quick lookup by ID
CAPABILITIES_BY_ID = {cap["id"]: cap for cap in CAPABILITIES}
