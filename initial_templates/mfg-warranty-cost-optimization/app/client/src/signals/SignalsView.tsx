/**
 * Early-warning board — every AI failure mode × attributable supplier, claims in the last
 * 90 days vs the prior 12 months per 1,000 bike-years (gold_early_warning, live from Delta).
 * Flagged signals (ratio ≥ 2 and ≥ 15 claims) open the signal workbench.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Radar } from 'lucide-react';
import { fetchSignals, moneyK, type SignalRow } from '@/warranty/api';
import { Pill, StatusPill, cn } from '@/warranty/ui';

type Row = {
  signal_id: string; failure_mode: string; failure_mode_label: string; supplier_name: string; claims_90d: number; claims_base: number;
  rate_90d: number; baseline_rate: number; rate_ratio: number; cost_90d: number; is_signal: boolean | string; chargeable: boolean | string;
  dealer_code_agreement: number;
};
const truthy = (v: unknown) => v === true || v === 'true';

export function SignalsView() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  useEffect(() => {
    fetch('/api/charts/early_warning').then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error ?? `HTTP ${r.status}`); setRows(b.data); }).catch((e) => setErr((e as Error).message));
    fetchSignals().then(setSignals).catch(() => {});
  }, []);
  const maxRatio = Math.max(1, ...(rows ?? []).map((r) => Number(r.rate_ratio) || 0));
  const byId = new Map(signals.map((s) => [s.id, s]));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Warranty &amp; field quality · Priya Raman</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Early-warning board</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
            Claims per 1,000 bike-years in service, by <b>AI-classified</b> failure mode and the supplier whose part it is — last 90 days
            vs the prior 12 months. A signal is flagged at ≥ 2× the baseline with at least 15 claims (procedure QP-12 triggers a field review at 3×).
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          {err && <div className="px-5 py-4 text-sm text-[var(--destructive)]">{err}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Failure mode (ai_classify)', 'Supplier', 'Claims 90 d', 'Rate / 1K bike-yrs', 'vs last year', 'Cost 90 d', 'Dealer code agrees', ''].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!rows && !err && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={8} className="px-4 py-2"><div className="h-6 rounded bg-[var(--muted)] animate-pulse" /></td></tr>)}
              {(rows ?? []).map((r) => {
                const flagged = truthy(r.is_signal);
                const s = byId.get(r.signal_id);
                return (
                  <tr key={r.signal_id} onClick={() => flagged && nav(`/signals/${r.signal_id}`)}
                    className={cn('border-t border-[var(--border)]', flagged && 'cursor-pointer bg-[#FFF5F1] hover:bg-[#FFEDE5]')}>
                    <td className="px-4 py-2">
                      <div className={cn('font-medium', flagged && 'text-[var(--brand-5)]')}>{flagged && <Radar className="mr-1 inline size-3.5" />}{r.failure_mode_label}</div>
                    </td>
                    <td className="px-4 py-2 text-xs">{r.supplier_name}{truthy(r.chargeable) ? '' : <span className="text-[var(--muted-foreground)]"> · not chargeable</span>}</td>
                    <td className="px-4 py-2 tabular-nums">{r.claims_90d}</td>
                    <td className="px-4 py-2 tabular-nums">{r.rate_90d} <span className="text-xs text-[var(--muted-foreground)]">vs {r.baseline_rate}</span></td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full bg-[var(--muted)]"><div className="h-2 rounded-full" style={{ width: `${Math.min(100, (Number(r.rate_ratio) / maxRatio) * 100)}%`, background: flagged ? 'var(--brand-5)' : 'var(--primary-light)' }} /></div>
                        <span className={cn('tabular-nums text-xs', flagged && 'font-semibold text-[var(--brand-5)]')}>{r.rate_ratio}×</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{moneyK(r.cost_90d)}</td>
                    <td className="px-4 py-2 tabular-nums text-xs">{Math.round(Number(r.dealer_code_agreement) * 100)}%</td>
                    <td className="px-4 py-2 text-right">{flagged ? (s ? <StatusPill status={s.status} /> : <Pill tone="bad">Signal</Pill>) : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          “Dealer code agrees” = share of claims whose dealer labor code matches the failure mode the AI found in the technician notes.
          Low agreement is why this signal never showed up in the labor-code report.
        </p>
      </div>
    </div>
  );
}
