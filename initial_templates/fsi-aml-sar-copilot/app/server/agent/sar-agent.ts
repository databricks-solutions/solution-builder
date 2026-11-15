/**
 * SAR drafting agent — the "copilot" step of the investigator console.
 *
 * A real tool-calling loop on the Databricks Foundation Model API
 * (OpenAI-compatible /serving-endpoints chat completions, default model
 * databricks-claude-sonnet-4-5). Every tool is a governed SQL query over the
 * case data in Unity Catalog, plus `search_aml_policy`, which asks the demo's
 * Genie agent (Agent mode) — it searches the bank's AML policy library volume.
 * The agent must finish by calling `submit_sar_draft` — a FinCEN-style SAR
 * narrative (5 Ws + how), a recommendation and the red flags with policy cites.
 */
import OpenAI from 'openai';
import { query, T, appHeaders, host, type Row } from '../lib/sql.js';
import { askGenieAgent } from '../lib/genie-agent.js';

type Emit = (ev: Record<string, unknown>) => void;
export type SarDraft = {
  narrative: string;
  recommendation: string;
  rationale: string;
  red_flags: string[];
  amount_involved: number;
  model: string;
  tool_calls: number;
};

const MODEL = () => process.env.AGENT_MODEL || 'databricks-claude-sonnet-4-5';
const money = (n: unknown) => `$${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export async function getCaseContext(alertId: string): Promise<Record<string, unknown> | null> {
  const p = [{ name: 'a', value: alertId }];
  const [alert] = await query(
    `SELECT a.alert_id, a.customer_id, a.account_id, a.scenario, a.alert_ts, a.rule_score, a.status, a.triggered_amount,
            a.triggered_txn_count, a.lookback_start, a.lookback_end, s.ml_risk_score, q.ml_rank, q.rules_rank, q.reason_codes,
            n.cluster_id, n.cluster_size, f.sub_ctr_cnt_30d, f.cash_branches_30d, f.pass_through_ratio, f.hr_wire_out_30d,
            f.cash_in_30d, f.cash_vs_expected, f.network_parties_alerted_30d, f.account_age_days
     FROM ${T('alerts')} a JOIN ${T('gold_alert_scores')} s USING (alert_id) JOIN ${T('gold_alert_features')} f USING (alert_id)
     JOIN ${T('gold_customer_network')} n ON n.customer_id = a.customer_id
     LEFT JOIN ${T('gold_alert_queue')} q USING (alert_id)
     WHERE a.alert_id = :a`, p);
  if (!alert) return null;
  const c = [{ name: 'c', value: String(alert.cluster_id) }, { name: 'cust', value: String(alert.customer_id) }];
  const multi = Number(alert.cluster_size) >= 3;
  const [[customer], [network], network_alerts] = await Promise.all([
    query(`SELECT * FROM ${T('customers')} WHERE customer_id = :cust`, c),
    multi ? query(`SELECT * FROM ${T('gold_network_clusters')} WHERE cluster_id = :c`, c) : Promise.resolve([null]),
    multi
      ? query(`SELECT alert_id, customer_name, scenario, rule_score, ml_risk_score, rules_rank, ml_rank FROM ${T('gold_alert_queue')} WHERE cluster_id = :c ORDER BY ml_rank`, c)
      : query(`SELECT alert_id, customer_name, scenario, rule_score, ml_risk_score, rules_rank, ml_rank FROM ${T('gold_alert_queue')} WHERE alert_id = :a`, p),
  ]);
  return { alert, customer, network, network_alerts };
}

// ── tools ─────────────────────────────────────────────────────────────────
function scopeSql(ctx: Record<string, any>) {
  return Number(ctx.alert.cluster_size) >= 3
    ? { where: `customer_id IN (SELECT customer_id FROM ${T('gold_customer_network')} WHERE cluster_id = :c)`, params: [{ name: 'c', value: String(ctx.alert.cluster_id) }] }
    : { where: `customer_id = :c`, params: [{ name: 'c', value: String(ctx.alert.customer_id) }] };
}

async function toolCall(name: string, args: any, ctx: Record<string, any>): Promise<{ result: unknown; summary: string }> {
  const s = scopeSql(ctx);
  const since = `(SELECT max(txn_ts) FROM ${T('transactions')}) - INTERVAL 90 DAYS`;
  switch (name) {
    case 'get_case_overview': {
      const a = ctx.alert, cu = ctx.customer;
      return {
        result: { alert: a, subject: cu, network_summary: ctx.network, alerts_in_case: ctx.network_alerts },
        summary: `${cu.customer_name} · ${a.scenario} · ML ${a.ml_risk_score} vs rules ${a.rule_score} · ${ctx.network_alerts.length} open alert(s) in case`,
      };
    }
    case 'get_cash_activity': {
      const rows = await query(`SELECT c.customer_name, c.customer_type, c.occupation_or_industry, c.kyc_risk_rating, c.expected_monthly_cash,
            count(*) AS cash_deposits, sum(CASE WHEN t.cash_below_ctr THEN 1 ELSE 0 END) AS deposits_8k_to_10k,
            round(sum(t.amount), 2) AS total_cash, round(min(t.amount), 2) AS min_amount, round(max(t.amount), 2) AS max_amount,
            count(DISTINCT t.branch_id) AS branches, concat_ws(', ', sort_array(collect_set(t.branch_id))) AS branch_ids,
            date(min(t.txn_ts)) AS first_date, date(max(t.txn_ts)) AS last_date
          FROM ${T('transactions')} t JOIN ${T('customers')} c USING (customer_id)
          WHERE t.${s.where} AND t.txn_type = 'cash_deposit' AND t.txn_ts >= ${since}
          GROUP BY ALL ORDER BY total_cash DESC`, s.params);
      const n = rows.reduce((x, r) => x + Number(r.deposits_8k_to_10k), 0);
      const tot = rows.reduce((x, r) => x + Number(r.total_cash), 0);
      return { result: rows, summary: `${n} cash deposits of $8K–$10K across ${rows.length} part${rows.length === 1 ? 'y' : 'ies'} · ${money(tot)} cash in 90 days` };
    }
    case 'get_fund_flows': {
      const [internal, wires] = await Promise.all([
        query(`SELECT c.customer_name AS from_party, t.counterparty_name AS to_party, count(*) AS transfers, round(sum(t.amount), 2) AS total,
                      date(min(t.txn_ts)) AS first_date, date(max(t.txn_ts)) AS last_date, first(t.memo) AS memo
               FROM ${T('transactions')} t JOIN ${T('customers')} c USING (customer_id)
               WHERE t.${s.where} AND t.txn_type IN ('internal_out', 'p2p_out') AND t.counterparty_customer_id IS NOT NULL AND t.txn_ts >= ${since}
               GROUP BY ALL ORDER BY total DESC`, s.params),
        query(`SELECT c.customer_name AS originator, t.counterparty_name AS beneficiary, t.counterparty_country AS country, t.high_risk_country,
                      count(*) AS wires, round(sum(t.amount), 2) AS total, concat_ws(', ', collect_list(date_format(t.txn_ts, 'MM/dd/yyyy'))) AS dates, first(t.memo) AS memo
               FROM ${T('transactions')} t JOIN ${T('customers')} c USING (customer_id)
               WHERE t.${s.where} AND t.txn_type = 'wire_out' AND t.txn_ts >= ${since}
               GROUP BY ALL ORDER BY total DESC LIMIT 15`, s.params),
      ]);
      const hr = wires.filter((w) => w.high_risk_country).reduce((x, w) => x + Number(w.total), 0);
      return { result: { transfers_between_parties: internal, outbound_wires: wires }, summary: `${internal.length} transfer path(s) between parties · ${money(hr)} wired to high-risk jurisdictions` };
    }
    case 'get_linked_parties': {
      const rows = await query(`SELECT a.attr_type, a.attr_value, collect_list(c.customer_name) AS parties, count(*) AS n
            FROM ${T('customer_attributes')} a JOIN ${T('customers')} c USING (customer_id)
            WHERE a.${s.where} GROUP BY ALL HAVING count(*) > 1 ORDER BY n DESC`, s.params);
      const members = await query(`SELECT customer_name, customer_type, occupation_or_industry, onboarding_date, kyc_risk_rating, address
            FROM ${T('customers')} WHERE ${s.where}`, s.params);
      return { result: { shared_identifiers: rows, parties: members }, summary: `${members.length} parties · ${rows.length} shared identifier(s) (address / phone / device)` };
    }
    case 'get_alert_history': {
      const rows = await query(`SELECT a.alert_id, c.customer_name, a.scenario, date(a.alert_ts) AS alert_date, a.rule_score, a.status, a.assigned_analyst
            FROM ${T('alerts')} a JOIN ${T('customers')} c USING (customer_id)
            WHERE a.${s.where} AND a.status IN ('closed_no_sar', 'sar_filed') ORDER BY a.alert_ts DESC LIMIT 25`, s.params);
      const closed = rows.filter((r) => r.status === 'closed_no_sar').length;
      return { result: rows, summary: `${rows.length} prior alert(s) — ${closed} closed as "no SAR" in isolation` };
    }
    case 'search_aml_policy': {
      // Policy questions go to the documents only; the case numbers come from the other tools.
      const { text } = await askGenieAgent(`Answer from the AML policy documents only, citing document and section: ${String(args.question)}`);
      return { result: text, summary: `Policy: “${String(args.question).slice(0, 70)}”` };
    }
    default:
      return { result: `unknown tool ${name}`, summary: `unknown tool ${name}` };
  }
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: 'function', function: { name: 'get_case_overview', description: 'Alert, subject KYC profile, ML risk score vs rules score, reason codes, network summary and every open alert that belongs to this case.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_cash_activity', description: 'Per-party cash deposits over the last 90 days: count, $8K-$10K (just under CTR) deposits, totals, min/max, branches, date range, versus the KYC expected cash profile.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_fund_flows', description: 'Transfers between the case parties and outbound wires (beneficiary, country, high-risk flag, dates, totals) over the last 90 days.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_linked_parties', description: 'Entity resolution: all parties in the case and the identifiers they share (address/suite, phone number, online-banking device).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_alert_history', description: 'Prior dispositioned alerts on the case parties (incl. alerts closed as no SAR).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'search_aml_policy', description: "Search the bank's AML policy library through the Genie agent (BSA/AML program policy, structuring red flags RF-03, SAR narrative standard SAR-04, high-risk jurisdiction policy HRJ-02, disposition QA AD-01).", parameters: { type: 'object', properties: { question: { type: 'string', description: 'A focused policy question' } }, required: ['question'] } } },
  { type: 'function', function: { name: 'submit_sar_draft', description: 'FINAL step. Submit the SAR narrative draft and your recommendation for the human investigator.', parameters: { type: 'object', properties: {
    narrative: { type: 'string', description: 'FinCEN SAR Part V narrative in plain text with section headings (Introduction, Subjects, Chronology of activity, Red flags, Bank actions, Conclusion). Exact amounts (USD with commas), dates MM/DD/YYYY, subject names.' },
    recommendation: { type: 'string', enum: ['file_sar', 'close_no_sar', 'escalate'] },
    rationale: { type: 'string', description: '2-3 sentence decision rationale for the audit trail, citing policy sections.' },
    red_flags: { type: 'array', items: { type: 'string' }, description: 'Each red flag with its evidence and policy cite, e.g. "133 cash deposits $8,200-$9,900 across 7 branches (RF-03 #1, #2)".' },
    amount_involved: { type: 'number', description: 'Total suspicious amount in USD' },
  }, required: ['narrative', 'recommendation', 'rationale', 'red_flags', 'amount_involved'] } } },
];

const SYSTEM = `You are the SAR drafting copilot for Northwind Federal Bank's Financial Intelligence Unit (fictional bank).
A human investigator will review, edit and decide — you assemble evidence and draft.
Procedure:
1. Call get_case_overview, then gather evidence with get_cash_activity, get_fund_flows, get_linked_parties and get_alert_history (call them all).
2. Call search_aml_policy at least twice: once for the SAR filing deadline / approval rules that apply to this case, once for the red flags that match the observed behaviour.
3. Decide: file_sar when the facts meet the SAR standard; escalate when policy requires BSA Officer approval (e.g. network of 3+ subjects, high-risk wires > $100K) — you may recommend escalate or file_sar and state the approval requirement; close_no_sar only when the activity is explained by the customer profile.
4. Finish by calling submit_sar_draft exactly once. The narrative must follow the SAR-04 structure, be factual and chronological, use exact figures from the tools, never mention model or rule scores, and never invent facts not returned by the tools.
Keep any text outside tool calls very short.`;

export async function runSarAgent(alertId: string, emit: Emit): Promise<SarDraft> {
  const ctx = (await getCaseContext(alertId)) as Record<string, any> | null;
  if (!ctx) throw new Error(`alert ${alertId} not found`);
  const auth = (await appHeaders()).get('Authorization') ?? '';
  const client = new OpenAI({ baseURL: `${host()}/serving-endpoints`, apiKey: auth.replace(/^Bearer\s+/i, '') });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Assemble the evidence and draft the SAR for alert ${alertId} (subject: ${ctx.customer.customer_name}).` },
  ];
  let calls = 0;
  for (let turn = 0; turn < 12; turn++) {
    emit({ type: 'thinking', turn });
    const r = await client.chat.completions.create({ model: MODEL(), messages, tools: TOOLS, max_tokens: 8000, temperature: 0.1 });
    const msg = r.choices[0].message;
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls } as any);
    if (msg.content && msg.content.trim()) emit({ type: 'note', text: msg.content.trim().slice(0, 600) });
    if (!msg.tool_calls?.length) {
      messages.push({ role: 'user', content: 'You must now call submit_sar_draft.' });
      continue;
    }
    const fnCalls = msg.tool_calls.filter((tc) => tc.type === 'function') as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
    const submit = fnCalls.find((tc) => tc.function.name === 'submit_sar_draft');
    // run the evidence tools of this turn in parallel (the model often batches 4-5 of them)
    const results = await Promise.all(fnCalls.filter((tc) => tc !== submit).map(async (tc) => {
      calls++;
      let args: any = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep {} */ }
      emit({ type: 'step', tool: tc.function.name, status: 'running', args });
      const t0 = Date.now();
      let out: { result: unknown; summary: string };
      try {
        out = await toolCall(tc.function.name, args, ctx);
      } catch (e) {
        out = { result: `tool error: ${(e as Error).message}`, summary: `error: ${(e as Error).message.slice(0, 120)}` };
      }
      emit({ type: 'step', tool: tc.function.name, status: 'done', args, summary: out.summary, ms: Date.now() - t0,
             preview: typeof out.result === 'string' ? out.result.slice(0, 700) : undefined });
      return { id: tc.id, content: JSON.stringify(out.result).slice(0, 14000) };
    }));
    if (submit) {
      let args: any = null;
      try { args = JSON.parse(submit.function.arguments || '{}'); } catch { args = null; }
      if (!args || typeof args.narrative !== 'string' || !args.narrative.trim()) {
        // Truncated or empty submission: ask the model to resubmit rather than filing an empty draft.
        for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
        messages.push({ role: 'tool', tool_call_id: submit.id, content: 'error: submit_sar_draft arguments were incomplete or not valid JSON. Call submit_sar_draft again with the full narrative, keeping it concise.' });
        emit({ type: 'note', text: 'The draft came back incomplete; asking the agent to resubmit.' });
        continue;
      }
      calls++;
      emit({ type: 'step', tool: 'submit_sar_draft', status: 'done', summary: `Draft ready — recommendation: ${args.recommendation}` });
      return {
        narrative: String(args.narrative ?? ''),
        recommendation: String(args.recommendation ?? 'escalate'),
        rationale: String(args.rationale ?? ''),
        red_flags: Array.isArray(args.red_flags) ? args.red_flags.map(String) : [],
        amount_involved: Number(args.amount_involved ?? 0),
        model: MODEL(),
        tool_calls: calls,
      };
    }
    for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  throw new Error('agent did not submit a draft within 12 turns');
}

export type { Row };
