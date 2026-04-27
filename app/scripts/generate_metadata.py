"""Generate src/demo_prompt_generator/_metadata.py.

Mirrors the hatch custom build hook in ``hatch_build.py``. Used by ``dev.sh``
on a fresh clone, before any wheel build has run, so uvicorn can import
``demo_prompt_generator._metadata`` on first startup.
"""

from __future__ import annotations

from pathlib import Path

METADATA_TEMPLATE = '''\
from pathlib import Path

app_name = "demo-prompt-generator"
app_entrypoint = "demo_prompt_generator.backend.app:app"
app_slug = "demo_prompt_generator"
api_prefix = "/api"
dist_dir = Path(__file__).parent / "__dist__"
'''


def main() -> None:
    app_dir = Path(__file__).resolve().parent.parent
    target = app_dir / "src" / "demo_prompt_generator" / "_metadata.py"
    target.write_text(METADATA_TEMPLATE)
    print(f"Wrote {target.relative_to(app_dir)}")


if __name__ == "__main__":
    main()
