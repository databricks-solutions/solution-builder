/**
 * The investigation agent — the workbench's "Investigate" button.
 *
 * A real tool-calling loop on the Databricks Foundation Model API (OpenAI-compatible
 * chat completions, default databricks-claude-sonnet-4-5). Every evidence tool is a
 * parameterized, read-only SQL query over the governed telemetry in Unity Catalog
 * (auth, VPN, EDR, DNS, SIEM alerts, UEBA scores, travel approvals, service-desk
 * tickets), run on the SQL warehouse; `ask_ir_playbook` asks the Genie agent, which
 * searches the CSOC incident-response playbook documents (Agent mode). The agent pivots from the
 * lead's entity to the IPs, hosts and domains it finds, then must finish by calling
 * `submit_investigation`: verdict, severity, an ordered incident timeline, the MITRE
 * ATT&CK techniques with evidence, and a containment plan from the playbook's action
 * catalog. The analyst reviews it and opens the incident case (the write-back).
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { authedFetch } from '../lib/auth.js';
import { askDocuments } from '../lib/serving.js';
import { execSql, type DataConfig, type SqlParam } from '../db/sync.js';
import type { ContainmentAction, Investigation, Technique, TimelineEvent } from '../db/schema.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type LeadRef = { id: string; entityType: string; entityId: string; displayName: string; riskScore: number; topFactors: string[] };

export const CONTAINMENT_CATALOG: Record<string, string> = {
  'C-01': 'Disable the user account',
  'C-02': 'Revoke all sessions & refresh tokens (incl. VPN)',
  'C-03': 'Remove attacker-registered MFA device',
  'C-04': 'Force password reset',
  'C-05': 'Isolate host (EDR network containment)',
  'C-06': 'Block source IP range (IdP, VPN, firewall)',
  'C-07': 'Sinkhole / block domain',
  'C-08': 'Preserve evidence (memory image + logs)',
  'C-09': 'Notify (CISO / IRS Safeguards & TIGTA / Fusion Center)',
};

const host = () => (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
const wh = () => process.env.DATABRICKS_WAREHOUSE_ID ?? '';
const RE = {
  user: /^[a-z0-9_]{2,40}$/,
  host: /^[A-Za-z0-9-]{2,30}$/,
  ip: /^[0-9]{1,3}(\.[0-9]{1,3}){0,3}\.?$/,
  domain: /^[a-z0-9][a-z0-9.-]{2,80}$/,
};

function tables(d: DataConfig) {
  return (t: string) => `${d.catalog}.${d.schema}.${t}`;
}

async function q(sql: string, params: Record<string, string> = {}) {
  const p: SqlParam[] = Object.entries(params).map(([name, value]) => ({ name, value, type: 'STRING' }));
  return execSql<Record<string, unknown>>(wh(), sql, p);
}

type ToolOut = { result: unknown; summary: string };

async function runTool(name: string, args: Record<string, unknown>, lead: LeadRef, data: DataConfig, req: Request, genieSpaceId: string): Promise<ToolOut> {
  const T = tables(data);
  const since = (tbl: string, col: string) => `${col} >= (SELECT max(${col}) FROM ${T(tbl)}) - INTERVAL 30 DAYS`;
  const str = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? (args[k] as string).trim() : null);
  const need = (v: string | null, re: RegExp, what: string) => {
    if (!v || !re.test(v)) throw new Error(`invalid ${what}: ${v}`);
    return v;
  };
  switch (name) {
    case 'get_lead_context': {
      const id = lead.entityId;
      if (lead.entityType === 'user') {
        const [profile, ueba, alerts, travel, tickets] = await Promise.all([
          q(`SELECT i.user_id, i.display_name, i.department, i.title, i.office, i.is_privileged, i.remote_work_share, i.home_ip, i.laptop_id, i.hire_date
             FROM ${T('identities')} i WHERE i.user_id = :u`, { u: id }),
          q(`SELECT CAST(score_date AS STRING) d, risk_score, deviating_behaviours, top_factors FROM ${T('ueba_user_daily')}
             WHERE user_id = :u AND score_date > (SELECT date_sub(max(score_date), 14) FROM ${T('ueba_user_daily')}) ORDER BY score_date`, { u: id }),
          q(`SELECT alert_id, CAST(created_ts AS STRING) created, rule_name, severity, src_ip, disposition, analyst, analyst_note
             FROM ${T('siem_alerts')} WHERE entity_user = :u AND ${since('siem_alerts', 'created_ts')} ORDER BY created_ts`, { u: id }),
          q(`SELECT travel_id, destination_city, destination_country, CAST(start_date AS STRING) start_date, CAST(end_date AS STRING) end_date, purpose, approved_by
             FROM ${T('travel_approvals')} WHERE user_id = :u ORDER BY start_date DESC LIMIT 5`, { u: id }),
          q(`SELECT ticket_id, CAST(opened_ts AS STRING) opened, category, summary, status FROM ${T('it_tickets')} WHERE user_id = :u ORDER BY opened_ts DESC LIMIT 5`, { u: id }),
        ]);
        const peak = ueba.reduce((m, r) => Math.max(m, Number(r.risk_score)), 0);
        return {
          result: { lead: { id: lead.id, risk_score: lead.riskScore, top_factors: lead.topFactors }, profile: profile[0], ueba_last_14_days: ueba, siem_alerts_30d: alerts, travel_approvals: travel, it_tickets: tickets },
          summary: `${profile[0]?.display_name ?? id} · ${profile[0]?.title ?? ''} · UEBA peak ${peak} · ${alerts.length} alert(s), ${alerts.filter((a) => a.disposition === 'false_positive').length} closed as FP · ${travel.length} travel approval(s) · ${tickets.length} ticket(s)`,
        };
      }
      const [asset, ueba, alerts] = await Promise.all([
        q(`SELECT a.*, i.display_name AS owner_name FROM ${T('assets')} a LEFT JOIN ${T('identities')} i ON i.user_id = a.owner_user_id WHERE a.host_id = :h`, { h: id }),
        q(`SELECT CAST(score_date AS STRING) d, risk_score, deviating_behaviours, top_factors FROM ${T('ueba_host_daily')}
           WHERE host_id = :h AND score_date > (SELECT date_sub(max(score_date), 14) FROM ${T('ueba_host_daily')}) ORDER BY score_date`, { h: id }),
        q(`SELECT alert_id, CAST(created_ts AS STRING) created, rule_name, severity, disposition, analyst, analyst_note
           FROM ${T('siem_alerts')} WHERE entity_host = :h AND ${since('siem_alerts', 'created_ts')} ORDER BY created_ts`, { h: id }),
      ]);
      return {
        result: { lead: { id: lead.id, risk_score: lead.riskScore, top_factors: lead.topFactors }, asset: asset[0], ueba_last_14_days: ueba, siem_alerts_30d: alerts },
        summary: `${id} · ${asset[0]?.description ?? ''} · owner ${asset[0]?.owner_name ?? 'n/a'} · ${alerts.length} alert(s)`,
      };
    }
    case 'search_sign_ins': {
      const u = str('user_id');
      const ip = str('src_ip_prefix');
      if (u) {
        need(u, RE.user, 'user_id');
        const [byNet, unusual] = await Promise.all([
          q(`SELECT asn_org, geo_country, geo_city, application, result, coalesce(failure_reason, '') failure_reason, count(*) n,
                    CAST(min(event_ts) AS STRING) first_seen, CAST(max(event_ts) AS STRING) last_seen
             FROM ${T('auth_logs')} WHERE user_id = :u AND ${since('auth_logs', 'event_ts')} GROUP BY ALL ORDER BY n DESC LIMIT 25`, { u }),
          q(`SELECT CAST(event_ts AS STRING) ts, src_ip, asn_org, geo_country, application, result, failure_reason, mfa_result, device_id, device_managed, user_agent
             FROM ${T('auth_logs')} WHERE user_id = :u AND ${since('auth_logs', 'event_ts')}
               AND (asn_org NOT IN ('Cascadia State Network', 'Cascade Broadband') OR hour(event_ts) >= 22 OR hour(event_ts) < 6
                    OR mfa_result IN ('denied', 'timeout') OR application = 'Authenticator device registration')
             ORDER BY event_ts LIMIT 40`, { u }),
        ]);
        return { result: { by_network: byNet, unusual_events: unusual }, summary: `${u}: ${byNet.length} network/app combos · ${unusual.length} unusual sign-in event(s)` };
      }
      need(ip, RE.ip, 'src_ip_prefix');
      const pfx = `${ip}%`;
      const [agg, success, perDay] = await Promise.all([
        q(`SELECT count(*) attempts, count(DISTINCT user_id) accounts, count(DISTINCT src_ip) source_ips, collect_set(asn_org) asn_orgs,
                  CAST(min(event_ts) AS STRING) first_seen, CAST(max(event_ts) AS STRING) last_seen,
                  count_if(result = 'success') successes, count_if(failure_reason = 'invalid_password') bad_passwords,
                  count_if(failure_reason LIKE 'mfa%') mfa_prompts
           FROM ${T('auth_logs')} WHERE src_ip LIKE :p`, { p: pfx }),
        q(`SELECT user_id, CAST(event_ts AS STRING) ts, src_ip, application, result, failure_reason, mfa_result
           FROM ${T('auth_logs')} WHERE src_ip LIKE :p AND (result = 'success' OR failure_reason LIKE 'mfa%') ORDER BY event_ts LIMIT 30`, { p: pfx }),
        q(`SELECT max(c) max_failures_per_account_per_day FROM (SELECT count(*) c FROM ${T('auth_logs')}
           WHERE src_ip LIKE :p AND failure_reason = 'invalid_password' GROUP BY user_id, date(event_ts))`, { p: pfx }),
      ]);
      const a = agg[0] ?? {};
      return {
        result: { summary: a, max_failures_per_account_per_day: perDay[0]?.max_failures_per_account_per_day, successes_or_mfa_prompts: success },
        summary: `${ip}*: ${a.attempts} attempts on ${a.accounts} accounts from ${a.source_ips} IPs · ${a.successes} success(es) · max ${perDay[0]?.max_failures_per_account_per_day}/account/day`,
      };
    }
    case 'search_vpn_sessions': {
      const u = need(str('user_id'), RE.user, 'user_id');
      const rows = await q(`SELECT CAST(session_start AS STRING) start, CAST(session_end AS STRING) end_, src_ip, asn_org, geo_country, geo_city,
                                   device_id, device_managed, posture, assigned_ip, round(bytes_out / 1e6) mb_out
                            FROM ${T('vpn_sessions')} WHERE user_id = :u AND ${since('vpn_sessions', 'session_start')}
                            ORDER BY device_managed, session_start DESC LIMIT 30`, { u });
      const unmanaged = rows.filter((r) => String(r.device_managed) === 'false');
      return { result: rows, summary: `${rows.length} session(s) · ${unmanaged.length} from an unmanaged device${unmanaged[0] ? ` (${unmanaged[0].device_id}, ${unmanaged[0].asn_org})` : ''}` };
    }
    case 'search_endpoint_activity': {
      const u = str('user_id');
      const h = str('host_id');
      if (u) need(u, RE.user, 'user_id');
      if (h) need(h, RE.host, 'host_id');
      if (!u && !h) throw new Error('give user_id or host_id');
      const where = [u ? 'user_id = :u' : null, h ? '(host_id = :h OR src_host = :h)' : null].filter(Boolean).join(' AND ');
      const p: Record<string, string> = {};
      if (u) p.u = u;
      if (h) p.h = h;
      const [rdp, procs, files] = await Promise.all([
        q(`SELECT CAST(event_ts AS STRING) ts, user_id, host_id, src_ip, src_host FROM ${T('endpoint_events')}
           WHERE ${where} AND event_type = 'logon' AND logon_type = 10 AND ${since('endpoint_events', 'event_ts')} ORDER BY event_ts DESC LIMIT 25`, p),
        q(`SELECT CAST(event_ts AS STRING) ts, user_id, host_id, process_name, command_line, parent_process FROM ${T('endpoint_events')}
           WHERE ${where} AND event_type = 'process_start' AND command_line IS NOT NULL AND ${since('endpoint_events', 'event_ts')} ORDER BY event_ts LIMIT 30`, p),
        q(`SELECT date(event_ts) d, user_id, event_type, host_id, src_host, regexp_replace(file_path, 'Batch-[0-9]+', 'Batch-*') path,
                  sum(file_count) files, round(sum(coalesce(bytes, 0)) / 1e9, 2) gb, CAST(min(event_ts) AS STRING) first_ts, CAST(max(event_ts) AS STRING) last_ts
           FROM ${T('endpoint_events')} WHERE ${where} AND event_type IN ('file_read', 'file_write') AND ${since('endpoint_events', 'event_ts')}
           GROUP BY ALL ORDER BY files DESC LIMIT 15`, p),
      ]);
      return {
        result: { rdp_logons: rdp, commands: procs, file_activity: files },
        summary: `${rdp.length} RDP logon(s) · ${procs.length} command(s) · ${files.reduce((s, f) => s + Number(f.files ?? 0), 0).toLocaleString('en-US')} files touched`,
      };
    }
    case 'search_dns': {
      const h = str('host_id');
      const d = str('domain');
      if (h) {
        need(h, RE.host, 'host_id');
        const rows = await q(`SELECT regexp_extract(query, '([a-z0-9-]+[.][a-z]+)$', 1) domain, count(*) lookups, count_if(query_type = 'TXT') txt,
                                     round(avg(label_entropy), 2) avg_entropy, max(length(split(query, '[.]')[0])) max_label_len,
                                     CAST(min(event_ts) AS STRING) first_seen, CAST(max(event_ts) AS STRING) last_seen
                              FROM ${T('dns_logs')} WHERE host_id = :h AND ${since('dns_logs', 'event_ts')}
                              GROUP BY 1 ORDER BY avg_entropy DESC, lookups DESC LIMIT 12`, { h });
        return { result: rows, summary: `${rows.length} domains · top by entropy: ${rows[0]?.domain} (${Number(rows[0]?.lookups ?? 0).toLocaleString('en-US')} lookups, ${Number(rows[0]?.txt ?? 0).toLocaleString('en-US')} TXT)` };
      }
      need(d, RE.domain, 'domain');
      const [hosts, cadence, samples] = await Promise.all([
        q(`SELECT host_id, count(*) lookups, count_if(query_type = 'TXT') txt, CAST(min(event_ts) AS STRING) first_seen, CAST(max(event_ts) AS STRING) last_seen
           FROM ${T('dns_logs')} WHERE query LIKE :d GROUP BY 1 ORDER BY lookups DESC LIMIT 10`, { d: `%${d}` }),
        q(`SELECT date(event_ts) day, query_type, count(*) lookups, round(avg(label_entropy), 2) avg_entropy,
                  CAST(min(event_ts) AS STRING) first_ts, CAST(max(event_ts) AS STRING) last_ts
           FROM ${T('dns_logs')} WHERE query LIKE :d GROUP BY ALL ORDER BY day, query_type`, { d: `%${d}` }),
        q(`SELECT CAST(event_ts AS STRING) ts, query, query_type FROM ${T('dns_logs')} WHERE query LIKE :d AND query_type = 'A' ORDER BY event_ts LIMIT 4`, { d: `%${d}` }),
      ]);
      return { result: { hosts_resolving: hosts, per_day: cadence, first_lookups: samples }, summary: `${d}: resolved by ${hosts.length} host(s) · ${cadence.reduce((s, c) => s + Number(c.lookups), 0).toLocaleString('en-US')} lookups` };
    }
    case 'ask_ir_playbook': {
      if (!genieSpaceId) return { result: 'Genie agent (IR playbook) not configured', summary: 'playbook unavailable' };
      const question = String(args.question ?? '').slice(0, 600);
      const r = await askDocuments(req, genieSpaceId, `Answer from the CSOC incident-response playbook documents only, citing the section: ${question}`);
      return { result: { answer: r.answer, sources: r.sources }, summary: `Playbook: “${question.slice(0, 80)}${question.length > 80 ? '…' : ''}”` };
    }
    default:
      return { result: `unknown tool ${name}`, summary: `unknown tool ${name}` };
  }
}

const LABEL: Record<string, string> = {
  get_lead_context: 'Reading the lead: UEBA trend, alerts, travel, tickets',
  search_sign_ins: 'Pivoting into identity-provider sign-ins',
  search_vpn_sessions: 'Pulling VPN sessions',
  search_endpoint_activity: 'Querying EDR telemetry (RDP, commands, file access)',
  search_dns: 'Hunting DNS resolver logs',
  ask_ir_playbook: 'Consulting the IR playbook (Genie agent)',
};

const S = (description: string) => ({ type: 'string', description });
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: 'function', function: { name: 'get_lead_context', description: 'The lead: entity profile (identity or asset), UEBA daily risk + top factors for the last 14 days, SIEM alerts on the entity in the last 30 days (with tier-1 dispositions and notes), approved travel and IT service-desk tickets.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'search_sign_ins', description: 'Identity-provider sign-in log, last 30 days. EITHER user_id (per-network summary + every unusual event: unfamiliar ASN, off-hours, MFA denials, device registration) OR src_ip_prefix like "203.0.113." (who else that range targeted: attempts, accounts, successes, max failures per account per day — spray scoping).', parameters: { type: 'object', properties: { user_id: { ...S('user id, e.g. dmorales'), type: ['string', 'null'] }, src_ip_prefix: { ...S('IP or prefix, e.g. 203.0.113.'), type: ['string', 'null'] } } } } },
  { type: 'function', function: { name: 'search_vpn_sessions', description: 'Remote-access VPN sessions for a user, last 30 days (source IP/ASN/geo, device, managed flag, EDR posture, assigned internal IP, MB out). Unmanaged sessions listed first.', parameters: { type: 'object', properties: { user_id: S('user id') }, required: ['user_id'] } } },
  { type: 'function', function: { name: 'search_endpoint_activity', description: 'EDR telemetry, last 30 days, for a user_id and/or host_id: RDP logons (logon type 10), command lines executed (discovery, archiving, dropped binaries), file reads/writes aggregated by day and share path with file counts.', parameters: { type: 'object', properties: { user_id: { ...S('user id'), type: ['string', 'null'] }, host_id: { ...S('host id, e.g. WS-FIN-022'), type: ['string', 'null'] } } } } },
  { type: 'function', function: { name: 'search_dns', description: 'DNS resolver logs, last 30 days. EITHER host_id (domains it resolved ranked by label entropy, TXT counts, first/last seen) OR domain (which hosts resolve it, per-day lookups by query type, first lookups — for beacon cadence and tunneling volume).', parameters: { type: 'object', properties: { host_id: { ...S('host id'), type: ['string', 'null'] }, domain: { ...S('parent domain, e.g. example.com'), type: ['string', 'null'] } } } } },
  { type: 'function', function: { name: 'ask_ir_playbook', description: 'Ask the CSOC incident-response playbook (the Genie agent over the playbook documents): severity matrix PB-1.1, notification deadlines PB-1.2 (FTI → IRS Safeguards/TIGTA 24h), identity compromise PB-2.x, lateral movement PB-4.x, exfiltration PB-5.x, ATT&CK mapping and containment catalog PB-7. Returns a cited answer.', parameters: { type: 'object', properties: { question: S('one focused playbook question') }, required: ['question'] } } },
  { type: 'function', function: { name: 'submit_investigation', description: 'FINAL step. Submit the investigation for the analyst to review.', parameters: { type: 'object', properties: {
    verdict: { type: 'string', enum: ['confirmed_compromise', 'suspicious', 'benign'] },
    severity: { type: 'string', enum: ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'], description: 'Per playbook PB-1.1' },
    headline: S('One sentence (max 25 words) for the analyst, with the key number.'),
    summary: S('3-5 sentences: what happened, how it was found, what is at risk. Exact figures from the tools.'),
    timeline: { type: 'array', description: 'Chronological, 8 to 14 rows MAXIMUM (earliest first). Collapse repetitive events into ONE row with counts and first-last times (e.g. the whole spray = 1 row, 5 MFA pushes = 1 row, 5 VPN nights = 1 row, all file-read batches = 1 row).', items: { type: 'object', properties: {
      ts: S('YYYY-MM-DD HH:MM agency local time, from the tool output'), source: { type: 'string', enum: ['auth', 'vpn', 'endpoint', 'dns', 'siem', 'ueba', 'ticket'] },
      entity: S('user id, host id or IP'), event: S('what happened, with figures'), technique_id: { type: ['string', 'null'], description: 'ATT&CK id evidenced by this event, or null' } }, required: ['ts', 'source', 'entity', 'event', 'technique_id'] } },
    techniques: { type: 'array', items: { type: 'object', properties: { id: S('ATT&CK technique id, e.g. T1110.003'), evidence: S('the evidence, one line') }, required: ['id', 'evidence'] } },
    containment: { type: 'array', description: 'Ordered containment plan from the playbook catalog (empty for benign).', items: { type: 'object', properties: {
      code: { type: 'string', enum: Object.keys(CONTAINMENT_CATALOG) }, target: S('exact account / host / IP range / domain'), rationale: S('why, with playbook section') }, required: ['code', 'target', 'rationale'] } },
    notifications: { type: 'array', items: { type: 'string' }, description: 'Required notifications with deadline and playbook section (empty if none).' },
    benign_evidence: { type: 'array', items: { type: 'string' }, description: 'For benign/suspicious verdicts: each check that explains the anomaly (travel id, ticket id, managed device…). Empty otherwise.' },
    records_at_risk: { type: ['number', 'null'], description: 'Taxpayer files / records accessed by the attacker, if any' },
    playbook_citations: { type: 'array', items: { type: 'string' }, description: 'Playbook sections relied on, e.g. PB-2.2' },
  }, required: ['verdict', 'severity', 'headline', 'summary', 'timeline', 'techniques', 'containment', 'notifications', 'benign_evidence', 'records_at_risk', 'playbook_citations'] } } },
];

const SYSTEM = `You are the Threat Hunting Copilot for the Cascadia Security Operations Center (CSOC), which defends the Cascadia Department of Revenue (fictional state agency; synthetic data — IPs are documentation ranges, attacker domains end in .example).
A tier-2 analyst opened a UEBA lead. Investigate it like a senior threat hunter, then submit. The analyst decides; you assemble evidence.
Procedure:
1. Call get_lead_context first.
2. Pivot across the logs with the other tools: sign-ins for the user, then any unfamiliar source IP prefix (who else did it target? did anything succeed?); VPN sessions; endpoint activity for the user AND for every host the user reached that it does not own; DNS for those hosts, then any suspicious domain (cadence, TXT volume, which hosts). Batch independent calls in one turn. Stop pivoting when the story is complete (typically 6-10 evidence calls).
3. Call ask_ir_playbook at least once (twice for a compromise: severity + notifications, and the containment steps for the observed techniques). For a benign-looking lead, ask what evidence the playbook requires to close it.
4. Call submit_investigation exactly once. Use exact timestamps and figures from tool outputs (keep units: files, GB, queries); never invent events. The timeline is a slide, not a log dump: 8-14 rows. For a compromise include the whole chain (initial access → persistence → lateral movement → discovery → collection → C2 / exfiltration) and a containment plan in playbook order. Benign = a documented explanation (approved travel, ticket, managed device, MFA first try, business hours) for every anomaly.
Keep any text outside tool calls to one short sentence.`;

export async function investigateLead(
  req: Request,
  lead: LeadRef,
  opts: { data: DataConfig; genieSpaceId: string; model: string; onStep: (e: StepEvent) => void },
): Promise<Investigation> {
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
    { role: 'user', content: `Investigate lead ${lead.id}: ${lead.entityType} ${lead.entityId} (${lead.displayName}), UEBA risk ${lead.riskScore}. Top factors: ${lead.topFactors.join('; ') || 'n/a'}.` },
  ];
  let calls = 0;
  let step = 0;
  onStep({ id: 'plan', label: `Planning the investigation (${opts.model})`, status: 'running' });
  for (let turn = 0; turn < 14; turn++) {
    const r = await client.chat.completions.create({ model: opts.model, messages, tools: TOOLS, max_tokens: 6000, temperature: 0.1 });
    if (turn === 0) onStep({ id: 'plan', label: 'Investigation plan ready', status: 'done', detail: opts.model });
    const msg = r.choices[0].message;
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
    const fnCalls = (msg.tool_calls ?? []).filter((tc) => tc.type === 'function') as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
    if (!fnCalls.length) {
      messages.push({ role: 'user', content: 'You must now call submit_investigation.' });
      continue;
    }
    const submit = fnCalls.find((tc) => tc.function.name === 'submit_investigation');
    const evidence = fnCalls.filter((tc) => tc !== submit);
    const results = await Promise.all(evidence.map(async (tc) => {
      calls++;
      const sid = `s${++step}`;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep {} */ }
      const target = [args.user_id, args.host_id, args.src_ip_prefix, args.domain].filter((x) => typeof x === 'string' && x).join(' · ');
      const label = `${LABEL[tc.function.name] ?? tc.function.name}${target ? ` — ${target}` : ''}`;
      onStep({ id: sid, label, status: 'running', detail: tc.function.name === 'ask_ir_playbook' ? String(args.question ?? '') : undefined });
      try {
        const out = await runTool(tc.function.name, args, lead, data, req, opts.genieSpaceId);
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
      onStep({ id: 'submit', label: 'Assembling timeline, ATT&CK mapping and containment plan', status: 'running' });
      const inv = await finalize(a, data, opts.model, calls);
      onStep({ id: 'submit', label: `Investigation ready — ${inv.verdict.replace('_', ' ')}, ${inv.severity}`, status: 'done', detail: `${inv.timeline.length} timeline events · ${inv.techniques.length} techniques · ${inv.containment.length} containment actions` });
      return inv;
    }
    for (const r2 of results) messages.push({ role: 'tool', tool_call_id: r2.id, content: r2.content });
    if (submit) messages.push({ role: 'tool', tool_call_id: submit.id, content: 'Submit again on its own turn, after reading the evidence above.' });
  }
  throw new Error('agent did not submit an investigation within 14 turns');
}

