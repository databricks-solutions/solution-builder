/**
 * The three signature visuals of the NOC wall:
 *   - StormTimeline   alarms per 5 minutes, storm router vs the rest of the network
 *   - TopologyTree    aggregation router → core uplinks, with the optics that explain the outage
 *   - SilentTrend     the one degradation with no alarm: drop-call rate creeping up by sector
 */
import type { KpiPoint, LinkRow, SiteTile, TimelineBucket } from '@/noc/api';
import { cn } from '@/noc/ui';

const RED = '#FF4D5E', AMBER = '#FFB020', CYAN = '#3CD7F0', GREY = '#3E5566', GREEN = '#3DDC97';

// ── Storm timeline ──────────────────────────────────────────────────────────
export function StormTimeline({ data }: { data: TimelineBucket[] }) {
  if (!data.length) return <div className="text-sm text-[var(--muted-foreground)]">No alarm history yet.</div>;
  const W = 520, H = 170, L = 26, B = 20, T = 8, R = 6;
  const max = Math.max(1, ...data.map((d) => d.storm_alarms + d.other_alarms));
  const bw = (W - L - R) / data.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const stormIdx = data.findIndex((d) => d.bucket >= '05:50');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Alarms per five minutes">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#1F2D39" strokeDasharray="2 4" />
          <text x={L - 4} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill="#7D8FA0" fontFamily="Geist Mono">{Math.round(max * f)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = L + i * bw + 1;
        const yOther = y(d.other_alarms);
        const yStorm = y(d.other_alarms + d.storm_alarms);
        return (
          <g key={d.bucket}>
            <rect x={x} y={yOther} width={bw - 2} height={H - B - yOther} fill={GREY} opacity={0.9} />
            <rect x={x} y={yStorm} width={bw - 2} height={Math.max(0, yOther - yStorm)} fill={RED} />
          </g>
        );
      })}
      {stormIdx >= 0 && (
        <g>
          <line x1={L + stormIdx * bw} x2={L + stormIdx * bw} y1={T} y2={H - B} stroke={AMBER} strokeDasharray="3 3" />
          <text x={L + stormIdx * bw + 4} y={T + 9} fontSize="9" fill={AMBER} fontFamily="Geist Mono">05:55 AGG-DEN-04 isolated</text>
        </g>
      )}
      {data.map((d, i) => (i % 6 === 0 ? (
        <text key={d.bucket} x={L + i * bw} y={H - 5} fontSize="9" fill="#7D8FA0" fontFamily="Geist Mono">{d.bucket}</text>
      ) : null))}
    </svg>
  );
}

// ── Topology tree ───────────────────────────────────────────────────────────
type LinkState = { label: string; tone: 'los' | 'degraded' | 'ok' | 'unknown'; color: string };
function linkState(l: LinkRow): LinkState {
  const rx = l.rx_power_dbm;
  if (rx == null) return { label: 'no optics reading', tone: 'unknown', color: GREY };
  if (rx <= -39) return { label: 'LOS · no light', tone: 'los', color: RED };
  if (rx < -18) return { label: `rx ${rx.toFixed(1)} dBm · degrading`, tone: 'degraded', color: AMBER };
  return { label: `rx ${rx.toFixed(1)} dBm · ok`, tone: 'ok', color: GREEN };
}

