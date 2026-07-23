"""
Constants for the template library feature.

Industries are Databricks verticals.
Capabilities are loaded from markdown files in .claude/skills/databricks-solution-builder/references/blocks/capabilities/.
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
    "lakeflow": "Lakeflow",
    "ai-bi": "AI/BI",
    "agent-bricks": "Agent Bricks",
    "uc-governance": "UC Governance",
    "apps-infra": "Apps & Infra",
}

# Category sort order
CATEGORY_ORDER = ["lakeflow", "ai-bi", "agent-bricks", "uc-governance", "apps-infra"]


def _get_capabilities_folder() -> Optional[Path]:
    """Find the capabilities folder in the solution-builder skill.

    Same path inside the wheel and the dev tree: `.claude/skills/databricks-solution-builder/`.
    """
    bundled = (
        Path(__file__).parent.parent.parent / ".claude" / "skills"
        / "databricks-solution-builder" / "references" / "blocks" / "capabilities"
    )
    if bundled.exists():
        return bundled

    # Editable dev fallback — walk up to the repo's skill folder.
    current_file = Path(__file__)
    for parent in current_file.parents:
        capabilities_dir = (
            parent / ".claude" / "skills" / "databricks-solution-builder"
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
        logger.error("Capabilities folder not found - no capabilities will be available")
        return []

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
                "buildable": frontmatter.get("buildable", False),
                # Offered in the "Prepare a workshop" (Genie Code) mode? Defaults
                # to True; set false on capabilities the workshop can't co-build
                # via Genie Code prompts (lakebase, apps, KA/MAS, ML, …).
                "genie_code_workshop": frontmatter.get("genie_code_workshop", True),
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