/** Names for common ATT&CK techniques the agent may cite that are not in the playbook table. */
const EXTRA_TECHNIQUES: Record<string, [string, string]> = {
  T1083: ['File and Directory Discovery', 'Discovery'], T1105: ['Ingress Tool Transfer', 'Command and Control'],
  'T1074.001': ['Data Staged: Local Data Staging', 'Collection'], 'T1070.004': ['Indicator Removal: File Deletion', 'Defense Evasion'],
  T1135: ['Network Share Discovery', 'Discovery'], T1018: ['Remote System Discovery', 'Discovery'], T1110: ['Brute Force', 'Credential Access'],
  T1059: ['Command and Scripting Interpreter', 'Execution'], 'T1059.003': ['Command and Scripting Interpreter: Windows Command Shell', 'Execution'],
  T1036: ['Masquerading', 'Defense Evasion'], T1071: ['Application Layer Protocol', 'Command and Control'], T1048: ['Exfiltration Over Alternative Protocol', 'Exfiltration'],
  T1560: ['Archive Collected Data', 'Collection'], T1021: ['Remote Services', 'Lateral Movement'], 'T1078.002': ['Valid Accounts: Domain Accounts', 'Defense Evasion'],
  T1098: ['Account Manipulation', 'Persistence'], T1119: ['Automated Collection', 'Collection'], T1005: ['Data from Local System', 'Collection'],
  T1572: ['Protocol Tunneling', 'Command and Control'], T1568: ['Dynamic Resolution', 'Command and Control'],
};

