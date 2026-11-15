/**
 * Claims explorer — every dealer warranty claim with what AI Functions read in the technician
 * notes (ai_classify failure mode, ai_extract fault code / water exposure / damage) next to the
 * coarse labor code the dealer picked. Lakebase mirror of gold_claims.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CloudRain, Search, Sparkles } from 'lucide-react';
import { fetchClaims, money, moneyK, type ClaimsResponse } from '@/warranty/api';
import { Pill, cn } from '@/warranty/ui';

export function ClaimsView() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') ?? '';
  const [q, setQ] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [data, setData] = useState<ClaimsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetchClaims({ mode: mode || undefined, q: q || undefined, mismatch: mismatch ? '1' : undefined, limit: '150' })
        .then((d) => { setData(d); setErr(null); }).catch((e) => setErr((e as Error).message));
    }, 200);
    return () => clearTimeout(t);
  }, [mode, q, mismatch]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">AI Functions over dealer technician notes</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Claims, classified</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
            Dealers pick one of nine generic labor codes. <code>ai_classify</code> reads the free-text technician notes into 14 failure
            modes; <code>ai_extract</code> pulls the fault code, water exposure and the damage the technician found.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setParams({})} className={cn('rounded-full border px-3 py-1 text-xs', !mode ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)]')}>All modes</button>
          {(data?.modes ?? []).map((m) => (
            <button key={m.failure_mode} onClick={() => setParams({ mode: m.failure_mode })}
              className={cn('rounded-full border px-3 py-1 text-xs', mode === m.failure_mode ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-[var(--card)]')}>
              {m.failure_mode_label} <span className="opacity-70">· {m.claims_90d} in 90 d</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes, claim id, serial…" className="h-9 w-80 rounded-lg border border-[var(--border)] bg-[var(--card)] pl-8 pr-3 text-sm outline-none" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mismatch} onChange={(e) => setMismatch(e.target.checked)} />Only claims the dealer coded differently</label>
          {data && <span className="text-xs text-[var(--muted-foreground)]">showing {data.claims.length} most recent</span>}
        </div>
        {err && <div className="text-sm text-[var(--destructive)]">{err}</div>}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Claim', 'Bike / dealer', 'Technician notes', 'Dealer code', 'AI failure mode', 'Cost'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!data && !err && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={6} className="px-4 py-2"><div className="h-8 rounded bg-[var(--muted)] animate-pulse" /></td></tr>)}
              {(data?.claims ?? []).map((c) => (
                <tr key={String(c.id)} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-2 whitespace-nowrap"><div className="font-medium">{String(c.id)}</div><div className="text-xs text-[var(--muted-foreground)]">{String(c.claim_date).slice(0, 10)}</div></td>
                  <td className="px-4 py-2 text-xs"><div>{String(c.model_name)} · {String(c.serial)}</div><div className="text-[var(--muted-foreground)]">{String(c.dealer_name)}</div></td>
                  <td className="px-4 py-2 text-xs leading-relaxed max-w-[460px]">{String(c.technician_notes)}</td>
                  <td className="px-4 py-2"><Pill tone={c.matches_dealer_code ? 'neutral' : 'warn'}>{String(c.dealer_labor_code)}</Pill></td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Pill tone="info"><Sparkles className="size-3" />{String(c.failure_mode_label)}</Pill>
                      {c.fault_code ? <Pill tone="bad">{String(c.fault_code)}</Pill> : null}
                      {c.water_exposure ? <Pill tone="info"><CloudRain className="size-3" />water</Pill> : null}
                    </div>
                    {c.observed_damage ? <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">found: {String(c.observed_damage)}</div> : null}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{money(Number(c.total_cost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && (
          <div className="grid gap-2 md:grid-cols-3">
            {data.modes.slice(0, 6).map((m) => (
              <div key={m.failure_mode} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-xs">
                <div className="font-medium">{m.failure_mode_label}</div>
                <div className="text-[var(--muted-foreground)]">{m.claims} claims · {moneyK(m.cost)} · dealer code agrees {Math.round(m.code_agreement * 100)}%</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
