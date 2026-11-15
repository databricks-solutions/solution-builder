#!/usr/bin/env python3
"""Build a single combined review page (index.html) with one tab per eval diagram.

Reads scripts/eval-arch/results/arch-eval.json for the fault counts + kinds, and
wraps the per-diagram HTMLs that eval-arch.ts already wrote in results/ (one
<diagram>.html each) in an iframe-per-tab shell. Reference tabs first (green),
hostile after (amber), each labelled with its fault count. Open results/index.html.

    python3 scripts/eval-arch/build-review-index.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"

scores = json.loads((RESULTS / "arch-eval.json").read_text())["scores"]


def faults(s: dict) -> int:
    g = sum(v or 0 for v in s.get("geometry", {}).values())
    return g + s.get("contentIssues", 0) + s.get("genericLabels", 0) + s.get("overLongLabels", 0)


def fault_breakdown(s: dict) -> list[dict]:
    """Per-category faults WITH their detail lines, so the page shows WHAT is
    wrong (e.g. 'e6 ✕ e7'), not just a number. Only non-zero categories."""
    out = []
    details = s.get("details", {})
    for cat, n in (s.get("geometry") or {}).items():
        if n:
            out.append({"cat": cat, "n": n, "lines": details.get(cat, [])})
    # content / label-quality faults (no per-line detail from inspect-arch)
    for cat, key in (("content issues", "contentIssues"), ("generic labels", "genericLabels"), ("over-long labels", "overLongLabels")):
        if s.get(key):
            out.append({"cat": cat, "n": s[key], "lines": []})
    return out


# references first, then hostile; stable alpha within each group
tabs = sorted(
    ({"name": s["diagram"], "kind": s["kind"], "faults": faults(s), "breakdown": fault_breakdown(s)} for s in scores),
    key=lambda t: (t["kind"] != "reference", t["name"]),
)
# only include tabs whose per-theme review HTMLs actually exist (eval-arch writes
# <name>.slide.html + <name>.technical.html); fall back to the plain <name>.html
# for older runs so the page still builds.
# slide + technical are read-only scoring renders; edit is the DRAGGABLE editor
# build (build-edit-pages.mjs writes <name>.edit.html) so you can move nodes and
# watch the routing update live. Only included when the edit pages exist.
# source shows the redraw's source image next to the diagram (see SOURCES).
THEMES = ("slide", "technical", "edit", "source")

# Source view: when a diagram was redrawn from an image, drop that image in
# results/sources/<name>.png (or .jpg/.jpeg/.webp; gitignored — source slides can be
# internal material) and the "Source vs output" toggle shows it next to the diagram
# as authored. Diagrams without an image get a placeholder saying where to put one.
SOURCES = RESULTS / "sources"


def source_image(name: str):
    for ext in ("png", "jpg", "jpeg", "webp"):
        f = SOURCES / f"{name}.{ext}"
        if f.exists():
            return f
    return None


def write_source_page(name: str) -> None:
    img = source_image(name)
    left = (f'<img src="sources/{img.name}" alt="source">' if img
            else f'<p>No source image. Put one at <code>results/sources/{name}.png</code> and rebuild.</p>')
    (RESULTS / f"{name}.source.html").write_text(f"""<!doctype html><meta charset="utf-8">
