import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { budget, interventions, segments, type ChatLine, type EvidenceTile, type TopPlayer } from './schema.js';

/**
 * One-shot Delta → Lakebase sync (Delta is the source of truth, Lakebase the OLTP mirror
 * the console and the agent write to). Pulls the at-risk segments (gold_risk_segments) with
 * their average SHAP shares, top players, driver-specific evidence and AI-labelled chat
 * samples, the intervention catalog + its holdout-measured lift, and the budget. Runs only
 * when app.segments is empty; `{ forceIfAnyEmpty: true }` re-syncs (the "Reset demo" button).
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    segments: string;
    scores: string;
    features: string;
    chatInsights: string;
    interventions: string;
    history: string;
    budget: string;
  };
};

const mmss = (s: number) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
const pctS = (x: number) => `${Math.round(x * 100)}%`;

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.segments`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync…');
  const t0 = Date.now();
  const fq = (name: keyof DataConfig['tables']) => `\`${cfg.catalog}\`.\`${cfg.schema}\`.${cfg.tables[name]}`;
  const fqt = (t: string) => `\`${cfg.catalog}\`.\`${cfg.schema}\`.${t}`;

  type R = Record<string, string | null>;
  const [segRows, topRows, chatRows, mmRows, stageRows, toxRows, ivRows, histRows, budgetRows] = await Promise.all([
    execSql<R>(warehouseId, `
      SELECT g.*, to_json(named_struct(
               'difficulty', round(avg(s.driver_difficulty_pct), 1), 'matchmaking', round(avg(s.driver_matchmaking_pct), 1),
               'toxicity', round(avg(s.driver_toxicity_pct), 1), 'engagement', round(avg(s.driver_engagement_pct), 1),
               'spend', round(avg(s.driver_spend_pct), 1), 'profile', round(avg(s.driver_profile_pct), 1))) AS drivers,
             round(avg(f.warden_fails_total), 1) AS avg_warden_fails,
             round(avg(f.active_days_14d), 1) AS avg_active_days,
             round(avg(f.days_since_last_play), 1) AS avg_days_since_play,
             round(avg(f.queue_abandons_14d), 1) AS avg_abandons
      FROM ${fq('segments')} g
      JOIN ${fq('scores')} s ON s.segment_id = g.segment_id AND s.risk_tier <> 'Low'
      JOIN ${fq('features')} f ON f.player_id = s.player_id
      GROUP BY ALL`),
    execSql<R>(warehouseId, `
      SELECT segment_id, player_id, gamertag, spender_tier, platform, churn_probability_14d, risk_tier,
             predicted_ltv_12m, at_risk_ltv_usd, to_json(top_reasons) AS reasons
      FROM ${fq('scores')} WHERE risk_tier <> 'Low'
      QUALIFY row_number() OVER (PARTITION BY segment_id ORDER BY at_risk_ltv_usd DESC) <= 6`),
    execSql<R>(warehouseId, `
      SELECT s.segment_id, c.message_id, cast(c.sent_at AS STRING) AS sent_at, c.channel, c.message_text, c.toxicity_label, c.is_harmful
      FROM ${fq('chatInsights')} c JOIN ${fq('scores')} s ON s.player_id = c.recipient_player_id AND s.risk_tier <> 'Low'
      WHERE s.top_driver = 'toxicity'
      QUALIFY row_number() OVER (PARTITION BY s.segment_id, c.is_harmful ORDER BY c.sent_at DESC) <= CASE WHEN c.is_harmful THEN 3 ELSE 1 END`),
    execSql<R>(warehouseId, `
      SELECT region,
             round(sum(CASE WHEN activity_date < DATE'2026-08-18' THEN avg_queue_wait_sec * queues END) / sum(CASE WHEN activity_date < DATE'2026-08-18' THEN queues END), 0) AS wait_pre,
             round(sum(CASE WHEN activity_date >= DATE'2026-08-18' THEN avg_queue_wait_sec * queues END) / sum(CASE WHEN activity_date >= DATE'2026-08-18' THEN queues END), 0) AS wait_post,
             round(sum(CASE WHEN activity_date >= DATE'2026-08-18' THEN abandon_rate * queues END) / sum(CASE WHEN activity_date >= DATE'2026-08-18' THEN queues END), 3) AS abandon_post
      FROM ${fqt('gold_matchmaking_daily')} GROUP BY region`),
    execSql<R>(warehouseId, `
      SELECT stage_id, attempt_clear_rate, players_stuck FROM ${fqt('gold_stage_funnel')} WHERE season LIKE 'S7%' ORDER BY stage_id`),
    execSql<R>(warehouseId, `
      WITH np AS (SELECT player_id, install_date, region FROM ${fqt('players')}
                  WHERE install_date BETWEEN DATE'2026-08-18' AND DATE'2026-09-20'),
      h AS (SELECT DISTINCT np.player_id FROM np JOIN ${fq('chatInsights')} c
              ON c.recipient_player_id = np.player_id AND c.is_harmful AND c.sent_date < date_add(np.install_date, 7)),
      d7 AS (SELECT DISTINCT np.player_id FROM np JOIN ${fqt('player_daily')} d
              ON d.player_id = np.player_id AND d.activity_date = date_add(np.install_date, 7))
      SELECT np.region,
             round(avg(CASE WHEN h.player_id IS NOT NULL THEN CASE WHEN d7.player_id IS NOT NULL THEN 1 ELSE 0 END END), 3) AS d7_harassed,
             round(avg(CASE WHEN h.player_id IS NULL THEN CASE WHEN d7.player_id IS NOT NULL THEN 1 ELSE 0 END END), 3) AS d7_not,
             round(avg(CASE WHEN h.player_id IS NOT NULL THEN 1 ELSE 0 END), 3) AS harassed_share
      FROM np LEFT JOIN h USING (player_id) LEFT JOIN d7 USING (player_id) GROUP BY np.region`),
    execSql<R>(warehouseId, `SELECT * FROM ${fq('interventions')}`),
    execSql<R>(warehouseId, `
      SELECT intervention_code, count(*) AS runs, round(avg(lift_pp), 1) AS lift_pp,
             round(sum(cost_usd) / sum(players_retained_incremental), 2) AS cost_per_retained
      FROM ${fq('history')} GROUP BY 1`),
    execSql<R>(warehouseId, `SELECT * FROM ${fq('budget')} ORDER BY budget_month LIMIT 1`),
  ]);

  const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));
  const mm = Object.fromEntries(mmRows.map((r) => [r.region!, r]));
  const tox = Object.fromEntries(toxRows.map((r) => [r.region!, r]));
  const warden = stageRows.find((r) => r.stage_id === '7-4');
  const others = stageRows.filter((r) => r.stage_id !== '7-4').map((r) => num(r.attempt_clear_rate));

  function evidence(r: R): EvidenceTile[] {
    const reg = r.region!;
    const tiles: EvidenceTile[] = [];
    if (r.churn_driver === 'difficulty') {
      tiles.push({ label: '7-4 Warden clear rate', value: pctS(num(warden?.attempt_clear_rate)), bad: true,
        hint: `other Season 7 stages ${pctS(Math.min(...others))}–${pctS(Math.max(...others))}` });
      tiles.push({ label: 'Stuck on the Warden', value: pctS(num(r.stuck_on_warden_share)), bad: num(r.stuck_on_warden_share) > 0.3, hint: 'of at-risk players (4+ fails, never cleared)' });
      tiles.push({ label: 'Avg Warden fails', value: String(num(r.avg_warden_fails)), bad: true, hint: 'per at-risk player' });
    } else if (r.churn_driver === 'matchmaking') {
      const m = mm[reg];
      tiles.push({ label: `Ranked queue wait · ${reg}`, value: mmss(num(m?.wait_post)), bad: num(m?.wait_post) > 150, hint: `was ${mmss(num(m?.wait_pre))} before Season 7` });
      tiles.push({ label: 'Queue abandon rate', value: pctS(num(m?.abandon_post)), bad: num(m?.abandon_post) > 0.1, hint: `${reg}, since Season 7` });
      tiles.push({ label: 'Avg segment wait', value: mmss(num(r.avg_queue_wait_sec)), bad: num(r.avg_queue_wait_sec) > 150, hint: 'at-risk players, last 14 days' });
    } else if (r.churn_driver === 'toxicity') {
      const t = tox[reg];
      tiles.push({ label: 'D7 retention · harassed new players', value: pctS(num(t?.d7_harassed)), bad: true, hint: `vs ${pctS(num(t?.d7_not))} for new players not harassed (${reg})` });
      tiles.push({ label: 'New players harassed in week 1', value: pctS(num(t?.harassed_share)), bad: num(t?.harassed_share) > 0.1, hint: `${reg} installs since Season 7 (AI Functions)` });
      tiles.push({ label: 'Harassed at-risk players', value: pctS(num(r.harassed_share)), bad: true, hint: 'received AI-flagged harmful chat in 14 days' });
    } else {
      tiles.push({ label: 'Days since last session', value: String(num(r.avg_days_since_play)), bad: num(r.avg_days_since_play) > 4, hint: 'average, at-risk players' });
      tiles.push({ label: 'Days played', value: `${num(r.avg_active_days)} of 14`, bad: num(r.avg_active_days) < 4, hint: 'average, last 14 days' });
      tiles.push({ label: 'New players', value: pctS(num(r.new_players_at_risk) / Math.max(1, num(r.players_at_risk))), hint: 'of the segment (< 14 days)' });
    }
    tiles.push({ label: 'Payers at risk', value: `${num(r.payers_at_risk).toLocaleString('en-US')}`, hint: `${num(r.whales_at_risk)} whales` });
    return tiles;
  }

  const byTop = new Map<string, TopPlayer[]>();
  for (const t of topRows) {
    const arr = byTop.get(t.segment_id!) ?? [];
    arr.push({
      playerId: t.player_id!, gamertag: t.gamertag!, spenderTier: t.spender_tier!, platform: t.platform!,
      churnProbability: num(t.churn_probability_14d), riskTier: t.risk_tier!, predictedLtv: num(t.predicted_ltv_12m),
      atRiskLtv: num(t.at_risk_ltv_usd), reasons: JSON.parse(t.reasons ?? '[]') as string[],
    });
    byTop.set(t.segment_id!, arr);
  }
  const byChat = new Map<string, ChatLine[]>();
  for (const c of chatRows) {
    const arr = byChat.get(c.segment_id!) ?? [];
    arr.push({ messageId: c.message_id!, sentAt: c.sent_at!, channel: c.channel!, text: c.message_text!, label: c.toxicity_label!, harmful: c.is_harmful === 'true' });
    byChat.set(c.segment_id!, arr);
  }

  const now = new Date().toISOString();
  await db.insert(segments).values(
    segRows.map((r) => ({
      segmentId: r.segment_id!,
      segmentName: r.segment_name!,
      churnDriver: r.churn_driver!,
      region: r.region!,
      playersAtRisk: num(r.players_at_risk),
      criticalPlayers: num(r.critical_players),
      highPlayers: num(r.high_players),
      avgChurnProbability: num(r.avg_churn_probability),
      atRiskLtv: num(r.at_risk_ltv_usd),
      ltvBook: num(r.ltv_book_usd),
      payersAtRisk: num(r.payers_at_risk),
      whalesAtRisk: num(r.whales_at_risk),
      newPlayersAtRisk: num(r.new_players_at_risk),
      drivers: JSON.parse(r.drivers ?? '{}') as Record<string, number>,
      evidence: evidence(r),
      topPlayers: (byTop.get(r.segment_id!) ?? []).sort((a, b) => b.atRiskLtv - a.atRiskLtv),
      chatSample: (byChat.get(r.segment_id!) ?? []).sort((a, b) => Number(b.harmful) - Number(a.harmful)),
      auditTrail: [{
        at: now, by: 'player_churn_model@champion', action: 'scored' as const,
        notes: `${num(r.players_at_risk)} players at risk · avg 14-day churn ${(num(r.avg_churn_probability) * 100).toFixed(0)}% · $${Math.round(num(r.at_risk_ltv_usd)).toLocaleString('en-US')} LTV at risk`,
      }],
    })),
  ).onConflictDoNothing();
  console.log(`[sync]   segments: ${segRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const hist = Object.fromEntries(histRows.map((h) => [h.intervention_code!, h]));
  await db.insert(interventions).values(
    ivRows.map((r) => ({
      code: r.intervention_code!,
      name: r.intervention_name!,
      targetDriver: r.target_driver!,
      kind: r.kind!,
      scope: r.scope!,
      description: r.description!,
      fixedCost: num(r.fixed_cost_usd),
      costPerPlayer: num(r.cost_per_player_usd),
      leadTimeDays: num(r.lead_time_days),
      history: { runs: num(hist[r.intervention_code!]?.runs), liftPp: num(hist[r.intervention_code!]?.lift_pp), costPerRetained: num(hist[r.intervention_code!]?.cost_per_retained) },
    })),
  ).onConflictDoNothing();
  if (budgetRows[0]) {
    await db.insert(budget).values({
      month: budgetRows[0].budget_month!, description: budgetRows[0].description!, budgetUsd: num(budgetRows[0].budget_usd),
    }).onConflictDoNothing();
  }
  console.log(`[sync]   interventions: ${ivRows.length}; done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.segments`);
    await tx.execute(sql`TRUNCATE TABLE app.interventions`);
    await tx.execute(sql`TRUNCATE TABLE app.budget`);
  });
}

/** Run one statement on the warehouse (exported for the Delta write-back). */
export async function execWarehouseSql<T>(statement: string, parameters?: Array<{ name: string; value: string | null; type?: string }>): Promise<T[]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) throw new Error('DATABRICKS_WAREHOUSE_ID not set');
  return execSql<T>(warehouseId, statement, parameters);
}

export async function execSql<T>(
  warehouseId: string,
  statement: string,
  parameters?: Array<{ name: string; value: string | null; type?: string }>,
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      ...(parameters ? { parameters } : {}),
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  // Cap total polling at 10 minutes. The warehouse can take a couple of
  // minutes to spin from idle + scan, but a state stuck in RUNNING beyond
  // 10 min is broken — fail loud instead of silently blocking boot forever.
  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}
