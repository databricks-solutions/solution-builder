/** Asset drawer: ML risk + drivers, condition trend vs baseline, CMMS history, failures, work orders. */
import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CalendarCheck, Droplets, History, Wrench } from 'lucide-react';
import {
  LineChart,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchAsset, fmtDate, TIER_STYLE, usd, type AssetDetail } from '@/lib/pdm';
import { RiskBadge } from './RiskBadge';

export function AssetDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      fetchAsset(id)
        .then((d) => alive && (setDetail(d), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    setDetail(null);
    void load();
    const off = dataMutated.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [id]);

  const a = detail?.asset;
  const nonSpec = (lub: string | null) => !!lub && /substitute|XHP/i.test(lub);

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-display text-2xl">
            {id} {a && <RiskBadge tier={a.risk_tier} score={a.risk_score} />}
          </SheetTitle>
          <SheetDescription>
            {a ? `${a.name} · ${a.manufacturer} ${a.model} · ${a.line} · ${usd(a.downtime_cost_per_hour)}/h downtime${a.is_bottleneck ? ' · LINE BOTTLENECK' : ''}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>
        {error && <div className="m-4 text-sm text-destructive">{error}</div>}
        {!detail && !error && (
          <div className="p-4 space-y-3">
            <div className="h-24 rounded-lg bg-muted animate-pulse" />
            <div className="h-56 rounded-lg bg-muted animate-pulse" />
          </div>
        )}
        {a && detail && (
          <div className="px-4 pb-8 space-y-5">
            <div className={`rounded-xl p-4 ${TIER_STYLE[a.risk_tier].bg}`}>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label="7-day failure risk" value={`${a.risk_score}%`} />
                <Stat label="Est. days to failure" value={a.est_days_to_failure != null ? `${a.est_days_to_failure.toFixed(1)} d` : '—'} />
                <Stat label="Unplanned cost exposure" value={usd(a.unplanned_failure_cost_usd ?? null)} />
              </div>
              <div className="mt-3 text-sm font-medium">{a.predicted_failure_mode}</div>
              <ul className="mt-1 text-sm list-disc ml-5 text-foreground/80">
                {[a.top_driver_1, a.top_driver_2, a.top_driver_3].filter(Boolean).map((d) => <li key={d}>{d}</li>)}
              </ul>
              {a.open_work_order_id ? (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--risk-ok-bg)] px-2 py-1 text-xs font-medium text-[var(--risk-ok)]">
                  <CalendarCheck className="size-3.5" /> Protected — {a.open_work_order_id} booked
                </div>
              ) : a.risk_tier !== 'Healthy' || nonSpec(a.last_pm_lubricant) ? (
                <button
                  type="button"
                  onClick={() => dockController.newAndSend(`Why is ${a.id} at risk and what should I do about it?`)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Bot className="size-3.5" /> Ask PdM Copilot why
                </button>
              ) : null}
            </div>

            <Tabs defaultValue="trend">
              <TabsList>
                <TabsTrigger value="trend">Condition trend</TabsTrigger>
                <TabsTrigger value="history">Maintenance ({detail.history.length})</TabsTrigger>
                <TabsTrigger value="failures">Failures ({detail.failures.length})</TabsTrigger>
                <TabsTrigger value="wo">Work orders ({detail.work_orders.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="trend" className="space-y-4 pt-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Vibration RMS (mm/s) vs 30-day baseline — last 60 days</div>
                  <LineChart data={detail.trend} xKey="day" yKey={['vibration', 'vibration_baseline']} colors={['#E4572E', '#94A3B8']} height={200} smooth showLegend />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Temperature (°C) vs baseline</div>
                  <LineChart data={detail.trend} xKey="day" yKey={['temperature', 'temperature_baseline']} colors={['#F2A541', '#94A3B8']} height={180} smooth showLegend />
                </div>
                {a.last_pm_at && (
                  <div className={`rounded-lg border p-3 text-sm ${nonSpec(a.last_pm_lubricant) ? 'border-[var(--risk-critical)] bg-[var(--risk-critical-bg)]' : ''}`}>
                    <div className="flex items-center gap-1.5 font-medium"><Droplets className="size-4" /> Last PM {fmtDate(a.last_pm_at)} · {a.last_pm_vendor}</div>
                    <div className="text-foreground/80">Lubricant: {a.last_pm_lubricant ?? 'n/a'}{nonSpec(a.last_pm_lubricant) && ' — NOT the OEM spec'}</div>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="history" className="pt-2">
                <ol className="space-y-2">
                  {detail.history.map((h) => (
                    <li key={h.id} className={`rounded-lg border p-3 text-sm ${nonSpec(h.lubricant_used) ? 'border-[var(--risk-critical)] bg-[var(--risk-critical-bg)]' : 'bg-card'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium flex items-center gap-1.5"><History className="size-3.5" /> {h.id} · {h.work_type}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(h.scheduled_at)}</span>
                      </div>
                      <div className="text-foreground/80">{h.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">{h.vendor} · {h.technician}{h.lubricant_used ? ` · ${h.lubricant_used}` : ''}</div>
                      {h.notes && h.notes !== 'Completed per PM checklist. No abnormal findings.' && <div className="text-xs mt-1 italic">“{h.notes}”</div>}
                    </li>
                  ))}
                </ol>
              </TabsContent>
              <TabsContent value="failures" className="pt-2 space-y-2">
                {detail.failures.length === 0 && <div className="text-sm text-muted-foreground">No unplanned failures in the last 12 months.</div>}
                {detail.failures.map((f) => (
                  <div key={f.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex justify-between font-medium"><span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-[var(--risk-critical)]" />{f.id} · {f.component}</span><span className="text-xs text-muted-foreground">{fmtDate(f.failure_at)}</span></div>
                    <div className="text-xs text-muted-foreground">{f.downtime_hours} h down · {usd(f.total_cost_usd)} total cost</div>
                    <div className="mt-1 text-foreground/80">{f.root_cause}</div>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="wo" className="pt-2 space-y-2">
                {detail.work_orders.length === 0 && <div className="text-sm text-muted-foreground">No work orders booked from the control room yet.</div>}
                {detail.work_orders.map((w) => (
                  <div key={w.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex justify-between font-medium"><span className="flex items-center gap-1.5"><Wrench className="size-3.5" />{w.id} · {w.title}</span><span className="text-xs">{w.status}</span></div>
                    <div className="text-xs text-muted-foreground">{fmtDate(w.scheduled_start, true)} · {w.duration_hours} h · {w.technicians}</div>
                    <div className="text-xs mt-1">Cost avoided {usd(w.unplanned_cost_avoided_usd)} · net {usd(w.net_savings_usd)}</div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-display text-2xl">{value}</div>
    </div>
  );
}
