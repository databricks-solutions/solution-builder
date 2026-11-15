"""Render a project's architecture.md through the SAME viewer the app ships, and check it.

The agent's `render_architecture` tool (`arch_tools.py`) is a thin wrapper over this
module. The pieces:

  * `render_project()` — the parent side. Selects tabs, writes one single-tab page per
    tab (the standalone viewer shows only the first tab of its JSON), and runs the
    headless browser in a CHILD process: a hard timeout, a process group that is
    SIGKILLed on every exit path, and a slot from the shared pool in
    `headless_browser.py` (the brand screenshots use the same pool, so the two never
    add up to more than two browsers).
  * `worker_main()` — the child side. Stdlib + Playwright only, so the child imports
    nothing from the app. It renders the overview and (optionally) a zoomed crop of
    every tab, and runs the layout check in a second page.
  * The layout check is `skill/renderer/arch-browser.js`, the SAME file the Node scripts
    `inspect-arch.mjs` and `render-arch.mjs` read. This module evaluates it with
    `page.evaluate`; it never re-implements a check.

Output lands in `<project>/.claude/arch-renders/` (not synced to the DB; the file
watcher only syncs the project's own files). Pages and the job file live in a temp
directory that is removed on every path.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from .headless_browser import (
    BrowserBusy,
    browser_env,
    browser_slot,
    sanitize_browser_env,
    track_group,
    untrack_group,
)

# The overview's LONG edge in pixels. A vision model reads ~1568px at full detail; a
# 9000px render is downscaled 6x and its 11px labels become unreadable. Zoom with a crop.
MAX_EDGE = 1568
# How long a render waits for a free browser slot before answering "busy, retry".
QUEUE_WAIT_S = 20.0
# Hard cap on one render (all tabs), enforced by killing the child's process group.
RENDER_TIMEOUT_S = 90.0

_LAUNCH_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run",
]
_ARCH_BLOCK = re.compile(r'(<script[^>]*type="application/json"[^>]*id="architecture"[^>]*>)[\s\S]*?(</script>)')
_FENCE = re.compile(r"```json\s*\n([\s\S]*?)\n```")

# Named crop regions, as (x, y, w, h) fractions of the overview.
CROP_REGIONS: dict[str, tuple[float, float, float, float]] = {
    "top-left": (0.0, 0.0, 0.5, 0.5), "top-right": (0.5, 0.0, 0.5, 0.5),
    "bottom-left": (0.0, 0.5, 0.5, 0.5), "bottom-right": (0.5, 0.5, 0.5, 0.5),
    "top": (0.0, 0.0, 1.0, 0.5), "bottom": (0.0, 0.5, 1.0, 0.5),
    "left": (0.0, 0.0, 0.5, 1.0), "right": (0.5, 0.0, 0.5, 1.0),
    "center": (0.25, 0.25, 0.5, 0.5),
}


class RenderError(Exception):
    """The render could not be produced. The message is safe to show the agent."""


class RenderInputError(RenderError):
    """Bad input (no file, bad JSON, unknown tab or crop): nothing was rendered."""


class RendererBusy(RenderError):
    """No browser slot freed up within QUEUE_WAIT_S."""


# ---------------------------------------------------------------------------
# Reading and selecting tabs (parent side, pure)
# ---------------------------------------------------------------------------

def parse_architecture(text: str) -> list[dict[str, Any]]:
    """architecture.md → the list of tabs. Accepts the fenced ```json block or bare JSON,
    and an object, an array, or an object with a `tabs` array (the same shapes the
    viewer and score.mjs accept)."""
    fence = _FENCE.search(text)
    try:
        doc = json.loads(fence.group(1) if fence else text)
    except json.JSONDecodeError as e:
        raise RenderInputError(f"architecture.md is not valid JSON: {e.msg} (line {e.lineno})") from e
    if isinstance(doc, dict) and isinstance(doc.get("tabs"), list):
        tabs = doc["tabs"]
    elif isinstance(doc, list):
        tabs = doc
    else:
        tabs = [doc]
    tabs = [t for t in tabs if isinstance(t, dict)]
    if not tabs:
        raise RenderInputError("architecture.md has no diagram tabs")
    return tabs


def read_tabs(project_dir: Path) -> list[dict[str, Any]]:
    path = project_dir / "architecture.md"
    if not path.is_file():
        raise RenderInputError("there is no architecture.md in the project yet; write it first")
    return parse_architecture(path.read_text(encoding="utf-8"))


def tab_name(tab: dict[str, Any], index: int) -> str:
    name = str(tab.get("name") or "").strip()
    return name or f"tab {index + 1}"


def tab_slug(tab: dict[str, Any], index: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", tab_name(tab, index).lower()).strip("-")
    return slug or f"tab{index + 1}"


def select_tabs(tabs: list[dict[str, Any]], selector: str | int | None) -> list[tuple[int, dict[str, Any]]]:
    """None → every tab. An int or digit string → that 1-based tab. A name (or its slug),
    case-insensitive → that tab. Anything else is an error that lists the tab names."""
    indexed = list(enumerate(tabs))
    if selector is None or (isinstance(selector, str) and not selector.strip()):
        return indexed
    if isinstance(selector, bool):
        raise RenderInputError("tab must be a tab name or a 1-based number")
    if isinstance(selector, int) or (isinstance(selector, str) and selector.strip().isdigit()):
        n = int(selector)
        if 1 <= n <= len(tabs):
            return [indexed[n - 1]]
    else:
        wanted = str(selector).strip().lower()
        for i, t in indexed:
            if wanted in (tab_name(t, i).lower(), tab_slug(t, i)):
                return [(i, t)]
    names = ", ".join(f"{i + 1}={tab_name(t, i)!r}" for i, t in indexed)
    raise RenderInputError(f"no tab matches {selector!r}; the tabs are: {names}")


def parse_crop(crop: Any) -> tuple[float, float, float, float] | None:
    """A named region (CROP_REGIONS) or {x,y,w,h} fractions of the overview (0-1)."""
    if crop is None:
        return None
    if isinstance(crop, str):
        key = crop.strip().lower()
        if key not in CROP_REGIONS:
            raise RenderInputError(f"unknown crop region {crop!r}; use one of: {', '.join(CROP_REGIONS)}")
        return CROP_REGIONS[key]
    if isinstance(crop, dict):
        try:
            x, y, w, h = (float(crop[k]) for k in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError) as e:
            raise RenderInputError("crop needs numeric x, y, w, h (fractions 0-1 of the overview)") from e
        if not (0 <= x < 1 and 0 <= y < 1 and 0 < w <= 1 and 0 < h <= 1 and x + w <= 1.0001 and y + h <= 1.0001):
            raise RenderInputError("crop must lie inside the overview: 0<=x,y<1, 0<w,h<=1, x+w<=1, y+h<=1")
        return (x, y, w, h)
    raise RenderInputError("crop must be a region name or {x, y, w, h}")


def inject_tab(viewer_html: str, tab: dict[str, Any]) -> str:
    """The viewer page with ONE tab in its inline JSON block. `<` is escaped so the JSON
    cannot close the script element."""
    payload = json.dumps([tab]).replace("<", "\\u003c")
    return _ARCH_BLOCK.sub(lambda m: m.group(1) + payload + m.group(2), viewer_html, count=1)


# ---------------------------------------------------------------------------
# Parent side: run the child, enforce budget and timeouts
# ---------------------------------------------------------------------------

def _kill_group(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGKILL)
    except OSError:
        pass  # the group is already gone


def _run_worker(job_path: Path, result_path: Path, log_path: Path) -> dict[str, Any]:
    # Parent's sys.path goes to the child so `-c` can import the app from any layout
    # (dev venv, wheel, eval harness). Stdout is dropped; stderr goes to a log file, not
    # a pipe: a pipe would wait on any browser helper that inherited it.
    env = browser_env()
    env["PYTHONPATH"] = os.pathsep.join(p for p in sys.path if p)
    code = ("import sys; from demo_prompt_generator.backend.services.arch_render import worker_main; "
            "worker_main(sys.argv[1])")
    try:
        with browser_slot(timeout=QUEUE_WAIT_S):
            with open(log_path, "wb") as errf:
                proc = subprocess.Popen(
                    [sys.executable, "-c", code, str(job_path)],
                    start_new_session=True, env=env,
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errf,
                )
            track_group(proc.pid)
            try:
                try:
                    proc.wait(timeout=RENDER_TIMEOUT_S)
                except subprocess.TimeoutExpired as e:
                    _kill_group(proc.pid)
                    proc.wait(timeout=5)
                    raise RenderError(f"the render timed out after {int(RENDER_TIMEOUT_S)}s and was stopped") from e
            finally:
                # Reap anything the worker left behind (a browser helper after a crash),
                # then stop tracking it. Safe on a clean exit: the group is empty.
                _kill_group(proc.pid)
                untrack_group(proc.pid)
    except BrowserBusy as e:
        raise RendererBusy(
            f"the renderer is busy (all browser slots in use for {int(QUEUE_WAIT_S)}s); retry in a moment"
        ) from e
    if not result_path.exists():
        tail = log_path.read_bytes()[-800:].decode("utf-8", "replace").strip() if log_path.exists() else ""
        raise RenderError(f"the headless browser produced no result (exit {proc.returncode}). {tail}".strip())
    result = json.loads(result_path.read_text(encoding="utf-8"))
    if result.get("error"):
        raise RenderError(str(result["error"]))
    return result


def render_tabs(
    project_dir: Path,
    selected: list[tuple[int, dict[str, Any]]],
    crop: tuple[float, float, float, float] | None,
    *,
    viewer_path: Path,
    browser_js_path: Path,
) -> list[dict[str, Any]]:
    """Render the selected tabs (overview, plus a crop if asked). Returns one dict per
    tab: its PNG path (project-relative), pixel size, and the layout check."""
    out_dir = project_dir / ".claude" / "arch-renders"
    out_dir.mkdir(parents=True, exist_ok=True)
    viewer_html = viewer_path.read_text(encoding="utf-8")
    tmp = Path(tempfile.mkdtemp(prefix="arch-render-"))
    try:
        items = []
        for index, tab in selected:
            slug = tab_slug(tab, index)
            page = tmp / f"tab-{index + 1}.html"
            page.write_text(inject_tab(viewer_html, tab), encoding="utf-8")
            items.append({
                "index": index + 1, "tab": tab_name(tab, index), "page": str(page),
                "png": str(out_dir / f"{slug}.png"), "crop_png": str(out_dir / f"{slug}-crop.png"),
            })
        job = {"browser_js": str(browser_js_path), "items": items,
               "crop": list(crop) if crop else None, "result": str(tmp / "result.json")}
        job_path = tmp / "job.json"
        job_path.write_text(json.dumps(job), encoding="utf-8")
        result = _run_worker(job_path, tmp / "result.json", tmp / "worker.log")
        tabs = result.get("tabs") or []
        for t in tabs:
            for key in ("png", "crop_png"):
                if t.get(key):
                    t[key] = str(Path(t[key]).relative_to(project_dir))
        return tabs
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def render_project(
    project_dir: Path,
    tab: str | int | None,
    crop: Any,
    *,
    viewer_path: Path,
    browser_js_path: Path,
) -> dict[str, Any]:
    """One call = one render. `tab` selects a tab (None = all), `crop` is a region name
    or {x,y,w,h}. Raises RenderError / RendererBusy with a message the agent can act on."""
    tabs = read_tabs(project_dir)
    selected = select_tabs(tabs, tab)
    region = parse_crop(crop)
    try:
        rendered = render_tabs(project_dir, selected, region,
                               viewer_path=viewer_path, browser_js_path=browser_js_path)
    except OSError as e:
        raise RenderError(f"could not start the headless browser: {e}") from e
    return {
        "tab_count": len(tabs),
        "tabs": [r if r.get("error") else {**{k: v for k, v in r.items() if k != "sections"},
                                            **summarize(r)} for r in rendered],
    }


def summarize(tab_result: dict[str, Any]) -> dict[str, Any]:
    """The layout check for one tab, as the agent should read it. `faults` are the
    gated categories (the same set inspect-arch's exit code uses); `reported_not_gated`
    holds categories printed but not counted (EDGE THROUGH TILE is one: see
    arch-browser.js UNCOUNTED); `advisory` never fails anything."""
    faults, reported = [], []
    for s in tab_result.get("sections", []):
        if not s.get("items"):
            continue
        entry = {"check": s["name"], "count": len(s["items"]), "examples": s["items"][:5]}
        (faults if s.get("counted") else reported).append(entry)
    comp = tab_result.get("composition") or {}
    return {
        "faults": faults,
        "reported_not_gated": reported,
        "advisory": {
            "alignment_reuse": {"x": _r(comp.get("xReuse")), "y": _r(comp.get("yReuse"))},
            "text_budget_chars_per_node": _r(comp.get("charsPerNode")),
            "largest_row_gap_ratio": _r(comp.get("spacingRatio")),
            "aspect": tab_result.get("aspectNote"),
        },
    }


def _r(v: Any) -> Any:
    return round(v, 2) if isinstance(v, (int, float)) else v


# ---------------------------------------------------------------------------
# Child side: the browser work. Imports nothing from the app.
# ---------------------------------------------------------------------------

def worker_main(job_path: str) -> None:
    """Entry point of the render child (python -c …). Writes the result JSON next to the
    job file. Errors become `{"error": …}` so the parent can report them."""
    job = json.loads(Path(job_path).read_text(encoding="utf-8"))
    result: dict[str, Any] = {"tabs": []}
    try:
        result["tabs"] = _run_job(job)
    except Exception as e:  # noqa: BLE001 — the parent turns this into a tool message
        result["error"] = f"{type(e).__name__}: {str(e)[:400]}"
    Path(job["result"]).write_text(json.dumps(result), encoding="utf-8")


def _run_job(job: dict[str, Any]) -> list[dict[str, Any]]:
    from playwright.sync_api import sync_playwright

    sanitize_browser_env()
    browser_js = Path(job["browser_js"]).read_text(encoding="utf-8").strip()
    crop = tuple(job["crop"]) if job.get("crop") else None
    out: list[dict[str, Any]] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium-headless-shell", args=_LAUNCH_ARGS)
        try:
            for item in job["items"]:
                try:
                    out.append(_render_item(browser, browser_js, item, crop))
                except Exception as e:  # noqa: BLE001 — one bad tab must not hide the others
                    out.append({"index": item["index"], "tab": item["tab"],
                                "error": f"{type(e).__name__}: {str(e)[:300]}"})
        finally:
            browser.close()
    return out


def _wait_ready(page: Any) -> None:
    for _ in range(150):  # ~15 s, same budget as render-arch.mjs
        if page.evaluate("document.body && document.body.getAttribute('data-arch-ready')==='1'"):
            return
        page.wait_for_timeout(100)


def _png_size(data: bytes) -> tuple[int, int]:
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _shot(cdp: Any, rect: dict[str, float], total: float) -> bytes:
    # The PNG is `rect × total` pixels: the clip's scale is the whole factor. (Measured: under
    # Playwright the context's device-scale-factor does not multiply the clip scale, unlike the
    # raw-CDP render-arch.mjs path, so halving it here would halve the output.)
    r = cdp.send("Page.captureScreenshot", {
        "format": "png", "captureBeyondViewport": True,
        "clip": {"x": rect["x"], "y": rect["y"], "width": rect["w"], "height": rect["h"],
                 "scale": total},
    })
    return base64.b64decode(r["data"])


def _render_item(browser: Any, browser_js: str, item: dict[str, Any], crop: tuple | None) -> dict[str, Any]:
    url = Path(item["page"]).as_uri()
    ctx = browser.new_context(viewport={"width": 2400, "height": 1600}, device_scale_factor=2)
    try:
        page = ctx.new_page()
        page.goto(url, wait_until="load", timeout=30_000)
        _wait_ready(page)
        page.evaluate("document.documentElement.classList.add('arch-static')")
        page.wait_for_timeout(300)
        box = page.evaluate(f"{browser_js}.contentBox(24)")
        if not box or box["w"] <= 1 or box["h"] <= 1:
            raise RuntimeError(f"tab {item['tab']!r} has nothing to draw")
        cdp = ctx.new_cdp_session(page)
        data = _shot(cdp, box, min(4.0, MAX_EDGE / max(box["w"], box["h"])))
        Path(item["png"]).write_bytes(data)
        w, h = _png_size(data)
        out: dict[str, Any] = {"index": item["index"], "tab": item["tab"], "png": item["png"],
                               "size_px": [w, h]}
        if crop:
            fx, fy, fw, fh = crop
            rect = {"x": box["x"] + fx * box["w"], "y": box["y"] + fy * box["h"],
                    "w": fw * box["w"], "h": fh * box["h"]}
            cdata = _shot(cdp, rect, min(4.0, MAX_EDGE / max(rect["w"], rect["h"])))
            Path(item["crop_png"]).write_bytes(cdata)
            cw, ch = _png_size(cdata)
            out["crop_png"] = item["crop_png"]
            out["crop_size_px"] = [cw, ch]
    finally:
        ctx.close()
    out.update(_inspect(browser, url, browser_js))
    return out


def _inspect(browser: Any, url: str, browser_js: str) -> dict[str, Any]:
    """The layout check, on the STATIC picture, in a 4800x2600 page (what inspect-arch
    measures). Console errors and uncaught exceptions are collected for its CONSOLE
    category, formatted the way inspect-arch.mjs formats them."""
    logs: list[str] = []
    ctx = browser.new_context(viewport={"width": 4800, "height": 2600}, device_scale_factor=1)
    try:
        page = ctx.new_page()
        page.on("console", lambda m: logs.append(f"console.{m.type}: {m.text}"[:400])
                if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: logs.append(f"uncaught exception: {str(e).strip()[:400]}"))
        page.goto(url, wait_until="load", timeout=30_000)
        _wait_ready(page)
        page.evaluate("document.documentElement.classList.add('arch-static')")
        page.wait_for_timeout(600)
        res = page.evaluate(f"{browser_js}.inspect({json.dumps(logs)})")
    finally:
        ctx.close()
    # The Node-only text output and the full DOM dump are not for the agent.
    return {"sections": res["sections"], "faults_count": res["faults"],
            "composition": res["composition"], "aspectNote": res["aspectNote"]}
