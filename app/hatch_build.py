"""Hatch build hook that generates ``src/demo_prompt_generator/_metadata.py``.

The runtime imports ``demo_prompt_generator._metadata`` for the app name,
slug, entrypoint, and dist directory. The values are static, but the file
itself is gitignored (mirroring ``_version.py``) so each environment must
materialize it locally. The version hook (``uv-dynamic-versioning``) handles
``_version.py``; this hook handles ``_metadata.py``.

It runs both for ``hatch build`` (wheel builds) and for editable installs via
``uv sync``. The ``scripts/generate_metadata.py`` helper covers the bare-clone
case where the package has never been built or installed.
"""

from __future__ import annotations

from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

METADATA_TEMPLATE = '''\
from pathlib import Path

app_name = "demo-prompt-generator"
app_entrypoint = "demo_prompt_generator.backend.app:app"
app_slug = "demo_prompt_generator"
api_prefix = "/api"
dist_dir = Path(__file__).parent / "__dist__"
'''


class MetadataBuildHook(BuildHookInterface):
    PLUGIN_NAME = "metadata"

    def initialize(self, version: str, build_data: dict) -> None:
        target = Path(self.root) / "src" / "demo_prompt_generator" / "_metadata.py"
        target.write_text(METADATA_TEMPLATE)
