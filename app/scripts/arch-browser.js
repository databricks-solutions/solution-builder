/**
 * arch-browser.js — the ONE copy of the architecture layout check, shared by every host.
 *
 * It is a JS EXPRESSION (no module syntax, no Node APIs) evaluated inside the viewer
 * page. Hosts read this file as text and evaluate it in a page that has the standalone
 * architecture viewer loaded and reported data-arch-ready:
 *   • scripts/inspect-arch.mjs   (Node + raw CDP)            → .inspect(consoleLogs)
 *   • scripts/render-arch.mjs    (Node + raw CDP)            → .contentBox(pad)
 *   • app backend arch_render.py (Python Playwright)         → both, page.evaluate(text)
 * Hosts must NOT fork these checks: change the rule here, and every host reports it.
 *
 * .contentBox(pad)  the CSS-px box that tightly frames the drawn nodes (null if none).
 * .inspect(logs)   measures the page and runs every check. `logs` is the list of
 *                   console/uncaught-exception lines the host collected, pre-formatted.
 *                   Returns { lines, sections, faults, dump, composition, aspectNote }:
 *     lines       the exact text inspect-arch.mjs prints (CLI output contract, eval-arch.ts
 *                 parses its "CATEGORY: N" lines);
 *     sections    [{ name, counted, items }] for every category (structured, for the tool);
 *     faults      number of COUNTED categories with items (drives the exit code: >0 → 1);
 *     dump        { nodes, truncated, clipped, labels } (what ARCH_DUMP writes);
 *     composition advisory numbers (never gated);
 *     aspectNote  advisory aspect string, or null.
 *
 * Keep it dependency-free. Changing a check here changes the eval:arch baseline.
 */
