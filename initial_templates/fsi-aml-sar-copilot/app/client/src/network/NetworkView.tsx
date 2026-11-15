import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Globe2, Network as NetIcon } from 'lucide-react';
import { getJson, usd, fmtDate, type Json } from '@/lib/api';
import { KycBadge, RiskBar } from '@/ops/Badges';

const LINK_COLOR: Record<string, string> = { shared_address: '#E8871E', shared_phone: '#8E44AD', shared_device: '#16A085' };
const LINK_LABEL: Record<string, string> = { shared_address: 'same address / suite', shared_phone: 'same phone', shared_device: 'same login device' };

/** Split a beneficiary name onto (at most) two lines of ~20 chars so it fits the 130px box. */
function wrap2(name: string): string[] {
  const words = name.split(' ');
  let a = '';
  while (words.length && (a + ' ' + words[0]).trim().length <= 20) a = (a + ' ' + words.shift()).trim();
  const b = words.join(' ');
  return b ? [a || b.slice(0, 20), b.length > 20 ? b.slice(0, 19) + '…' : b] : [a];
}

export function NetworksList() {
  const [rows, setRows] = useState<Json[] | null>(null);
  useEffect(() => { getJson<{ networks: Json[] }>('/api/networks').then((r) => setRows(r.networks)); }, []);
  return (
    <div className="px-8 py-6 space-y-4">
      <h1 className="font-display text-3xl">Entity networks</h1>
      <p className="text-sm text-muted-foreground">Customers linked by shared identifiers (address, phone, online-banking device) or by moving money to each other — resolved into networks so linked alerts are investigated as one case (Policy §2).</p>
      <div className="grid grid-cols-3 gap-4">
        {!rows && [1, 2, 3].map((i) => <div key={i} className="h-36 rounded-xl bg-muted animate-pulse" />)}
        {rows?.map((n) => (
          <Link key={n.cluster_id} to={`/network/${n.cluster_id}`} className="rounded-xl border bg-card p-4 hover:shadow-md transition">
            <div className="flex items-center gap-2"><NetIcon className="h-4 w-4" /><span className="font-mono text-xs">{n.cluster_id}</span><span className="ml-auto text-xs text-muted-foreground">{n.cluster_size} parties · {n.open_alerts} open alerts</span></div>
            <div className="mt-2 text-sm font-medium line-clamp-2">{(n.member_names ?? []).join(', ')}</div>
            <div className="mt-3 grid grid-cols-3 gap-x-3 text-xs">
              <div><div className="text-muted-foreground">Cash 60d</div><div className="font-semibold">{usd(n.cash_in_60d, true)}</div></div>
              <div><div className="text-muted-foreground">$8K–$10K deposits</div><div className="font-semibold">{n.sub_ctr_deposits_60d}</div></div>
              <div><div className="text-muted-foreground">High-risk wires</div><div className={`font-semibold ${Number(n.high_risk_wires_60d) > 100000 ? 'text-[#D1495B]' : ''}`}>{usd(n.high_risk_wires_60d, true)}</div></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function NetworkView() {
  const { clusterId = '' } = useParams();
  const [d, setD] = useState<Json | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => { setD(null); getJson(`/api/network/${clusterId}`).then(setD); }, [clusterId]);

  const layout = useMemo(() => {
    if (!d) return null;
    const members: Json[] = d.members;
    const inflow: Record<string, number> = {};
    d.edges.filter((e: Json) => e.edge_type === 'funds_transfer').forEach((e: Json) => { inflow[e.dst] = (inflow[e.dst] ?? 0) + Number(e.amount); });
    const hub = [...members].sort((a, b) => (inflow[b.customer_id] ?? 0) - (inflow[a.customer_id] ?? 0))[0];
    const biz = members.filter((m) => m.customer_id !== hub.customer_id && m.customer_type === 'business');
    const ind = members.filter((m) => m.customer_id !== hub.customer_id && m.customer_type !== 'business');
    const pos: Record<string, { x: number; y: number }> = {};
    // left-to-right flow: individuals (placement) -> businesses (layering) -> hub -> offshore beneficiaries
    const cy = 290;
    const col = (list: Json[], x: number, gap: number) => list.forEach((m, i) => { pos[m.customer_id] = { x: x + (i % 2 ? 30 : 0), y: cy - ((list.length - 1) * gap) / 2 + i * gap }; });
    col(ind, 110, Math.min(115, 500 / Math.max(1, ind.length)));
    col(biz, 360, Math.min(170, 460 / Math.max(1, biz.length)));
    pos[hub.customer_id] = { x: 600, y: cy };
    const bens: Json[] = d.beneficiaries;
    bens.forEach((b, i) => { pos[`BEN:${b.name}`] = { x: 860, y: cy - ((bens.length - 1) * 130) / 2 + i * 130 }; });
    // aggregate shared-identifier links per pair
    const shared: Record<string, Json> = {};
    d.edges.filter((e: Json) => e.edge_type !== 'funds_transfer').forEach((e: Json) => {
      const k = [e.src, e.dst].sort().join('|');
      (shared[k] ??= { src: e.src, dst: e.dst, types: new Set<string>() }).types.add(e.edge_type);
    });
    return { hub, pos, shared: Object.values(shared), flows: d.edges.filter((e: Json) => e.edge_type === 'funds_transfer'), bens };
  }, [d]);

  if (!d || !layout) return <div className="p-8"><div className="h-[560px] rounded-xl bg-muted animate-pulse" /></div>;
  const s = d.summary ?? {};
  const maxFlow = Math.max(1, ...layout.flows.map((f: Json) => Number(f.amount)));
  const maxBen = Math.max(1, ...layout.bens.map((b: Json) => Number(b.amount)));
  const R = (m: Json) => 16 + Math.min(20, Math.sqrt(Number(m.cash_in_60d) / 4000));
  const byId = Object.fromEntries(d.members.map((m: Json) => [m.customer_id, m]));
  const dim = (ids: string[]) => (hover && !ids.includes(hover) ? 0.15 : 1);

  return (
    <div className="px-8 py-6 space-y-4">
      <Link to="/networks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Entity networks</Link>
      <header className="flex items-end gap-6">
        <div className="flex-1">
          <div className="font-mono text-xs text-muted-foreground">{d.cluster_id}</div>
          <h1 className="font-display text-3xl">{layout.hub.customer_name} network</h1>
          <p className="text-sm text-muted-foreground">{d.members.length} parties resolved by shared identifiers and fund transfers. Cash comes in just under the CTR threshold, is swept to the hub, and leaves by wire.</p>
        </div>
        <div className="grid grid-cols-4 gap-3 text-sm">
          {[['Cash in (60d)', usd(s.cash_in_60d)], ['$8K–$10K deposits', s.sub_ctr_deposits_60d], ['Branches', s.cash_branches_60d], ['High-risk wires', usd(s.high_risk_wires_60d)]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl border bg-card px-3 py-2"><div className="text-[10px] uppercase text-muted-foreground">{l}</div><div className="font-semibold">{v}</div></div>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-4 items-start gap-4">
        <div className="col-span-3 rounded-xl border bg-card p-2" data-testid="network-graph">
          <svg viewBox="0 0 1000 580" className="w-full">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3E7CB1" /></marker>
              <marker id="arrRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#D1495B" /></marker>
            </defs>
            {layout.shared.map((l: Json, i: number) => {
              const a = layout.pos[l.src], b = layout.pos[l.dst];
              if (!a || !b) return null;
              const types = [...l.types] as string[];
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={LINK_COLOR[types[0]] ?? '#999'} strokeDasharray="4 4" strokeWidth={1 + types.length * 0.5} opacity={0.45 * dim([l.src, l.dst])}><title>{types.map((t) => LINK_LABEL[t]).join(', ')}</title></line>;
            })}
            {layout.flows.map((f: Json, i: number) => {
              const a = layout.pos[f.src], b = layout.pos[f.dst];
              if (!a || !b) return null;
              const rb = R(byId[f.dst] ?? { cash_in_60d: 0 }) + 4;
              const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
              return <line key={i} x1={a.x} y1={a.y} x2={b.x - (dx / len) * rb} y2={b.y - (dy / len) * rb} stroke="#3E7CB1" strokeWidth={1 + 5 * Number(f.amount) / maxFlow} markerEnd="url(#arr)" opacity={dim([f.src, f.dst])}><title>{`${byId[f.src]?.customer_name} → ${byId[f.dst]?.customer_name}: ${usd(f.amount)} in ${f.txn_count} transfers`}</title></line>;
            })}
            {layout.bens.map((b: Json) => {
              const a = layout.pos[b.src], p = layout.pos[`BEN:${b.name}`];
              if (!a || !p) return null;
              return (
                <g key={b.name} opacity={dim([b.src])}>
                  <line x1={a.x} y1={a.y} x2={p.x - 60} y2={p.y} stroke="#D1495B" strokeWidth={2 + 7 * Number(b.amount) / maxBen} markerEnd="url(#arrRed)" />
                  <text x={p.x + 5} y={p.y - 40} textAnchor="middle" fontSize="12" fontWeight="600" fill="#D1495B">{usd(b.amount, true)} · {b.wires} wires</text>
                  <rect x={p.x - 60} y={p.y - 30} width={130} height={62} rx={8} fill="#FDECEE" stroke="#D1495B" />
                  <text x={p.x + 5} y={p.y - 13} textAnchor="middle" fontSize="11" fontWeight="600" fill="#7a1f2c">
                    {wrap2(String(b.name)).map((ln, j) => <tspan key={j} x={p.x + 5} dy={j ? 13 : 0}>{ln}</tspan>)}
                    <title>{b.name}</title>
                  </text>
                  <text x={p.x + 5} y={p.y + 22} textAnchor="middle" fontSize="11" fill="#7a1f2c">🌐 {b.country} · high-risk</text>
                </g>
              );
            })}
            {d.members.map((m: Json) => {
              const p = layout.pos[m.customer_id];
              const isHub = m.customer_id === layout.hub.customer_id;
              const fill = m.kyc_risk_rating === 'high' ? '#D1495B' : m.kyc_risk_rating === 'medium' ? '#E8871E' : '#3E7CB1';
              return (
                <g key={m.customer_id} onMouseEnter={() => setHover(m.customer_id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} opacity={hover && hover !== m.customer_id ? 0.55 : 1}>
                  <circle cx={p.x} cy={p.y} r={R(m) + (isHub ? 6 : 0)} fill={isHub ? '#0B2545' : fill} stroke="white" strokeWidth={3} />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fill="white" fontWeight="700">{m.customer_type === 'business' ? 'LLC' : '👤'}</text>
                  <text x={p.x} y={p.y + R(m) + (isHub ? 22 : 16)} textAnchor="middle" fontSize="12" fontWeight="600" fill="#1F2530" stroke="white" strokeWidth={4} paintOrder="stroke">{m.customer_name}</text>
                  <text x={p.x} y={p.y + R(m) + (isHub ? 36 : 30)} textAnchor="middle" fontSize="10" fill="#5B6573" stroke="white" strokeWidth={4} paintOrder="stroke">{usd(m.cash_in_60d, true)} cash · {m.sub_ctr_60d} sub-$10K</text>
                  {Number(m.open_alerts) > 0 && (<g><circle cx={p.x + R(m) - 2} cy={p.y - R(m) + 2} r={9} fill="#F2C14E" /><text x={p.x + R(m) - 2} y={p.y - R(m) + 6} textAnchor="middle" fontSize="10" fontWeight="700">{m.open_alerts}</text></g>)}
                </g>
              );
            })}
          </svg>
          <div className="flex flex-wrap gap-4 px-3 pb-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-0.5 w-6 bg-[#3E7CB1]" /> internal transfer (width = $)</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-6 bg-[#D1495B]" /> wire to high-risk jurisdiction</span>
            {Object.entries(LINK_LABEL).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className="h-0 w-6 border-t-2 border-dashed" style={{ borderColor: LINK_COLOR[k] }} /> {v}</span>)}
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#F2C14E]" /> open alerts</span>
          </div>
        </div>
        <div className="rounded-xl border bg-card overflow-hidden">
          <h2 className="px-3 pt-3 text-sm font-semibold">Parties</h2>
          <ul className="divide-y text-xs mt-2">
            {[...d.members].sort((a: Json, b: Json) => Number(b.max_ml_score ?? 0) - Number(a.max_ml_score ?? 0)).map((m: Json) => (
              <li key={m.customer_id} className="px-3 py-2" onMouseEnter={() => setHover(m.customer_id)} onMouseLeave={() => setHover(null)}>
                <div className="flex items-center gap-2"><span className="font-medium">{m.customer_name}</span><KycBadge rating={m.kyc_risk_rating} /></div>
                <div className="text-muted-foreground">{m.occupation_or_industry} · since {fmtDate(m.onboarding_date)}</div>
                <div className="flex items-center justify-between mt-1">
                  {m.max_ml_score != null ? <RiskBar score={m.max_ml_score} /> : <span />}
                  {m.top_alert_id && <Link to={`/case/${m.top_alert_id}`} className="text-[#3E7CB1] hover:underline">{m.open_alerts} alert(s) →</Link>}
                </div>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-1"><Globe2 className="h-3 w-3" /> gold_network_edges · gold_customer_network</div>
        </div>
      </div>
    </div>
  );
}
