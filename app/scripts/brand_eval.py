#!/usr/bin/env python
"""Brand-resolver evaluation harness — the improvement loop's cockpit.

Runs BrandService.resolve() over a curated set of companies (big / medium /
small startups), scores each result heuristically, and writes an HTML report
with the LOGOS RENDERED (on white / black / checker) + PALETTE swatches + the
full instrumented TRACE per company. Search results are cached (see
brand_service._search_cache_*), so re-running after a code patch is fast but
re-executes ALL the resolve logic — that's the point of the loop.

Workflow (as designed with the user):
  1. Iterate on ONE company:      uv run python scripts/brand_eval.py --only Stripe
     → patch brand_service.py → re-run the same command (searches cached) → repeat.
  2. When it looks good, run ALL:  uv run python scripts/brand_eval.py
  3. Read the report / traces, patch, loop again until all tiers look good.

Options:
  --only NAME[,NAME...]   Run just these (fast single-company iteration).
  --tier big|medium|small Run one tier.
  --no-cache              Bypass the search cache (force fresh DDG).
  --open                  Open the HTML report when done (macOS `open`).
  --list                  Print the company set and exit.

Outputs per run (in /tmp/brand_eval/):
  review-<ts>.html  — INTERACTIVE human-review file (also review-latest.html).
                      Shows Claude's findings + reasoning AND per-element ok/✗
                      controls (website / logo / palette / global), lets you pick
                      the correct logo candidate + flag wrong swatches, and has an
                      "Export human report" button that copies structured
                      markdown+JSON to the clipboard to paste back to Claude.
  results-<ts>.json — durable machine record of the run.
Per-company trace also mirrored to /tmp/brand_traces/<slug>.json.
"""
from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import sys
import time
import webbrowser
from pathlib import Path

# --- Curated test set --------------------------------------------------------
# Mix of tiers so we see where the system is strong/weak. Big = household names
# with pro brand pages; medium = well-known startups; small = harder, thinner
# web presence (the real stress test).
COMPANIES: dict[str, list[str]] = {
    "big": ["Databricks", "Stripe", "Nvidia", "Airbnb", "Rolls-Royce", "Notion"],
    "medium": ["Linear", "Ramp", "Vercel", "Retool", "Cal.com", "Mistral AI"],
    "small": ["Resend", "Braintrust", "Baseten", "Modal", "Turbopuffer", "Unkey"],
}

REPORT_DIR = Path(os.environ.get("BRAND_EVAL_DIR", "/tmp/brand_eval"))


def _score(out) -> tuple[int, list[str]]:
    """Cheap heuristic score (0-100) + notes — a triage signal, NOT ground truth
    (I still eyeball the rendered logos). Rewards: a real domain, a WIDE wordmark
    logo (aspect ≳ 2.5), a rich multi-hue palette, no warnings. Penalizes icon-ish
    / square / jpeg logos and thin palettes."""
    score, notes = 0, []
    # Domain (25)
    if out.domain:
        score += 25
    else:
        notes.append("no domain")

    # Logo (up to 40): present (vision-committed) + a small nudge for a vector.
    # NOTE: we deliberately DON'T re-judge by jpeg/aspect anymore — the logo is now
    # chosen by a vision model that LOOKED at the candidates, and search-CDN logos
    # legitimately come as padded PNG/JPEG (canvas aspect ≠ logo aspect). The human
    # review is the real logo verdict; this is just "did we commit something".
    chosen = next((l for l in out.logos if l.chosen), None)
    if chosen:
        score += 32
        ct = chosen.content_type or ""
        if "svg" in ct:
            score += 8  # crisp vector — a bonus, not a requirement
        elif not ct:
            notes.append("logo content-type unknown")
    else:
        notes.append("NO logo")

    # Palette (up to 35): richness + distinct hues
    pal = out.palette
    n = len(pal)
    score += min(25, n * 8)
    if n >= 4 and _distinct_hues(pal) >= 2:
        score += 10  # a real multi-hue palette, not shades of one color
    if n < 3:
        notes.append(f"thin palette ({n})")

    if out.warnings:
        score -= 4 * len(out.warnings)
        notes.append(f"{len(out.warnings)} warning(s)")
    return max(0, min(100, score)), notes