<style>
  html,body{{margin:0;height:100%;font:13px -apple-system,sans-serif;color:#334}}
  body{{display:flex;flex-direction:column}}
  .pane{{flex:1 1 50%;min-height:0;display:flex;flex-direction:column;border-bottom:1px solid #dde}}
  .pane h4{{margin:0;padding:6px 10px;background:#f4f6f8;border-bottom:1px solid #dde;font-weight:600}}
  .body{{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;background:#fff}}
  .body img{{max-width:100%;max-height:100%;object-fit:contain}}
  iframe{{width:100%;height:100%;border:0}}
</style>
<div class="pane"><h4>Source</h4><div class="body">{left}</div></div>
<div class="pane"><h4>Output</h4><div class="body"><iframe src="{name}.html"></iframe></div></div>
""")


def theme_src(name: str, theme: str) -> str:
    themed = RESULTS / f"{name}.{theme}.html"
    src = f"{name}.{theme}.html" if themed.exists() else f"{name}.html"
    # The editable drag copies open in EPHEMERAL mode: `#ephemeral` tells the
    # standalone editor to skip its localStorage restore/snapshot, so a refresh
    # always resets to the original diagram (these are for testing positions, not
    # authoring — remembered drags across reloads were confusing).
    if theme == "edit":
        src += "#ephemeral"
    if theme == "source":
        src = f"{name}.source.html"
    return src


tabs = [t for t in tabs if any((RESULTS / f"{t['name']}.{th}.html").exists() for th in THEMES)
        or (RESULTS / f"{t['name']}.html").exists()]

# ── Grouping (sidebar sections) ───────────────────────────────────────────────
# Derived, never hand-listed, so a new diagram lands in the right section on its own:
#   redrawn from an image (has a results/sources/ file) → by cloud (name suffix);
#   other skill references → style examples (style-*) vs patterns; hostile corpus.
REFERENCE_DIR = HERE.parents[2] / ".claude/skills/databricks-architecture/reference"
CORPUS_DIR = HERE / "corpus"
CLOUDS = {"azure": "Azure", "aws": "AWS", "gcp": "GCP"}
GROUP_ORDER = ["Redrawn from an image", "Skill references", "Hostile corpus"]


def diagram_title(name: str) -> str:
    """The frame title (or tab name) of the diagram, for a readable sidebar line."""
    import re
    for f in (REFERENCE_DIR / f"{name}.jsonc", CORPUS_DIR / f"{name}.json"):
        if f.exists():
            txt = f.read_text()
            m = (re.search(r'"frame"\s*:\s*\{[^{}]*?"title"\s*:\s*"([^"]+)"', txt)
                 or re.search(r'"name"\s*:\s*"([^"]+)"', txt))
            if m:
                return m.group(1)
    return ""


def cloud_of(name: str) -> str:
    """The cloud whose icons the diagram uses most (file:cloud/<cloud>/…)."""
    import re
    f = REFERENCE_DIR / f"{name}.jsonc"
    hits = re.findall(r"file:cloud/(azure|aws|gcp)/", f.read_text()) if f.exists() else []
    if not hits:
        return "Cross-cloud"
    return CLOUDS[max(set(hits), key=hits.count)]


def group_of(t: dict) -> tuple[str, str]:
    if t["kind"] != "reference":
        return "Hostile corpus", ""
    if t["has_source"]:
        return "Redrawn from an image", cloud_of(t["name"])
    return "Skill references", "Style examples" if t["name"].startswith("style-") else "Patterns"


for t in tabs:
    write_source_page(t["name"])
    t["has_source"] = source_image(t["name"]) is not None
    t["title"] = diagram_title(t["name"])
    t["group"], t["sub"] = group_of(t)

tabs.sort(key=lambda t: (GROUP_ORDER.index(t["group"]), t["sub"], t["name"]))

import html as _html

buttons = []
frames = []
cur_group = cur_sub = None
for i, t in enumerate(tabs):
    if t["group"] != cur_group:
        if cur_group is not None:
            buttons.append("</div></section>")
        n = sum(1 for x in tabs if x["group"] == t["group"])
        bad = sum(1 for x in tabs if x["group"] == t["group"] and x["faults"])
        buttons.append(
            f'<section class="group"><h3 class="ghead"><span class="caret">▾</span>{t["group"]}'
            f'<span class="gcount">{n}{f" · {bad} with faults" if bad else ""}</span></h3><div class="gbody">'
        )
        cur_group, cur_sub = t["group"], None
    if t["sub"] and t["sub"] != cur_sub:
        buttons.append(f'<h4 class="sub">{t["sub"]}</h4>')
        cur_sub = t["sub"]
    active = " active" if i == 0 else ""
    badge_cls = "ok" if t["faults"] == 0 else "bad"
    title = _html.escape(t["title"])
    search = _html.escape(f'{t["name"]} {t["title"]} {t["group"]} {t["sub"]}'.lower())
    buttons.append(
        f'<button class="tab{active}" data-i="{i}" data-name="{t["name"]}" data-search="{search}"'
        f' data-source="{1 if t["has_source"] else 0}">'
        f'<span class="tname"><span class="dot {t["kind"]}"></span>{t["name"]}</span>'
        f'<span class="badge {badge_cls}">{t["faults"]}</span>'
        + (f'<span class="ttitle">{title}</span>' if title else "")
        + "</button>"
    )
    # One iframe per (diagram, theme). Lazy: only the first-tab / active-theme iframe
    # gets a src; the rest load on first view (10×2 themes × ~2MB is heavy). The
    # active theme starts as "slide"; the toggle swaps which theme is shown.
    for th in THEMES:
        on = i == 0 and th == "slide"
        vis = " active" if on else ""
        src = f'src="{theme_src(t["name"], th)}"' if on else f'data-src="{theme_src(t["name"], th)}"'
        frames.append(f'<iframe class="frame{vis}" data-i="{i}" data-theme="{th}" {src}></iframe>')

if cur_group is not None:
    buttons.append("</div></section>")

# Per-tab fault breakdown, indexed by tab position, for the detail panel.
breakdowns_json = json.dumps([t["breakdown"] for t in tabs])

html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Architecture eval — review</title>
<style>
  :root {{ --bg:#0f1419; --panel:#1a2129; --fg:#e8ecf0; --muted:#8aa; --border:#2b3540; }}
  * {{ box-sizing:border-box; }}
  html,body {{ margin:0; height:100%; background:var(--bg); color:var(--fg);
    font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; }}
  /* Column layout: fixed header (never scrolls) + fixed tab strip + flexible
     stage. The stage takes the remaining height whatever the header height, so
     nothing depends on a hard-coded top offset — it scales to any tab count. */
  body {{ display:grid; grid-template-columns:300px 1fr; grid-template-rows:auto 1fr; }}
  .header {{ grid-column:1 / -1; }}
  .sidebar {{ grid-row:2; overflow:auto; background:var(--panel); border-right:1px solid var(--border);
    padding:8px 8px 40px; }}
  .search {{ width:100%; padding:7px 9px; border-radius:8px; border:1px solid var(--border);
    background:#0f1419; color:var(--fg); font-size:12px; margin-bottom:6px; }}
  .group {{ margin-top:8px; }}
  .ghead {{ margin:0; padding:6px 4px; font-size:12px; text-transform:uppercase; letter-spacing:.04em;
    color:#cfd8e3; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none; }}
  .ghead .caret {{ display:inline-block; transition:transform .15s; color:var(--muted); }}
  .group.collapsed .caret {{ transform:rotate(-90deg); }}
  .group.collapsed .gbody {{ display:none; }}
  .gcount {{ margin-left:auto; text-transform:none; letter-spacing:0; font-weight:400; color:var(--muted); }}
  .sub {{ margin:8px 4px 3px; font-size:11px; color:var(--muted); font-weight:600; }}
  .tabstrip {{ display:none; }}
  .header {{ display:flex; align-items:center; gap:14px; padding:8px 10px; background:var(--panel);
    border-bottom:1px solid var(--border); flex:0 0 auto; }}
  .header .title {{ font-weight:600; opacity:.7; white-space:nowrap; }}
  /* Tab strip: a SINGLE row that scrolls horizontally (never wraps), so however
     many diagrams there are the header/toggle above it stay put and reachable. */
  .tabstrip {{ display:flex; gap:4px; padding:6px 10px; background:var(--panel);
    border-bottom:1px solid var(--border); flex:0 0 auto; overflow-x:auto; overflow-y:hidden;
    white-space:nowrap; scrollbar-width:thin; }}
  .tab {{ display:grid; grid-template-columns:1fr auto; align-items:center; gap:2px 6px; width:100%;
    padding:6px 8px; margin:2px 0; cursor:pointer; text-align:left; background:transparent; color:var(--fg);
    border:1px solid transparent; border-radius:8px; font-size:12px; }}
  .tab .tname {{ display:flex; align-items:center; gap:6px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
  .tab .ttitle {{ grid-column:1 / -1; color:var(--muted); font-size:11px; white-space:nowrap; overflow:hidden;
    text-overflow:ellipsis; padding-left:14px; }}
  .tab.hidden {{ display:none; }}
  .tab:hover {{ border-color:#3d7; }}
  .tab.active {{ background:#25303a; border-color:#4a90d9; }}
  .dot {{ width:8px; height:8px; border-radius:50%; flex:0 0 auto; }}
  .dot.reference {{ background:#3ecf8e; }} .dot.hostile {{ background:#e0a; }}
  .badge {{ font-size:11px; padding:0 6px; border-radius:10px; font-variant-numeric:tabular-nums; }}
  .badge.ok {{ background:#173; color:#9f9; }} .badge.bad {{ background:#622; color:#fbb; }}
  .stage {{ position:relative; grid-row:2; grid-column:2; min-height:0; }}
  .frame {{ position:absolute; inset:0; width:100%; height:100%; border:0; display:none; background:#fff; }}
  .frame.active {{ display:block; }}
  .legend {{ margin-left:auto; font-size:11px; color:var(--muted); display:flex; align-items:center;
    gap:10px; white-space:nowrap; }}
  .theme-toggle {{ display:inline-flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; flex:0 0 auto; }}
  .theme-toggle button {{ background:transparent; color:var(--fg); border:0; padding:5px 10px; cursor:pointer; font-size:12px; }}
  .theme-toggle button.on {{ background:#25303a; color:#8cf; }}
  /* Fault detail panel: floats over the stage bottom-left, listing WHAT is wrong
     (each category + its inspect-arch detail lines) for the active diagram, not
     just the badge number. Collapsible; scrolls if long; never covers the whole
     canvas. */
  .faults {{ position:absolute; left:10px; bottom:10px; z-index:5; max-width:min(46%, 560px);
    max-height:52%; overflow:auto; background:rgba(16,20,25,.94); border:1px solid var(--border);
    border-radius:10px; font-size:12px; box-shadow:0 6px 24px rgba(0,0,0,.4); }}
  .faults.clean {{ display:none; }}
  .faults-head {{ display:flex; align-items:center; gap:8px; padding:7px 10px; cursor:pointer;
    position:sticky; top:0; background:rgba(16,20,25,.97); border-bottom:1px solid var(--border); }}
  .faults-head .n {{ font-weight:700; color:#fbb; }}
  .faults-head .hint {{ margin-left:auto; color:var(--muted); font-size:11px; }}
  .faults-body {{ padding:6px 10px 10px; }}
  .faults.collapsed .faults-body {{ display:none; }}
  .fcat {{ margin:8px 0 2px; font-weight:600; color:#ffd9a0; }}
  .fcat .fn {{ color:var(--muted); font-weight:400; }}
  .fline {{ margin:1px 0 1px 12px; color:#d7e0ea; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:11.5px; white-space:pre-wrap; word-break:break-word; }}
  .fnone {{ margin-left:12px; color:var(--muted); font-style:italic; }}
</style></head>
<body>
  <div class="header">
    <span class="title">Architecture eval — {len(tabs)} diagrams</span>
    <span class="theme-toggle">
      <button data-theme="slide" class="on">Slide</button>
      <button data-theme="technical">Technical</button>
      <button data-theme="edit" title="Draggable editor build — move nodes to test routing live (local only, not saved to the repo)">Edit &amp; drag</button>
      <button data-theme="source" title="The image this diagram was redrawn from, next to the diagram as authored (results/sources/&lt;name&gt;.png)">Source vs output</button>
    </span>
    <span class="legend">
      <span><span class="dot reference"></span> reference &nbsp; <span class="dot hostile"></span> hostile &nbsp;·&nbsp; badge = faults · ←/→ step through</span>
    </span>
  </div>
  <nav class="sidebar">
    <input class="search" id="search" placeholder="Filter diagrams…  (/ to focus)">
    {''.join(buttons)}
  </nav>
  <div class="stage">
    {''.join(frames)}
    <div class="faults" id="faults">
      <div class="faults-head" id="faultsHead">
        <span class="n" id="faultsN"></span>
        <span id="faultsTitle">faults</span>
        <span class="hint">click to collapse</span>
      </div>
      <div class="faults-body" id="faultsBody"></div>
    </div>
  </div>
  <script>
    const tabs = [...document.querySelectorAll('.tab')];
    const frames = [...document.querySelectorAll('.frame')];
    const themeBtns = [...document.querySelectorAll('.theme-toggle button')];
    const BREAKDOWNS = {breakdowns_json};
    const faultsEl = document.getElementById('faults');
    const faultsN = document.getElementById('faultsN');
    const faultsBody = document.getElementById('faultsBody');
    let active = 0, theme = 'slide';
    const esc = s => String(s).replace(/[&<>]/g, c => ({{ '&':'&amp;', '<':'&lt;', '>':'&gt;' }}[c]));
    function renderFaults() {{
      const bd = BREAKDOWNS[active] || [];
      const total = bd.reduce((a, c) => a + (c.n || 0), 0);
      faultsN.textContent = total;
      faultsEl.classList.toggle('clean', total === 0);
      faultsBody.innerHTML = bd.map(c => {{
        const lines = (c.lines && c.lines.length)
          ? c.lines.map(l => `<div class="fline">${{esc(l)}}</div>`).join('')
          : '<div class="fnone">(no per-item detail)</div>';
        return `<div class="fcat">${{esc(c.cat)}} <span class="fn">×${{c.n}}</span></div>${{lines}}`;
      }}).join('');
    }}
    function apply() {{
      tabs.forEach(t => {{
        const on = +t.dataset.i === active;
        t.classList.toggle('active', on);
        // keep the current tab in view when the strip scrolls (many diagrams)
        if (on) t.scrollIntoView({{ inline: 'nearest', block: 'nearest' }});
      }});
      themeBtns.forEach(b => b.classList.toggle('on', b.dataset.theme === theme));
      frames.forEach(f => {{
        const on = +f.dataset.i === active && f.dataset.theme === theme;
        f.classList.toggle('active', on);
        if (on && !f.src && f.dataset.src) f.src = f.dataset.src; // lazy-load on first view
      }});
      renderFaults();
      // Reflect the active diagram in the URL hash so a specific tab is
      // shareable / reopenable (e.g. …/index.html#decision-view-grid). Also
      // remember the theme after `:` (…#decision-view-grid:edit).
      const name = tabs[active] && tabs[active].dataset.name;
      if (name) history.replaceState(null, '', '#' + name + (theme !== 'slide' ? ':' + theme : ''));
    }}
    // Open the tab (+ theme) named in the URL hash, if any.
    function fromHash() {{
      const h = decodeURIComponent(location.hash.replace(/^#/, ''));
      if (!h) return;
      const [name, th] = h.split(':');
      const i = tabs.findIndex(t => t.dataset.name === name);
      if (i >= 0) active = i;
      if (th && themeBtns.some(b => b.dataset.theme === th)) theme = th;
    }}
    document.getElementById('faultsHead').addEventListener('click', () => faultsEl.classList.toggle('collapsed'));
    tabs.forEach(t => t.addEventListener('click', () => {{ active = +t.dataset.i; apply(); }}));
    themeBtns.forEach(b => b.addEventListener('click', () => {{ theme = b.dataset.theme; apply(); }}));
    // ←/→ step through diagrams (with many tabs, faster than hunting for one).
    const search = document.getElementById('search');
    search.addEventListener('input', () => {{
      const q = search.value.trim().toLowerCase();
      tabs.forEach(t => t.classList.toggle('hidden', !!q && !q.split(/\s+/).every(w => t.dataset.search.includes(w))));
      document.querySelectorAll('.group').forEach(g => {{
        if (q) g.classList.remove('collapsed');
        g.style.display = g.querySelector('.tab:not(.hidden)') ? '' : 'none';
      }});
    }});
    document.querySelectorAll('.ghead').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
    addEventListener('keydown', e => {{
      if (e.key === '/' && document.activeElement !== search) {{ e.preventDefault(); search.focus(); return; }}
      if (document.activeElement === search) {{ if (e.key === 'Escape') search.blur(); return; }}
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      // step through the VISIBLE diagrams only (respects the filter + collapsed groups)
      const vis = tabs.filter(t => t.offsetParent !== null).map(t => +t.dataset.i);
      if (!vis.length) return;
      const k = vis.indexOf(active), fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      active = vis[k < 0 ? 0 : (k + (fwd ? 1 : vis.length - 1)) % vis.length];
      apply();
    }});
    addEventListener('hashchange', () => {{ fromHash(); apply(); }});
    fromHash();
    apply();
  </script>
</body></html>
"""

out = RESULTS / "index.html"
out.write_text(html)
print(f"wrote {out}  ({len(tabs)} tabs)")
