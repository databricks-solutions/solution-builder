#!/usr/bin/env python3
"""Build the Genie Code workshop from its source folder (stdlib only).

    python3 build.py            # -> ../notebooks_html/workshop.html
    python3 build.py --check    # build into memory, fail if the output is stale

Source layout (see README.md):
    workshop.json         page title / brand / sub + "forbid" (leftover-term check)
    shell.html            page frame with {{title}} {{brand}} {{sub}} and @@ markers
    shell.css             page chrome (sidebar, notebook frame)
    theme.css             every style a cell uses
    app.js                nav + copy buttons
    icons/<name>.svg      referenced in cells as <i data-icon="name"></i>
    notebooks/NN_slug/    one folder per notebook: notebook.json (pill + nav) + NN_name.html cells
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent
OUT_HTML = SRC.parent / "notebooks_html" / "workshop.html"

ICON_RE = re.compile(r'<i data-icon="([\w-]+)"></i>')


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def load_icons() -> dict[str, str]:
    return {p.stem: read(p).strip() for p in sorted((SRC / "icons").glob("*.svg"))}


def expand_icons(html_src: str, icons: dict[str, str], where: str) -> str:
    def sub(m: re.Match) -> str:
        name = m.group(1)
        if name not in icons:
            sys.exit(f"build error: unknown icon '{name}' in {where} (add icons/{name}.svg)")
        return icons[name]
    return ICON_RE.sub(sub, html_src)


def load_notebooks(icons: dict[str, str]) -> list[dict]:
    nbs = []
    for d in sorted(p for p in (SRC / "notebooks").iterdir() if p.is_dir()):
        meta = json.loads(read(d / "notebook.json")) if (d / "notebook.json").exists() else {}
        cells = [
            expand_icons(read(f).strip("\n"), icons, f"{d.name}/{f.name}")
            for f in sorted(d.glob("*.html"))
        ]
        if not cells:
            sys.exit(f"build error: notebook {d.name} has no .html cells")
        nbs.append({
            "slug": d.name,
            "id": "nb-" + d.name[:2],
            "pill": meta.get("pill", ""),
            "nav": meta.get("nav"),  # sidebar entry; notebooks without one are not in the sidebar
            "cells": cells,
        })
    return nbs


def render_nav(nbs: list[dict]) -> str:
    rows = []
    for nb in nbs:
        nav = nb["nav"]
        if not nav:
            continue
        opt = '<span class="opt">optional</span>' if nav.get("optional") else ""
        rows.append(
            f'      <a href="#{nb["id"]}" data-target="{nb["id"]}">'
            f'<span class="num">{html.escape(nav["num"])}</span>'
            f'<span>{html.escape(nav["label"])}</span>{opt}</a>'
        )
        if nav.get("divider_after"):
            rows.append('      <div class="divider"></div>')
    return "\n".join(rows)


# ── HTML ────────────────────────────────────────────────────────────
def render_html(nbs: list[dict], icons: dict[str, str], meta: dict) -> str:
    sections = []
    for i, nb in enumerate(nbs):
        active = " active" if i == 0 else ""
        cells = "".join(
            '\n<div class="cell md" data-cell="md" data-badge="Md">\n'
            f'<div class="gcw cell-body">\n{c}\n</div>\n</div>'
            for c in nb["cells"]
        )
        sections.append(
            f'<section class="nb{active}" id="{nb["id"]}" data-notebook="{nb["slug"]}">\n'
            f'<div class="nb-head"><span class="file">{nb["slug"]}</span>'
            f'<span class="pill">{nb["pill"]}</span></div>{cells}\n</section>'
        )
    shell = expand_icons(read(SRC / "shell.html"), icons, "shell.html")
    for key in ("title", "brand", "sub"):
        token = "{{" + key + "}}"
        if token not in shell:
            sys.exit(f"build error: shell.html is missing the {token} token")
        shell = shell.replace(token, html.escape(meta[key]))
    parts = {
        "<!-- @@nav -->": render_nav(nbs),
        "<!-- @@css -->": f"<style>\n{read(SRC / 'shell.css')}\n</style>\n<style>\n{read(SRC / 'theme.css')}\n</style>",
        "<!-- @@notebooks -->": "\n".join(sections),
        "<!-- @@js -->": f"<script>\n{read(SRC / 'app.js')}\n</script>",
    }
    for marker, value in parts.items():
        if marker not in shell:
            sys.exit(f"build error: shell.html is missing the {marker} marker")
        shell = shell.replace(marker, value)
    return shell


def check_forbidden(meta: dict, nbs: list[dict], rendered: str) -> None:
    """Fail if any term in workshop.json "forbid" survives into the built page.

    Used when a workshop is re-themed: the reference's story terms (LuxeBeauty, SKU-1001,
    Lyon, Claire...) must not leak into a new workshop's cells, shell or sidebar.
    """
    terms = [t for t in meta.get("forbid", []) if t]
    if not terms:
        return
    hits = []
    for term in terms:
        if term.lower() in rendered.lower():
            where = [f"{nb['slug']} cell {i + 1}" for nb in nbs for i, c in enumerate(nb["cells"])
                     if term.lower() in c.lower()]
            hits.append(f"'{term}' in {', '.join(where) or 'shell/sidebar/theme'}")
    if hits:
        sys.exit("build error: leftover story terms (workshop.json \"forbid\"):\n  " + "\n  ".join(hits))


def main() -> None:
    icons = load_icons()
    meta = json.loads(read(SRC / "workshop.json"))
    nbs = load_notebooks(icons)
    out = render_html(nbs, icons, meta)
    check_forbidden(meta, nbs, out)
    stale = not OUT_HTML.exists() or read(OUT_HTML) != out
    if "--check" in sys.argv:
        sys.exit(f"stale output (run build.py): {OUT_HTML.name}") if stale else print("output up to date")
        return
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(out, encoding="utf-8")
    print(f"built {OUT_HTML.relative_to(SRC.parent)}")


if __name__ == "__main__":
    main()
