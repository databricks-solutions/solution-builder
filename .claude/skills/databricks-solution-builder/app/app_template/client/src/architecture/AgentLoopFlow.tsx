/**
 * AgentLoopFlow — the "How the agent works" panel placed below the journey
 * diagram on the home page. Shows how one conversation becomes a multi-step
 * plan with a human-in-the-loop checkpoint:
 *
 *   Operator → [ ANALYSIS box: Agent Bricks · Genie · Lakebase ]
 *            → Propose action → fork{ Send email, Approve refunds }
 *   ──────── governed by Unity Catalog · AI Gateway ────────
 *
 * Purely visual — no live state. Tiles use the shared <Stage> primitive at
 * a slightly larger 50×50 size to read as a marketing panel; the analysis
 * box renders inline since it has three stacked MiniTiles instead of one.
 */
import { Connector, FlowKeyframes, Fork, Stage } from './Flow';
import {
  AgentBricksIcon,
  GatewayIcon,
  GenieIcon,
  LakebaseIcon,
  UCIcon,
} from './icons';

const OperatorIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#EF5B3F"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
  </svg>
);

const ProposeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#EF5B3F"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 12l2 2 4-4" />
  </svg>
);

const SendIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#EF5B3F"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
);

function MiniTile({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="grid place-items-center"
        style={{
          width: 38,
          height: 38,
          borderRadius: 9,
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,.15)',
        }}
      >
        <div style={{ width: 28, height: 28 }}>{icon}</div>
      </div>
      <span className="text-[13px] font-semibold text-foreground whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

/** Mobile-only horizontal row: tile + label, with an optional muted sub. */
function MobileStep({
  icon,
  label,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <div
        className="grid place-items-center shrink-0"
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: '#fff',
          boxShadow: '0 2px 10px rgba(0,0,0,.18)',
        }}
      >
        <div style={{ width: 26, height: 26 }}>{icon}</div>
      </div>
      <div className="text-sm font-semibold">
        {label}
        {sub && <span className="font-normal text-muted-foreground"> {sub}</span>}
      </div>
    </li>
  );
}

export function AgentLoopFlow() {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6 overflow-hidden">
      <FlowKeyframes />

      {/* header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          How the agent works
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5">
        The agent doesn't just diagnose — it{' '}
        <span className="font-medium text-foreground">takes the action</span>.
        Genie queries the data, you approve the plan, then the agent sends the
        apology emails and files the refunds, updating Lakebase live. One
        conversation, end to end.
      </p>

      {/* the loop — desktop */}
      <div className="hidden md:flex items-center justify-center" style={{ gap: 0, paddingBottom: 12 }}>
        <Stage tileSize={50} iconSize={32} icon={<OperatorIcon />} name="Operator" sub="asks the question" />
        <Connector width={56} centered />

        {/* analysis box */}
        <div
          className="rounded-xl border bg-background"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 14px',
            borderColor: 'var(--border)',
          }}
        >
          <div className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
            Agentic analysis
          </div>
          <MiniTile icon={<AgentBricksIcon />} label="Agent Bricks · orchestrates" />
          <MiniTile icon={<GenieIcon />} label="Genie · text → SQL" />
          <MiniTile icon={<LakebaseIcon />} label="Lakebase · queries the data" />
        </div>

        <Connector width={56} centered />
        <Stage tileSize={50} iconSize={32} icon={<ProposeIcon />} name="Propose action" sub="human approves" />
        <Fork />
        {/* Right column: top branch → Send email; bottom branch → Lakebase
            update. The Fork's two endpoints are at y=22 and y=108 within a
            130-tall box. justify-content: space-between lines the two
            <Stage> tiles up with those endpoints. */}
        <div
          className="flex flex-col"
          style={{ height: 130, justifyContent: 'space-between', flexShrink: 0 }}
        >
          <Stage tileSize={50} iconSize={32} icon={<SendIcon />} name="Send email" />
          <Stage tileSize={50} iconSize={32} icon={<LakebaseIcon />} name="Approve refunds" sub="update Lakebase" />
        </div>
      </div>

      {/* the loop — mobile: stack vertically without animated connectors */}
      <ol className="md:hidden flex flex-col gap-3 mt-2 mb-2">
        <MobileStep icon={<OperatorIcon />} label="Operator" sub="asks the question" />
        <li className="rounded-xl border border-border bg-background p-3 flex flex-col gap-2">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Agentic analysis</div>
          <MiniTile icon={<AgentBricksIcon />} label="Agent Bricks · orchestrates" />
          <MiniTile icon={<GenieIcon />} label="Genie · text → SQL" />
          <MiniTile icon={<LakebaseIcon />} label="Lakebase · queries the data" />
        </li>
        <MobileStep icon={<ProposeIcon />} label="Propose action" sub="human approves" />
        <MobileStep icon={<SendIcon />} label="Send email" />
        <MobileStep icon={<LakebaseIcon />} label="Approve refunds" sub="update Lakebase" />
      </ol>

      {/* governed strip */}
      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 mt-1 pt-2 border-t border-border">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Governed by
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 22, height: 22 }}><UCIcon /></span>
          <span className="text-sm font-semibold">Unity Catalog</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 22, height: 22 }}><GatewayIcon /></span>
          <span className="text-sm font-semibold">AI Gateway</span>
        </span>
      </div>
    </section>
  );
}
