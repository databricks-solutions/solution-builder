/**
 * Home — the NOC video wall. One screen answers the shift lead's question at 08:40: what is
 * down, where, why, and what has already been dispatched. Left: every cell site on the real map
 * (the storm is a red cluster under one router). Centre: the alarm storm against the rest of the
 * network, and the silent degradation with no alarm. Right: the topology that explains the outage.
 * Bottom: the correlated incident strip and the Copilot command line.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Radar, Terminal } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import {
  fetchActivity, fetchEvidence, fetchIncidents, fetchKpiHeadline, fetchMapSites, fetchSummary, fetchTimeline,
  fmtN, type ActivityRow, type Evidence, type IncidentRow, type KpiHeadline, type MapSite, type Summary, type TimelineBucket,
} from '@/noc/api';
import { NetworkMap } from '@/noc/NetworkMap';
import { SilentTrend, StormTimeline, TopologyTree } from '@/noc/WallPanels';
import { PriorityPill, TYPE_META, cn } from '@/noc/ui';

const ACTION: Record<string, string> = { ai_triage: 'AI triage', ticket_opened: 'Ticket opened', closed_explained: 'Closed as explained' };

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [sum, setSum] = useState<Summary | null>(null);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [kpi, setKpi] = useState<KpiHeadline | null>(null);
  const [sites, setSites] = useState<MapSite[]>([]);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [storm, setStorm] = useState<Evidence | null>(null);
  const [silent, setSilent] = useState<Evidence | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchKpiHeadline().then(setKpi).catch(() => {});
    fetchMapSites().then(setSites).catch(() => {});
    fetchTimeline().then(setTimeline).catch(() => {});
    fetchSummary().then(setSum).catch(() => {});
    fetchIncidents('all').then(setIncidents).catch(() => {});
    fetchActivity(6).then(setActivity).catch(() => {});
  }, [tick]);

  const stormRow = useMemo(() => incidents.find((t) => t.incident_type === 'alarm_storm') ?? null, [incidents]);
  const silentRow = useMemo(
    () => incidents.find((t) => t.incident_type === 'kpi_anomaly' && (t.top_factors[0] ?? '').startsWith('Dropped-call')) ?? incidents.find((t) => t.incident_type === 'kpi_anomaly') ?? null,
    [incidents],
  );
  const silentCount = incidents.filter((t) => t.incident_type === 'kpi_anomaly' && t.alarm_count === 0).length;

  useEffect(() => { if (stormRow) fetchEvidence(stormRow.id).then(setStorm).catch(() => {}); }, [stormRow?.id, tick]);
  useEffect(() => { if (silentRow) fetchEvidence(silentRow.id).then(setSilent).catch(() => {}); }, [silentRow?.id, tick]);

  const script = config?.assistantScript ?? [];
  const stormSites = storm?.sites ?? [];
  const correlated = sum ? sum.open + sum.ticketed + sum.closed_explained : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="noc-grid mx-auto max-w-[1500px] space-y-3 px-5 py-4">
        {/* ── Alarm banner ───────────────────────────────────────────────── */}
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-[#FF4D5E]/50 bg-gradient-to-r from-[#3A0F17] via-[#1E0B10] to-[#0C141C] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-[#FF4D5E] px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-[#1A0306]">SEV-1</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#FF8C98]">Alarm storm · AGG-DEN-04</span>
          </div>
          <h1 className="min-w-0 flex-1 text-[28px] uppercase leading-none tracking-wide text-[var(--foreground)]">
            {stormRow ? `${stormRow.sites_affected} cell sites down under one router · ${fmtN(stormRow.alarm_count)} alarms since 05:55` : 'Network status'}
          </h1>
          <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--muted-foreground)]">
            <span className="noc-live-dot size-2 rounded-full bg-[var(--primary)]" />
            LIVE · as of {kpi?.as_of?.slice(11, 16) ?? '--:--'} MT
          </div>
          {stormRow && (
            <button onClick={() => nav(`/incidents/${stormRow.id}`)} className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3.5 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:brightness-110">
              <Radar className="size-4" />Triage {stormRow.id}<ArrowRight className="size-4" />
            </button>
          )}
        </section>

        {/* ── Vitals ─────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-2 md:grid-cols-[repeat(5,minmax(0,1fr))]">
          <Vital label="Cell sites down" value={kpi ? `${kpi.sites_down}` : '…'} unit={kpi ? `/ ${kpi.sites_total}` : ''} tone="bad" />
          <Vital label="Subscribers off air" value={kpi ? fmtN(kpi.subscribers_down) : '…'} tone="bad" />
          <Vital label="Alarms, last 24 h" value={kpi ? fmtN(kpi.alarms_24h) : '…'} />
          <Vital label="Correlated into" value={correlated != null ? String(correlated) : '…'} unit="incidents" />
          <Vital label="Silent, no alarm" value={incidents.length ? `${silentCount}` : '…'} unit="degradations" tone="warn" />
        </section>

        {/* ── Map · timeline · topology ─────────────────────────────────── */}
        <section className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
          <Panel title="Network · every cell site" meta="OpenStreetMap · site coordinates" className="h-[470px]" bodyClass="p-0">
            <NetworkMap sites={sites} stormRouter={stormRow?.suspected_node_id ?? null} onPick={(s) => { if (stormRow && s.agg_router_id === stormRow.suspected_node_id) nav(`/incidents/${stormRow.id}`); }} />
          </Panel>

          <div className="flex min-w-0 flex-col gap-3 h-[470px]">
            <Panel title="Alarms / 5 min · storm vs rest" meta="last 4 h" className="flex-1">
              <StormTimeline data={timeline} />
              <div className="mt-1 flex gap-4 font-mono text-[10px] text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1"><span className="size-2 bg-[#FF4D5E]" />storm router</span>
                <span className="flex items-center gap-1"><span className="size-2 bg-[#3E5566]" />rest of network</span>
              </div>
            </Panel>
            <Panel title="Silent degradation" meta={silentRow ? silentRow.market ?? '' : ''} className="flex-1">
              {silent?.trend?.length ? <SilentTrend rows={silent.trend} title={silentRow?.title.split(':')[0] ?? 'KPI trend'} /> : <div className="text-sm text-[var(--muted-foreground)]">No silent degradation in the queue.</div>}
              {silentRow && <button onClick={() => nav(`/incidents/${silentRow.id}`)} className="mt-2 text-xs text-[var(--primary-light)] hover:underline">Open {silentRow.id} · no alarm raised →</button>}
            </Panel>
          </div>

          <Panel title="Topology" meta={stormRow?.suspected_node_id ?? ''} className="h-[470px] overflow-y-auto">
            <TopologyTree router={stormRow?.suspected_node_id ?? null} links={storm?.links ?? []} sites={stormSites} />
          </Panel>
        </section>

        {/* ── Incident strip ────────────────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg uppercase tracking-wide">Incident queue · one row per root cause</h2>
            <button onClick={() => nav('/incidents')} className="font-mono text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">open queue →</button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {incidents.slice(0, 6).map((l) => {
              const M = TYPE_META[l.incident_type] ?? TYPE_META.site_outage;
              const Icon = M.icon;
              const isStorm = l.incident_type === 'alarm_storm';
              return (
                <button key={l.id} onClick={() => nav(`/incidents/${l.id}`)}
                  className="group flex min-w-0 items-stretch gap-3 rounded-md border border-[var(--border)] bg-[var(--card)] text-left transition-colors hover:border-[var(--primary)]/60">
                  <span className={cn('w-1 shrink-0 rounded-l-md', isStorm ? 'bg-[#FF4D5E]' : l.alarm_count === 0 ? 'bg-[#FFB020]' : 'bg-[#3CD7F0]')} />
                  <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3">
                    <PriorityPill p={l.ai_priority ?? l.suggested_priority} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium"><Icon className="size-3.5 shrink-0 text-[var(--primary-light)]" /><span className="min-w-0 truncate" title={l.title}>{l.title}</span></div>
                      <div className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">{l.id} · {M.label} · {l.market}</div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                      {l.alarm_count > 0 ? <span>{l.alarm_count} alarms</span> : <span className="text-[#FFB020]">no alarm</span>}
                      <div className="text-[var(--muted-foreground)]">{fmtN(l.subscribers_served)} subs</div>
                    </div>
                  </div>
                </button>
              );
            })}
            {incidents.length === 0 && [0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-[var(--muted)]" />)}
          </div>
        </section>

        {/* ── Copilot command line + activity ───────────────────────────── */}
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Panel title="Ask the NOC Copilot" meta="network → Genie · procedure → runbook">
            <div className="flex flex-col gap-1.5 font-mono text-[12px]">
              {script.map((s) => (
                <button key={s.prompt} onClick={() => dockController.openAndSend(s.prompt)}
                  className="flex items-center gap-2 rounded border border-[var(--border)] bg-[#070D13] px-3 py-2 text-left text-[var(--foreground)] hover:border-[var(--primary)]/60">
                  <Terminal className="size-3.5 shrink-0 text-[var(--primary)]" /><span className="text-[var(--muted-foreground)]">$</span><span className="truncate">{s.prompt}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Workbench activity" meta={sum ? `${sum.tickets_opened} tickets · ${fmtN(sum.alarms_suppressed)} alarms suppressed` : ''}>
            {activity.length === 0 && <div className="text-sm text-[var(--muted-foreground)]">Nothing yet — open an incident and click Triage.</div>}
            <ul className="space-y-1.5 font-mono text-[12px]">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <button onClick={() => nav(`/incidents/${a.incident_id}`)} className="truncate text-left hover:underline">
                    <span className="text-[var(--primary-light)]">{ACTION[a.action] ?? a.action}</span> · {a.entity} <span className="text-[var(--muted-foreground)]">({a.incident_id})</span>
                  </button>
                  <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      </div>
    </div>
  );
}

function Vital({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('mt-0.5 text-[34px] leading-none tabular-nums', tone === 'bad' && 'text-[#FF8C98]', tone === 'warn' && 'text-[#FFC466]')} style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
        {value}{unit && <span className="ml-1 text-base text-[var(--muted-foreground)]">{unit}</span>}
      </div>
    </div>
  );
}

function Panel({ title, meta, className, bodyClass, children }: { title: string; meta?: string; className?: string; bodyClass?: string; children: ReactNode }) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col rounded-md border border-[var(--border)] bg-[var(--card)]', className)}>
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground)]">{title}</div>
        {meta && <div className="shrink-0 truncate font-mono text-[10px] text-[var(--muted-foreground)]">{meta}</div>}
      </div>
      <div className={cn('min-h-0 flex-1 p-3', bodyClass)}>{children}</div>
    </div>
  );
}
