import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import { Skeleton, Spinner } from '@databricks/appkit-ui/react';
import {
  Activity, AlertTriangle, Battery, Bot, CheckCircle2, Flame, GitBranch, Hospital, Sparkles, ThermometerSun, Users, Zap,
} from 'lucide-react';
import { dockController } from '@/chat/dockController';
import { dataMutated } from '@/lib/events';
import {
  approveOption, fetchActions, fetchCurve, fetchDetail, fetchOptions, fetchOverview, fmtHour, RISK_COLOR, usd,
  type Action, type Curve, type Detail, type Options, type Overview, type ReliefOption,
} from '@/lib/grid';
import { LoadChart } from './LoadChart';

const OPTION_ICON: Record<string, typeof Zap> = { 'Demand response': Users, 'Feeder switching': GitBranch, 'DER dispatch': Battery };

export const PROMPT_RISK = 'What is at risk on the grid tomorrow, and why?';
export const PROMPT_RANK = 'Rank my relief options for T-104 by cost, customers affected and thermal risk, and recommend one.';

export function ControlRoomView() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [curve, setCurve] = useState<Curve | null>(null);
  const [opts, setOpts] = useState<Options | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [actions, setActions] = useState<Action[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadActions = useCallback(() => fetchActions().then(setActions).catch((e) => setErr(String(e.message ?? e))), []);

  useEffect(() => {
    fetchOverview().then((o) => { setOv(o); setSel((s) => s ?? o.transformers[0]?.transformer_id ?? null); })
      .catch((e) => setErr(String(e.message ?? e)));
    loadActions();
    return dataMutated.subscribe(() => { void loadActions(); });
  }, [loadActions]);

  useEffect(() => {
    if (!sel) return;
    setCurve(null); setOpts(null); setDetail(null); setPreview(null);
    Promise.all([fetchCurve(sel), fetchOptions(sel), fetchDetail(sel)])
      .then(([c, o, d]) => {
        setCurve(c); setOpts(o); setDetail(d);
        const rec = o.options.find((x) => x.recommended_rank === 1);
        if (rec) setPreview(rec.option_id);
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, [sel]);

  const tx = ov?.transformers.find((t) => t.transformer_id === sel) ?? null;
  const postCurve = useMemo(
    () => (preview && opts ? opts.hourly.filter((h) => h.option_id === preview) : undefined),
    [preview, opts],
  );
  const previewOpt = opts?.options.find((o) => o.option_id === preview);
  const dispatched = new Set((actions ?? []).map((a) => a.option_id));

  async function approve(o: ReliefOption) {
    setBusy(o.option_id);
    try {
      const a = await approveOption(o.option_id,
        `Approved from the control-room console: ${o.option_type} — post-action peak ${o.post_peak_pct}% / hot-spot ${o.post_hot_spot_c}°C, est. ${usd(o.estimated_cost_usd)}.`);
      setToast(`${a.action_id} dispatched — ${o.option_name}`);
      setTimeout(() => setToast(null), 5000);
      await loadActions();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  if (err && !ov) return <div className="p-8 text-sm text-red-600">Could not load the grid: {err}</div>;
  const k = ov?.kpi;

  return (
    <div className="control-room min-h-full p-4 lg:p-5 space-y-4">
      {/* Heat advisory banner */}
      <div className="cr-banner rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 font-semibold">
          <ThermometerSun className="size-5" /> HEAT ADVISORY · Wed 22 Jul forecast high {k ? `${k.forecast_high_f.toFixed(0)}°F` : '…'}
        </div>
        <div className="text-sm opacity-90">
          Midwest Regional Electric Cooperative · Distribution control room · SCADA as of {k ? fmtHour(k.as_of.slice(0, 16)) : '…'} CDT
        </div>
        <button className="cr-btn-ghost ml-auto" data-testid="ask-risk" onClick={() => dockController.openAndSend(PROMPT_RISK)}>
          <Bot className="size-4" /> Ask the copilot what's at risk
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="System load now" value={k ? `${k.system_load_now_mva.toFixed(0)} MVA` : null} sub={k ? `of ${k.system_capacity_mva.toFixed(0)} MVA installed` : ''} />
        <Kpi label="Tomorrow's system peak" value={k ? `${k.system_peak_forecast_mva.toFixed(0)} MVA` : null} sub={k ? `${(k.system_peak_forecast_mva / k.system_capacity_mva * 100).toFixed(0)}% of capacity — headroom overall` : ''} />
        <Kpi label="Transformers over nameplate" value={k ? String(k.transformers_over_nameplate) : null} sub="forecast, next 48 h" alert={!!k && k.transformers_over_nameplate > 0} />
        <Kpi label="Customers on at-risk assets" value={k ? k.customers_at_risk.toLocaleString() : null} sub={k ? `of ${k.customers_total.toLocaleString()} served` : ''} alert={!!k && k.customers_at_risk > 0} />
        <Kpi label="SAIDI, last 12 months" value={k ? `${k.saidi_12m.toFixed(0)} min` : null} sub="target 125 min" alert={!!k && k.saidi_12m > 125} />
        <Kpi label="SAIFI, last 12 months" value={k ? k.saifi_12m.toFixed(2) : null} sub="target 1.10" alert={!!k && k.saifi_12m > 1.1} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* LEFT: forecast + risk board */}
        <div className="xl:col-span-7 space-y-4">
          <Panel
            title={tx ? `${tx.transformer_id} · ${tx.substation_name} — load vs rating, last 36 h + 48 h forecast` : 'Load forecast'}
            right={tx && <RiskPill risk={tx.overload_risk} />}>
            {curve ? (
              <LoadChart curve={curve} post={postCurve}
                postLabel={previewOpt ? `After: ${previewOpt.option_type} (${previewOpt.post_peak_pct}% peak)` : undefined} />
            ) : <Skeleton className="h-[260px] w-full bg-muted" />}
            {tx && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <Stat label="Forecast peak" value={`${tx.forecast_peak_pct.toFixed(1)}%`} sub={`${tx.forecast_peak_mva.toFixed(2)} MVA · ${fmtHour(tx.forecast_peak_at)}`} hot={tx.forecast_peak_pct > 100} />
                <Stat label="Hours over nameplate" value={String(tx.forecast_hours_over_nameplate)} sub="next 48 h" hot={tx.forecast_hours_over_nameplate > 0} />
                <Stat label="Winding hot-spot" value={`${tx.forecast_peak_hot_spot_c.toFixed(0)}°C`} sub="limit 110 / emergency 120" hot={tx.forecast_peak_hot_spot_c > 110} />
                <Stat label="Insulation aging" value={`${tx.forecast_peak_aging_factor.toFixed(1)}×`} sub="normal rate at peak" hot={tx.forecast_peak_aging_factor > 2} />
              </div>
            )}
          </Panel>

          <Panel title="Transformer risk board — tomorrow's forecast peak" right={<span className="text-[11px]" style={{ color: 'var(--cr-dim)' }}>click a row to inspect</span>}>
            {!ov ? <Skeleton className="h-64 w-full bg-muted" /> : (
              <div className="overflow-x-auto">
                <table className="cr-table w-full text-[13px]">
                  <thead>
                    <tr><th>Asset</th><th>Substation</th><th className="w-[26%]">Forecast peak</th><th>Hot-spot</th><th>Health</th><th>Customers</th><th>Risk</th></tr>
                  </thead>
                  <tbody>
                    {ov.transformers.map((t) => (
                      <tr key={t.transformer_id} onClick={() => setSel(t.transformer_id)}
                        className={t.transformer_id === sel ? 'is-selected' : ''} data-testid={`row-${t.transformer_id}`}>
                        <td className="font-semibold">{t.transformer_id}</td>
                        <td>{t.substation_name}</td>
                        <td><LoadBar pct={t.forecast_peak_pct} now={t.loading_now_pct} /></td>
                        <td style={{ color: t.forecast_peak_hot_spot_c > 110 ? 'var(--risk-critical)' : undefined }}>{t.forecast_peak_hot_spot_c.toFixed(0)}°C</td>
                        <td><span style={{ color: t.health_index < 45 ? 'var(--risk-critical)' : t.health_index < 65 ? 'var(--risk-high)' : 'var(--cr-text)' }}>{t.health_index.toFixed(0)}</span> <span style={{ color: 'var(--cr-dim)' }}>{t.health_tier}</span></td>
                        <td>{t.customers_served.toLocaleString()}</td>
                        <td><RiskPill risk={t.overload_risk} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* RIGHT: map, asset, options, log */}
        <div className="xl:col-span-5 space-y-4">
          <Panel title={tx ? `Relief options for ${tx.transformer_id}` : 'Relief options'}
            right={opts && opts.options.length > 0 && (
              <button className="cr-btn-ghost" data-testid="ask-rank" onClick={() => dockController.openAndSend(
                sel === 'T-104' ? PROMPT_RANK : `Rank my relief options for ${sel} by cost, customers affected and thermal risk, and recommend one.`)}>
                <Sparkles className="size-4" /> Ask the copilot to rank
              </button>
            )}>
            {!opts ? <Skeleton className="h-40 w-full bg-muted" /> : opts.options.length === 0 ? (
              <div className="text-sm" style={{ color: 'var(--cr-dim)' }}>
                <CheckCircle2 className="inline size-4 mr-1" style={{ color: 'var(--risk-normal)' }} />
                No action needed — forecast peak stays within 95% of nameplate.
              </div>
            ) : (
              <div className="space-y-2.5">
                {opts.options.map((o) => {
                  const Icon = OPTION_ICON[o.option_type] ?? Zap;
                  const done = dispatched.has(o.option_id);
                  return (
                    <div key={o.option_id} data-testid={`opt-${o.option_id}`}
                      className={`cr-option ${preview === o.option_id ? 'is-preview' : ''}`}
                      onMouseEnter={() => setPreview(o.option_id)} onClick={() => setPreview(o.option_id)}>
                      <div className="flex items-start gap-2.5">
                        <div className="cr-option-icon"><Icon className="size-4" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-[13.5px]">{o.option_type}</span>
                            {o.recommended_rank === 1 && <span className="cr-rec">RECOMMENDED</span>}
                            <span className="text-[11px]" style={{ color: 'var(--cr-dim)' }}>#{o.recommended_rank} · score {o.composite_risk_score}</span>
                          </div>
                          <div className="text-[12px] mt-0.5" style={{ color: 'var(--cr-dim)' }}>{o.option_name}</div>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 text-[12px]">
                            <Mini label="Relief @ peak" value={`${o.relief_at_peak_mva.toFixed(1)} MVA`} />
                            <Mini label="Cost" value={usd(o.estimated_cost_usd)} />
                            <Mini label="Customers" value={o.customers_affected.toLocaleString()} />
                            <Mini label="Peak after" value={`${o.post_peak_pct.toFixed(0)}% · ${o.post_hot_spot_c.toFixed(0)}°C`} bad={!o.clears_overload || o.post_peak_pct > 100} />
                          </div>
                          <div className="text-[11.5px] mt-1.5" style={{ color: o.clears_overload && !o.side_effect_transformer_id ? 'var(--cr-dim)' : 'var(--risk-high)' }}>
                            {o.customer_impact} · {o.n1_redundancy}
                          </div>
                        </div>
                        <button className={done ? 'cr-btn-done' : 'cr-btn'} disabled={done || busy !== null}
                          data-testid={`approve-${o.option_id}`}
                          onClick={(e) => { e.stopPropagation(); void approve(o); }}>
                          {busy === o.option_id ? <Spinner className="size-4" /> : done ? <><CheckCircle2 className="size-4" /> Dispatched</> : 'Approve & dispatch'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Control-room action log" right={<Activity className="size-4" style={{ color: 'var(--cr-dim)' }} />}>
            {!actions ? <Skeleton className="h-16 w-full bg-muted" /> : actions.length === 0 ? (
              <div className="text-[12.5px]" style={{ color: 'var(--cr-dim)' }}>No actions dispatched this shift. Approve an option above or ask the copilot.</div>
            ) : (
              <ul className="space-y-2" data-testid="action-log">
                {actions.map((a) => (
                  <li key={a.action_id} className="cr-log">
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <Flame className="size-3.5" style={{ color: 'var(--cr-post)' }} />
                      <span className="font-semibold">{a.action_id}</span>
                      <span className="cr-chip">{a.status}</span>
                      <span className="ml-auto text-[11px]" style={{ color: 'var(--cr-dim)' }}>{a.logged_at} UTC · via {a.source}</span>
                    </div>
                    <div className="text-[12px] mt-0.5">{a.transformer_id} · {a.option_name} → peak {a.expected_peak_pct}% · {usd(a.estimated_cost_usd)}</div>
                    <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--cr-dim)' }}>{a.operator}: {a.rationale}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {tx && (
            <Panel title={`Why ${tx.transformer_id} — asset condition`}>
              <div className="grid grid-cols-3 gap-3 text-[12px]">
                <Stat label="Health index" value={tx.health_index.toFixed(0)} sub={tx.health_tier} hot={tx.health_index < 45} />
                <Stat label="Ethylene (DGA)" value={`${tx.ethylene_ppm.toFixed(0)} ppm`} sub={tx.dga_status} hot={tx.ethylene_ppm > 100} />
                <Stat label="Age" value={`${tx.age_years} yr`} sub={`replace: ${usd(tx.replacement_cost_usd)} · ${tx.replacement_lead_time_weeks} wk`} />
              </div>
              {detail && <DgaSpark d={detail.dga} />}
              {tx.risk_drivers && (
                <ul className="mt-3 space-y-1 text-[12.5px]">
                  {tx.risk_drivers.split('; ').map((r) => (
                    <li key={r} className="flex gap-2"><AlertTriangle className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--risk-high)' }} />{r}</li>
                  ))}
                </ul>
              )}
              {detail && detail.facilities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {detail.facilities.map((f) => (
                    <span key={f.facility_name} className="cr-chip"><Hospital className="size-3" />{f.facility_name}</span>
                  ))}
                </div>
              )}
            </Panel>
          )}

          <Panel title="Service territory — worst forecast loading per substation">
            <div className="h-[210px] rounded-lg overflow-hidden">
              {ov && (
                <MapContainer center={[42.03, -93.55]} zoom={9} scrollWheelZoom={false} className="h-full w-full" attributionControl={false}>
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" />
                  {Object.values(ov.transformers.reduce<Record<string, typeof ov.transformers[number]>>((acc, t) => {
                    if (!acc[t.substation_id] || acc[t.substation_id].forecast_peak_pct < t.forecast_peak_pct) acc[t.substation_id] = t;
                    return acc;
                  }, {})).map((t) => (
                    <CircleMarker key={t.substation_id} center={[t.latitude, t.longitude]}
                      radius={t.forecast_peak_pct > 100 ? 16 : 10}
                      pathOptions={{ color: RISK_COLOR[t.overload_risk], fillColor: RISK_COLOR[t.overload_risk], fillOpacity: 0.55, weight: 2 }}
                      eventHandlers={{ click: () => setSel(t.transformer_id) }}>
                      <Tooltip direction="top" permanent={t.forecast_peak_pct > 100}>
                        {t.substation_name}: {t.transformer_id} {t.forecast_peak_pct.toFixed(0)}%
                      </Tooltip>
                    </CircleMarker>
                  ))}
                </MapContainer>
              )}
            </div>
          </Panel>

        </div>
      </div>
      {toast && <div className="cr-toast"><CheckCircle2 className="size-4" /> {toast}</div>}
    </div>
  );
}

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="cr-panel rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[13px] font-semibold tracking-wide uppercase" style={{ color: 'var(--cr-dim)' }}>{title}</h2>
        <div className="ml-auto">{right}</div>
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, alert }: { label: string; value: string | null; sub: string; alert?: boolean }) {
  return (
    <div className={`cr-kpi rounded-xl px-3.5 py-3 ${alert ? 'is-alert' : ''}`}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--cr-dim)' }}>{label}</div>
      {value === null ? <Skeleton className="h-7 w-20 mt-1 bg-muted" /> : <div className="text-[24px] font-semibold leading-tight mt-0.5">{value}</div>}
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--cr-dim)' }}>{sub}</div>
    </div>
  );
}

function Stat({ label, value, sub, hot }: { label: string; value: string; sub?: string; hot?: boolean }) {
  return (
    <div className="cr-stat rounded-lg px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--cr-dim)' }}>{label}</div>
      <div className="text-[18px] font-semibold" style={{ color: hot ? 'var(--risk-critical)' : 'var(--cr-text)' }}>{value}</div>
      {sub && <div className="text-[11px]" style={{ color: 'var(--cr-dim)' }}>{sub}</div>}
    </div>
  );
}

function Mini({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase" style={{ color: 'var(--cr-dim)' }}>{label}</div>
      <div className="font-semibold whitespace-nowrap tabular-nums" style={{ color: bad ? 'var(--risk-critical)' : 'var(--cr-text)' }}>{value}</div>
    </div>
  );
}

function RiskPill({ risk }: { risk: string }) {
  return <span className="cr-pill" style={{ color: RISK_COLOR[risk], borderColor: RISK_COLOR[risk] }}>{risk}</span>;
}

function LoadBar({ pct, now }: { pct: number; now: number }) {
  const w = Math.min(pct, 120) / 120 * 100;
  const color = pct > 100 ? 'var(--risk-critical)' : pct > 88 ? 'var(--risk-watch)' : 'var(--risk-normal)';
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 flex-1 rounded-full" style={{ background: 'var(--cr-grid)' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: color }} />
        <div className="absolute -top-0.5 h-3 w-0.5" style={{ left: `${Math.min(now, 120) / 120 * 100}%`, background: 'var(--cr-text)' }} title={`now ${now}%`} />
        <div className="absolute -top-1 h-4 w-px" style={{ left: `${100 / 1.2}%`, background: 'var(--risk-critical)' }} />
      </div>
      <span className="w-12 text-right tabular-nums" style={{ color }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function DgaSpark({ d }: { d: Detail['dga'] }) {
  if (d.length < 2) return null;
  const W = 400, H = 54;
  const max = Math.max(...d.map((x) => x.ethylene_ppm), 110);
  const pts = d.map((x, i) => `${(i / (d.length - 1)) * W},${H - 4 - (x.ethylene_ppm / max) * (H - 10)}`).join(' ');
  return (
    <div className="mt-3">
      <div className="text-[10.5px] uppercase" style={{ color: 'var(--cr-dim)' }}>Ethylene, last 12 lab samples (ppm) — IEEE C57.104 alert at 100</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12">
        <line x1="0" x2={W} y1={H - 4 - (100 / max) * (H - 10)} y2={H - 4 - (100 / max) * (H - 10)} stroke="var(--risk-high)" strokeDasharray="4 3" />
        <polyline points={pts} fill="none" stroke="var(--risk-critical)" strokeWidth="2" />
      </svg>
    </div>
  );
}