let techCache: Promise<Record<string, Record<string, unknown>>> | null = null;
function techniques(data: DataConfig) {
  if (!techCache) {
    techCache = q(`SELECT * FROM ${data.catalog}.${data.schema}.attack_techniques`).then((rows) => Object.fromEntries(rows.map((r) => [String(r.technique_id), r])));
    techCache.catch(() => { techCache = null; });
  }
  return techCache;
}

async function finalize(a: Record<string, unknown>, data: DataConfig, model: string, calls: number): Promise<Investigation> {
  const ref = await techniques(data).catch(() => ({} as Record<string, Record<string, unknown>>));
  const arr = <X>(v: unknown): X[] => (Array.isArray(v) ? (v as X[]) : []);
  const tech: Technique[] = arr<{ id: string; evidence: string }>(a.techniques).map((t) => {
    const r = ref[t.id] ?? {};
    const x = EXTRA_TECHNIQUES[t.id];
    return { id: t.id, evidence: String(t.evidence ?? ''), name: String(r.technique_name ?? x?.[0] ?? t.id), tactic: String(r.tactic ?? x?.[1] ?? '—'),
             coverage: (r.detection_coverage as string) ?? null, playbook_section: (r.playbook_section as string) ?? null };
  });
  const timeline = arr<TimelineEvent>(a.timeline).map((t) => ({ ...t, ts: String(t.ts ?? '').slice(0, 16) })).sort((x, y) => x.ts.localeCompare(y.ts));
  const containment: ContainmentAction[] = arr<{ code: string; target: string; rationale: string }>(a.containment)
    .filter((c) => CONTAINMENT_CATALOG[c.code])
    .map((c) => ({ code: c.code, action: CONTAINMENT_CATALOG[c.code], target: String(c.target ?? ''), rationale: String(c.rationale ?? '') }));
  const verdict = (['confirmed_compromise', 'suspicious', 'benign'].includes(String(a.verdict)) ? a.verdict : 'suspicious') as Investigation['verdict'];
  return {
    verdict,
    severity: (String(a.severity ?? 'SEV-3') as Investigation['severity']),
    headline: String(a.headline ?? ''),
    summary: String(a.summary ?? ''),
    timeline,
    techniques: tech,
    containment,
    notifications: arr<string>(a.notifications).map(String),
    benign_evidence: arr<string>(a.benign_evidence).map(String),
    records_at_risk: a.records_at_risk == null ? null : Number(a.records_at_risk),
    playbook_citations: arr<string>(a.playbook_citations).map(String),
    model,
    tool_calls: calls,
    generated_at: new Date().toISOString(),
  };
}
