#!/usr/bin/env python3
"""
Search demo references.

Usage: python search_demos.py "query"

Returns top 3 matching demos with name and short description.

=== MOCK IMPLEMENTATION ===
This is a simplified mock that scans local demo_references folder
and does basic keyword matching.

Production implementation should:
- Store demo metadata + embeddings in a vector database (e.g., Databricks Vector Search, Pinecone, Weaviate)
- Embed the user query using the same embedding model
- Perform semantic similarity search to find relevant demos
- Support filtering by industry, components, complexity
- Scale to thousands of community-contributed demos

Example production architecture:
  1. Demo ingestion pipeline: Parse demo files → generate embeddings → store in vector DB
  2. Search API: Embed query → vector similarity search → return top K results
  3. Could use Databricks Foundation Model APIs for embeddings
===============================
"""

import sys
import json
from pathlib import Path


def load_demo_catalog():
    """
    Scan demo_references folder and extract info from each demo's overview file.
    """
    script_dir = Path(__file__).parent
    demo_dir = script_dir / "demo_references"

    if not demo_dir.exists():
        return []

    demos = []
    for folder in sorted(demo_dir.iterdir()):
        if not folder.is_dir():
            continue

        # Try to find overview file
        overview_file = None
        for f in folder.glob("*overview*.md"):
            overview_file = f
            break
        if not overview_file:
            for f in folder.glob("*.md"):
                overview_file = f
                break

        if not overview_file:
            continue

        # Parse overview to extract key info
        content = overview_file.read_text()

        # Extract title (first # heading)
        title = folder.name
        for line in content.split('\n'):
            if line.startswith('# '):
                title = line[2:].strip()
                break

        # Extract description (look for "The Problem" or first paragraph after title)
        description = ""
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if '**The Problem:**' in line or 'The Problem:' in line:
                description = line.split(':', 1)[-1].strip()
                break
            elif line.startswith('**Company:**'):
                # Get company + next few key lines
                desc_parts = []
                for j in range(i, min(i+4, len(lines))):
                    if lines[j].strip():
                        desc_parts.append(lines[j].replace('**', '').strip())
                description = ' '.join(desc_parts)
                break

        if not description:
            description = f"Demo in {folder.name}"

        # Extract components from overview if present
        components = ["Data Gen", "Pipeline", "Dashboard", "Genie", "KA", "MAS"]
        if "ML" in content or "ml" in content.lower():
            components.append("ML Notebook")

        demos.append({
            "name": folder.name,
            "title": title,
            "description": description[:200],  # Truncate
            "components": components,
            "searchable": content.lower()  # For keyword matching
        })

    return demos


def search_demos(query: str) -> list:
    """
    Search demos by keyword matching.
    In production: embed query, search vector DB, return top K.
    """
    demos = load_demo_catalog()
    query_lower = query.lower()

    # Simple keyword scoring
    scored = []
    for demo in demos:
        score = 0
        for word in query_lower.split():
            if word in demo["searchable"]:
                score += 1
            if word in demo["name"]:
                score += 2
            if word in demo["title"].lower():
                score += 2
        scored.append((score, demo))

    # Sort by score descending, return top 3
    scored.sort(key=lambda x: x[0], reverse=True)

    results = []
    for score, demo in scored[:3]:
        results.append({
            "name": demo["name"],
            "title": demo["title"],
            "description": demo["description"],
            "components": demo["components"]
        })

    return results


def main():
    if len(sys.argv) < 2:
        print("Usage: python search_demos.py \"query\"", file=sys.stderr)
        sys.exit(1)

    query = sys.argv[1]
    results = search_demos(query)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
