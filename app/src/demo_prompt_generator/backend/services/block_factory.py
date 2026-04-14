"""
Block Factory — decomposes large documents into standard-format blocks.

Two-phase LLM pipeline:
  1. Decompose: analyze the document, identify distinct topics, propose block specs
  2. Generate: for each spec, produce a full block in the correct category format
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from ..models import (
    BlockCategory,
    BlockFactoryRequest,
    BlockFactoryResponse,
    BlockSpec,
    GeneratedBlock,
)
from .llm_service import LLMService, ModelSize

logger = logging.getLogger(__name__)

_MAX_DOC_CHARS = 60_000

_CATEGORY_DIR = {
    BlockCategory.DOMAIN: "domains",
    BlockCategory.CAPABILITY: "capabilities",
    BlockCategory.PATTERN: "patterns",
}

# Section templates per category — these mirror existing blocks and act as the
# structural contract the LLM must follow during generation.
_CATEGORY_SECTIONS: dict[str, str] = {
    "domain": """\
## Terminology
- **Term** — definition

## KPIs and Baseline Metrics
| KPI | Healthy Baseline | Red Flag |
|-----|-----------------|----------|

## Personas
- **Name, Title** — what they care about

## Data Entities and Relationships
- **Entity** (key fields)

## Regulatory and Compliance
- **Regulation** — what it means for data

## Common Pain Points and Use Cases
1. **Use case** — description""",

    "capability": """\
## What It Does
{one paragraph}

## When to Use in a Demo
- bullet points

## Key Configuration Decisions
1. **Decision**: guidance

## Common Pitfalls
- pitfall description

## How It Connects to Other Components
- **Upstream:** ...
- **Downstream:** ...

## Example Specification Snippet
```yaml
example: config
```""",

    "pattern": """\
## Narrative Arc
1. **Phase** -- description

## Data Shape
| Layer | Abstract Entity | Role |
|-------|----------------|------|

## Wow Moment Pattern
{what makes the demo compelling}

## Investigation / Discovery Flow
1. Step description

## Example Walkthrough Beats (5-Act Structure)
| Act | Beat | What Happens |
|-----|------|-------------|

## Suggested Databricks Components
- **Component** -- role in the pattern""",
}


def _blocks_root() -> Path:
    """Find the blocks/ directory at the repository root.

    Walks up from this file looking for a blocks/ directory that contains
    the expected subdirectories (capabilities/, domains/, patterns/).
    """
    current = Path(__file__)
    for parent in current.parents:
        blocks = parent / "blocks"
        if blocks.is_dir() and (blocks / "capabilities").is_dir():
            return blocks
    raise FileNotFoundError("Cannot locate blocks/ directory")


def _extract_json_array(text: str) -> list[dict]:
    """Extract the first balanced JSON array from LLM output."""
    # Find the opening bracket
    start = text.find("[")
    if start == -1:
        raise ValueError("No JSON array found in response")

    # Walk forward to find the matching close bracket
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])

    raise ValueError("Unbalanced JSON array in response")


def _strip_code_fences(text: str) -> str:
    """Remove wrapping markdown code fences if present."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```\w*\n?", "", cleaned)
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    return cleaned


