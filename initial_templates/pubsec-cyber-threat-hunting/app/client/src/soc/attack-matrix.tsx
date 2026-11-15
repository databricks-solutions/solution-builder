/**
 * MITRE ATT&CK coverage matrix — tactics in kill-chain order, one column each.
 * Cell wash = how often the SIEM alerted on that technique (90 days). Border =
 * CDOR detection coverage, so the blind spots the attacker used are visible as
 * red dashed cells with no rule behind them.
 */
import { cn } from './ui';
import type { AttackCell } from './api';

const TACTICS = [
  'Initial Access', 'Execution', 'Persistence', 'Defense Evasion', 'Credential Access', 'Discovery',
  'Lateral Movement', 'Collection', 'Command and Control', 'Exfiltration', 'Impact',
];

const COVERAGE: Record<AttackCell['detection_coverage'], { label: string; cls: string }> = {
  full: { label: 'RULE', cls: 'border-l-2 border-l-[var(--success)]' },
  partial: { label: 'PARTIAL', cls: 'border-l-2 border-l-[var(--severity-warning)]' },
  none: { label: 'NO RULE', cls: 'border border-dashed border-[var(--brand-5)]' },
};

export function AttackMatrix({ cells }: { cells: AttackCell[] | null }) {
  if (cells === null) return <div className="h-48 rounded-md bg-[var(--muted)] animate-pulse" />;
  const max = Math.max(1, ...cells.map((c) => c.alerts));
  const byTactic = (t: string) => cells.filter((c) => c.tactic === t).sort((a, b) => a.technique_id.localeCompare(b.technique_id));
  const blind = cells.filter((c) => c.detection_coverage === 'none').length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        <span>Cell wash = SIEM alerts, 90 days</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-1 bg-[var(--success)]" />rule covers it</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-1 bg-[var(--severity-warning)]" />partial</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 border border-dashed border-[var(--brand-5)]" />no rule (blind spot)</span>
        <span className="ml-auto text-[var(--brand-5)]">{blind} blind-spot techniques</span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[1040px] grid-cols-11 gap-1">
          {TACTICS.map((t) => (
            <div key={t} className="flex min-w-0 flex-col gap-1">
              <div className="h-8 border-b border-[var(--border)] px-1 pb-1 font-mono text-[10px] uppercase leading-tight tracking-wide text-[var(--muted-foreground)]">{t}</div>
              {byTactic(t).map((c) => {
                const heat = c.alerts / max;
                const cov = COVERAGE[c.detection_coverage] ?? COVERAGE.none;
                return (
                  <div
                    key={c.technique_id}
                    title={`${c.technique_id} ${c.technique_name} · ${c.alerts} alerts · ${c.true_positives} true positive · ${cov.label}`}
                    className={cn('rounded-sm px-1.5 py-1.5', cov.cls)}
                    style={{ background: heat > 0 ? `rgba(63, 208, 224, ${(0.08 + heat * 0.55).toFixed(3)})` : 'transparent' }}
                  >
                    <div className="font-mono text-[10px] text-[var(--primary-light)]">{c.technique_id}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug">{c.technique_name}</div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 font-mono text-[10px] text-[var(--muted-foreground)]">
                      <span className="tabular-nums">{c.alerts ? `${c.alerts} alerts` : '—'}</span>
                      <span className={cn(c.detection_coverage === 'none' && 'text-[var(--brand-5)] font-semibold')}>{cov.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