def _distinct_hues(hexes: list[str]) -> int:
    """Rough count of distinct hue families (so we don't reward 5 shades of blue)."""
    import colorsys
    buckets = set()
    for h in hexes:
        h = h.lstrip("#")
        if len(h) != 6:
            continue
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        hue, _, sat = colorsys.rgb_to_hls(r, g, b)[0], 0, colorsys.rgb_to_hls(r, g, b)[2]
        if sat < 0.15:  # greyish → its own "neutral" bucket
            buckets.add("neutral")
        else:
            buckets.add(round(hue * 12))  # 12 hue bins
    return len(buckets)




def _result_dict(out, score: int, notes: list[str], secs: float) -> dict:
    """Serialize a resolve into the JSON record embedded in the review file +
    saved to disk. Includes my findings (score/notes/trace) AND everything the
    human needs to review (rendered logos, palette, domain)."""
    return {
        "name": out.name,
        "domain": out.domain,
        "confidence": out.confidence,
        "score": score,
        "notes": notes,
        "secs": round(secs, 1),
        "palette": out.palette,
        "logo_url": out.logo_url,
        "warnings": out.warnings,
        "contact_sheet": out.logo_contact_sheet,
        "site_screenshot": out.site_screenshot,
        "logo_provenance": out.logo_provenance,
        "logo_rationale": next((s.get("reasoning") for s in out.trace
                                if s.get("tool") == "find_logo"), None),
        "logos": [
            {"source": l.source, "chosen": l.chosen, "content_type": l.content_type,
             "dims": l.dims, "data_url": l.data_url,
             "url": l.url if (l.url or "").startswith("http") else "(inline)"}
            for l in out.logos
        ],
        # reasoning notes pulled out of the trace for the human summary
        "reasoning": [
            {"step": s.get("tool"), "why": s.get("reasoning")}
            for s in out.trace if s.get("kind") == "reasoning"
        ],
        "trace": out.trace,
    }


