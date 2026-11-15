/**
 * The triage agent — the incident workbench's "Triage with the Copilot" button.
 *
 * A real tool-calling loop on the Databricks Foundation Model API (OpenAI-compatible chat
 * completions, default databricks-claude-sonnet-4-5). Every evidence tool is a parameterized,
 * read-only SQL query over the governed network telemetry in Unity Catalog (SDP silver/gold
 * alarms, optics counters, RAN KPIs, KPI anomaly scores, topology, planned activity, enterprise
 * coverage, care contacts, field workforce), run on the SQL warehouse; `ask_noc_runbook` asks the
 * Genie agent, which searches the NOC runbook documents (Agent mode). The agent walks the topology from
 * the correlated incident to the root cause, sizes the customer impact, then must finish with
 * `submit_triage`: verdict, priority, root cause, a timeline, the action plan from the runbook's
 * catalog and the field dispatch. The engineer reviews it and opens the trouble ticket (write-back).
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { authedFetch } from '../lib/auth.js';
import { askDocuments } from '../lib/serving.js';
import { execSql, type DataConfig, type SqlParam } from '../db/sync.js';
import type { Dispatch, PlanAction, TimelineEvent, Triage } from '../db/schema.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type IncidentRef = {
  id: string; incidentType: string; title: string; market: string | null; suspectedNodeId: string; cellId: string | null;
  siteIds: string[]; sitesAffected: number; subscribersServed: number; alarmCount: number; activeAlarms: number;
  alarmTypes: string[]; topFactors: string[]; anomalyScore: number | null; suggestedPriority: string; detectedTs: string | null;
};

export const ACTION_CATALOG: Record<string, string> = {
  'A-01': 'Open one parent ticket & suppress child alarms',
  'A-02': 'Dispatch OSP fiber splicing crew to the cut',
  'A-03': 'Dispatch transport technician to the router hut (clean / replace optic)',
  'A-04': 'Verify / force traffic onto microwave backup',
  'A-05': 'Notify enterprise accounts per SLA',
  'A-06': 'Open major-incident bridge & notify executives',
  'A-07': 'Dispatch tower crew (2 climbers, line sweep)',
  'A-08': 'Dispatch power technician with portable generator',
  'A-09': 'Remote RF check / interference hunt',
  'A-10': 'Monitor & close as explained',
};

const host = () => (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
const wh = () => process.env.DATABRICKS_WAREHOUSE_ID ?? '';
const RE = {
  node: /^[A-Z]{2,5}-[A-Z0-9]{2,5}(-[0-9]{2,3})?(-[ABC])?$/,
  link: /^(LNK-[0-9]{4}|MW-[A-Z0-9-]{3,12})$/,
  skill: /^(fiber_splicing|transport|rf_tower|power|microwave|generalist)$/,
  market: /^(Denver Metro|Boulder|Fort Collins|Colorado Springs|Pueblo)$/,
};
const ETA_COL: Record<string, string> = {
  'Denver Metro': 'eta_min_denver', Boulder: 'eta_min_boulder', 'Fort Collins': 'eta_min_fort', 'Colorado Springs': 'eta_min_colorado', Pueblo: 'eta_min_pueblo',
};

async function q(sql: string, params: Record<string, string> = {}) {
  const p: SqlParam[] = Object.entries(params).map(([name, value]) => ({ name, value, type: 'STRING' }));
  return execSql<Record<string, unknown>>(wh(), sql, p);
}

type ToolOut = { result: unknown; summary: string };

async function runTool(name: string, args: Record<string, unknown>, inc: IncidentRef, data: DataConfig, req: Request, genieSpaceId: string): Promise<ToolOut> {
  const T = (t: string) => `${data.catalog}.${data.schema}.${t}`;
  const NOW = `(SELECT max(ts) FROM ${T('silver_optics')})`;
  const str = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? (args[k] as string).trim() : null);
  const need = (v: string | null, re: RegExp, what: string) => {
    if (!v || !re.test(v)) throw new Error(`invalid ${what}: ${v}`);
    return v;
  };
  switch (name) {
    case 'get_incident_context': {
      const base = { incident: inc };
      if (inc.incidentType === 'alarm_storm') {
        const r = inc.suspectedNodeId;
        const [byType, transport, sites] = await Promise.all([
          q(`SELECT alarm_name, severity, count(*) n, count(DISTINCT site_id) sites, CAST(min(raised_ts) AS STRING) first_raised, CAST(max(raised_ts) AS STRING) last_raised
             FROM ${T('silver_alarms')} WHERE agg_router_id = :r AND node_type = 'cell_site' AND raised_ts > ${NOW} - INTERVAL 24 HOURS AND severity IN ('critical','major')
             GROUP BY ALL ORDER BY first_raised`, { r }),
          q(`SELECT CAST(raised_ts AS STRING) raised, node_id, interface, alarm_name, severity, is_active, additional_text FROM ${T('silver_alarms')}
             WHERE (node_id = :r OR (node_type = 'core_router' AND (additional_text LIKE concat('%', :r, '%')
                    OR EXISTS (SELECT 1 FROM ${T('transport_links')} l WHERE l.a_node = :r AND additional_text LIKE concat('%', l.link_id, '%')))))
               AND raised_ts > ${NOW} - INTERVAL 24 HOURS AND severity IN ('critical','major') AND node_type <> 'cell_site' ORDER BY raised_ts`, { r }),
          q(`SELECT count(*) sites_homed, count_if(is_down) sites_down, count_if(NOT is_down) sites_up,
                    collect_list(IF(NOT is_down, concat(site_id, ' (', backhaul_type, ')'), NULL)) up_sites, sum(IF(is_down, subscribers_served, 0)) subscribers_on_down_sites
             FROM ${T('gold_site_status')} WHERE agg_router_id = :r`, { r }),
        ]);
        const s = sites[0] ?? {};
        return {
          result: { ...base, alarm_types_on_sites: byType, transport_alarms_in_order: transport, router_sites: s },
          summary: `${inc.alarmCount} alarms · ${s.sites_down}/${s.sites_homed} sites under ${r} down · ${transport.length} transport alarms (first: ${transport[0]?.alarm_name ?? 'n/a'} ${String(transport[0]?.raised ?? '').slice(11, 19)})`,
        };
      }
      if (inc.incidentType === 'kpi_anomaly') {
        const c = inc.cellId ?? '';
        const [health] = await Promise.all([
          q(`SELECT CAST(day AS STRING) day, anomaly_score, is_anomaly, top_factors, drop_call_rate_pct, baseline_drop_call_rate_pct, max_vswr, baseline_vswr,
                    rrc_setup_success_pct, avg_sinr_db, ul_interference_dbm, peak_prb_utilization_pct
             FROM ${T('cell_health_daily')} WHERE cell_id = :c ORDER BY day`, { c }),
        ]);
        return { result: { ...base, anomaly_model: 'cell_kpi_anomaly_model@champion', daily_scores: health },
                 summary: `${c}: anomaly score ${inc.anomalyScore} · ${health.filter((h) => String(h.is_anomaly) === 'true').length} flagged day(s) · ${inc.topFactors[0] ?? ''}` };
      }
      const alarms = await q(`SELECT CAST(raised_ts AS STRING) raised, CAST(cleared_ts AS STRING) cleared, cell_id, alarm_name, severity, probable_cause, additional_text
                              FROM ${T('silver_alarms')} WHERE site_id = :s AND raised_ts > ${NOW} - INTERVAL 24 HOURS AND severity IN ('critical','major','warning') ORDER BY raised_ts`, { s: inc.suspectedNodeId });
      return { result: { ...base, alarms, now: (await q(`SELECT CAST(${NOW} AS STRING) now`))[0]?.now },
               summary: `${alarms.length} alarm(s) on ${inc.suspectedNodeId} · ${alarms.filter((a) => !a.cleared).length} still active` };
    }
    case 'get_topology': {
      const n = need(str('node_id'), RE.node, 'node_id');
      if (n.startsWith('AGG-') || n.startsWith('CORE-')) {
        const [node, links, sites] = await Promise.all([
          q(`SELECT * FROM ${T('transport_nodes')} WHERE node_id = :n`, { n }),
          q(`SELECT link_id, a_node, a_interface, z_node, z_interface, link_type, role, capacity_gbps, span_km, route FROM ${T('transport_links')} WHERE a_node = :n OR z_node = :n OR z_node LIKE concat('%', :n, '%') OR (link_type = 'microwave' AND a_node = :n)`, { n }),
          q(`SELECT backhaul_type, count(*) sites, sum(subscribers_served) subscribers, collect_list(IF(backhaul_type <> 'fiber', concat(site_id, ' via ', coalesce(microwave_backup_node, '')), NULL)) backup_paths
             FROM ${T('cell_sites')} WHERE agg_router_id = :n GROUP BY backhaul_type`, { n }),
        ]);
        return { result: { node: node[0], links, sites_homed_by_backhaul: sites },
                 summary: `${n} (${node[0]?.location ?? ''}) · ${links.length} link(s) · ${sites.reduce((a, s) => a + Number(s.sites), 0)} sites homed` };
      }
      const site = n.replace(/-[ABC]$/, '');
      const rows = await q(`SELECT s.*, n.location AS agg_location FROM ${T('cell_sites')} s LEFT JOIN ${T('transport_nodes')} n ON n.node_id = s.agg_router_id WHERE s.site_id = :s`, { s: site });
      return { result: rows[0] ?? null, summary: rows[0] ? `${site} ${rows[0].site_name} · ${rows[0].market} · via ${rows[0].agg_router_id} (${rows[0].backhaul_type})` : `${site} not found` };
    }
    case 'search_alarm_history': {
      const n = need(str('node_id'), RE.node, 'node_id');
      const days = String(Math.max(1, Math.min(30, Number(args.days ?? 14))));
      const rows = await q(`SELECT CAST(raised_ts AS STRING) raised, CAST(cleared_ts AS STRING) cleared, node_id, interface, cell_id, alarm_name, severity, acknowledged_by, additional_text
                            FROM ${T('silver_alarms')} WHERE (node_id = :n OR site_id = :n) AND raised_ts > ${NOW} - make_interval(0, 0, 0, CAST(:d AS INT))
                              AND alarm_code NOT IN ('RAN-S1-DOWN','RAN-X2-DOWN','SYNC-PTP-LOSS','RAN-CELL-UNAVAIL','TRN-CSR-BFD')
                            ORDER BY raised_ts LIMIT 60`, { n, d: days });
      const minor = rows.filter((r) => ['minor', 'warning'].includes(String(r.severity)));
      return { result: rows, summary: `${n}, ${days} days: ${rows.length} alarm(s) (${minor.length} minor/warning${minor.filter((m) => String(m.acknowledged_by ?? '').includes('auto')).length ? `, ${minor.filter((m) => String(m.acknowledged_by ?? '').includes('auto')).length} auto-acknowledged` : ''})` };
    }
    case 'get_optics': {
      const n = need(str('node_id'), RE.node, 'node_id');
      const [daily, recent] = await Promise.all([
        q(`SELECT interface, link_id, CAST(to_date(ts) AS STRING) day, round(min(rx_power_dbm), 1) min_rx_dbm, round(avg(rx_power_dbm), 1) avg_rx_dbm, max(crc_errors) max_crc, round(max(utilization_pct), 0) max_util_pct
           FROM ${T('silver_optics')} WHERE node_id = :n AND ts > ${NOW} - INTERVAL 14 DAYS GROUP BY ALL ORDER BY interface, day`, { n }),
        q(`SELECT CAST(ts AS STRING) ts, interface, link_id, rx_power_dbm, utilization_pct, crc_errors, oper_status FROM ${T('silver_optics')}
           WHERE node_id = :n AND ts > ${NOW} - INTERVAL 4 HOURS ORDER BY interface, ts`, { n }),
      ]);
      const last = new Map<string, Record<string, unknown>>();
      for (const r of recent) last.set(String(r.interface), r);
      return { result: { daily_last_14d: daily, last_4_hours_15min: recent },
               summary: [...last.values()].map((r) => `${r.interface} ${r.oper_status} rx ${r.rx_power_dbm} dBm`).join(' · ') || `no optics for ${n}` };
    }
    case 'get_cell_kpis': {
      const n = need(str('site_or_cell_id'), RE.node, 'site_or_cell_id');
      const site = n.replace(/-[ABC]$/, '');
      const rows = await q(`SELECT cell_id, CAST(day AS STRING) day, availability_pct, drop_call_rate_pct, rrc_setup_success_pct, avg_sinr_db, max_vswr, ul_interference_dbm, peak_prb_utilization_pct, voice_calls
                            FROM ${T('gold_cell_kpi_daily')} WHERE site_id = :s AND day > (SELECT max(day) FROM ${T('gold_cell_kpi_daily')}) - 21 ORDER BY cell_id, day`, { s: site });
      const byCell = new Map<string, Record<string, unknown>[]>();
      for (const r of rows) byCell.set(String(r.cell_id), [...(byCell.get(String(r.cell_id)) ?? []), r]);
      const summ = [...byCell.entries()].map(([c, rs]) => `${c.slice(-1)}: drop ${rs[0]?.drop_call_rate_pct}%→${rs[rs.length - 1]?.drop_call_rate_pct}%, VSWR ${rs[rs.length - 1]?.max_vswr}`).join(' · ');
      return { result: rows, summary: `${site} 21 days — ${summ}` };
    }
    case 'get_customer_impact': {
      const ids = (Array.isArray(args.site_ids) ? (args.site_ids as unknown[]).map(String) : inc.siteIds).filter((s) => RE.node.test(s)).slice(0, 80);
      if (!ids.length) throw new Error('site_ids required');
      const list = ids.map((_, i) => `:s${i}`).join(',');
      const p = Object.fromEntries(ids.map((s, i) => [`s${i}`, s]));
      const [subs, ent, care] = await Promise.all([
        q(`SELECT count(*) sites, sum(subscribers_served) subscribers, collect_set(critical_facility) critical_facilities,
                  collect_list(IF(critical_facility IS NOT NULL, concat(site_id, ' ', site_name, ' — ', critical_facility), NULL)) critical_sites
           FROM ${T('cell_sites')} WHERE site_id IN (${list})`, p),
        q(`SELECT account_name, sla_tier, restore_sla_hours, mrr_usd, collect_list(site_id) sites_affected FROM ${T('enterprise_site_coverage')} WHERE site_id IN (${list}) GROUP BY ALL ORDER BY restore_sla_hours, mrr_usd DESC`, p),
        q(`SELECT CAST(day AS STRING) day, sum(network_complaints) complaints, sum(dropped_call_complaints) dropped_call_complaints FROM ${T('care_contacts_daily')}
           WHERE site_id IN (${list}) AND day > (SELECT max(day) FROM ${T('care_contacts_daily')}) - 14 GROUP BY day ORDER BY day`, p),
      ]);
      return { result: { ...subs[0], enterprise_accounts: ent, care_contacts_14d: care },
               summary: `${subs[0]?.sites} site(s) · ${Number(subs[0]?.subscribers ?? 0).toLocaleString('en-US')} subscribers · ${ent.length} enterprise account(s)${ent[0] ? ` (${ent.map((e) => `${e.account_name} ${e.sla_tier}`).join(', ')})` : ''}` };
    }
    case 'check_planned_activity': {
      const m = str('market');
      const hours = String(Math.max(6, Math.min(168, Number(args.hours_back ?? 48))));
      if (m) need(m, RE.market, 'market');
      const rows = await q(`SELECT activity_id, activity_type, market, site_ids, node_ids, location, CAST(start_ts AS STRING) start_ts, CAST(end_ts AS STRING) end_ts, description
                            FROM ${T('planned_activity')} WHERE (:m = '' OR market = :m) AND end_ts > ${NOW} - make_interval(0, 0, 0, 0, CAST(:h AS INT)) ORDER BY start_ts`, { m: m ?? '', h: hours });
      return { result: rows, summary: `${rows.length} planned / external activit${rows.length === 1 ? 'y' : 'ies'}${m ? ` in ${m}` : ''}: ${rows.map((r) => r.activity_type).join(', ')}` };
    }
    case 'find_technicians': {
      const sk = need(str('skill'), RE.skill, 'skill');
      const m = need(str('market'), RE.market, 'market');
      const col = ETA_COL[m];
      const rows = await q(`SELECT tech_id, name, skill, base_market, on_shift, certifications, ${col} AS eta_min FROM ${T('field_technicians')} WHERE skill = :k ORDER BY on_shift DESC, ${col}`, { k: sk });
      const on = rows.filter((r) => String(r.on_shift) === 'true');
      return { result: rows, summary: `${sk} → ${m}: ${on.length} on shift${on[0] ? ` (nearest ${on[0].name}, ${on[0].eta_min} min)` : ''}` };
    }
    case 'ask_noc_runbook': {
      if (!genieSpaceId) return { result: 'Genie agent (NOC runbooks) not configured', summary: 'runbook unavailable' };
      const question = String(args.question ?? '').slice(0, 600);
      const r = await askDocuments(req, genieSpaceId, `Answer from the Halcyon NOC runbook documents only, citing the section: ${question}`);
      return { result: { answer: r.answer, sources: r.sources }, summary: `Runbook: “${question.slice(0, 80)}${question.length > 80 ? '…' : ''}”` };
    }
    default:
      return { result: `unknown tool ${name}`, summary: `unknown tool ${name}` };
  }
}

const LABEL: Record<string, string> = {
  get_incident_context: 'Reading the correlated incident',
  get_topology: 'Walking the topology',
  search_alarm_history: 'Searching alarm history',
  get_optics: 'Reading optical levels & interface counters',
  get_cell_kpis: 'Pulling RAN KPIs (21 days)',
  get_customer_impact: 'Sizing customer impact',
  check_planned_activity: 'Checking planned work, events, 811 notices',
  find_technicians: 'Finding field technicians',
  ask_noc_runbook: 'Consulting the NOC runbook (Genie agent)',
};

const S = (description: string) => ({ type: 'string', description });
const NS = (description: string) => ({ type: ['string', 'null'], description });
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: 'function', function: { name: 'get_incident_context', description: 'The correlated incident. Storm: alarm types on the child sites (counts, first/last), every transport alarm on the parent router / core ends IN TIME ORDER, and how many sites under the router are down vs up. Site incident: its alarms (raised/cleared) and the current time. KPI anomaly: the cell\'s daily anomaly scores + KPIs vs baseline.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_topology', description: 'Topology of a node. Router (AGG-*/CORE-*): location, its backhaul links (primary / secondary, interfaces, route = physical path), the sites homed on it by backhaul type and which have a microwave backup. Site/cell: site profile, aggregation router, backhaul, battery runtime, generator.', parameters: { type: 'object', properties: { node_id: S('e.g. AGG-DEN-04, DEN-150, BLD-047-B') }, required: ['node_id'] } } },
  { type: 'function', function: { name: 'search_alarm_history', description: 'Alarm history of a router or site over the last N days INCLUDING minor warnings and cleared alarms (excludes the per-site storm symptoms). Use it to find precursors (e.g. repeated optical warnings, who acknowledged them).', parameters: { type: 'object', properties: { node_id: S('router or site id'), days: { type: 'number', description: '1-30, default 14' } }, required: ['node_id', 'days'] } } },
  { type: 'function', function: { name: 'get_optics', description: 'Optical / interface counters of a router: per interface per day min & avg Rx power (dBm), max CRC errors, max utilization for 14 days, plus the last 4 hours at 15-minute resolution (oper status, rx, utilization, CRC). Healthy -3..-12 dBm, warning < -18, sensitivity -24, -40 = no light.', parameters: { type: 'object', properties: { node_id: S('e.g. AGG-DEN-04 or CORE-DEN-01') }, required: ['node_id'] } } },
  { type: 'function', function: { name: 'get_cell_kpis', description: 'Daily RAN KPIs for the 3 sectors of a site over 21 days: availability, dropped-call rate, RRC setup success, SINR, max VSWR, uplink interference, peak PRB utilization, calls.', parameters: { type: 'object', properties: { site_or_cell_id: S('e.g. BLD-047 or BLD-047-B') }, required: ['site_or_cell_id'] } } },
  { type: 'function', function: { name: 'get_customer_impact', description: 'Customer impact of a set of sites: subscribers served, critical facilities (hospital, 911 PSAP), enterprise accounts with SLA tier / restore SLA / MRR, and care contacts per day (14 days). Defaults to the incident\'s sites.', parameters: { type: 'object', properties: { site_ids: { type: ['array', 'null'], items: { type: 'string' }, description: 'site ids; null = the incident sites' } } } } },
  { type: 'function', function: { name: 'check_planned_activity', description: 'Planned work and known external activity overlapping the last N hours: maintenance windows (change numbers), local events, 811 third-party excavation notices (with location), weather advisories, utility outages (with ETA).', parameters: { type: 'object', properties: { market: NS('Denver Metro | Boulder | Fort Collins | Colorado Springs | Pueblo, or null for all'), hours_back: { type: 'number', description: '6-168, default 48' } } } } },
  { type: 'function', function: { name: 'find_technicians', description: 'Field technicians with a skill for a market, on-shift first, with drive time (min) to that market and certifications.', parameters: { type: 'object', properties: { skill: { type: 'string', enum: ['fiber_splicing', 'transport', 'rf_tower', 'power', 'microwave', 'generalist'] }, market: { type: 'string', enum: Object.keys(ETA_COL) } }, required: ['skill', 'market'] } } },
  { type: 'function', function: { name: 'ask_noc_runbook', description: 'Ask the Halcyon NOC runbooks (the Genie agent over the runbook documents): priority matrix & notification RB-1, alarm storms RB-2, optical thresholds / fiber cut vs optic / dual-path restoration RB-3, power & generators RB-4, KPI degradation (VSWR, interference, congestion) RB-5, closing as explained RB-6, action catalog A-01..A-10 RB-7. Returns a cited answer.', parameters: { type: 'object', properties: { question: S('one focused runbook question') }, required: ['question'] } } },
  { type: 'function', function: { name: 'submit_triage', description: 'FINAL step. Submit the triage for the NOC engineer to review.', parameters: { type: 'object', properties: {
    verdict: { type: 'string', enum: ['root_cause_identified', 'degradation_confirmed', 'explained', 'needs_investigation'] },
    priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: 'Per runbook RB-1.1 (and RB-4.2 / RB-5.2 raises)' },
    headline: S('One sentence (max 25 words) for the engineer, with the key number.'),
    summary: S('3-5 sentences: what failed, how you know (evidence), who is impacted, fastest path to restore. Exact figures from the tools.'),
    root_cause: { type: ['object', 'null'], properties: { node: S('node / cell / link id'), component: S('e.g. "LNK-0407 primary fiber span" or "sector B antenna jumper"'), cause: S('the cause, one sentence') }, required: ['node', 'component', 'cause'] },
    timeline: { type: 'array', description: 'Chronological, 6 to 12 rows MAXIMUM (earliest first). Collapse repetitive events into one row with counts (e.g. all per-site storm alarms = 1 row; 4 daily optical warnings = 1 row).', items: { type: 'object', properties: {
      ts: S('YYYY-MM-DD HH:MM local time, from tool output'), source: { type: 'string', enum: ['alarm', 'optics', 'kpi', 'topology', 'planned', 'care', 'ticket'] },
      entity: S('node / site / cell / link'), event: S('what happened, with figures'), is_root_cause: { type: 'boolean' } }, required: ['ts', 'source', 'entity', 'event', 'is_root_cause'] } },
    impact: { type: 'object', properties: { sites_down: { type: 'number' }, subscribers: { type: 'number' }, enterprise_accounts: { type: 'array', items: { type: 'string' }, description: 'name (tier, SLA)' }, critical_facilities: { type: 'array', items: { type: 'string' } }, note: S('one line, e.g. care contacts trend or "no customer impact"') }, required: ['sites_down', 'subscribers', 'enterprise_accounts', 'critical_facilities', 'note'] },
    actions: { type: 'array', description: 'Ordered action plan from the runbook catalog (A-10 only for explained incidents).', items: { type: 'object', properties: {
      code: { type: 'string', enum: Object.keys(ACTION_CATALOG), description: 'Catalog (use the code whose meaning matches): ' + Object.entries(ACTION_CATALOG).map(([k, v]) => `${k} = ${v}`).join('; ') }, target: S('exact node / site / location / account'), rationale: S('why, with runbook section') }, required: ['code', 'target', 'rationale'] } },
    dispatch: { type: 'array', description: 'Field dispatches (empty if none): pick real technicians returned by find_technicians.', items: { type: 'object', properties: {
      tech_id: S('FT-…'), name: S('technician name'), skill: S('skill'), destination: S('hut / site / cut location'), task: S('what to do on arrival'), eta_min: { type: ['number', 'null'] } }, required: ['tech_id', 'name', 'skill', 'destination', 'task', 'eta_min'] } },
    notifications: { type: 'array', items: { type: 'string' }, description: 'Required notifications with deadline and runbook section (empty if none).' },
    explanation_evidence: { type: 'array', items: { type: 'string' }, description: 'For explained incidents: each check that explains it (change number, event id, advisory id, clear time). Empty otherwise.' },
    child_alarms_to_suppress: { type: 'number', description: 'Child alarms to suppress under the parent ticket (storms), else 0' },
    estimated_restore: { type: ['string', 'null'], description: 'e.g. "~1 h (backup optic), splice ~5 h" or null' },
    runbook_citations: { type: 'array', items: { type: 'string' }, description: 'Runbook sections relied on, e.g. RB-3.3' },
  }, required: ['verdict', 'priority', 'headline', 'summary', 'root_cause', 'timeline', 'impact', 'actions', 'dispatch', 'notifications', 'explanation_evidence', 'child_alarms_to_suppress', 'estimated_restore', 'runbook_citations'] } } },
];

