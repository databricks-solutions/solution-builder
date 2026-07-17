"""Generate/check the committed JSON Schema for canonical scenarios."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from evaluation.models import Scenario


SCHEMA_PATH = Path(__file__).parent / "schema" / "scenario.schema.json"


def rendered_schema() -> str:
    schema = Scenario.model_json_schema()
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = (
        "https://github.com/databricks-solutions/solution-builder/evaluation/schema/scenario.schema.json"
    )
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    expected = rendered_schema()
    if args.check:
        return 0 if SCHEMA_PATH.is_file() and SCHEMA_PATH.read_text() == expected else 1
    SCHEMA_PATH.write_text(expected, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
