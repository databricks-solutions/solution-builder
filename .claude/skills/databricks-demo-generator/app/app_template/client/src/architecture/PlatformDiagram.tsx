/**
 * PlatformDiagram — the "Running LuxeBeauty Returns on the Databricks
 * Platform" panel that sits on top of the /platform page. Mirrors the
 * official Data + AI Platform slide layout: a single bordered box with
 * row labels on the left and product tiles on the right, plus a flowing
 * data path UP from the four datasources through Zerobus.
 *
 * Workspace deep-links are fetched from /api/resources at mount. The
 * server composes them from DATABRICKS_HOST + config/app.json (the IDs).
 * Until the fetch resolves, tiles render with empty hrefs → they read
 * as non-clickable, which is also the right behaviour when an id isn't
 * configured for the current demo.
 *
 * Pure CSS-in-component (single <style> block); no external CSS file so
 * the panel ships byte-for-byte to the skill template.
 */

import { useEffect, useState } from 'react';
import { fetchResources, type WorkspaceResources } from '@/lib/api';
import { FlowKeyframes, Fork } from './Flow';
import {
  AgentBricksIcon,
  AIBIIcon,
  AgentsIcon,
  AppsIcon,
  CodeIcon,
  DeltaLogo,
  GatewayIcon,
  GenieIcon,
  IcebergLogo,
  LakebaseIcon,
  LakeflowIcon,
  LakehouseIcon,
  OneIcon,
  RtBadge,
  SRC,
  SrcIcon,
  UCIcon,
  ZerobusBolt,
} from './icons';

// ─── Inert fallback used while /api/resources hasn't resolved yet, or for
// the template where IDs haven't been filled in. Each entry has an empty
// URL → the <Prod> renderer treats that as "non-clickable tile".
const EMPTY: WorkspaceResources = {
  dashboard:     { id: '', url: '' },
  genie:         { id: '', url: '' },
  pipeline:      { id: '', url: '' },
  warehouse:     { id: '', url: '' },
  lakebase:      { id: '', url: '' },
  mas:           { id: '', url: '' },
  ka:            { id: '', url: '' },
  gateway:       { id: '', url: '' },
  databricksOne: { id: '', url: '' },
  agentBricks:   { id: '', url: '' },
  catalog:       { id: '', url: '' },
  model:         { id: '', url: '' },
  volume:        { id: '', url: '' },
  app:           { id: '', url: '' },
};