class BlockFactory:
    """Decomposes documents into standard-format context blocks."""

    def __init__(self, llm: LLMService):
        self.llm = llm

    def process(self, request: BlockFactoryRequest) -> BlockFactoryResponse:
        """Run the full factory pipeline: decompose → generate → optionally write."""
        doc_text = request.content[:_MAX_DOC_CHARS]

        # Phase 1: decompose into block specs
        specs = self._decompose(doc_text, request.category_hint)
        logger.info(f"Decomposed '{request.source_name}' into {len(specs)} blocks")

        # Phase 2: generate full block content for each spec
        generated: list[GeneratedBlock] = []
        for spec in specs:
            markdown = self._generate_block(spec, doc_text)
            rel_path = f"blocks/{_CATEGORY_DIR[spec.category]}/{spec.slug}.md"

            block = GeneratedBlock(
                spec=spec,
                markdown=markdown,
                file_path=rel_path,
                written=False,
            )

            if request.write:
                self._write_block(block)
                block.written = True

            generated.append(block)

        return BlockFactoryResponse(
            source_name=request.source_name,
            blocks=generated,
        )

    # ------------------------------------------------------------------
    # Phase 1: Decompose
    # ------------------------------------------------------------------

    def _decompose(
        self,
        doc_text: str,
        category_hint: BlockCategory | None,
    ) -> list[BlockSpec]:
        """Analyze a document and propose block specs."""

        category_guidance = ""
        if category_hint:
            category_guidance = (
                f'\nThe user indicated these blocks should be "{category_hint.value}" blocks. '
                f"Bias toward that category, but use a different one if a section clearly "
                f"fits better elsewhere.\n"
            )

        prompt = f"""\
You are a document decomposition engine for a Databricks demo context system.

The system uses three categories of reusable context blocks:
- **domain**: Industry-specific context (terminology, KPIs, personas, data entities, regulations, pain points). One block per industry vertical or sub-vertical.
- **capability**: Databricks platform feature guidance (what it does, when to use, config decisions, pitfalls, connections). One block per feature/product.
- **pattern**: Analytical patterns that span industries (narrative arc, data shape, wow moment, investigation flow, walkthrough). One block per reusable analytical approach.

Analyze the following document and decompose it into 2-10 focused blocks. Each block should be self-contained and cover a single topic. Avoid overlap between blocks.
{category_guidance}
Return a JSON array of block specifications:
```json
[
  {{
    "name": "Display Name",
    "slug": "lowercase-hyphenated-id",
    "category": "domain|capability|pattern",
    "description": "One sentence describing what context this block provides to an LLM generating demos",
    "tags": ["tag1", "tag2"],
    "source_section": "Brief note on which part of the source document this maps to"
  }}
]
```

Rules:
- Slugs must be lowercase, hyphen-separated, no spaces, unique across the list
- Each block should map to 1-3 pages of the source document
- Prefer fewer, meatier blocks over many thin ones
- If the document is about a single industry, produce one domain block plus pattern/capability blocks for the specific use cases described
- Tags should be 3-6 lowercase keywords useful for search

DOCUMENT:
{doc_text}
"""

        raw = self.llm.chat(
            prompt,
            size=ModelSize.NORMAL,
            max_tokens=4000,
            system_prompt="You are a precise document analysis tool. Return only valid JSON.",
        )

        specs_raw = _extract_json_array(raw)

        specs = []
        seen_slugs: set[str] = set()
        for item in specs_raw:
            slug = re.sub(r"[^a-z0-9-]", "-", item["slug"].lower())
            slug = re.sub(r"-+", "-", slug).strip("-")
            if slug in seen_slugs:
                slug = f"{slug}-2"
            seen_slugs.add(slug)

            specs.append(BlockSpec(
                name=item["name"],
                slug=slug,
                category=BlockCategory(item["category"]),
                description=item.get("description", ""),
                tags=item.get("tags", []),
                source_section=item.get("source_section", ""),
            ))

        return specs

    # ------------------------------------------------------------------
    # Phase 2: Generate
    # ------------------------------------------------------------------

    def _generate_block(self, spec: BlockSpec, doc_text: str) -> str:
        """Generate a full block (frontmatter + markdown body) for one spec."""

        section_template = _CATEGORY_SECTIONS[spec.category.value]

        prompt = f"""\
Generate a context block for a Databricks demo generation system.

Block specification:
- Name: {spec.name}
- Category: {spec.category.value}
- Description: {spec.description}
- Source section: {spec.source_section}

The block MUST follow this exact structure for a "{spec.category.value}" block:

YAML frontmatter (between --- delimiters):
- name: {spec.name}
- slug: {spec.slug}
- category: {spec.category.value}
- tags: [comma, separated, keywords]
- description: >
    One to two sentences describing what context this block gives an LLM
- related: [slugs-of-related-blocks]

Then markdown body with these sections:
{section_template}

Rules:
- Extract specific, concrete details from the source document — real metrics, real terminology, real pain points. Do not generalize.
- If the source document has specific numbers, thresholds, or benchmarks, include them.
- The block should be 60-90 lines total (frontmatter + body).
- Write for an LLM that will use this as context to generate a convincing Databricks demo. Prioritize actionable specifics over general descriptions.
- Output the complete block including frontmatter. Nothing else — no commentary, no wrapping.

SOURCE DOCUMENT (extract relevant details for this block):
{doc_text}
"""

        raw = self.llm.chat(
            prompt,
            size=ModelSize.NORMAL,
            max_tokens=4000,
            system_prompt="You are a technical writer producing structured context blocks. Output only the block content.",
        )

        cleaned = _strip_code_fences(raw)

        # Ensure frontmatter exists — fallback if the model omitted it
        if not cleaned.startswith("---"):
            tags_str = ", ".join(spec.tags)
            cleaned = (
                f"---\nname: {spec.name}\nslug: {spec.slug}\n"
                f"category: {spec.category.value}\ntags: [{tags_str}]\n"
                f"description: >\n  {spec.description}\nrelated: []\n"
                f"---\n\n{cleaned}"
            )

        return cleaned

    # ------------------------------------------------------------------
    # Write to disk
    # ------------------------------------------------------------------

    def _write_block(self, block: GeneratedBlock) -> None:
        """Write a generated block to the blocks/ directory."""
        target_dir = _blocks_root() / _CATEGORY_DIR[block.spec.category]
        target_dir.mkdir(parents=True, exist_ok=True)

        target_file = target_dir / f"{block.spec.slug}.md"
        if target_file.exists():
            logger.warning(f"Overwriting existing block: {target_file}")

        target_file.write_text(block.markdown)
        logger.info(f"Wrote block: {target_file}")