# --- Interactive review HTML -------------------------------------------------
# Self-contained: embeds the results as JSON + JS that renders review controls
# (ok/no + note per element, candidate re-pick, per-swatch flag, global comment)
# and an "Export human report" button that copies structured markdown+JSON to the
# clipboard for pasting back to Claude. No server, works offline.
_REVIEW_TEMPLATE = r"""<!doctype html><html><head><meta charset="utf-8">
<title>Brand review — LOOP</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;max-width:1000px;margin:16px auto;padding:0 16px;color:#111}
 h1{margin:.2em 0}
 .sub{color:#666;font-size:15px;font-weight:400}
 .card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:14px 0}
 .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
 .score{color:#fff;padding:3px 10px;border-radius:999px;font-weight:700}
 .sec{margin-top:12px}
 .sec>b{font-size:12px;color:#555;letter-spacing:.03em}
 .swatch{display:inline-flex;flex-direction:column;align-items:center;margin:3px;cursor:pointer;position:relative}
 .swatch .chip{width:54px;height:54px;border-radius:8px;border:1px solid #ccc}
 .swatch.bad .chip{outline:3px solid #dc2626;outline-offset:1px;opacity:.5}
 .swatch code{font-size:10px}
 .logo{display:inline-block;margin:4px 8px 4px 0;padding:6px;border:1px solid #eee;border-radius:8px;vertical-align:top;cursor:pointer}
 .logo.pick{border-color:#16a34a;box-shadow:0 0 0 2px #16a34a}
 .logo .bgs{display:flex;gap:4px}
 .bgbox{width:92px;height:42px;display:flex;align-items:center;justify-content:center;border:1px solid #ddd;border-radius:6px}
 .bgbox img{max-height:34px;max-width:84px;object-fit:contain}
 .meta{font-size:10px;color:#999}
 .verdict{margin-top:6px}
 .btn{border:1px solid #ccc;background:#fff;border-radius:6px;padding:2px 10px;cursor:pointer;font-size:12px;margin-right:4px}
 .btn.ok.on{background:#16a34a;color:#fff;border-color:#16a34a}
 .btn.no.on{background:#dc2626;color:#fff;border-color:#dc2626}
 textarea{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:6px;font-size:12px;margin-top:4px;font-family:inherit}
 details{margin-top:8px}
 summary{cursor:pointer;font-size:12px;color:#555}
 .why{font-size:12px;color:#6b21a8;margin:2px 0}
 .warn{color:#b45309;font-size:12px}
 .bar{position:sticky;top:0;background:#fffe;backdrop-filter:blur(4px);padding:10px 0;border-bottom:1px solid #eee;z-index:9;display:flex;gap:8px;align-items:center}
 .bar .btn{padding:6px 14px;font-size:14px}
 .exp{background:#111;color:#fff;border-color:#111}
 .hint{font-size:12px;color:#888}
 table.tr{width:100%;border-collapse:collapse}
 table.tr td{font-size:11px;vertical-align:top;padding:1px 4px}
</style></head><body>
<div class="bar">
  <button class="btn exp" onclick="exportReport()">📋 Export human report</button>
  <span id="status" class="hint"></span>
  <span class="hint" style="margin-left:auto">click swatches to flag ✗ · click a logo to mark it the correct one</span>
</div>
<h1>Brand review <span class="sub" id="hdr"></span></h1>
<div id="cards"></div>
<script>
const DATA = __DATA__;
const REVIEW = {};   // name -> {website:{v,note}, logo:{v,note,pick}, palette:{v,note,bad:[]}, global}
function rv(name){ return REVIEW[name] || (REVIEW[name]={website:{},logo:{bad:[]},palette:{bad:[]},global:""}); }
function scColor(s){ return s>=70?'#16a34a':s>=45?'#d97706':'#dc2626'; }

function verdict(name, key){
  const r = rv(name)[key] || (rv(name)[key]={});
  const id = name+'|'+key;
  return `<span class="verdict" data-v="${id}">
    <button class="btn ok ${r.v==='ok'?'on':''}" onclick="setV('${id}','ok')">ok</button>
    <button class="btn no ${r.v==='no'?'on':''}" onclick="setV('${id}','no')">✗</button>
    <input style="border:1px solid #ddd;border-radius:6px;padding:2px 6px;font-size:12px;width:60%"
      placeholder="note (why not ok / what's wrong)" value="${(r.note||'').replace(/"/g,'&quot;')}"
      oninput="setNote('${id}',this.value)"></span>`;
}
function setV(id,v){ const [n,k]=id.split('|'); const r=rv(n)[k]||(rv(n)[k]={});
  r.v=(r.v===v?'':v); render(); }
function setNote(id,val){ const [n,k]=id.split('|'); const r=rv(n)[k]||(rv(n)[k]={}); r.note=val; }
function flagSwatch(name,hex){ const r=rv(name).palette; r.bad=r.bad||[];
  const i=r.bad.indexOf(hex); if(i>=0) r.bad.splice(i,1); else r.bad.push(hex); render(); }
function pickLogo(name,idx){ const r=rv(name).logo; r.pick=(r.pick===idx?undefined:idx); render(); }
function setGlobal(name,val){ rv(name).global=val; }

function logoHtml(name,l,idx){
  const r=rv(name).logo;
  const picked = r.pick===idx || (r.pick===undefined && l.chosen);
  const bgs=[['#fff','white'],['#000','black'],
    ['repeating-conic-gradient(#d4d4d8 0% 25%,transparent 0% 50%) 50%/14px 14px','alpha']];
  const imgs=bgs.map(([bg,lb])=>`<span style="display:inline-flex;flex-direction:column;align-items:center">
    <span class="bgbox" style="background:${bg}"><img src="${l.data_url}"></span>
    <span class="meta">${lb}</span></span>`).join('');
  const d=l.dims?`${l.dims.w}×${l.dims.h} a${l.dims.aspect}`:'dims?';
  return `<div class="logo ${picked?'pick':''}" onclick="pickLogo('${name}',${idx})">
    <div class="meta"><b>${l.source}${l.chosen?' ★agent':''}${picked?' ✓correct':''}</b> ${l.content_type||''} ${d}</div>
    <div class="bgs">${imgs}</div></div>`;
}
function traceHtml(t){
  const col={tool:'#2563eb',decision:'#16a34a',reasoning:'#9333ea',warning:'#dc2626',phase:'#64748b'};
  return '<table class="tr">'+t.map(s=>{
    let b=[]; for(const k of['args','summary']) if(s[k]) b.push(k+'='+JSON.stringify(s[k]));
    if(s.reasoning) b.push('<i>why: '+s.reasoning+'</i>'); if(s.detail) b.push(s.detail);
    return `<tr><td style="color:#aaa">${s.t_ms||''}ms</td>
      <td style="color:${col[s.kind]||'#333'};font-weight:600">${s.tool||s.kind}</td>
      <td style="font-family:monospace;word-break:break-word">${b.join(' ')}</td></tr>`;
  }).join('')+'</table>';
}
function card(d){
  const pal=d.palette.length? d.palette.map(h=>{
    const bad=(rv(d.name).palette.bad||[]).includes(h);
    return `<span class="swatch ${bad?'bad':''}" onclick="flagSwatch('${d.name}','${h}')">
      <span class="chip" style="background:${h}"></span><code>${h}</code></span>`;
  }).join('') : '<i style="color:#999">none</i>';
  const logos=d.logos.length? d.logos.map((l,i)=>logoHtml(d.name,l,i)).join('') : '<i style="color:#999">no logos</i>';
  const why=d.reasoning.filter(r=>r.why).map(r=>`<div class="why">• <b>${r.step}</b>: ${r.why}</div>`).join('');
  const warn=d.warnings.length?`<div class="warn">⚠ ${d.warnings.join('; ')}</div>`:'';
  return `<div class="card">
    <div class="row"><h2 style="margin:0">${d.name}
      <span class="sub">${d.domain||'—'} · conf ${d.confidence} · ${d.secs}s</span></h2>
      <span class="score" style="background:${scColor(d.score)}">${d.score}</span></div>
    ${d.notes.length?`<div class="hint">${d.notes.join('; ')}</div>`:''}${warn}
    <div class="sec"><b>WEBSITE / DOMAIN</b> — <code>${d.domain||'—'}</code> ${verdict(d.name,'website')}
      ${d.site_screenshot?`<details style="margin-top:4px"><summary>official site screenshot (reference the model saw)</summary>
        <img src="${d.site_screenshot}" style="max-width:100%;border:1px solid #eee;border-radius:6px;margin-top:4px"></details>`:''}</div>
    <div class="sec"><b>LOGO</b> (click the correct one) ${verdict(d.name,'logo')}<div>${logos}</div>
      ${d.logo_rationale?`<div class="why" style="margin-top:4px">👁 vision pick: ${d.logo_rationale}</div>`:''}
      ${d.contact_sheet?`<details style="margin-top:4px"><summary>grading image the vision model saw (${(d.logo_provenance||[]).length} candidates)</summary>
        <img src="${d.contact_sheet}" style="max-width:100%;border:1px solid #eee;border-radius:6px;margin-top:4px">
        ${(d.logo_provenance||[]).length?`<table class="tr" style="margin-top:4px">${d.logo_provenance.map(p=>{
          const vc={chosen:'#16a34a',alternate:'#2563eb',rejected:'#dc2626',candidate:'#888'}[p.verdict||'candidate'];
          return `<tr><td>#${p.n}</td><td style="color:${vc};font-weight:600">${p.verdict||''}</td>
           <td>${p.type}</td><td>${p.source||''}${p.official?' <b>★official</b>':''}</td>
           <td style="font-family:monospace">${p.host||''}</td>
           <td><a href="${p.image}" target="_blank">src</a></td></tr>`;}).join('')}</table>`:''}
        </details>`:''}</div>
    <div class="sec"><b>PALETTE</b> (click a swatch to flag ✗) ${verdict(d.name,'palette')}<div>${pal}</div></div>
    <div class="sec"><b>GLOBAL COMMENT</b>
      <textarea rows="2" placeholder="overall feedback for ${d.name}"
        oninput="setGlobal('${d.name}',this.value)">${rv(d.name).global||''}</textarea></div>
    ${why?`<details><summary>Claude's reasoning</summary>${why}</details>`:''}
    <details><summary>full trace (${d.trace.length} steps)</summary>${traceHtml(d.trace)}</details>
  </div>`;
}
function render(){
  document.getElementById('hdr').textContent = DATA.meta.header;
  document.getElementById('cards').innerHTML = DATA.results.map(card).join('');
}
function exportReport(){
  const lines=['# Brand review — human feedback','',`_Loop: ${DATA.meta.header}_`,''];
  for(const d of DATA.results){
    const r=rv(d.name);
    const V=(k)=>{const x=r[k]||{}; return (x.v?x.v.toUpperCase():'—')+(x.note?` — ${x.note}`:'');};
    lines.push(`## ${d.name}  (score ${d.score})`);
    lines.push(`- Website (\`${d.domain||'—'}\`): ${V('website')}`);
    let logoLine=`- Logo: ${V('logo')}`;
    if(r.logo && r.logo.pick!==undefined){ const lp=d.logos[r.logo.pick];
      logoLine+=`  [correct = candidate #${r.logo.pick}: ${lp.source} ${lp.url}]`; }
    lines.push(logoLine);
    let palLine=`- Palette (${d.palette.join(', ')||'none'}): ${V('palette')}`;
    if(r.palette && r.palette.bad && r.palette.bad.length) palLine+=`  [flagged wrong: ${r.palette.bad.join(', ')}]`;
    lines.push(palLine);
    if(r.global) lines.push(`- Overall: ${r.global}`);
    lines.push('');
  }
  const md=lines.join('\n');
  const blob=md+'\n\n<!-- machine-readable -->\n```json\n'+JSON.stringify(REVIEW,null,1)+'\n```\n';
  navigator.clipboard.writeText(blob).then(
    ()=>{document.getElementById('status').textContent='✓ copied to clipboard — paste it to Claude';},
    ()=>{document.getElementById('status').textContent='clipboard blocked — see console'; console.log(blob);}
  );
}
render();
</script></body></html>"""


