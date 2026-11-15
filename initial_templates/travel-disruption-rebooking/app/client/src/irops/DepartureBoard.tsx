/**
 * The departures board — every cancelled Harlan flight out of ORD in departure order, split-flap
 * style. Each row is a link to the flight's re-accommodation workbench. Status flips as the desk plans
 * (CANCELLED → PLAN READY → AWAITING DM → REBOOKED), so the board is also the rebooking progress.
 */
import { clock, type FlightRow, type FlightStatus } from './api';
import { FlapText } from './FlapText';
import { cn } from './ui';

const BOARD_STATUS: Record<FlightStatus, { text: string; tone: 'red' | 'yellow' | 'amber' | 'green' }> = {
  unplanned: { text: 'CANCELLED', tone: 'red' },
  plan_drafted: { text: 'PLAN READY', tone: 'amber' },
  awaiting_approval: { text: 'AWAITING DM', tone: 'yellow' },
  committed: { text: 'REBOOKED', tone: 'green' },
};

export function DepartureBoard({ rows, onOpen }: { rows: FlightRow[]; onOpen: (id: string) => void }) {
  const sorted = [...rows].sort((a, b) => a.sched_dep.localeCompare(b.sched_dep) || a.flight_number.localeCompare(b.flight_number));
  return (
    <section aria-label="Departures from Chicago O'Hare" className="overflow-hidden rounded-xl border border-[#2A2E36] bg-[#0A0B0D] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between gap-2.5 border-b border-[#2A2E36] bg-[#121419] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="size-2 animate-pulse rounded-full bg-[var(--brand-5)]" />
          <FlapText text="ORD DEPARTURES" cells={14} className="text-[13px]" />
        </div>
        <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {rows.length} flights · Winter Storm Harlan
        </div>
      </div>
      <div className="grid grid-cols-[58px_84px_1fr_126px_40px_52px] gap-2.5 border-b border-[#2A2E36] px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        <span>Dep</span><span>Flight</span><span>To</span><span>Status</span><span className="text-right">Pax</span><span className="text-right">Home</span>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        {sorted.map((r) => {
          const st = BOARD_STATUS[r.status];
          const home = Math.round((100 * r.ap_same_day) / Math.max(1, r.pax));
          return (
            <button key={r.id} onClick={() => onOpen(r.id)}
              className="grid w-full grid-cols-[58px_84px_1fr_126px_40px_52px] items-center gap-2.5 border-b border-[#1B1E24] px-4 py-2 text-left transition-colors hover:bg-[#15181E]">
              <FlapText text={clock(r.sched_dep)} cells={5} className="text-[13px]" tone="amber" />
              <FlapText text={r.flight_number} cells={7} className="text-[13px]" tone="amber" />
              <span className="min-w-0 truncate font-mono text-[13px] text-[var(--brand-ink)]">
                <span className="font-semibold">{r.destination}</span>
                <span className="ml-2 text-[var(--muted-foreground)]">{(r.destination_city ?? '').toUpperCase()}</span>
              </span>
              <FlapText text={st.text} cells={11} className="text-[12px]" tone={st.tone} />
              <span className="text-right font-mono text-[13px] tabular-nums text-[var(--brand-ink)]">{r.pax}</span>
              <span className={cn('text-right font-mono text-[13px] tabular-nums', home < 25 ? 'text-[var(--brand-5)]' : 'text-[var(--brand-2)]')}>{home}%</span>
            </button>
          );
        })}
        {rows.length === 0 && <div className="px-4 py-6 font-mono text-sm text-[var(--muted-foreground)]">NO DEPARTURES</div>}
      </div>
    </section>
  );
}