(() => {
  // EDGE UNDER LABEL gating switch — see the rule below for the data behind the choice.
  const LABEL_CROSS_GATED = true;
  // Categories that are REPORTED but do not count toward `faults` (never gated).
  // EDGE THROUGH TILE is printed but has never been in the exit code: see the note in
  // inspect-arch.mjs's header. Changing that is a deliberate decision, not a refactor.
  const UNCOUNTED = new Set(["EDGE THROUGH TILE", "LEGIBILITY (advisory, not gated)",
    "TEXT TOO SMALL (advisory, not gated)", "LABEL ON BOX BORDER (advisory, not gated)"]);

  const contentBox = (pad) => {
    const nodes = document.querySelectorAll('.react-flow__node');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
    }
    if (Number.isFinite(minX)) {
      const w = Math.ceil((maxX - minX) + pad * 2);
      const h = Math.ceil((maxY - minY) + pad * 2);
      return { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad), w, h, aspect: w / h };
    }
    // Fallback: empty diagram — clip to the container so we still emit something.
    const el = document.querySelector('.react-flow');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height };
  };

  const inspect = (logs) => {
    let spacingRatio = null;
    const lines = [];
    const sections = [];
    const emit = (s) => { lines.push(s); };
    const report = (name, arr) => {
      emit(`${name}: ${arr.length}`);
      arr.forEach(x => emit("  " + x));
      sections.push({ name, counted: !UNCOUNTED.has(name), items: arr.slice() });
    };

    // ---- measure the page (browser side) -------------------------------------------
    const info = (() => {
      const vp = document.querySelector('.react-flow__viewport');
      const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(vp).transform);
      const k = m ? parseFloat(m[1].split(',')[0]) : 1;
      const box = r => ({ x: r.left / k, y: r.top / k, w: r.width / k, h: r.height / k });
      const nodes = [], clipped = [], truncated = [];
      for (const n of document.querySelectorAll('.react-flow__node')) {
        const id = n.getAttribute('data-id');
        const own = box(n.getBoundingClientRect());
        let vis = { ...own };
        // Does this node RENDER a title in its own top strip? An untitled band/plain
        // rectangle does not, and the ON BOX TITLE check below must not invent one for
        // it — a full-width band whose whole job is to sit behind a row of tiles was
        // reporting one false hit per tile.
        let titled = false;
        // The rendered title text rects in that strip (TITLE CROSSED BY EDGE below).
        const titles = [];
        // Largest rendered font on this node, for the advisory LEGIBILITY ratio below.
        let maxFont = 0;
        // Every visible text element's own font size + text, for TEXT TOO SMALL below.
        const texts = [];
        // Text that paints OUTSIDE this node's own rect (a badge pushed over the card's corner,
        // a title row wider than its card). Only a visible overflow — clipping is CLIPPED TEXT.
        const outside = [];
        for (const el of n.querySelectorAll('*')) {
          if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
          // An html block body (data-html-body) is overflow:hidden at the height its layout
          // measured. Content the estimate missed clips here; it has no direct text, so it is
          // checked by its own box rather than by the text loop below.
          if (el.hasAttribute('data-html-body')) {
            if (el.clientHeight > 0 && el.scrollHeight - el.clientHeight > 4)
              clipped.push({ id, by: el.scrollHeight - el.clientHeight, t: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 48) });
            else if (el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 4)
              clipped.push({ id, by: el.scrollWidth - el.clientWidth, t: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 48) });
            continue;
          }
          const txt = [...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
          if (!txt) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (Number.isFinite(fs) && fs > maxFont) maxFont = fs;
          // CSS ellipsis (class "truncate", text-overflow:ellipsis): the DOM keeps the FULL text
          // and only the painted box is shorter, so the truth is "content wider than box".
          // innerText is therefore the full label we report.
          // A multi-line clamp (slide titles: line-clamp-2) ellipsizes on the LAST line, so
          // there the truth is "content taller than box" instead.
          const cs = getComputedStyle(el);
          const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none' &&
              el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
          if (clamped || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 &&
              cs.textOverflow === 'ellipsis'))
            truncated.push({ id, t: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) });
          const r = box(el.getBoundingClientRect());
          if (r.w > 0 && r.h > 0 && r.y < own.y + 34 && r.y + r.h > own.y - 2 &&
              r.x >= own.x - 2 && r.x + r.w <= own.x + own.w + 2) {
            titled = true;
            titles.push({ x: r.x, y: r.y, w: r.w, h: r.h, t: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
          }
          if (r.w <= 0 || r.h <= 0 || r.w > 2500 || r.h > 2500) continue;   // ignore hidden / absurd
          // The text this element paints itself (direct text nodes only, so a wrapper is not
          // counted again with its children's words).
          texts.push({ fs: Number.isFinite(fs) ? fs : 0, t: [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 48), x: r.x, y: r.y, w: r.w, h: r.h, inTitle: false });
          if (r.x < own.x - 400 || r.y < own.y - 400 ||
              r.x + r.w > own.x + own.w + 400 || r.y + r.h > own.y + own.h + 400) continue; // offscreen measuring element
          // An absolutely positioned overlay (a tab or pill deliberately hung over an edge, e.g. the
          // Genie One persona or the Lakeflow header) is a design choice; only flow content that paints
          // past the tile is a fault.
          let overlay = false;
          for (let a = el.parentElement; a && a !== n; a = a.parentElement) if (getComputedStyle(a).position === "absolute") { overlay = true; break; }
          if (!overlay && (r.x < own.x - 3 || r.y < own.y - 3 || r.x + r.w > own.x + own.w + 3 || r.y + r.h > own.y + own.h + 3))
            outside.push({ t: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), by: Math.round(Math.max(own.x - r.x, own.y - r.y, r.x + r.w - own.x - own.w, r.y + r.h - own.y - own.h)) });
          const x1 = Math.min(vis.x, r.x), y1 = Math.min(vis.y, r.y);
          const x2 = Math.max(vis.x + vis.w, r.x + r.w), y2 = Math.max(vis.y + vis.h, r.y + r.h);
          vis = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
          if (!clamped && el.scrollHeight - el.clientHeight > 4 && el.clientHeight > 0)
            clipped.push({ id, by: el.scrollHeight - el.clientHeight, t: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 48) });
          // Sideways: a long unbroken word (a table name, a URL) in an overflow:hidden box is
          // cut at the edge with no ellipsis, so neither check above sees it.
          else if (/hidden|clip/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' &&
              el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 4)
            clipped.push({ id, by: el.scrollWidth - el.clientWidth, t: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 48) });
        }
        const r = k => ({ x: Math.round(k.x), y: Math.round(k.y), w: Math.round(k.w), h: Math.round(k.h) });
        nodes.push({ id, outside, own: r(own), vis: r(vis), titled, titles: titles.map(t => ({ ...r(t), t: t.t })), font: Math.round(maxFont), texts, text: (n.innerText || '').replace(/\s+/g, ' ').slice(0, 60), fullText: (n.innerText || '').replace(/\s+/g, ' ') });
      }
      // sample every edge path and see which tiles it runs THROUGH (the renderer routes
      // edges without any node avoidance, so a line can cross a tile it has nothing to do with)
      const paths = [];
      for (const el of document.querySelectorAll('.react-flow__edge-path, .react-flow__edge path')) {
        if (typeof el.getTotalLength !== 'function') continue;
        try {
          const len = el.getTotalLength();
          if (!len) continue;
          const ctm = el.getScreenCTM();
          const pts = [];
          const N = Math.min(120, Math.max(40, Math.round(len / 10)));
          for (let i = 0; i <= N; i++) {
            const q = el.getPointAtLength((len * i) / N);
            const sx = ctm ? ctm.a * q.x + ctm.c * q.y + ctm.e : q.x;
            const sy = ctm ? ctm.b * q.x + ctm.d * q.y + ctm.f : q.y;
            // same space as the node rects below: viewport-relative screen px / scale
            const fx = sx / k, fy = sy / k;
            if (Number.isFinite(fx) && Number.isFinite(fy)) pts.push({ x: Math.round(fx), y: Math.round(fy) });
          }
          const g = el.closest('.react-flow__edge');
          paths.push({ id: g?.getAttribute('data-id') || '?', pts });
        } catch (err) { /* detached or unmeasurable path */ }
      }
      // Edge labels. The chip is an SVG <text> that WRAPS into <tspan> lines (see
      // edges/label-chip.ts), so a leaf-only filter drops every one of them — and
      // then LABEL OVERLAPS / LABEL OVER NODE/TITLE silently measure an EMPTY set
      // and report a false pass on a diagram whose labels are all over the tiles.
      // So: take the <text> chip ROOT (its own rect already unions its tspans, which
      // is the chip we want to collide-test), and keep the leaf rule only for the
      // HTML edgelabel-renderer path, where a wrapper div would otherwise count.
      // The chip as a PILL: the edge-label <text> lives in the EdgeLabelRenderer, inside a
      // <g> whose largest <rect> is the drawn pill (the <text> box is only the glyph line).
      // Also: a clamped chip (wrap ran past MAX_LINES) carries a <title> with the full text
      // and its last visible tspan ends in an ellipsis — that is the TRUNCATED TEXT signal.
      const shownOf = t => [...t.querySelectorAll(':scope > tspan')].map(s => s.textContent).join(' ').replace(/\s+/g, ' ').trim()
        || (t.textContent || '').replace(/\s+/g, ' ').trim();
      const chipTexts = [...document.querySelectorAll('.react-flow__edgelabel-renderer text, .react-flow__edges text')];
      const clampedLabels = chipTexts.filter(t => t.querySelector(':scope > title'))
        .map(t => ({ full: (t.querySelector(':scope > title').textContent || '').replace(/\s+/g, ' ').trim(), shown: shownOf(t) }))
        .filter(c => /…$/.test(c.shown));
      const pills = chipTexts.filter(t => t.closest('.react-flow__edgelabel-renderer')).map(t => {
        const g = t.parentElement;
        let best = null;
        for (const rc of (g ? g.querySelectorAll(':scope > rect') : [])) {
          const bb = rc.getBoundingClientRect(), a = bb.width * bb.height;
          if (!best || a > best.a) best = { el: rc, a };
        }
        const rr = box((best ? best.el : t).getBoundingClientRect());
        return { text: shownOf(t), x: rr.x, y: rr.y, w: rr.w, h: rr.h };
      }).filter(p => p.text && p.w > 0 && p.h > 0);
      // COVERED: is the chip actually painted over by a tile? A rect overlap is not enough: a
      // tile's transparent margin can sit under a chip without hiding anything. Hit-test the chip on
      // a grid of points; the first element that is the chip or a node decides, and a node covers
      // only where an element that paints a background (its own, or an ancestor's up to the node
      // root) is on top.
      const paints = el => {
        for (let a = el; a && a.closest && a.closest(".react-flow__node"); a = a.parentElement) {
          const bg = getComputedStyle(a).backgroundColor;
          if (bg && !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$|^transparent$/.test(bg)) return true;
          if (a.classList && a.classList.contains("react-flow__node")) break;
        }
        return false;
      };
      const coveredBy = c => {
        for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
          const px = (c.x + (i + 0.5) * c.w / 5) * k, py = (c.y + (j + 0.5) * c.h / 3) * k;
          for (const el of document.elementsFromPoint(px, py) || []) {
            if (el.closest(".react-flow__edgelabel-renderer")) break;   // the chip is on top here
            if (!el.closest(".react-flow__node")) continue;               // an edge line or the pane
            if (paints(el)) return true;
            break;
          }
        }
        return false;
      };
      for (const pl of pills) pl.covered = coveredBy(pl);
      const svgLab = [...document.querySelectorAll('.react-flow__edges text, .react-flow__edge-text')];
      const htmlLab = [...document.querySelectorAll('.react-flow__edgelabel-renderer *, [class*="edge-label"], [class*="edgeLabel"]')]
        .filter(e => !e.querySelector('*'));
      const labels = [...new Set([...svgLab, ...htmlLab])]
        // never count a tspan (or any child) separately from the <text> that owns it
        .filter(e => !svgLab.some(o => o !== e && o.contains(e)))
        .filter(e => (e.innerText || e.textContent || '').trim())
        .map(e => { const r = box(e.getBoundingClientRect()); return { t: (e.innerText || e.textContent || '').replace(/\s+/g, ' ').slice(0, 46), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), fs: parseFloat(getComputedStyle(e).fontSize) || 0 }; });
      let declaredAspect = null, declaredDirection = null, logicalEdges = [];
      try {
        const raw = JSON.parse(document.querySelector('#architecture')?.textContent || 'null');
        const tab = Array.isArray(raw) ? raw[0] : raw;
        if (tab?.aspect === '16:9' || tab?.aspect === '1:1') declaredAspect = tab.aspect;
        if (['horizontal', 'vertical', 'matrix'].includes(tab?.direction)) declaredDirection = tab.direction;
        // Every node, nested ones included, with its parent container (nested layout).
        const all = [], parentOf = new Map(), layoutOf = new Map();
        const walk = (ns, p) => { for (const n of ns || []) { all.push(n); parentOf.set(n.id, p); if (Array.isArray(n.children)) { layoutOf.set(n.id, n.layout || 'row'); walk(n.children, n.id); } } };
        walk(tab?.nodes, null);
        const nested = !!tab?.layout || all.some(n => Array.isArray(n.children));
        const types = new Map(all.map(n => [n.id, n.type]));
        const cols = new Map(all.map(n => [n.id, n.col]));
        // The layout of the container two nodes meet in (their lowest common container).
        const meet = (a, b) => {
          const chain = (id) => { const c = []; for (let p = id; p != null; p = parentOf.get(p)) c.unshift(p); return [null, ...c]; };
          const ca = chain(a), cb = chain(b);
          let lca = null;
          for (let i = 0; i < ca.length && i < cb.length && ca[i] === cb[i]; i++) lca = ca[i];
          return lca ? layoutOf.get(lca) : (tab?.layout || 'row');
        };
        // domId = the data-id ReactFlow renders for this edge. It is the file id when set,
        // else e-FROM-TO-INDEX (platform-architecture.ts parse). Keying on the
        // logical id ('edge-N') matched NOTHING for auto-id edges, so any check that joins
        // a DOM path to its endpoints silently saw no endpoints.
        logicalEdges = (tab?.edges || []).map((e, i) => ({
          id: e.id || ('edge-' + (i + 1)),
          domId: e.id || ('e-' + String(e.from || '').split('@')[0] + '-' + String(e.to || '').split('@')[0] + '-' + i),
          label: typeof e.label === 'string' ? e.label.trim() : '',
          from: String(e.from || '').split('@')[0],
          to: String(e.to || '').split('@')[0],
          dashed: !!e.dashed,
          fromType: types.get(String(e.from || '').split('@')[0]),
          toType: types.get(String(e.to || '').split('@')[0]),
          fromCol: cols.get(String(e.from || '').split('@')[0]),
          toCol: cols.get(String(e.to || '').split('@')[0]),
          meet: nested ? meet(String(e.from || '').split('@')[0], String(e.to || '').split('@')[0]) : undefined,
        }));
      } catch { /* validation reports malformed JSON elsewhere */ }
      return { nodes, labels, clipped, truncated, clampedLabels, pills, paths, declaredAspect, declaredDirection, logicalEdges, edgeCount: document.querySelectorAll('.react-flow__edge').length };
    })();

    // ---- checks (pure, over `info`) ----------------------------------------------
    const ov = (a, b, t = 4) => {
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      return ix > t && iy > t ? `${Math.round(ix)}x${Math.round(iy)}` : null;
    };
    // a container is any node whose own rect encloses another node's own rect
    const isBox = n => info.nodes.some(o => o.id !== n.id &&
      o.own.x >= n.own.x - 2 && o.own.y >= n.own.y - 2 &&
      o.own.x + o.own.w <= n.own.x + n.own.w + 2 && o.own.y + o.own.h <= n.own.y + n.own.h + 2);
    const boxes = info.nodes.filter(isBox);
    const tiles = info.nodes.filter(n => !isBox(n));

    const nn = [], bb = [], straddle = [], onTitle = [], ll = [], ln = [];
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const o = ov(tiles[i].vis, tiles[j].vis); if (o) nn.push(`${tiles[i].id} ∩ ${tiles[j].id} (${o})`);
    }
    // CONTAINER x CONTAINER. This was a real blind spot: the tile loop above is
    // tiles-only and the straddle loop below is box×tile, so NOTHING compared a box to
    // another box — a diagram whose phase BANDS collide scored 0 faults while looking
    // obviously broken (each wrapper adds a ~34px title strip + pad that the fixed row
    // pitch does not reserve, so bands stacked on contiguous rows creep into each other).
    // The discriminator is CONTAINMENT vs PARTIAL INTERSECTION: a box legitimately holds
    // another box (platform ⊃ catalog ⊃ tables), so full containment either way is fine
    // and only a partial overlap is a fault. Uses `own` (the drawn rect), not `vis`: a
    // box's title text sits inside its own border, so unioning it would invent overlaps.
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const o = ov(a.own, b.own);
      if (!o) continue;
      const holds = (p, c) => c.own.x >= p.own.x - 2 && c.own.y >= p.own.y - 2 &&
        c.own.x + c.own.w <= p.own.x + p.own.w + 2 && c.own.y + c.own.h <= p.own.y + p.own.h + 2;
      if (holds(a, b) || holds(b, a)) continue;          // nesting, not a collision
      bb.push(`${a.id} ∩ ${b.id} (${o})`);
    }
    for (const b of boxes) for (const n of tiles) {
      if (!ov(b.own, n.vis)) continue;
      const inside = n.vis.x >= b.own.x - 2 && n.vis.y >= b.own.y - 2 &&
        n.vis.x + n.vis.w <= b.own.x + b.own.w + 2 && n.vis.y + n.vis.h <= b.own.y + b.own.h + 2;
      if (!inside) straddle.push(`${n.id} straddles ${b.id} border`);
      else if (b.titled && n.vis.y < b.own.y + 34 && !/^(db-platform|governance-block)/.test(n.id)) onTitle.push(`${n.id} on ${b.id} title strip`);
    }
    // LABEL ON BOX BORDER — an edge label pill that STRADDLES a container's border (part
    // inside, part outside). A pill fully inside or fully outside a box reads as belonging to
    // it or not; one astride the border reads as a label for the box's edge. Same rule as the
    // solver's border penalty (edges/label-layout.ts). Tested on the PILL, not the glyph box.
    // Label collisions are tested on the drawn PILL (the chip's rect), never the glyph box: the
    // glyph <text> is narrower than the pill, so a pill clipped by a card by 12px read as 0 faults.
    // Falls back to the glyph box only when no pill was measured.
    const chips = info.pills.length ? info.pills : info.labels;
    const lb = [];
    for (const L of info.pills) for (const b of boxes) {
      if (!ov(L, b.own, 4)) continue;
      const inside = L.x >= b.own.x - 2 && L.y >= b.own.y - 2 &&
        L.x + L.w <= b.own.x + b.own.w + 2 && L.y + L.h <= b.own.y + b.own.h + 2;
      if (!inside) lb.push(`"${L.text}" straddles ${b.id} border`);
    }
    for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
      const o = ov(chips[i], chips[j]); if (o) ll.push(`"${chips[i].t ?? chips[i].text}" ∩ "${chips[j].t ?? chips[j].text}"`);
    }
    for (const l0 of chips) {
      const l = { ...l0, t: l0.t ?? l0.text };
      // A chip is over a tile only where the tile paints over it (see `covered` above); a rect
      // overlap onto a transparent margin is not a visible collision.
      if (l.covered !== false) for (const n of tiles) { const o = ov(l, n.vis, 6); if (o) ln.push(`"${l.t}" over ${n.id} (${o})`); }
      for (const b of boxes) { if (!b.titled) continue; const o = ov(l, { ...b.own, h: 34 }, 6); if (o) ln.push(`"${l.t}" on ${b.id} title (${o})`); }
      for (const n of info.nodes.filter(x => /^(db-platform|governance-block)/.test(x.id))) { const o = ov(l, n.vis, 6); if (o) ln.push(`"${l.t}" over banner ${n.id} (${o})`); }
    }
    // TEXT OVERLAPS — the painted text of one node runs into the painted text of ANOTHER (a
    // caption over a box's title, a label over a tile's sublabel). Each node's own text rects are
    // compared pairwise; a node's text is never compared with itself (its internal wraps are fine).
    const textHits = [];
    for (let i = 0; i < info.nodes.length; i++) for (let j = i + 1; j < info.nodes.length; j++) {
      const A = info.nodes[i], B = info.nodes[j];
      for (const a of A.texts) for (const b of B.texts) {
        if (a.x === undefined || b.x === undefined) continue;
        if (a.w <= 0 || b.w <= 0) continue;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 4 && iy > 4 && a.t && b.t) textHits.push(`"${a.t}" (${A.id}) over "${b.t}" (${B.id})`);
      }
    }
    const clip = info.clipped.filter((c, i, a) => a.findIndex(x => x.id === c.id && x.t === c.t) === i);

    emit(`nodes: ${info.nodes.length} (containers: ${boxes.length})  edges: ${info.edgeCount}  edgeLabels: ${info.labels.length}`);
    for (const n of info.nodes) {
      const grew = n.vis.w !== n.own.w || n.vis.h !== n.own.h ? ` vis ${n.vis.w}x${n.vis.h}@${n.vis.x},${n.vis.y}` : "";
      emit(`  ${String(n.id).padEnd(22)} ${String(n.own.x).padStart(6)},${String(n.own.y).padStart(6)} ${n.own.w}x${n.own.h}${grew}  ${n.text}`);
    }

    report("NODE OVERLAPS (visual)", nn);
    report("BOX OVERLAPS (container ∩ container)", bb);
    report("BOX STRADDLE", straddle);
    report("ON BOX TITLE", onTitle);
    report("LABEL OVERLAPS", ll);
    report("LABEL OVER NODE/TITLE", ln);
    // CONTENT OUTSIDE TILE — a tile's text that paints past its own border (a badge hung over a
    // card's corner, a title row wider than the card). Containers are exempt: their title strip
    // and their children legitimately sit at/over their edges.
    const spill = [];
    for (const n of tiles) for (const o of n.outside || []) spill.push(`${n.id}: "${o.t}" sticks out of the tile by ${o.by}px`);
    report("CONTENT OUTSIDE TILE", [...new Set(spill)].sort());
    report("TEXT OVERLAPS", [...new Set(textHits)].sort());

    report("LABEL ON BOX BORDER (advisory, not gated)", lb);
    // edge paths are in FLOW coordinates already (inside the viewport transform), same
    // space as node.own/vis after dividing by k
    // Proper SEGMENT/RECT intersection (Liang–Barsky), mirroring
    // edge-geometry.segmentHitsRect in the app. The previous test asked whether two
    // CONSECUTIVE SAMPLED POINTS both fell inside the tile, which silently misses the
    // most common real case: a long straight run crossing a tile with no sample
    // landing inside it. That under-reporting is why this check read 0 on diagrams
    // that visibly had lines through tiles.
    const segHitsRect = (a, b, r, inset = 3) => {
      const xmin = r.x + inset, xmax = r.x + r.w - inset;
      const ymin = r.y + inset, ymax = r.y + r.h - inset;
      if (xmax <= xmin || ymax <= ymin) return false;
      const dx = b.x - a.x, dy = b.y - a.y;
      let t0 = 0, t1 = 1;
      for (const [p, q] of [[-dx, a.x - xmin], [dx, xmax - a.x], [-dy, a.y - ymin], [dy, ymax - a.y]]) {
        if (p === 0) { if (q < 0) return false; continue; }
        const t = q / p;
        if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
      return t1 > t0;
    };
    const cross = [];
    for (const p of info.paths) {
      const hit = new Set();
      for (const n of tiles) {
        const r = n.vis;
        for (let i = 1; i < p.pts.length; i++) {
          if (segHitsRect(p.pts[i - 1], p.pts[i], r)) { hit.add(n.id); break; }
        }
      }
      // an edge legitimately starts/ends at its own endpoints' tiles: ignore the first/last hit tile
      const ends = new Set();
      for (const n of tiles) {
        const r = n.vis, near = q => q.x > r.x - 18 && q.x < r.x + r.w + 18 && q.y > r.y - 18 && q.y < r.y + r.h + 18;
        if (near(p.pts[0]) || near(p.pts[p.pts.length - 1])) ends.add(n.id);
      }
      for (const h of hit) if (!ends.has(h)) cross.push(`${p.id} runs through ${h}`);
    }
    report("EDGE THROUGH TILE", [...new Set(cross)].sort());

    // EDGE GRAZES TILE — a segment that runs ALONGSIDE a tile's edge within < GRAZE px
    // (so it reads as "over/behind" the tile) without technically entering it, which
    // EDGE THROUGH TILE (a 3px-inset interior test) misses. Coalesce each path into
    // maximal H/V runs (same helper the parallel check uses, below — defined here so
    // both use it), then for a run near+parallel to a tile face whose extent overlaps
    // that face, flag it. Skip the edge's own endpoint tiles.
    const GRAZE = 10; // px: closer than this to a tile edge, running alongside it, reads as touching
    const runsOfPts = (pts) => {
      const out = []; let cur = null;
      const flush = () => { if (cur && cur.hi - cur.lo > 8) out.push(cur); cur = null; };
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        let ax = null, c = 0, lo = 0, hi = 0;
        if (Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) > 1) { ax = "V"; c = (a.x + b.x) / 2; lo = Math.min(a.y, b.y); hi = Math.max(a.y, b.y); }
        else if (Math.abs(a.y - b.y) <= 2 && Math.abs(a.x - b.x) > 1) { ax = "H"; c = (a.y + b.y) / 2; lo = Math.min(a.x, b.x); hi = Math.max(a.x, b.x); }
        if (!ax) { flush(); continue; }
        if (cur && cur.axis === ax && Math.abs(cur.c - c) <= 4 && lo <= cur.hi + 4 && hi >= cur.lo - 4) {
          cur.c = (cur.c * cur.n + c) / (cur.n + 1); cur.n++; cur.lo = Math.min(cur.lo, lo); cur.hi = Math.max(cur.hi, hi);
        } else { flush(); cur = { axis: ax, c, n: 1, lo, hi }; }
      }
      flush();
      return out;
    };
    const graze = [];
    for (const p of info.paths) {
      const ends = new Set();
      for (const n of tiles) {
        const r = n.vis, near = q => q.x > r.x - 18 && q.x < r.x + r.w + 18 && q.y > r.y - 18 && q.y < r.y + r.h + 18;
        if (near(p.pts[0]) || near(p.pts[p.pts.length - 1])) ends.add(n.id);
      }
      for (const run of runsOfPts(p.pts)) {
        for (const n of tiles) {
          if (ends.has(n.id)) continue;
          const r = n.vis;
          if (run.axis === "V") {
            // vertical run alongside the tile's left or right face, overlapping its y-span
            const overlapsY = run.lo < r.y + r.h - 4 && run.hi > r.y + 4;
            if (overlapsY && (Math.abs(run.c - r.x) <= GRAZE || Math.abs(run.c - (r.x + r.w)) <= GRAZE)) {
              graze.push(`${p.id} grazes ${n.id} (V @ ${Math.round(run.c)})`);
            }
          } else {
            const overlapsX = run.lo < r.x + r.w - 4 && run.hi > r.x + 4;
            if (overlapsX && (Math.abs(run.c - r.y) <= GRAZE || Math.abs(run.c - (r.y + r.h)) <= GRAZE)) {
              graze.push(`${p.id} grazes ${n.id} (H @ ${Math.round(run.c)})`);
            }
          }
        }
      }
    }
    report("EDGE GRAZES TILE", [...new Set(graze)].sort());

    // PARALLEL OVERLAP — two DIFFERENT edges whose axis-aligned segments run parallel
    // TOO CLOSE to read as separate lines (same x for a vertical run / same y for a
    // horizontal run, within MIN_SEP px) and overlap along it for a meaningful span, so
    // they draw on top of / indistinguishable from each other. This flags not just a
    // literal 0px overlap but any pair closer than MIN_SEP — at slide scale two lines a
    // handful of px apart read as one. The fan/channel passes separate edges sharing a
    // node+side; this catches cross-node parallels + tracks placed too tight.
    const MIN_SEP = 10;      // px: parallel runs closer than this read as one line
    const MIN_OVERLAP = 24;  // px: overlap shorter than this is an anchor stub, not a run
    // The path is sampled at ~10px steps, so a straight run is MANY tiny collinear
    // sub-segments. Coalesce consecutive collinear samples (same axis, coordinate
    // within ~4px) into maximal RUNS before comparing — otherwise every run is
    // a pile of 10px fragments that never reach MIN_OVERLAP.
    const segsOf = (pts) => {
      const out = [];
      let cur = null; // { axis, cSum, cN, lo, hi }
      const flush = () => { if (cur && cur.hi - cur.lo > 8) out.push({ axis: cur.axis, c: cur.cSum / cur.cN, lo: cur.lo, hi: cur.hi }); cur = null; };
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        let axis = null, c = 0, lo = 0, hi = 0;
        if (Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) > 1) { axis = "V"; c = (a.x + b.x) / 2; lo = Math.min(a.y, b.y); hi = Math.max(a.y, b.y); }
        else if (Math.abs(a.y - b.y) <= 2 && Math.abs(a.x - b.x) > 1) { axis = "H"; c = (a.y + b.y) / 2; lo = Math.min(a.x, b.x); hi = Math.max(a.x, b.x); }
        if (!axis) { flush(); continue; }              // corner / diagonal (rounded elbow) breaks a run
        if (cur && cur.axis === axis && Math.abs(cur.cSum / cur.cN - c) <= 4 && lo <= cur.hi + 4 && hi >= cur.lo - 4) {
          cur.cSum += c; cur.cN++; cur.lo = Math.min(cur.lo, lo); cur.hi = Math.max(cur.hi, hi);
        } else { flush(); cur = { axis, cSum: c, cN: 1, lo, hi }; }
      }
      flush();
      return out;
    };
    const allSegs = info.paths.flatMap((p, ei) => segsOf(p.pts).map(s => ({ ...s, ei, id: p.id })));
    const parallel = new Set();
    for (let i = 0; i < allSegs.length; i++) for (let j = 0; j < i; j++) {
      const s = allSegs[i], t = allSegs[j];
      // Same edge (by index OR id — one edge renders as several path elements: base +
      // arrow overlay + animated flow, all sharing data-id) → not a collision.
      if (s.ei === t.ei || s.id === t.id || s.axis !== t.axis) continue;
      const sep = Math.abs(s.c - t.c);
      if (sep > MIN_SEP) continue;                                   // far enough apart to read as two
      const overlap = Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo);
      if (overlap < MIN_OVERLAP) continue;                           // stub, not a run
      const [x, y] = s.id < t.id ? [s.id, t.id] : [t.id, s.id];
      parallel.add(`${x} ∥ ${y} (${s.axis} @ ${Math.round(s.c)}, ${Math.round(overlap)}px overlap, ${Math.round(sep)}px apart)`);
    }
    report("PARALLEL OVERLAP", [...parallel].sort());

    // EDGE CROSS — two DIFFERENT edges whose drawn curves properly INTERSECT (an X). The rule is
    // strict: a fan from one source must NEST, so a crossing right beside the shared node is a
    // fault like any other. (The old check forgave any crossing within 60px of a shared node as
    // "fan convergence"; that is exactly where a mis-nested fan crosses — the lakehouse→{genie,
    // dashboards} fan read clean while its elbows crossed beside the tile.) Two edges that only
    // MEET at a shared endpoint are not a proper crossing (the shared point has zero orientation),
    // so convergence at a node is still allowed. Same rule the unit test uses (test-diagram-layout
    // "fan-out nesting"), on the same sampled curves.
    const properCross = (a, b, c, d) => {
      const ccw = (P, Q, R) => (R.y - P.y) * (Q.x - P.x) - (Q.y - P.y) * (R.x - P.x);
      return ccw(a, c, d) * ccw(b, c, d) < 0 && ccw(a, b, c) * ccw(a, b, d) < 0;
    };
    const edgeCross = new Set();
    for (let i = 0; i < info.paths.length; i++) for (let j = i + 1; j < info.paths.length; j++) {
      const A = info.paths[i], B = info.paths[j];
      if (A.id === B.id) continue;
      let crossed = false;
      for (let x = 1; x < A.pts.length && !crossed; x++) for (let y = 1; y < B.pts.length; y++) {
        if (properCross(A.pts[x - 1], A.pts[x], B.pts[y - 1], B.pts[y])) { crossed = true; break; }
      }
      if (crossed) { const [p, q] = A.id < B.id ? [A.id, B.id] : [B.id, A.id]; edgeCross.add(`${p} ✕ ${q}`); }
    }
    report("EDGE CROSS", [...edgeCross].sort());

    // TRUNCATED TEXT — something the author wrote is not fully on screen. Two shapes:
    //  • a node / box text element that ellipsizes (CSS text-overflow): the DOM keeps the
    //    FULL text, so the innerText we report is the label that was cut;
    //  • an edge label whose wrap ran past MAX_LINES: its last line ends in "…" and the full
    //    text is only in a <title> tooltip, which an exported PNG cannot show.
    // CLIPPED TEXT (below) only measures VERTICAL overflow; this is the horizontal case.
    const ownersOfLabel = text => info.logicalEdges.filter(e => e.label && e.label === text.trim());
    const truncFaults = [
      ...info.truncated.map(t => `${t.id}: "${t.t}" is ellipsized (does not fit its box)`),
      ...info.clampedLabels.map(c => {
        const own = ownersOfLabel(c.full).map(e => e.domId);
        return `${own.length ? own.join("/") : "edge label"}: "${c.full}" is ellipsized past the 3-line wrap (shows "…${c.shown.slice(-20)}")`;
      }),
    ];
    report("TRUNCATED TEXT", [...new Set(truncFaults)]);

    // TITLE CROSSED BY EDGE — a container's title strip (text in its top band) is run
    // through by an edge that is not one of its own endpoint stubs. Only a SEGMENT that
    // enters the title's rect counts. An edge whose endpoint is this container is allowed
    // to leave it: the leading/trailing samples that are still inside the container are its
    // terminal stub, and are skipped.
    const inBoxTol = (q, r) => q.x >= r.x - 2 && q.x <= r.x + r.w + 2 && q.y >= r.y - 2 && q.y <= r.y + r.h + 2;
    const domEdge = new Map(info.logicalEdges.map(e => [e.domId, e]));
    const titleHits = new Set();
    for (const p of info.paths) {
      const e = domEdge.get(p.id);
      const n = p.pts.length - 1;
      for (const b of boxes) {
        if (!b.titles.length) continue;
        let startStub = 0, endStub = 0;
        if (e && e.from === b.id) while (startStub < p.pts.length && inBoxTol(p.pts[startStub], b.own)) startStub++;
        if (e && e.to === b.id) while (endStub < p.pts.length && inBoxTol(p.pts[n - endStub], b.own)) endStub++;
        for (let i = 1; i <= n; i++) {
          if (i <= startStub) continue;                       // leaves its own start box
          if (endStub && i >= n - endStub + 1) continue;      // enters its own end box
          for (const t of b.titles) {
            if (segHitsRect(p.pts[i - 1], p.pts[i], t)) { titleHits.add(`${p.id} runs through the title "${t.t}" of ${b.id}`); break; }
          }
        }
      }
    }
    report("TITLE CROSSED BY EDGE", [...titleHits].sort());

    // EDGE UNDER LABEL — an edge path runs under ANOTHER edge's label pill, so the label
    // reads as belonging to the line it sits on. Only labels whose owner can be named
    // unambiguously are tested (authored text matching exactly one edge): a duplicate
    // "Register" on two edges could be either, and guessing would invent faults.
    const labelUnder = new Set();
    let unownedLabels = 0;
    for (const L of info.pills) {
      const owners = ownersOfLabel(L.text).map(e => e.domId);
      if (owners.length !== 1) { unownedLabels++; continue; }
      for (const p of info.paths) {
        if (p.id === owners[0]) continue;                   // the label's own line
        for (let i = 1; i < p.pts.length; i++) {
          if (segHitsRect(p.pts[i - 1], p.pts[i], L, 2)) { labelUnder.add(`${p.id} runs under the "${L.text}" label of ${owners[0]}`); break; }
        }
      }
    }
    report("EDGE UNDER LABEL", [...labelUnder].sort());
    // LABEL HIDES ARROW — an edge's own label pill covers the end of that edge (its arrowhead or
    // dot). Only labels whose owner is unambiguous are tested, as for EDGE UNDER LABEL.
    const hides = [];
    for (const L of info.pills) {
      const owners = ownersOfLabel(L.text);
      if (owners.length !== 1) continue;
      const p = info.paths.find(q => q.id === owners[0].domId);
      if (!p || !p.pts.length) continue;
      for (const q of [p.pts[0], p.pts[p.pts.length - 1]]) {
        if (q.x > L.x - 10 && q.x < L.x + L.w + 10 && q.y > L.y - 10 && q.y < L.y + L.h + 10) {
          hides.push(`"${L.text}" covers the end of ${owners[0].domId}`);
          break;
        }
      }
    }
    report("LABEL HIDES ARROW", [...new Set(hides)].sort());

    report("CLIPPED TEXT", clip.map(c => `${c.id} clipped by ${c.by}px: ${c.t}`));

    // TEXT TOO SMALL — text a reader cannot read once the diagram is on a slide. A px font
    // is a fixed size in FLOW units, so its size on a projected slide depends on how far the
    // diagram is scaled to fit one. The honest scale is the one that fits the drawn content
    // into a 1920×1080 frame, limited by whichever axis runs out first:
    //     scale = min(1920 / contentW, 1080 / contentH)
    // (a wide ribbon is limited by its width, a tall stack by its height). Effective size is
    // font × scale. Below SMALL_PX (10px on a projected 1080p slide) it is a legibility
    // fault. Measured in flow units, so it does not depend on the viewer's zoom. Covers node
    // text (sublabels, descriptors, rail labels, badges, box subtitles) and edge labels.
    const SLIDE_W = 1920, SLIDE_H = 1080, SMALL_PX = 10;
    const smallText = [];
    let slideScale = null;
    if (info.nodes.length) {
      const minX = Math.min(...info.nodes.map(n => n.vis.x));
      const minY = Math.min(...info.nodes.map(n => n.vis.y));
      const maxX = Math.max(...info.nodes.map(n => n.vis.x + n.vis.w));
      const maxY = Math.max(...info.nodes.map(n => n.vis.y + n.vis.h));
      slideScale = Math.min(SLIDE_W / Math.max(1, maxX - minX), SLIDE_H / Math.max(1, maxY - minY));
      const seen = new Set();
      const note = (what, fs) => `${what} is ${fs}px → ${(fs * slideScale).toFixed(1)}px on a 1920×1080 slide (scale ${slideScale.toFixed(2)})`;
      for (const n of info.nodes) for (const t of n.texts) {
        if (!t.t || !(t.fs > 0) || t.fs * slideScale >= SMALL_PX) continue;
        const key = n.id + "|" + t.t;
        if (seen.has(key)) continue;
        seen.add(key);
        smallText.push(note(`${n.id}: "${t.t}"`, t.fs));
      }
      for (const l of info.labels) {
        if (!(l.fs > 0) || l.fs * slideScale >= SMALL_PX) continue;
        smallText.push(note(`edge label "${l.t}"`, l.fs));
      }
    }
    report("TEXT TOO SMALL (advisory, not gated)", smallText);

    // The export is a tight crop, so the RENDERED union must itself be close to the
    // requested shape — no post-hoc whitespace can rescue a ribbon or portrait stack.
    // This measures every `.react-flow__node`, which INCLUDES the derived frame title
    // band and legend box, so a framed tab is judged on its COMPOSED frame while an
    // unframed one is still judged on its bare nodes. That is the whole point: a node
    // ribbon is legitimately 2-4:1 (a process spine far more) and it is the
    // title/legend/detail bands that make the composition 16:9. Adding a band is the
    // fix; inflating row gaps is not, and used to be the only lever this rule left.
    // NOTE: only the MISSING-declaration case is a fault. The ratio MISS is advisory
    // (printed in the COMPOSITION block) — see the long comment in
    // platform-architecture.ts's validateArchitecture for why: the 16:9 target was
    // reverse-engineered from cropped screenshots, and gating it flagged a 2.15:1
    // ribbon that is exactly the shape of the reference slide we want to imitate.
    const presentationAspect = [];
    let aspectNote = null;
    if (info.nodes.length >= 2) {
      if (!info.declaredAspect) presentationAspect.push('missing required aspect; choose "16:9" or "1:1"');
      const minX = Math.min(...info.nodes.map(n => n.vis.x));
      const minY = Math.min(...info.nodes.map(n => n.vis.y));
      const maxX = Math.max(...info.nodes.map(n => n.vis.x + n.vis.w));
      const maxY = Math.max(...info.nodes.map(n => n.vis.y + n.vis.h));
      const actual = (maxX - minX) / Math.max(1, maxY - minY);
      const nearest = Math.abs(Math.log(actual / (16 / 9))) < Math.abs(Math.log(actual)) ? "16:9" : "1:1";
      const target = info.declaredAspect || nearest;
      const targetRatio = target === "16:9" ? 16 / 9 : 1;
      const miss = Math.max(actual / targetRatio, targetRatio / actual) - 1;
      aspectNote = `${actual.toFixed(2)}:1 vs declared ${target}`
        + (miss > 0.12 ? ` (${(miss * 100).toFixed(0)}% off — fine for a ribbon meant to sit on a slide with its own title; add a \`frame\` band only if this ships standalone)` : " — close");
    }
    report("PRESENTATION ASPECT", presentationAspect);

    // COMPOSITION — advisory, never gated (same contract as alignment reuse below).
    // Reference decks put their node band at only 10-41% of canvas height and their
    // titles at ~1.3% of canvas WIDTH. A fixed px font is a shrinking fraction as the
    // canvas grows (20px is 1.33% at 1500px wide but 0.80% at 2500px), which is the
    // "text is tiny when I put it on a slide" complaint, mechanically. Reported so a
    // legibility regression is visible without failing a small sketch.
    const legibility = [];
    if (info.nodes.length >= 2) {
      const minX = Math.min(...info.nodes.map(n => n.vis.x));
      const maxX = Math.max(...info.nodes.map(n => n.vis.x + n.vis.w));
      const canvasW = Math.max(1, maxX - minX);
      const fonts = info.nodes.map(n => n.font).filter(f => typeof f === "number" && f > 0);
      if (fonts.length) {
        const biggest = Math.max(...fonts);
        const ratio = biggest / canvasW;
        if (ratio < 0.011) legibility.push(
          `largest text is ${biggest.toFixed(0)}px on a ${canvasW.toFixed(0)}px-wide canvas = ${(ratio * 100).toFixed(2)}% (reference decks ~1.3% for node titles, ~3.1% for the deck title); scale text up or reduce canvas width`,
        );
      }
    }
    report("LEGIBILITY (advisory, not gated)", legibility);

    // A wide bbox can still conceal a vertical flow (several tall columns beside one
    // another). Measure relationship displacement itself. Matrix/containment tabs opt
    // out explicitly; ordinary 16:9 tabs default to horizontal.
    const flowOrientation = [];
    if (info.nodes.length >= 2 && !info.declaredDirection) flowOrientation.push('missing required direction; use "horizontal", "matrix", or explicit-only "vertical"');
    const direction = info.declaredDirection || (info.declaredAspect === "1:1" ? "matrix" : "horizontal");
    if (direction !== "matrix") {
      const byId = new Map(info.nodes.map(n => [n.id, n.own]));
      const global = new Set(["governance-block", "unity-catalog", "db-platform"]);
      // With declared lanes, only CROSS-LANE edges speak for the reading direction:
      // a phase lane's internal steps stack vertically under its banner BY DESIGN
      // (the phase-relay reference pattern), and counting them failed every
      // phase-lane diagram even with 100% horizontal hand-offs. Mirrors
      // assessFlowOrientation in platform-architecture.ts — keep them in step.
      const hasLanes = info.logicalEdges.some(e => e.fromCol !== undefined || e.toCol !== undefined);
      let aligned = 0, total = 0;
      for (const e of info.logicalEdges) {
        if (e.dashed || global.has(e.fromType) || global.has(e.toType)) continue;
        if (hasLanes && e.fromCol !== undefined && e.toCol !== undefined && e.fromCol === e.toCol) continue;
        // Nested: only edges whose ends meet in a container running that way count
        // (ends that meet in a column are a phase's own stacked steps).
        if (e.meet !== undefined && e.meet !== (direction === 'horizontal' ? 'row' : 'column')) continue;
        const a = byId.get(e.from), b = byId.get(e.to);
        if (!a || !b) continue;
        const dx = Math.abs((b.x + b.w / 2) - (a.x + a.w / 2));
        const dy = Math.abs((b.y + b.h / 2) - (a.y + a.h / 2));
        if (Math.max(dx, dy) < 20) continue;
        total++;
        if (direction === "horizontal" ? dx >= dy : dy >= dx) aligned++;
      }
      const share = total ? aligned / total : 1;
      if (total >= 4 && share < 0.6) flowOrientation.push(
        `only ${Math.round(share * 100)}% of ${total} cross-lane relationships read ${direction}; reorganize sequential steps across ${direction === "horizontal" ? "columns" : "rows"}`,
      );
    }
    report("FLOW ORIENTATION", flowOrientation);
    // CONSOLE counts EVERY uncaught exception and console error/warning (the list is only
    // truncated for display). It was once printed but left out of the exit code.
    emit(`CONSOLE: ${logs.length}`);
    logs.slice(0, 10).forEach(l => emit("  " + l));
    sections.push({ name: "CONSOLE", counted: true, items: logs.slice() });

    // ---------------------------------------------------------------------------
    // COMPOSITION DISCIPLINE — REPORTED, NEVER GATED.
    //
    // Everything above is a FAULT: something is overlapping, clipped or crossing, and
    // the answer is always "fix it". What follows is different in kind. It measures
    // whether a diagram was composed on a REUSED GRID or scattered, which is a matter
    // of craft, not correctness. A legitimate diagram can score low — a small
    // free-form sketch, a transcription of someone else's drawing — so it must not
    // fail a build. It is here because the alternative is arguing about taste.
    //
    // WHY THESE TWO NUMBERS. Comparing an executive slide that reads well against a
    // dense diagram that does not, on the same renderer and the same source file, the
    // separation was not node count, edge count or nesting. It was:
    //
    //   ALIGNMENT REUSE — nodes per distinct centre line. 47 nodes sharing 8 vertical
    //   centres means every alignment the eye finds is real, because there are only 8
    //   places anything can be. The same 47 nodes on 40 centres look "nearly aligned"
    //   everywhere and aligned nowhere.
    //
    //   TEXT BUDGET — mean rendered characters per node. Past roughly 40 the reader is
    //   reading paragraphs inside boxes instead of scanning a structure.
    //
    // Measured on CENTRES, not left/top edges: `at` is a centre, and two nodes of
    // different widths sharing a centre are visually aligned while their left edges
    // differ. Measuring edges reported the best diagram in the sample as mid-pack.
    //
    // CALIBRATION (12 diagrams: 4 upstream reference + 8 tabs of a real customer file,
    // all measured through this script):
    //   alignment reuse   min 1.43   median 1.86   max 5.88
    //   chars per node    min 13.2   median ~40    max 51.5
    // The best-judged diagram scored 5.88 / 29.7. The four upstream reference diagrams
    // scored 1.71-5.00. So the advisory line sits at 3.0 and 40 — above the median but
    // inside the observed range, i.e. "few diagrams do this, and the good one does".
    // Re-derive these if the corpus changes; do not invent them.
    const ALIGN_REUSE_GOOD = 3.0;
    const CHARS_PER_NODE_GOOD = 40;
    const CENTRE_TOL = 6;          // px; absorbs sub-pixel rounding on a shared centre

    // Count distinct centre lines, collapsing anything within CENTRE_TOL into one.
    const centreLines = (vals) => {
      const s = [...vals].sort((a, b) => a - b);
      let n = 0, last = -Infinity;
      for (const v of s) { if (v - last > CENTRE_TOL) { n++; last = v; } }
      return n || 1;
    };
    // Tiles only: a container's centre is an artefact of what it wraps, so counting it
    // rewards nesting rather than alignment.
    const gridNodes = tiles.length ? tiles : info.nodes;
    const cxLines = centreLines(gridNodes.map(n => n.own.x + n.own.w / 2));
    const cyLines = centreLines(gridNodes.map(n => n.own.y + n.own.h / 2));
    const xReuse = gridNodes.length / cxLines;
    const yReuse = gridNodes.length / cyLines;
    const charsPerNode = gridNodes.reduce((a, n) => a + (n.text || "").length, 0) / (gridNodes.length || 1);
    const verdict = (ok) => (ok ? "ok" : "loose");
    emit("COMPOSITION (advisory, not gated):");
    // ALIGNMENT REUSE IS REPORTED WITHOUT A VERDICT — deliberately. It was introduced
    // after a senior practitioner judged one tab of a customer file far better than its
    // siblings, and reuse was the metric that separated them (4.75 on 8 centre lines vs
    // 1.73 on 51). But that diagnosis was on a diagram TRANSCRIBED FROM VISIO, which had
    // inherited 72 arbitrary coordinates — for THAT failure mode (accidental scatter) high
    // reuse is the fix. Generalising it into "composed diagrams have high reuse" does not
    // follow, and we now have a counter-example: a deliberately asymmetric, relationally
    // composed variant scored 1.50 while a rigid lane grid scored 3.00, and the rigid one
    // was the diagram a reviewer called "too rigid... everything has to be in a line".
    // Optimising this number pushes toward regimentation. So print it as a MEASUREMENT of
    // scatter, not a target: low reuse means "check whether this is intentional
    // composition or accidental drift", and only the author can tell those apart.
    emit(`  alignment reuse   x ${xReuse.toFixed(2)} (${cxLines} centres), `
      + `y ${yReuse.toFixed(2)} (${cyLines} centres)`
      + `  [scatter measure, NOT a target — low can be intentional asymmetry or accidental drift; ~${ALIGN_REUSE_GOOD}+ means tiles share centre lines]`);
    emit(`  text budget       ${charsPerNode.toFixed(1)} chars/node`
      + `  — ${verdict(charsPerNode <= CHARS_PER_NODE_GOOD)}  [≤${CHARS_PER_NODE_GOOD} scans as structure]`);
    emit(`  nodes measured    ${gridNodes.length} tiles (containers excluded)`);
    if (aspectNote) emit(`  aspect            ${aspectNote}`);

    // SPACING — the largest RENDERED vertical gap between tiles that share a column
    // band, in units of median tile height. Measured on geometry, not on the authored
    // `rowGap`, because a legal gap value can still produce a huge void via skipped
    // row numbers (a skipped row is a documented banding lever, so the NUMBER is not
    // the defect — the resulting void is). Reference decks measured 0.38-0.75x tile
    // height between rows; mainstream engine defaults run 0.28-1.00x. Advisory: a
    // deliberate phase band legitimately exceeds this.
    const SPACING_GOOD = 2.5;
    if (gridNodes.length >= 2) {
      const medH = (() => {
        const hs = gridNodes.map(n => n.own.h).sort((a, b) => a - b);
        return hs[Math.floor(hs.length / 2)] || 1;
      })();
      const cols = new Map();
      for (const n of gridNodes) {
        const key = Math.round((n.own.x + n.own.w / 2) / 40);
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(n);
      }
      let worst = 0;
      for (const list of cols.values()) {
        list.sort((a, b) => a.own.y - b.own.y);
        for (let i = 1; i < list.length; i++) {
          const gap = list[i].own.y - (list[i - 1].own.y + list[i - 1].own.h);
          if (gap > worst) worst = gap;
        }
      }
      const ratio = worst / medH;
      spacingRatio = ratio;
      emit(`  largest row gap   ${worst.toFixed(0)}px = ${ratio.toFixed(2)}x median tile height`
        + `  — ${verdict(ratio <= SPACING_GOOD)}  [≤${SPACING_GOOD}x; decks 0.38-0.75x, engines 0.28-1.00x]`);
    }

    // Exit code deliberately EXCLUDES the composition numbers — see the block comment.
    const composition = { xReuse, yReuse, cxLines, cyLines, charsPerNode, gridNodes: gridNodes.length, spacingRatio };
    const faults = sections.filter(s => s.counted && s.items.length > 0).length;
    const dump = { nodes: info.nodes, truncated: info.truncated, clipped: info.clipped, labels: info.labels };
    return { lines, sections, faults, dump, composition, aspectNote };
  };

  return { contentBox, inspect };
})()