const SYSTEM = `You are the NOC Copilot of Halcyon Wireless (fictional Mountain-West regional carrier: 500 cell sites in Denver Metro, Boulder, Fort Collins, Colorado Springs and Pueblo; synthetic data). A NOC engineer opened a correlated incident from the queue. Triage it like a senior NOC / transport engineer, then submit. The engineer decides; you assemble evidence and a plan.
Procedure:
1. Call get_incident_context first.
2. Walk to the root cause with the other tools. Alarm storm: get_topology of the parent router (links, routes, who has a backup path), get_optics on the router (and the far-end core router if useful), search_alarm_history on the router for precursors, check_planned_activity for the market (811 excavation on a link route? maintenance?). Site incident: its alarms, topology (battery runtime, generator, backhaul), planned activity (maintenance / weather / utility outage). KPI anomaly: get_cell_kpis for the site (compare the sectors), planned activity (events), care contacts. Batch independent calls in one turn; typically 5-9 evidence calls.
3. get_customer_impact for the affected sites (subscribers, enterprise SLAs, critical facilities).
4. ask_noc_runbook at least once (twice for a P1/P2: priority + notifications, and the restoration / dispatch procedure for what you found).
5. If a dispatch is needed, call find_technicians for the skill(s) and market and dispatch real technicians (name, id, drive time).
6. Call submit_triage exactly once. Use exact timestamps and figures from the tool outputs (keep units: dBm, %, minutes, subscribers); never invent events or technicians. The timeline is a slide, 6-12 rows. Action codes must match their catalog meaning (A-05 = notify enterprise accounts, A-07 = tower crew only for antenna/jumper work). An alarm storm always includes A-01 (one parent ticket, child alarms suppressed) and A-06 for a P1. Explained = a documented reason (change number, event id, weather advisory) AND the alarms cleared / KPIs back to baseline.
Keep any text outside tool calls to one short sentence.`;

