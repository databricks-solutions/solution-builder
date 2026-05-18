"""Extract canonical deployed-resource IDs from a project's resources.json.

Why an LLM does this instead of a schema parser: the build agent writes
resources.json in whatever shape it likes. We've seen at least four
variants in the wild — flat `pipeline_id`, nested `pipeline: {id, name,
url, ...}`, lists of objects, free-form `demo_numbers` next to the IDs,
etc. Maintaining a parser that covers every drift is a losing game.

Instead: call the mini LLM with a fixed output schema. Cache by content
hash so the call only fires when resources.json actually changes.

The cache is in-process (dict). Loss on restart costs one LLM call per
project on next deployed-resources load (~500ms with mini). DB-backed
cache wasn't worth the migration for that small win.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from typing import Any

from typing import TYPE_CHECKING

from ..core._config import AppConfig
from .llm_service import LLMService, ModelSize

if TYPE_CHECKING:
    from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)


# The canonical flat shape every downstream consumer can rely on. Keep
# this list aligned with _RESOURCE_URL_PATTERNS in routes/project_files.py
# so the URL builder always finds the keys it expects.
CANONICAL_KEYS = (
    "catalog",
    "schema",
    "workspace_folder",
    "warehouse_id",
    "pipeline_id",
    "dashboard_id",
    "genie_space_id",
    "knowledge_assistant_id",
    "knowledge_assistant_endpoint",
    "multi_agent_supervisor_id",
    "multi_agent_supervisor_endpoint",
    "mlflow_experiment_path",
    "metric_view_name",
    "app_name",
    "app_id",
    "lakebase_project_id",
    "lakebase_project_slug",
    "lakebase_database",
)


_EXTRACTOR_PROMPT = """You are a JSON normalizer for a project's resources.json file.

Different versions of an AI agent wrote this file in different shapes:
sometimes flat (`pipeline_id`: "..."), sometimes nested (`pipeline`:
{"id": "...", "name": "...", "url": "..."}), sometimes mixed with
unrelated fields. Your job: extract a flat object using the canonical
shape below. Use the empty string "" for any field that isn't present.

For nested objects with an "id" field, extract just the id. Ignore
free-form fields like demo_numbers, tables, retry_command, deployment
notes, etc. — keep ONLY the canonical fields.

Output STRICTLY this JSON shape:

{
  "catalog": "",
  "schema": "",
  "workspace_folder": "",
  "warehouse_id": "",
  "pipeline_id": "",
  "dashboard_id": "",
  "genie_space_id": "",
  "knowledge_assistant_id": "",
  "knowledge_assistant_endpoint": "",
  "multi_agent_supervisor_id": "",
  "multi_agent_supervisor_endpoint": "",
  "mlflow_experiment_path": "",
  "metric_view_name": "",
  "app_name": "",
  "app_id": "",
  "lakebase_project_id": "",
  "lakebase_project_slug": "",
  "lakebase_database": ""
}

Input resources.json:
"""


# Module-level cache: project_id -> (content_hash, extracted_dict).
# Threadsafe; the lock is only held during dict ops, not the LLM call.
_cache: dict[str, tuple[str, dict[str, str]]] = {}
_cache_lock = threading.Lock()


def _hash_content(raw_text: str) -> str:
    return hashlib.sha256(raw_text.encode("utf-8")).hexdigest()


def _empty_extraction() -> dict[str, str]:
    return {k: "" for k in CANONICAL_KEYS}


def extract_resources(
    project_id: str,
    raw_json_text: str,
    ws: "WorkspaceClient",
    config: AppConfig,
) -> tuple[dict[str, str], str | None]:
    """Return (canonical flat resource dict, error message).

    On success, `error` is None. On any LLM failure (auth, missing model,
    network), returns an empty extraction AND the error message so the
    caller can surface it to the UI instead of silently rendering zero
    resources. Caches successful extractions by content hash so the LLM
    only fires when resources.json actually changes.
    """
    if not raw_json_text or not raw_json_text.strip():
        return _empty_extraction(), None

    content_hash = _hash_content(raw_json_text)

    # Cache hit: same content, return the previous extraction.
    with _cache_lock:
        cached = _cache.get(project_id)
    if cached and cached[0] == content_hash:
        return cached[1], None

    # Miss: call mini. Cap the input — pathological resources.json files
    # bloated with the model's tangential notes can run to thousands of
    # lines; the canonical fields are always near the top so a generous
    # truncation is fine.
    snippet = raw_json_text[:20_000]
    prompt = _EXTRACTOR_PROMPT + snippet

    try:
        llm = LLMService(ws, config)
        raw = llm.chat_json(
            prompt,
            size=ModelSize.MINI,
            max_tokens=800,
        )
    except Exception as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {e}"
        logger.warning(
            f"[resources_extractor] LLM extraction failed for {project_id}: {msg}"
        )
        return _empty_extraction(), msg

    extracted = _normalize_extraction(raw)

    with _cache_lock:
        _cache[project_id] = (content_hash, extracted)

    return extracted, None


def _normalize_extraction(raw: Any) -> dict[str, str]:
    """Coerce the LLM output into a strict dict[str, str] over CANONICAL_KEYS.

    The LLM is told to emit the right shape, but defensively we:
      - drop unexpected keys
      - cast values to str
      - replace None / missing with ""
    """
    if not isinstance(raw, dict):
        return _empty_extraction()
    out: dict[str, str] = {}
    for k in CANONICAL_KEYS:
        v = raw.get(k, "")
        if v is None:
            out[k] = ""
        elif isinstance(v, (dict, list)):
            # LLM disregarded the "flat" instruction. Try a last-ditch
            # rescue: if it gave us a dict with an "id", use that.
            if isinstance(v, dict) and "id" in v:
                out[k] = str(v["id"])
            else:
                out[k] = ""
        else:
            out[k] = str(v)
    return out


def invalidate_cache(project_id: str | None = None) -> None:
    """Test hook / admin escape hatch. Drop a single project's cache, or
    all of them when project_id is None."""
    with _cache_lock:
        if project_id is None:
            _cache.clear()
        else:
            _cache.pop(project_id, None)
