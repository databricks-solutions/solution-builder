/**
 * Split-flap display text: each character sits in its own dark tile with a mid-seam, the way an
 * airport departures board does. Pass `cells` to pad a field to a fixed column width so rows line up;
 * padding cells are left blank (no tile), so a short value never shows empty flap tiles.
 */
import { cn } from './ui';

export function FlapText({ text, cells, className, tone = 'amber' }: {
  text: string; cells?: number; className?: string; tone?: 'amber' | 'green' | 'red' | 'yellow' | 'dim';
}) {
  const value = cells ? text.toUpperCase().padEnd(cells).slice(0, cells) : text.toUpperCase();
  const color = {
    amber: 'text-[var(--brand-1)]', green: 'text-[var(--brand-2)]', red: 'text-[var(--brand-5)]',
    yellow: 'text-[var(--brand-4)]', dim: 'text-[var(--muted-foreground)]',
  }[tone];
  return (
    <span aria-label={text} className={cn('inline-flex gap-[2px] font-mono font-semibold leading-none', className)}>
      {Array.from(value).map((ch, i) =>
        ch === ' ' ? (
          <span key={i} aria-hidden="true" className="inline-flex h-[1.5em] w-[0.72em]" />
        ) : (
          <span key={i} aria-hidden="true"
            className={cn('relative inline-flex h-[1.5em] w-[0.72em] items-center justify-center overflow-hidden rounded-[3px] bg-[#16181D] text-[0.95em] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]', color)}>
            {ch}
            <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/80" />
          </span>
        ),
      )}
    </span>
  );
}