export async function triageIncident(
  req: Request,
  inc: IncidentRef,
  opts: { data: DataConfig; genieSpaceId: string; model: string; onStep: (e: StepEvent) => void },
): Promise<Triage> {
  const { onStep, data } = opts;
  const client = new OpenAI({
    baseURL: `${host()}/serving-endpoints`,
    apiKey: 'unused', // replaced per request by authedFetch (viewer OBO token → app SP fallback)
    maxRetries: 2,
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const h = new Headers(init?.headers);
      h.delete('Authorization');
      return authedFetch(req, url, { ...init, headers: Object.fromEntries(h.entries()) } as RequestInit);
    },
  });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Triage incident ${inc.id}: ${inc.title} (${inc.incidentType}, suggested ${inc.suggestedPriority}). Market ${inc.market}. ${inc.sitesAffected} site(s), ${inc.alarmCount} alarm(s) (${inc.activeAlarms} active). Detected ${inc.detectedTs ?? 'n/a'}.${inc.topFactors.length ? ` Anomaly factors: ${inc.topFactors.join('; ')}.` : ''}` },
  ];
  let calls = 0;
  let step = 0;
  onStep({ id: 'plan', label: `Planning the triage (${opts.model})`, status: 'running' });
  for (let turn = 0; turn < 14; turn++) {
    const r = await client.chat.completions.create({ model: opts.model, messages, tools: TOOLS, max_tokens: 6000, temperature: 0.1 });
    if (turn === 0) onStep({ id: 'plan', label: 'Triage plan ready', status: 'done', detail: opts.model });
    const msg = r.choices[0].message;
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
    const fnCalls = (msg.tool_calls ?? []).filter((tc) => tc.type === 'function') as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
    if (!fnCalls.length) {
      messages.push({ role: 'user', content: 'You must now call submit_triage.' });
      continue;
    }
    const submit = fnCalls.find((tc) => tc.function.name === 'submit_triage');
    const evidence = fnCalls.filter((tc) => tc !== submit);
    const results = await Promise.all(evidence.map(async (tc) => {
      calls++;
      const sid = `s${++step}`;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep {} */ }
      const target = [args.node_id, args.site_or_cell_id, args.market, args.skill].filter((x) => typeof x === 'string' && x).join(' · ');
      const label = `${LABEL[tc.function.name] ?? tc.function.name}${target ? ` — ${target}` : ''}`;
      onStep({ id: sid, label, status: 'running', detail: tc.function.name === 'ask_noc_runbook' ? String(args.question ?? '') : undefined });
      try {
        const out = await runTool(tc.function.name, args, inc, data, req, opts.genieSpaceId);
        onStep({ id: sid, label, status: 'done', detail: out.summary });
        return { id: tc.id, content: JSON.stringify(out.result).slice(0, 16000) };
      } catch (e) {
        onStep({ id: sid, label, status: 'error', detail: (e as Error).message.slice(0, 160) });
        return { id: tc.id, content: `tool error: ${(e as Error).message}` };
      }
    }));
    if (submit && evidence.length === 0) {
      let a: Record<string, unknown> = {};
      try { a = JSON.parse(submit.function.arguments || '{}'); } catch { /* keep */ }
      onStep({ id: 'submit', label: 'Assembling root cause, impact, action plan and dispatch', status: 'running' });
      const tr = finalize(a, opts.model, calls);
      onStep({ id: 'submit', label: `Triage ready — ${tr.verdict.replace(/_/g, ' ')}, ${tr.priority}`, status: 'done', detail: `${tr.timeline.length} timeline events · ${tr.actions.length} actions · ${tr.dispatch.length} dispatch(es)` });
      return tr;
    }
    for (const r2 of results) messages.push({ role: 'tool', tool_call_id: r2.id, content: r2.content });
    if (submit) messages.push({ role: 'tool', tool_call_id: submit.id, content: 'Submit again on its own turn, after reading the evidence above.' });
  }
  throw new Error('agent did not submit a triage within 14 turns');
}

function finalize(a: Record<string, unknown>, model: string, calls: number): Triage {
  const arr = <X>(v: unknown): X[] => (Array.isArray(v) ? (v as X[]) : []);
  const timeline = arr<TimelineEvent>(a.timeline).map((t) => ({ ...t, ts: String(t.ts ?? '').slice(0, 16) })).sort((x, y) => x.ts.localeCompare(y.ts));
  const actions: PlanAction[] = arr<{ code: string; target: string; rationale: string }>(a.actions)
    .filter((c) => ACTION_CATALOG[c.code])
    .map((c) => ({ code: c.code, action: ACTION_CATALOG[c.code], target: String(c.target ?? ''), rationale: String(c.rationale ?? '') }));
  const dispatch: Dispatch[] = arr<Dispatch>(a.dispatch).map((d) => ({
    tech_id: String(d.tech_id ?? ''), name: String(d.name ?? ''), skill: String(d.skill ?? ''), destination: String(d.destination ?? ''),
    task: String(d.task ?? ''), eta_min: d.eta_min == null ? null : Number(d.eta_min),
  }));
  const im = (a.impact ?? {}) as Record<string, unknown>;
  const rc = a.root_cause as Record<string, unknown> | null;
  const verdicts = ['root_cause_identified', 'degradation_confirmed', 'explained', 'needs_investigation'];
  return {
    verdict: (verdicts.includes(String(a.verdict)) ? a.verdict : 'needs_investigation') as Triage['verdict'],
    priority: (['P1', 'P2', 'P3', 'P4'].includes(String(a.priority)) ? a.priority : 'P3') as Triage['priority'],
    headline: String(a.headline ?? ''),
    summary: String(a.summary ?? ''),
    root_cause: rc && rc.node ? { node: String(rc.node), component: String(rc.component ?? ''), cause: String(rc.cause ?? '') } : null,
    timeline,
    impact: {
      sites_down: Number(im.sites_down ?? 0), subscribers: Number(im.subscribers ?? 0),
      enterprise_accounts: arr<string>(im.enterprise_accounts).map(String), critical_facilities: arr<string>(im.critical_facilities).map(String), note: String(im.note ?? ''),
    },
    actions,
    dispatch,
    notifications: arr<string>(a.notifications).map(String),
    explanation_evidence: arr<string>(a.explanation_evidence).map(String),
    child_alarms_to_suppress: Number(a.child_alarms_to_suppress ?? 0),
    estimated_restore: a.estimated_restore == null ? null : String(a.estimated_restore),
    runbook_citations: arr<string>(a.runbook_citations).map(String),
    model,
    tool_calls: calls,
    generated_at: new Date().toISOString(),
  };
}