def write_review_html(results: list[dict], header: str, path: Path) -> None:
    payload = {"meta": {"header": header}, "results": results}
    html_out = _REVIEW_TEMPLATE.replace("__DATA__", json.dumps(payload))
    path.write_text(html_out)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated company names")
    ap.add_argument("--tier", choices=["big", "medium", "small"])
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--open", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for tier, names in COMPANIES.items():
            print(f"{tier:7}: {', '.join(names)}")
        return 0

    if args.no_cache:
        os.environ["BRAND_NO_CACHE"] = "1"

    if args.only:
        names = [n.strip() for n in args.only.split(",") if n.strip()]
    elif args.tier:
        names = COMPANIES[args.tier]
    else:
        names = [n for tier in COMPANIES.values() for n in tier]

    from databricks.sdk import WorkspaceClient
    from demo_prompt_generator.backend.core._config import AppConfig
    from demo_prompt_generator.backend.services.brand_service import BrandService

    svc = BrandService(WorkspaceClient(), AppConfig())
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    results, total = [], 0
    print(f"Resolving {len(names)} companies…\n")
    for name in names:
        t = time.time()
        out = await svc.resolve(name)
        secs = time.time() - t
        score, notes = _score(out)
        total += score
        chosen = next((l for l in out.logos if l.chosen), None)
        print(f"  {score:3d}  {name:14} {str(out.domain or '—'):22} "
              f"logo={chosen.source if chosen else 'NONE':11} pal={len(out.palette)} "
              f"{secs:4.1f}s  {'; '.join(notes)}")
        results.append(_result_dict(out, score, notes, secs))

    avg = total // max(1, len(names))
    stamp = time.strftime("%Y%m%d-%H%M%S")
    header = f"avg {avg}/100 · {len(names)} companies · {time.strftime('%Y-%m-%d %H:%M')}"

    # 1) durable JSON record of this loop iteration
    (REPORT_DIR / f"results-{stamp}.json").write_text(json.dumps(results, indent=2, default=str))
    # 2) interactive human-review file (per loop, preserved) + a stable "latest"
    review = REPORT_DIR / f"review-{stamp}.html"
    write_review_html(results, header, review)
    # Only refresh the stable "latest" on a FULL run — a --only/--tier subset must
    # not clobber the complete review a human is working from.
    is_full = not (args.only or args.tier)
    if is_full:
        write_review_html(results, header, REPORT_DIR / "review-latest.html")

    print(f"\nAvg score: {avg}/100")
    print(f"Review (open in browser): {review}"
          + ("  (also review-latest.html)" if is_full else "  [subset — review-latest.html unchanged]"))
    print(f"JSON record:              {REPORT_DIR / f'results-{stamp}.json'}")
    if args.open:
        webbrowser.open(f"file://{review}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