// ─── Component-scoped CSS. Names are prefixed `pd-` so they can't collide
// with PlatformView's `dx-` classes. Single block, no external file, so
// the diagram is portable byte-for-byte across the test app + template.
//
// Light theme: white card with subtle warm tints in each row band, navy
// text, orange accents for live links / flow dots / glows. Goes wider
// than the inner pitch (escapes the dx-platform-inner constraint via
// negative margin) so the Agentic Data row's Lakeflow + Lakehouse +
// Lakebase trio fits on one line.
const CSS = `
.pd-root{position:relative;color:var(--foreground);font-family:'DM Sans',sans-serif;
  border-radius:16px;overflow:hidden;margin-bottom:48px;
  /* Escape the parent's max-width so the panel runs edge-to-edge of the
     PlatformView gutters — the Agentic Data row needs the width. */
  margin-left:calc(50% - 50vw + 16px);margin-right:calc(50% - 50vw + 16px);
  background:var(--card)}
.pd-wrap{position:relative;z-index:1;max-width:1480px;margin:0 auto;
  padding:24px clamp(14px,2.5vw,28px) 20px}

/* hero — kicker + title */
.pd-hero{position:relative;text-align:center;margin:0 0 16px;padding:6px 24px 4px}
.pd-hero .pd-kick{font:600 12px 'DM Mono',monospace;letter-spacing:.26em;
  text-transform:uppercase;color:var(--accent)}
.pd-hero h2{margin:6px 0 0;font-size:clamp(22px,2.4vw,28px);font-weight:800;
  letter-spacing:-.015em;line-height:1.15;color:var(--foreground)}
.pd-hero h2 .pd-hl{color:var(--accent)}
.pd-hero .pd-brand{position:absolute;top:8px;right:12px;
  font:600 12px 'DM Mono',monospace;letter-spacing:.04em;color:var(--muted-foreground)}

/* the one platform box */
.pd-plat{border:1px solid var(--border);border-radius:14px;overflow:hidden;
  background:var(--background);
  box-shadow:0 8px 28px rgba(15,23,42,.06), 0 1px 0 rgba(15,23,42,.04) inset}
.pd-row{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:center;
  padding:14px 18px;border-top:1px solid var(--border)}
.pd-row:first-child{border-top:none}
.pd-row.pd-tint-orange{background:color-mix(in srgb, var(--accent) 5%, transparent)}
.pd-row.pd-tint-navy{background:color-mix(in srgb, var(--primary) 4%, transparent)}
.pd-row .pd-lbl b{display:block;font-size:17px;font-weight:800;letter-spacing:-.01em;color:var(--foreground)}
.pd-row .pd-lbl span{display:block;font-size:13px;color:var(--muted-foreground);line-height:1.4;margin-top:3px}
.pd-row .pd-items{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.pd-row .pd-items.pd-two{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:20px}

/* product = white tile + name + sub (no card box) */
.pd-prod{display:flex;align-items:center;gap:11px;text-decoration:none;color:inherit;min-width:0;
  padding:4px 7px;margin:-4px -7px;border-radius:10px;transition:.15s ease}
a.pd-prod:hover{background:color-mix(in srgb, var(--accent) 10%, transparent)}
.pd-tile{width:50px;height:50px;flex:none;background:#fff;border-radius:12px;
  display:grid;place-items:center;box-shadow:0 2px 10px rgba(15,23,42,.10);
  border:1px solid var(--border)}
.pd-tile svg{width:36px;height:36px}
.pd-tx b{display:flex;align-items:center;font-size:16.5px;font-weight:800;
  letter-spacing:-.01em;white-space:nowrap;color:var(--foreground)}
.pd-tx .pd-sub{display:block;font-size:13px;color:var(--muted-foreground);line-height:1.35;margin-top:2px}
.pd-live{width:6px;height:6px;border-radius:99px;background:var(--accent);
  box-shadow:0 0 7px color-mix(in srgb, var(--accent) 80%, transparent);
  display:inline-block;margin-left:7px;flex:none}

/* ONE / AGENTS / CODE chips on the Genie row */
.pd-trow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pd-chip{display:inline-flex;align-items:center;gap:5px;background:#fff;color:#11171C;
  border:1px solid var(--border);
  border-radius:99px;padding:5px 11px;font:800 11.5px 'DM Sans',sans-serif;
  letter-spacing:.04em;box-shadow:0 1px 4px rgba(15,23,42,.08);white-space:nowrap}
.pd-chip svg{width:14px;height:14px;flex:none}

/* Agentic Data row — Lakeflow on the left, Fork in the middle, Lakehouse
   (top) + Lakebase (bottom) stacked on the right matching the fork's
   two branch endpoints (y=22 and y=108 in the 130-tall Fork SVG).
   justify-content: center makes the whole rig sit as one centered block
   inside the row instead of pinning to the left with empty whitespace. */
.pd-story{display:flex;align-items:center;justify-content:center;
  gap:18px;width:100%;flex-wrap:nowrap}
.pd-lfgrp{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;
  padding:4px 7px;margin:-4px -7px;border-radius:12px;transition:.15s ease;flex-shrink:0}
a.pd-lfgrp:hover{background:color-mix(in srgb, var(--accent) 10%, transparent)}
/* the 3 medallion stage labels under the Lakeflow title */
.pd-medlbls{display:flex;align-items:center;gap:6px;margin-top:4px;
  font:600 10px 'DM Mono',monospace;letter-spacing:.10em;color:var(--muted-foreground);
  text-transform:uppercase;white-space:nowrap}
.pd-medlbls .pd-medsep{color:var(--accent)}
/* Right column: top tile (Lakehouse) sits at the fork's y=22 branch end,
   bottom tile (Lakebase) at y=108 — justify-content: space-between on a
   130-tall flex column lands them exactly there. */
.pd-fork-dest{display:flex;flex-direction:column;height:130px;
  justify-content:space-between;flex-shrink:0;min-width:0}

/* Open Infrastructure strip */
.pd-infra{display:flex;align-items:center;gap:18px;padding:9px 18px;
  border-top:1px solid var(--border);background:color-mix(in srgb, var(--muted) 60%, transparent)}
.pd-infra b{font-size:14.5px;font-weight:800;color:var(--foreground)}
.pd-infra .pd-ofdl{font:600 12px 'DM Mono',monospace;letter-spacing:.10em;color:var(--muted-foreground);text-transform:uppercase}
.pd-infra .pd-logos{margin-left:auto;display:flex;align-items:center;gap:22px}

/* data flowing UP from the sources */
.pd-flows{position:relative;height:58px;display:grid;grid-template-columns:repeat(4,1fr);
  max-width:880px;margin:6px auto 0}
.pd-fl{position:relative}
.pd-fl::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 60%, transparent), color-mix(in srgb, var(--accent) 10%, transparent))}
.pd-fl i{position:absolute;left:50%;width:6px;height:6px;margin-left:-3px;border-radius:99px;
  background:var(--accent);box-shadow:0 0 8px color-mix(in srgb, var(--accent) 80%, transparent);
  animation:pd-rise 2.1s linear infinite}
.pd-fl i:nth-child(2){animation-delay:1.05s}
@keyframes pd-rise{0%{top:calc(100% - 4px);opacity:0}12%{opacity:1}88%{opacity:1}100%{top:-4px;opacity:0}}
.pd-zb{position:absolute;left:25%;top:50%;transform:translate(-50%,-50%);z-index:2;
  display:inline-flex;align-items:center;gap:6px;white-space:nowrap;
  background:var(--card);border:1px solid var(--border);border-radius:99px;
  padding:6px 13px;text-decoration:none;color:var(--foreground);
  font:700 13px 'DM Sans',sans-serif;
  box-shadow:0 4px 14px rgba(15,23,42,.10);transition:.15s ease}
.pd-zb:hover{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 8%, transparent)}
.pd-zb svg{width:13px;height:13px;color:var(--accent)}
.pd-zb.pd-up{left:87.5%}

/* sources row */
.pd-sources{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-width:880px;margin:0 auto}
.pd-src{display:flex;align-items:center;gap:10px;justify-content:center}
.pd-src .pd-tile{width:44px;height:44px;border-radius:11px}
.pd-src .pd-tile svg{width:28px;height:28px}
.pd-src .pd-tx b{display:block;font-size:14px;font-weight:800;white-space:nowrap}
.pd-src .pd-tx span{display:block;font-size:12.5px;color:var(--muted-foreground);white-space:nowrap}

.pd-foot{margin-top:14px;text-align:center;font-size:12px;color:var(--muted-foreground)}
.pd-foot .pd-dot{display:inline-block;width:5px;height:5px;border-radius:99px;background:var(--accent);
  box-shadow:0 0 6px color-mix(in srgb, var(--accent) 80%, transparent);
  vertical-align:middle;margin:0 4px 1px 0}

@media (max-width:1180px){
  .pd-story{flex-wrap:wrap;gap:14px}
}
@media (max-width:980px){
  .pd-root{margin-left:0;margin-right:0}
  .pd-row{grid-template-columns:1fr}
  .pd-row .pd-items.pd-two{grid-template-columns:1fr}
  .pd-fork-dest{height:auto;gap:14px}
  .pd-sources{grid-template-columns:1fr 1fr}
  .pd-flows{display:none}
}
`;

