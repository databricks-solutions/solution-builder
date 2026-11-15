/**
 * Entity swimlane timeline — one row per log source (sign-in, VPN, EDR, DNS) on a
 * shared time axis. The eye reads the attack as a band: the same entity moving
 * from identity to network to endpoint in the same few hours.
 */
import type { Evidence } from './api';
import { cn } from './ui';

type Ev = Evidence['events'][number];

const LANES: Array<{ src: string; label: string; color: string }> = [
  { src: 'auth', label: 'SIGN-IN', color: '#7FB2E6' },
  { src: 'vpn', label: 'VPN', color: '#B38CFF' },
  { src: 'endpoint', label: 'EDR', color: '#FF9F1C' },
  { src: 'dns', label: 'DNS', color: '#5CCFBE' },
];

function fmt(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function SwimlaneTimeline({ events, className }: { events: Ev[]; className?: string }) {
  const pts = events
    .map((e) => ({ ...e, t: Date.parse(e.ts.replace(' ', 'T')) }))
    .filter((e) => Number.isFinite(e.t) && LANES.some((l) => l.src === e.src));
  if (pts.length === 0) {
    return <div className={cn('h-40 rounded-md bg-[var(--muted)] animate-pulse', className)} />;
  }
  const t0 = Math.min(...pts.map((p) => p.t));
  const t1 = Math.max(...pts.map((p) => p.t));
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => `${(((t - t0) / span) * 100).toFixed(2)}%`;

  return (
    <div className={cn('font-mono text-[10px]', className)}>
      {LANES.map((lane) => {
        const mine = pts.filter((p) => p.src === lane.src);
        return (
          <div key={lane.src} className="grid grid-cols-[64px_1fr] items-center gap-2 border-b border-[var(--border)] py-2 last:border-0">
            <div className="text-[var(--muted-foreground)] tracking-wide" style={{ color: lane.color }}>{lane.label}</div>
            <div className="relative h-5 rounded-sm bg-[var(--canvas-soft,#0A0E13)]">
              <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
              {mine.length === 0 && (
                <span className="absolute inset-0 flex items-center pl-2 text-[var(--muted-foreground)]">no {lane.label} events</span>
              )}
              {mine.map((p) => (
                <span
                  key={`${p.t}-${p.detail}`}
                  title={`${fmt(p.t)} · ${p.detail}`}
                  className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-[1px]"
                  style={{ left: x(p.t), background: lane.color, boxShadow: p.detail.includes('UNMANAGED') || p.detail.includes('RDP') ? '0 0 0 2px #FF4D5E' : undefined }}
                />
              ))}
            </div>
          </div>
        );
      })}
      <div className="mt-2 grid grid-cols-[64px_1fr] gap-2 text-[var(--muted-foreground)]">
        <span />
        <div className="flex justify-between">
          <span>{fmt(t0)}</span>
          <span>{fmt(t1)}</span>
        </div>
      </div>
      <div className="mt-1 grid grid-cols-[64px_1fr] gap-2 text-[var(--muted-foreground)]">
        <span />
        <span className="text-[var(--brand-5)]">red ring = unmanaged device or RDP</span>
      </div>
    </div>
  );
}
