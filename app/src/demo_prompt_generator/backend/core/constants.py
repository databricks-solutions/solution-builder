"""
Constants for the template library feature.

Industries are Databricks verticals.
Capabilities are loaded from markdown files in blocks/capabilities/.
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Industries (Databricks verticals)
INDUSTRIES = [
    "Financial Services",
    "Healthcare & Life Sciences",
    "Retail & CPG",
    "Manufacturing",
    "Media & Entertainment",
    "Public Sector",
]

# Category display name mapping (from frontmatter slug to display name)
CATEGORY_DISPLAY_NAMES = {
    "data-processing": "Data Processing",
    "ai-bi": "AI/BI",
    "ai-genai-ml": "AI/GenAI and ML",
    "governance": "Governance",
    "apps": "Apps",
}

# Category sort order
CATEGORY_ORDER = ["data-processing", "ai-bi", "ai-genai-ml", "governance", "apps"]


def _get_capabilities_folder() -> Optional[Path]:
    """Find the capabilities folder in the demo-generator skill."""
    current_file = Path(__file__)

    # Look in parent directories for .claude/skills/databricks-demo-generator
    for parent in current_file.parents:
        capabilities_dir = (
            parent / ".claude" / "skills" / "databricks-demo-generator"
            / "references" / "blocks" / "capabilities"
        )
        if capabilities_dir.exists():
            return capabilities_dir

    return None


def _parse_capability_frontmatter(content: str) -> dict:
    """Parse YAML frontmatter from a capability markdown file."""
    if not content.startswith("---"):
        return {}

    end_idx = content.find("---", 3)
    if end_idx < 0:
        return {}

    frontmatter = content[3:end_idx]
    result = {}

    for line in frontmatter.split("\n"):
        line = line.strip()
        if ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip().strip("\"'")

            # Handle boolean values
            if value.lower() == "true":
                result[key] = True
            elif value.lower() == "false":
                result[key] = False
            else:
                result[key] = value

    return result


def _load_capabilities_from_files() -> list[dict]:
    """Load capabilities from markdown files in blocks/capabilities/."""
    capabilities_dir = _get_capabilities_folder()
    if not capabilities_dir:
        logger.warning("Capabilities folder not found, using fallback")
        return _get_fallback_capabilities()

    capabilities = []

    for md_file in capabilities_dir.glob("*.md"):
        try:
            content = md_file.read_text()
            frontmatter = _parse_capability_frontmatter(content)

            if not frontmatter.get("name"):
                continue

            capability_id = md_file.stem  # filename without .md
            category_slug = frontmatter.get("category", "other")

            capabilities.append({
                "id": capability_id,
                "name": frontmatter["name"],
                "category": CATEGORY_DISPLAY_NAMES.get(category_slug, category_slug.title()),
                "disabled": frontmatter.get("disabled", False),
            })
        except Exception as e:
            logger.warning(f"Failed to parse capability {md_file.name}: {e}")

    # Sort by category order, then by name
    def sort_key(cap):
        category_slug = next(
            (k for k, v in CATEGORY_DISPLAY_NAMES.items() if v == cap["category"]),
            "zzz"
        )
        category_idx = CATEGORY_ORDER.index(category_slug) if category_slug in CATEGORY_ORDER else 999
        return (category_idx, cap["name"])

    return sorted(capabilities, key=sort_key)


def _get_fallback_capabilities() -> list[dict]:
    """Fallback capabilities if files can't be loaded."""
    return [
        {"id": "lakeflow-connect", "name": "Lakeflow Connect", "category": "Data Processing", "disabled": False},
        {"id": "sdp", "name": "SDP", "category": "Data Processing", "disabled": False},
        {"id": "lakeflow-jobs", "name": "Lakeflow Jobs", "category": "Data Processing", "disabled": False},
        {"id": "ai-query", "name": "AI Query", "category": "Data Processing", "disabled": False},
        {"id": "dashboards", "name": "Dashboards", "category": "AI/BI", "disabled": False},
        {"id": "genie", "name": "Genie", "category": "AI/BI", "disabled": False},
        {"id": "metric-views", "name": "Metric Views", "category": "AI/BI", "disabled": False},
        {"id": "databricks-sql", "name": "Databricks SQL", "category": "AI/BI", "disabled": False},
        {"id": "vector-search", "name": "Vector Search", "category": "AI/GenAI and ML", "disabled": False},
        {"id": "knowledge-assistant", "name": "Knowledge Assistant", "category": "AI/GenAI and ML", "disabled": False},
        {"id": "supervisor-agent", "name": "Supervisor Agent", "category": "AI/GenAI and ML", "disabled": False},
        {"id": "model-training-mlflow", "name": "Model Training + MLflow", "category": "AI/GenAI and ML", "disabled": False},
        {"id": "model-serving", "name": "Model Serving", "category": "AI/GenAI and ML", "disabled": False},
        {"id": "unity-catalog", "name": "Unity Catalog", "category": "Governance", "disabled": False},
        {"id": "delta-sharing", "name": "Delta Sharing", "category": "Governance", "disabled": False},
        {"id": "abac", "name": "ABAC", "category": "Governance", "disabled": True},
        {"id": "data-classification", "name": "Data Classification", "category": "Governance", "disabled": True},
        {"id": "data-quality", "name": "Data Quality", "category": "Governance", "disabled": True},
        {"id": "databricks-apps", "name": "Databricks Apps", "category": "Apps", "disabled": True},
        {"id": "lakebase", "name": "Lakebase", "category": "Apps", "disabled": True},
    ]


def get_capabilities() -> list[dict]:
    """Get capabilities, loading from files or using cache."""
    global _capabilities_cache
    if _capabilities_cache is None:
        _capabilities_cache = _load_capabilities_from_files()
    return _capabilities_cache


# Cache for loaded capabilities
_capabilities_cache: Optional[list[dict]] = None

# For backwards compatibility
CAPABILITIES = property(lambda self: get_capabilities())


def get_capabilities_by_id() -> dict[str, dict]:
    """Get capabilities indexed by ID."""
    return {cap["id"]: cap for cap in get_capabilities()}
