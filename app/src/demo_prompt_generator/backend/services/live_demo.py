"""Live-demo links for seeded templates ("Try it live" buttons in the gallery).

A seed template's `manifest.json` may carry a `live_demo` block describing where
the demo is deployed (app, dashboard, Genie space, pipeline, job, data, …). We
only surface it when that deployment lives in the SAME workspace as this app:
an app deployed anywhere else must never show links into a workspace its users
probably can't open (and that isn't "theirs").

`build_live_demo` is pure: manifest block + this app's workspace host in, the
render-ready JSON (or None) out. The seeder stores the result in
`Template.live_demo`; the API returns it as-is.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

# Order = order of the buttons in the UI (the app, the demo's "front door", first).
_ASSET_ORDER = ["app", "dashboard", "genie", "documents", "pipeline", "job", "model", "data", "folder"]
_LABELS = {
    "app": "Open the app",
    "dashboard": "Dashboard",
    "genie": "Ask Genie",
    "pipeline": "Pipeline",
    "job": "Setup job",
    "documents": "Documents",
    "model": "ML model",
    "data": "Data",
    "folder": "Workspace folder",
}


def _hostname(url: Optional[str]) -> str:
    """Bare lowercase hostname of a URL or host string ('' if unparseable)."""
    if not url:
        return ""
    u = url.strip()
    if "://" not in u:
        u = f"https://{u}"
    return (urlparse(u).hostname or "").lower()


def app_workspace_host(ws: Any = None) -> str:
    """Hostname of the workspace THIS app runs in. Deployed: `DATABRICKS_HOST`
    (set by the Apps runtime); local dev: the SDK client's configured host.

    `LIVE_DEMO_WORKSPACE_HOST` overrides both — for LOCAL testing only, when the
    dev database lives in one workspace (your profile) but you want to see the
    "Try it live" links of demos deployed in another."""
    host = os.environ.get("LIVE_DEMO_WORKSPACE_HOST") or os.environ.get("DATABRICKS_HOST") or ""
    if not host and ws is not None:
        try:
            host = ws.config.host or ""
        except Exception:
            host = ""
    return _hostname(host)


def _url(block: Any) -> Optional[str]:
    return block.get("url") if isinstance(block, dict) and isinstance(block.get("url"), str) else None


def build_live_demo(live_demo: Any, app_host: str) -> Optional[dict]:
    """Render-ready live-demo payload, or None when the manifest has no live demo
    or it is deployed in a different workspace than `app_host`.

    Returns {"workspace": <base url>, "assets": [{kind, label, url}, …],
    "demo_questions": [str, …]} with assets in `_ASSET_ORDER`.
    """
    if not isinstance(live_demo, dict) or not app_host:
        return None
    base = (live_demo.get("workspace") or "").rstrip("/")
    if _hostname(base) != app_host:
        return None

    o = live_demo.get("workspace_id")
    suffix = f"?o={o}" if o else ""
    found: dict[str, str] = {}

    for kind, key in (("app", "app"), ("dashboard", "dashboard"), ("genie", "genie_space"), ("documents", "documents"),
                      ("pipeline", "pipeline"), ("job", "setup_job"), ("data", "data"),
                      ("folder", "workspace_folder")):
        u = _url(live_demo.get(key))
        if u:
            found[kind] = u

    model = live_demo.get("ml_model")
    if isinstance(model, str) and model.count(".") >= 2:
        # "<catalog>.<schema>.<model>@<alias>" → Catalog Explorer model page
        cat, sch, name = model.split("@", 1)[0].split(".", 2)
        found["model"] = f"{base}/explore/data/models/{cat}/{sch}/{name}{suffix}"

    # Only links into this workspace (or its Apps domain) — never a stray external URL.
    def _ok(u: str) -> bool:
        h = _hostname(u)
        return h == app_host or h.endswith(".databricksapps.com")

    assets = [
        {"kind": k, "label": _LABELS[k], "url": found[k]}
        for k in _ASSET_ORDER if k in found and _ok(found[k])
    ]
    if not assets:
        return None
    questions = [q for q in (live_demo.get("demo_questions") or []) if isinstance(q, str) and q.strip()]
    return {"workspace": base, "assets": assets, "demo_questions": questions[:3]}


# ── The seed's live demo, handed to a fork's POV deck stage ───────────────────
# A fork's resources.json starts with no `created_resources` (it points at no live
# objects until its owner builds), so the POV deck stage had no addresses to link.
# The seed's own deployment is the next best thing, labeled as the seed's, never the
# buyer's. Only `Template.live_demo` feeds it, so the same-workspace guard above holds.

SEED_LIVE_DEMO_PATH = "context/seed-live-demo.json"

_SEED_LIVE_DEMO_NOTE = (
    "The deployed demo of the seed template this project was forked from, in this app's own "
    "workspace. It is not this project's build. The POV deck stage uses these addresses only "
    "when resources.json has none, and marks each one as the seed's (resources[].source = \"seed\")."
)


def seed_live_demo_file(template_id: str, live_demo: Any) -> Optional[str]:
    """The text of `context/seed-live-demo.json` for a fork of `template_id`, or None when
    the seed has no live demo in this workspace (`live_demo` is `Template.live_demo`,
    either its JSON text or the parsed dict)."""
    if isinstance(live_demo, str):
        try:
            live_demo = json.loads(live_demo)
        except ValueError:
            return None
    if not isinstance(live_demo, dict) or not live_demo.get("assets"):
        return None
    return json.dumps({
        "note": _SEED_LIVE_DEMO_NOTE,
        "source_template_id": template_id,
        "workspace": live_demo.get("workspace"),
        "assets": live_demo["assets"],
        "demo_questions": live_demo.get("demo_questions") or [],
    }, indent=2) + "\n"


def sync_seed_live_demo(project_dir: Path, template_id: Optional[str], live_demo: Any) -> bool:
    """Write, refresh, or remove a project's `context/seed-live-demo.json` so it matches
    its seed's current live demo. Touches disk only when the content changes (the file
    watcher syncs it to the DB). A project with no seed is left alone. Returns True when
    the file changed."""
    if not template_id:
        return False
    path = project_dir / SEED_LIVE_DEMO_PATH
    want = seed_live_demo_file(template_id, live_demo)
    have = path.read_text(encoding="utf-8") if path.is_file() else None
    if want == have:
        return False
    if want is None:
        path.unlink()
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(want, encoding="utf-8")
    return True


# ── The project's own deployed links, handed to the POV deck stage ────────────
# Build records IDs and names in resources.json `created_resources`, never URLs. The
# deployed-resources endpoint turns them into links for the project's pinned target
# workspace (routes/project_files.py::_build_deployed_links). This file hands those links
# to the deck stage in the same {kind, label, url} shape as seed-live-demo.json, so the
# stage's refresh-links reads both the same way.

DEPLOYED_LINKS_PATH = "context/deployed-links.json"

_DEPLOYED_LINKS_NOTE = (
    "This project's own deployed resources, written by the app each time it resolves their "
    "links for the project's target workspace. The POV deck stage takes addresses from here "
    "first, then from seed-live-demo.json."
)

# DeployedResourceLink.resource_type → the seed-live-demo `kind` the deck stage matches on.
# Types with no deck kind (warehouse, metric view, experiment, Lakebase, supervisor) keep
# their own name, so nothing is lost.
_LINK_KINDS = {
    "app": "app",
    "app_runtime": "app",  # the running app's own address; replaces the settings page
    "job": "job",
    "skill": "skill",
    "dashboard": "dashboard",
    "genie_space": "genie",
    "pipeline": "pipeline",
    "knowledge_assistant": "knowledge_assistant",
    "ml_model": "model",
    "catalog_explorer": "data",
    "workspace_folder": "folder",
}


def deployed_links_file(links: list[Any]) -> Optional[str]:
    """The text of `context/deployed-links.json` for these DeployedResourceLink objects (or
    dicts), or None when none has a URL."""
    assets = []
    for link in links:
        get = link.get if isinstance(link, dict) else (lambda k, _l=link: getattr(_l, k, None))
        url, rtype = get("url"), get("resource_type")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")) or not rtype:
            continue
        assets.append({"kind": _LINK_KINDS.get(rtype, rtype), "label": get("label") or rtype, "url": url})
    if not assets:
        return None
    return json.dumps({"note": _DEPLOYED_LINKS_NOTE, "assets": assets}, indent=2) + "\n"


def sync_deployed_links(project_dir: Path, links: list[Any]) -> bool:
    """Write, refresh, or remove `context/deployed-links.json`. Touches disk only when the
    content changes (the file watcher syncs it to the DB). True when the file changed."""
    if not project_dir.is_dir():
        return False
    path = project_dir / DEPLOYED_LINKS_PATH
    want = deployed_links_file(links)
    have = path.read_text(encoding="utf-8") if path.is_file() else None
    if want == have:
        return False
    if want is None:
        path.unlink()
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(want, encoding="utf-8")
    return True
