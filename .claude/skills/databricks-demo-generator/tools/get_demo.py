#!/usr/bin/env python3
"""
Get full demo reference content.

Usage: python get_demo.py "demo-name"

Returns all markdown files from the demo folder concatenated into a single string.
Demo name = folder name in demo_references/.

=== MOCK IMPLEMENTATION ===
This is a simplified mock that reads from local demo_references folder.

Production implementation should:
- Fetch demo content from a central repository (e.g., GitHub repo, cloud storage, database)
- Support versioning of demos
- Include metadata like author, last updated, ratings, usage count
- Potentially cache frequently accessed demos
- Handle access control for private/enterprise demos

Example production architecture:
  1. Central demo repository (GitHub, Unity Catalog Volume, S3)
  2. API to fetch demo by ID with proper authentication
  3. CDN/cache layer for performance
  4. Analytics to track which demos are most useful
===============================
"""

import sys
from pathlib import Path


def get_demo_content(demo_name: str) -> str:
    """
    Read all markdown files from a demo folder and concatenate them.
    """
    script_dir = Path(__file__).parent
    demo_dir = script_dir / "demo_references" / demo_name

    if not demo_dir.exists():
        return f"Error: Demo '{demo_name}' not found in demo_references/"

    output_parts = []
    output_parts.append(f"# Demo Reference: {demo_name}")
    output_parts.append(f"{'=' * 60}\n")

    # Read all .md files in the folder, sorted alphabetically
    for filepath in sorted(demo_dir.glob("*.md")):
        content = filepath.read_text()
        output_parts.append(f"\n## FILE: {filepath.name}\n")
        output_parts.append("-" * 40)
        output_parts.append(content)
        output_parts.append("\n")

    return "\n".join(output_parts)


def main():
    if len(sys.argv) < 2:
        print("Usage: python get_demo.py \"demo-name\"", file=sys.stderr)
        sys.exit(1)

    demo_name = sys.argv[1]
    content = get_demo_content(demo_name)
    print(content)


if __name__ == "__main__":
    main()
