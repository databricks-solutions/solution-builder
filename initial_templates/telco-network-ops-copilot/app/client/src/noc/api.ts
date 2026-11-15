/** NOC workbench API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type IncidentRow = {
  id: string; incident_type: string; title: string; market: string | null; suspected_node_id: string; suspected_node_type: string;
  cell_id: string | null; detected_ts: string | null; first_alarm_ts: string | null; first_flagged_day: string | null;
  sites_affected: number; subscribers_served: number; enterprise_accounts: string[]; critical_facilities: string[];
  alarm_count: number; critical_alarms: number; active_alarms: number; transport_alarms: number; alarm_types: string[];
  anomaly_score: number | null; top_factors: string[]; suggested_priority: string; status: string; ticket_id: string | null;
  decision: string | null; ai_verdict: string | null; ai_priority: string | null; ai_headline: string | null;
};
export type Summary = {
  open: number; p1_open: number; sites_down: number; subscribers_down: number; alarms_open_incidents: number; triaged: number;
  ticketed: number; closed_explained: number; tickets_opened: number; alarms_suppressed: number;
};
export type TimelineEvent = { ts: string; source: string; entity: string; event: string; is_root_cause?: boolean };
export type PlanAction = { code: string; action: string; target: string; rationale: string; status?: string };
export type Dispatch = { tech_id: string; name: string; skill: string; destination: string; task: string; eta_min: number | null; status?: string };
export type Triage = {
  verdict: 'root_cause_identified' | 'degradation_confirmed' | 'explained' | 'needs_investigation'; priority: string; headline: string; summary: string;
  root_cause: { node: string; component: string; cause: string } | null; timeline: TimelineEvent[];
  impact: { sites_down: number; subscribers: number; enterprise_accounts: string[]; critical_facilities: string[]; note: string };
  actions: PlanAction[]; dispatch: Dispatch[]; notifications: string[]; explanation_evidence: string[]; child_alarms_to_suppress: number;
  estimated_restore: string | null; runbook_citations: string[]; model: string; tool_calls: number; generated_at: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };
export type TroubleTicket = {
  id: string; incidentId: string; title: string; priority: string; status: string; rootCause: string | null; rootNode: string | null;
  summary: string | null; sitesAffected: number; subscribersImpacted: number; childAlarmsSuppressed: number; actions: PlanAction[];
  dispatches: Dispatch[]; notifications: string[]; engineer: string; notes: string | null; openedAt: string;
};
export type IncidentDetail = {
  id: string; incidentType: string; title: string; market: string | null; suspectedNodeId: string; suspectedNodeType: string; cellId: string | null;
  detectedTs: string | null; firstAlarmTs: string | null; lastAlarmTs: string | null; firstFlaggedDay: string | null; sitesAffected: number;
  siteIds: string[]; subscribersServed: number; enterpriseAccounts: string[]; criticalFacilities: string[]; alarmCount: number;
  criticalAlarms: number; activeAlarms: number; transportAlarms: number; alarmTypes: string[]; anomalyScore: number | null; topFactors: string[];
  suggestedPriority: string; status: string; triage: Triage | null; triagedAt: string | null; ticketId: string | null; decision: string | null;
  decisionNotes: string | null; decidedBy: string | null; decidedAt: string | null; auditTrail: AuditEntry[]; ticket: TroubleTicket | null;
};
export type SiteTile = {
  site_id: string; site_name: string; city: string | null; latitude: number; longitude: number; is_down: boolean; backhaul_type: string;
  subscribers_served: number; critical_facility: string | null; active_alarms: number; active_critical_alarms: number;
};
export type MapSite = {
  site_id: string; site_name: string; city: string | null; market: string | null; latitude: number; longitude: number; agg_router_id: string | null;
  is_down: boolean; active_alarms: number; active_critical_alarms: number; subscribers_served: number;
};
export type LinkRow = {
  link_id: string; a_node: string; z_node: string; link_type: string; role: string; capacity_gbps: number; span_km: number;
  rx_power_dbm: number | null; oper_status: string | null; ts: string | null;
};
export type AlarmRow = { ts: string; cleared: string | null; node_id: string; detail: string; alarm_name: string; severity: string };
export type KpiPoint = { d: string; sector: string; drop_call_rate_pct: number | null; max_vswr: number | null; rrc_setup_success_pct: number | null; ul_interference_dbm: number | null; peak_prb_utilization_pct: number | null; availability_pct: number | null };
export type Evidence = { kind: 'storm' | 'kpi'; sites: SiteTile[]; links?: LinkRow[]; alarms: AlarmRow[]; trend: KpiPoint[] };
export type TimelineBucket = { bucket: string; storm_alarms: number; other_alarms: number; storm_router: string };
export type KpiHeadline = { sites_down: number; sites_total: number; subscribers_down: number; alarms_24h: number; as_of: string };
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type ActivityRow = { incident_id: string; entity: string; entity_type: string; at: string; by: string; action: string; notes: string | null };

const j = async <T>(r: Response, label: string): Promise<T> => (await okOrThrow(r, label)).json() as Promise<T>;
export const fetchIncidents = (status = 'all') => fetch(`/api/incidents?status=${status}`).then((r) => j<IncidentRow[]>(r, 'incidents'));
export const fetchSummary = () => fetch('/api/incidents/summary').then((r) => j<Summary>(r, 'summary'));
export const fetchIncident = (id: string) => fetch(`/api/incidents/${encodeURIComponent(id)}`).then((r) => j<IncidentDetail>(r, 'incident'));
export const fetchEvidence = (id: string) => fetch(`/api/incidents/${encodeURIComponent(id)}/evidence`).then((r) => j<Evidence>(r, 'evidence'));
export const fetchTickets = () => fetch('/api/tickets').then((r) => j<TroubleTicket[]>(r, 'tickets'));
export const fetchActivity = (limit = 10) => fetch(`/api/activity/recent?limit=${limit}`).then((r) => j<ActivityRow[]>(r, 'activity'));
export const fetchMapSites = () => fetch('/api/network/sites').then((r) => j<MapSite[]>(r, 'network sites'));
export const fetchTimeline = () => fetch('/api/charts/alarm_timeline').then((r) => j<{ data?: TimelineBucket[] }>(r, 'timeline')).then((b) => b.data ?? []);
export const fetchKpiHeadline = () => fetch('/api/charts/noc_kpis').then((r) => j<{ data?: KpiHeadline[] }>(r, 'kpis')).then((b) => b.data?.[0] ?? null);

export async function openTicket(id: string, body: { priority: string; title: string; actions: PlanAction[]; dispatches: Dispatch[]; notes?: string }): Promise<IncidentDetail> {
  return j(await fetch(`/api/incidents/${encodeURIComponent(id)}/ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'ticket');
}
export async function closeExplained(id: string, notes: string): Promise<IncidentDetail> {
  return j(await fetch(`/api/incidents/${encodeURIComponent(id)}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) }), 'close');
}

/** POST /triage and parse the SSE stream (event: step | result | error). */
export async function runTriage(
  id: string,
  on: { step: (e: StepEvent) => void; result: (t: Triage) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/incidents/${encodeURIComponent(id)}/triage`, { method: 'POST' });
  if (!resp.ok || !resp.body) {
    on.error(`HTTP ${resp.status}`);
    return;
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      const parsed = JSON.parse(data);
      if (ev === 'step') on.step(parsed);
      else if (ev === 'result') on.result(parsed.triage);
      else if (ev === 'error') on.error(parsed.message);
    }
  }
}

export const fmtTs = (s: string | null | undefined) => (s ? s.replace('T', ' ').slice(0, 16) : '—');
export const fmtN = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