// ─── A "product card" — white tile + title + sub. Optional href makes it
// clickable (live workspace deep-link); optional rt adds the ⚡RT badge.
function Prod({
  href, icon, title, sub, rt, after,
}: {
  href?: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  rt?: boolean;
  after?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="pd-tile">{icon}</span>
      <span className="pd-tx">
        <b>
          {title}
          {rt ? <RtBadge /> : null}
          {href ? <span className="pd-live" /> : null}
          {after}
        </b>
        <span className="pd-sub">{sub}</span>
      </span>
    </>
  );
  return href ? (
    <a className="pd-prod" href={href} target="_blank" rel="noopener noreferrer"
       title="Opens the live resource in the Databricks workspace">
      {body}
    </a>
  ) : (
    <div className="pd-prod">{body}</div>
  );
}

function Row({
  ttl, sub, tint, two, children,
}: {
  ttl: string;
  sub: string;
  tint?: 'orange' | 'navy';
  two?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`pd-row${tint ? ` pd-tint-${tint}` : ''}`}>
      <div className="pd-lbl"><b>{ttl}</b><span>{sub}</span></div>
      <div className={`pd-items${two ? ' pd-two' : ''}`}>{children}</div>
    </div>
  );
}

const UploadArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);

export function PlatformDiagram() {
  // Workspace resource URLs land via /api/resources. Until that resolves,
  // tiles render inert (no href) — same UX as a template fork where ids
  // haven't been filled into config/app.json yet.
  const [R, setR] = useState<WorkspaceResources>(EMPTY);
  useEffect(() => {
    let alive = true;
    void fetchResources()
      .then((r) => { if (alive) setR(r); })
      .catch((e) => {
        console.error('[platform-diagram] /api/resources failed', e);
      });
    return () => { alive = false; };
  }, []);

  // Local: empty-string URL → render the tile non-clickable.
  const href = (u: string) => (u ? u : undefined);

  return (
    <section className="pd-root" aria-label="LuxeBeauty on the Databricks Platform">
      <style>{CSS}</style>
      <div className="pd-wrap">
        <div className="pd-hero">
          <div className="pd-brand">Databricks Platform</div>
          <div className="pd-kick">LuxeBeauty · Returns Intelligence</div>
          <h2>
            Running LuxeBeauty Returns on the{' '}
            <span className="pd-hl">Databricks Platform</span>
          </h2>
        </div>

        {/* ============ ONE PLATFORM BOX ============ */}
        <div className="pd-plat">
          <Row
            ttl="Agentic Apps"
            sub="Deploy agents at scale to transform work"
            tint="orange"
            two
          >
            <Prod
              href={href(R.app.url)}
              icon={<AppsIcon />}
              title="Returns Console"
              sub="This app — queue, agent, refunds, all in one place"
            />
            <Prod
              href={href(R.dashboard.url)}
              icon={<AIBIIcon />}
              title="AI/BI Dashboard"
              sub="Where the returns are coming from — same numbers, one page"
            />
          </Row>

          <Row
            ttl="Agentic Work"
            sub="Data-smart coworkers for every employee"
            two
          >
            {/* Genie tile — the Genie icon + name + sub are wrapped in
                an anchor pointing at the Genie space, exactly as before.
                The ONE / AGENTS / CODE chips sit inline with the title;
                ONE is broken out as its OWN anchor pointing at the
                Databricks One landing page (nested <a> would be invalid,
                so the chips have to live outside the Genie anchor). */}
            <div className="pd-prod">
              <a
                href={href(R.genie.url)}
                target="_blank"
                rel="noopener noreferrer"
                title="Opens the Genie space in the Databricks workspace"
                style={{ display: 'flex', alignItems: 'center', gap: 11,
                  color: 'inherit', textDecoration: 'none' }}
              >
                <span className="pd-tile"><GenieIcon /></span>
              </a>
              <span className="pd-tx">
                <span className="pd-trow">
                  <a
                    href={href(R.genie.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'inherit', textDecoration: 'none',
                      display: 'inline-flex', alignItems: 'center' }}
                    title="Opens the Genie space in the Databricks workspace"
                  >
                    <b>Genie<span className="pd-live" /></b>
                  </a>
                  <a
                    className="pd-chip"
                    href={href(R.databricksOne.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Opens Databricks One in the workspace"
                    style={{ textDecoration: 'none' }}
                  >
                    <OneIcon />ONE
                  </a>
                  <span className="pd-chip"><AgentsIcon />AGENTS</span>
                  <span className="pd-chip"><CodeIcon />CODE</span>
                </span>
                <span className="pd-sub">"Why do I have so many returns?"</span>
              </span>
            </div>
            {/* Default href = the workspace-wide Agent Bricks landing
                page ({host}/ml/agents) — works on any workspace, even
                when the demo doesn't deploy a MAS.
                If your demo DOES deploy a specific Multi-Agent
                Supervisor endpoint (set masEndpointName in
                config/app.json), swap the href below to:
                  href={href(R.mas.url)}
                which deep-links to {host}/ml/endpoints/{masEndpointName}. */}
            <Prod
              href={href(R.agentBricks.url)}
              icon={<AgentBricksIcon />}
              title="Agent Bricks"
              sub="Diagnose the spike, draft apology emails, file refunds"
            />
          </Row>

          <Row
            ttl="Unified Governance"
            sub="Data + AI control and cost management"
            tint="navy"
            two
          >
            <Prod
              href={href(R.catalog.url)}
              icon={<UCIcon />}
              title="Unity Catalog"
              sub="retail_consumer_goods.luxebeauty_demo — one governed schema + lineage"
            />
            <Prod
              href={href(R.gateway.url)}
              icon={<GatewayIcon />}
              title="Unity AI Gateway"
              sub="Every agent LLM call governed — security + cost"
            />
          </Row>

          <Row
            ttl="Agentic Data"
            sub="Unified, real-time data foundation — the returns story"
          >
            <div className="pd-story">
              <FlowKeyframes />
              {/* Lakeflow tile — stage labels (bronze → silver → gold)
                  sit under the title instead of a full medallion. */}
              <a
                className="pd-lfgrp"
                href={href(R.pipeline.url)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the live pipeline"
              >
                <span className="pd-tile"><LakeflowIcon /></span>
                <span className="pd-tx">
                  <b>Lakeflow<span className="pd-live" /></b>
                  <span className="pd-medlbls">
                    bronze<span className="pd-medsep">›</span>silver<span className="pd-medsep">›</span>gold
                  </span>
                </span>
              </a>
              {/* Fork: trunk out of Lakeflow, branches to Lakehouse (top) +
                  Lakebase (bottom). Stacked vertically on the right so the
                  pipeline visibly serves both stores. */}
              <Fork />
              <div className="pd-fork-dest">
                <Prod
                  href={href(R.warehouse.url)}
                  icon={<LakehouseIcon />}
                  title="Lakehouse"
                  rt
                  sub="~100 ms charts, thousands of concurrent users"
                />
                <Prod
                  href={href(R.lakebase.url)}
                  icon={<LakebaseIcon />}
                  title="Lakebase"
                  sub="Returns Console reads/writes the queue live · branch on reset"
                />
              </div>
            </div>
          </Row>

          {/* Open Infrastructure strip */}
          <div className="pd-infra">
            <b>Open Infrastructure</b>
            <span className="pd-ofdl">Open Format Data Lake</span>
            <span className="pd-logos"><DeltaLogo /><IcebergLogo /></span>
          </div>
        </div>

        {/* ============ data flowing UP from the sources ============ */}
        <div className="pd-flows">
          <div className="pd-fl"><i /><i /></div>
          <div className="pd-fl"><i style={{ animationDelay: '.5s' }} /><i /></div>
          <div className="pd-fl"><i style={{ animationDelay: '.9s' }} /><i /></div>
          <div className="pd-fl"><i style={{ animationDelay: '.3s' }} /><i /></div>
          <span className="pd-zb" title="Zerobus · real-time ingest">
            <ZerobusBolt />Zerobus · real-time ingest
          </span>
          <a
            className="pd-zb pd-up"
            href={href(R.volume.url)}
            target="_blank"
            rel="noopener noreferrer"
            title="Manufacturing PDFs on a Unity Catalog Volume"
          >
            <UploadArrow />Upload · file on Volume
          </a>
        </div>

        <div className="pd-sources">
          <div className="pd-src">
            <span className="pd-tile"><SrcIcon d={SRC.scan} /></span>
            <span className="pd-tx"><b>Order POS</b><span>400K orders · 24mo</span></span>
          </div>
          <div className="pd-src">
            <span className="pd-tile"><SrcIcon d={SRC.bet} /></span>
            <span className="pd-tx"><b>CS Tickets</b><span>returns · sentiment</span></span>
          </div>
          <div className="pd-src">
            <span className="pd-tile"><SrcIcon d={SRC.odds} /></span>
            <span className="pd-tx"><b>Production Lots</b><span>QC + lot manifests</span></span>
          </div>
          <div className="pd-src">
            <span className="pd-tile"><SrcIcon d={SRC.pdf} /></span>
            <span className="pd-tx"><b>Manufacturing PDFs</b><span>incident reports → KA</span></span>
          </div>
        </div>

        <div className="pd-foot">
          <span className="pd-dot" />
          glowing dot = opens the real object in the Databricks workspace
        </div>
      </div>
    </section>
  );
}