export function TopologyTree({ router, links, sites }: { router: string | null; links: LinkRow[]; sites: SiteTile[] }) {
  if (!router) return <div className="text-sm text-[var(--muted-foreground)]">No storm in the queue.</div>;
  const down = sites.filter((s) => s.is_down).length;
  const subs = sites.filter((s) => s.is_down).reduce((a, s) => a + s.subscribers_served, 0);
  const up = links.filter((l) => l.a_node === router).slice(0, 3);
  return (
    <div className="flex flex-col items-stretch gap-0 font-mono text-[11px]">
      <div className="flex justify-center gap-2">
        {up.map((l) => <CoreBox key={l.link_id} name={l.z_node} />)}
      </div>
      <div className="flex justify-around px-6">
        {up.map((l) => {
          const st = linkState(l);
          return <div key={l.link_id} className="h-6 w-0.5 rounded" style={{ background: st.color }} />;
        })}
      </div>
      <div className="flex flex-col gap-1 pb-1">
        {up.map((l) => {
          const st = linkState(l);
          return (
            <div key={l.link_id} className="flex items-center justify-between gap-2 rounded border px-2 py-1" style={{ borderColor: st.color + '66' }}>
              <span className="truncate text-[var(--muted-foreground)]">{l.link_id} · {l.role}</span>
              <span className={cn('shrink-0 font-semibold', st.tone === 'los' && 'text-[#FF8C98]', st.tone === 'degraded' && 'text-[#FFC466]', st.tone === 'ok' && 'text-[#7BF0C0]')}>{st.label}</span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-center"><div className="h-5 w-px bg-[#FF4D5E]" /></div>
      <div className="rounded-md border border-[#FF4D5E]/60 bg-[#2A0F15] px-3 py-2 text-center">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[#FF8C98]">Aggregation router</div>
        <div className="text-sm font-semibold text-[var(--foreground)]">{router}</div>
        <div className="mt-1 text-[var(--muted-foreground)]">management plane lost · traffic on backup optic</div>
      </div>
      <div className="flex justify-center"><div className="h-5 w-px bg-[#FF4D5E]" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-2 py-2 text-center">
          <div className="text-2xl font-semibold text-[#FF8C98] tabular-nums" style={{ fontFamily: 'var(--font-display)' }}>{down}<span className="text-sm text-[var(--muted-foreground)]">/{sites.length}</span></div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">cell sites down</div>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-2 py-2 text-center">
          <div className="text-2xl font-semibold tabular-nums" style={{ fontFamily: 'var(--font-display)' }}>{(subs / 1000).toFixed(1)}K</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">subscribers off air</div>
        </div>
      </div>
    </div>
  );
}

function CoreBox({ name }: { name: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-center">
      <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">core</div>
      <div className="font-semibold">{name}</div>
    </div>
  );
}

// ── Silent degradation trend ───────────────────────────────────────────────
export function SilentTrend({ rows, title }: { rows: KpiPoint[]; title: string }) {
  const sectors = [...new Set(rows.map((r) => r.sector))].sort();
  const days = [...new Set(rows.map((r) => r.d))].sort();
  const vals = rows.map((r) => r.drop_call_rate_pct).filter((v): v is number => v != null);
  if (!vals.length) return <div className="text-sm text-[var(--muted-foreground)]">No KPI history.</div>;
  const W = 300, H = 120, L = 28, B = 16, T = 6, R = 4;
  const max = Math.max(...vals) * 1.15 || 1;
  const x = (i: number) => L + (i / Math.max(1, days.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const colors = [CYAN, AMBER, '#A98BFF'];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="min-w-0 truncate font-semibold text-[var(--foreground)]" title={title}>{title}</span>
        <span className="shrink-0 pl-2 font-mono text-[var(--muted-foreground)]">drop-call %</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#1F2D39" strokeDasharray="2 4" />
            <text x={L - 4} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill="#7D8FA0" fontFamily="Geist Mono">{(max * f).toFixed(1)}</text>
          </g>
        ))}
        {sectors.map((s, k) => {
          const pts = days.map((d, i) => { const r = rows.find((q) => q.d === d && q.sector === s); return r && r.drop_call_rate_pct != null ? `${x(i)},${y(r.drop_call_rate_pct)}` : null; }).filter(Boolean);
          return <polyline key={s} points={pts.join(' ')} fill="none" stroke={colors[k % colors.length]} strokeWidth={2} />;
        })}
        {days.length > 0 && <text x={L} y={H - 3} fontSize="9" fill="#7D8FA0" fontFamily="Geist Mono">{days[0].slice(5)}</text>}
        {days.length > 0 && <text x={W - R} y={H - 3} textAnchor="end" fontSize="9" fill="#7D8FA0" fontFamily="Geist Mono">{days[days.length - 1].slice(5)}</text>}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] text-[var(--muted-foreground)]">
        {sectors.map((s, k) => <span key={s} className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: colors[k % colors.length] }} />{s}</span>)}
      </div>
    </div>
  );
}
