export function RiskBar({ score }: { score: number }) {
  const s = Number(score ?? 0);
  const color = s >= 70 ? '#D1495B' : s >= 40 ? '#E8871E' : s >= 15 ? '#F2C14E' : '#9AA5B1';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-2 w-20 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, s)}%`, background: color }} />
      </div>
      <span className="tabular-nums text-sm font-semibold" style={{ color }}>{s.toFixed(0)}</span>
    </div>
  );
}

export function KycBadge({ rating }: { rating: string }) {
  const m: Record<string, string> = { high: 'bg-red-100 text-red-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-emerald-100 text-emerald-800' };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${m[rating] ?? 'bg-muted'}`}>KYC {rating}</span>;
}

export function DecisionBadge({ decision }: { decision?: string | null }) {
  if (!decision) return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">Open</span>;
  const m: Record<string, [string, string]> = {
    file_sar: ['SAR filed', 'bg-red-600 text-white'],
    escalate: ['Escalated', 'bg-amber-500 text-white'],
    close_no_sar: ['Closed — no SAR', 'bg-slate-200 text-slate-700'],
  };
  const [label, cls] = m[decision] ?? [decision, 'bg-muted'];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'alert' | 'ok' }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'alert' ? 'text-[#D1495B]' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
