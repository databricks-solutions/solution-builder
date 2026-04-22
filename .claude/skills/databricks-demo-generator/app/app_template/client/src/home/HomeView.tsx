/**
 * Home / landing page.
 *
 * Template concern: this is where you tell the STORY of the use case.
 * The narrative pieces (hero persona, story headline + situation + goal,
 * "journey diagram" quotes, starter prompts, featuredAction, and the
 * scripted 3-step `assistantScript`) are ALL config-driven via
 * `config/app.json` → rendered here. To repurpose this template for a
 * different use case, you typically only need to rewrite `config/app.json`
 * + the agent tools + instructions in `server/agent/<yourAgent>.ts`.
 *
 * The journey diagram's 4 cards wire into the floating chat dock via
 * `dockController` (pub/sub in `chat/dockController.ts`) — clicking a card
 * either navigates somewhere, opens the dock, or opens the dock and
 * auto-sends a scripted prompt. That's the "see the demo in action" path.
 */
import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  ArrowDown,
  Brain,
  CheckCircle2,
  Eye,
  Mail,
  MessageCircleQuestion,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { fetchConfig, type AppConfig, type ScriptStep } from '@/lib/api';
import { fetchActivity, type ActivityEvent } from '@/lib/returns';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';

export function HomeView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchConfig().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    const reload = () => fetchActivity(20).then(setActivity).catch(console.error);
    void reload();
    return dataMutated.subscribe(reload);
  }, []);

  if (!config) {
    return <div className="p-12 text-muted-foreground">Loading…</div>;
  }

  const { hero, story, starterQuestions, featuredAction } = config;
  const heroFirstName = hero?.name.split(/\s+/)[0] ?? 'you';

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-14 space-y-14">
        {/* Hero */}
        <section className="space-y-5">
          {hero && (
            <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <span className="inline-block h-px w-8 bg-foreground/40" />
              {hero.name} · {hero.role}
            </div>
          )}
          <h1 className="display text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight text-foreground">
            {story?.headline ?? 'Ask your assistant anything.'}
          </h1>
          {story?.situation && (
            <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
              {story.situation}
            </p>
          )}
          {story?.goal && (
            <p
              className="inline-block text-sm text-foreground italic border-l-2 pl-3 py-0.5 max-w-3xl"
              style={{ borderColor: 'var(--accent)' }}
            >
              <span className="font-semibold not-italic uppercase tracking-[0.15em] text-xs text-muted-foreground mr-2">
                Goal
              </span>
              {story.goal}
            </p>
          )}
        </section>

        {/* Persona journey diagram */}
        <section className="space-y-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            A week of work · before noon
          </div>
          <JourneyDiagram heroName={heroFirstName} script={config.assistantScript} />
          <p className="text-sm text-foreground/80 leading-relaxed max-w-3xl">
            <span className="font-medium">One person. One conversation.</span>{' '}
            What used to take a cross-functional team a week — analysts pulling
            data, CSMs drafting emails, ops approving refunds — is done by noon.
          </p>
        </section>

        {/* Starter prompts — each opens the floating assistant dock */}
        {starterQuestions.length > 0 && (
          <section className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Try asking
            </div>
            <div className="flex flex-wrap gap-2">
              {starterQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => dockController.newAndSend(q)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground/30 hover:shadow-sm transition-all"
                >
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  {q}
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Featured action — climax */}
        {featuredAction && (
          <section>
            <div
              className="rounded-2xl p-7 relative overflow-hidden"
              style={{
                background:
                  'linear-gradient(135deg, color-mix(in oklch, var(--primary) 96%, white) 0%, color-mix(in oklch, var(--primary) 88%, var(--accent) 12%) 100%)',
                color: 'var(--primary-foreground)',
              }}
            >
              <div
                className="absolute -right-16 -top-16 size-52 rounded-full opacity-20"
                style={{ background: 'var(--accent)' }}
              />
              <div className="relative">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80 mb-3">
                  <Zap className="size-3.5" />
                  Let the assistant handle it
                </div>
                <h3 className="display text-2xl font-semibold mb-2 leading-tight">
                  {featuredAction.title}
                </h3>
                <p className="text-sm opacity-85 leading-relaxed mb-5 max-w-2xl">
                  {featuredAction.description}
                </p>
                <button
                  onClick={() => dockController.newAndSend(featuredAction.prompt)}
                  className="inline-flex items-center gap-2 rounded-full bg-background text-foreground px-5 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Run this <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Proof — activity feed */}
        {activity.length > 0 && (
          <section className="space-y-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent activity
            </div>
            <ActivityFeed
              events={activity}
              onJumpToReturn={(id) => navigate(`/operations?return=${id}`)}
            />
          </section>
        )}
      </div>
    </div>
  );
}

// --- Journey diagram -------------------------------------------------------

/**
 * Four-step narrative. Each step is clickable and fires the demo:
 *   - "Claire operates"    → navigate to Operations page
 *   - "She asks"           → open dock, auto-send "Why so many returns?"
 *   - "AI investigates"    → open dock (shows the investigation in progress)
 *   - "AI takes action"    → open dock, auto-send the final "send it" prompt
 *
 * `script` comes from config — the handlers pull the matching prompts.
 */
function JourneyDiagram({
  heroName,
  script,
}: {
  heroName: string;
  script: ScriptStep[];
}) {
  const navigate = useNavigate();
  const step0 = script[0];
  const step1 = script[1];
  const step2 = script[2];

  const steps = [
    {
      icon: <Eye className="size-5" />,
      role: `${heroName} operates`,
      quote: '"Returns are everywhere — my dashboard lit up."',
      highlight: false,
      cta: 'Open the queue →',
      onClick: () => navigate('/operations'),
    },
    {
      icon: <MessageCircleQuestion className="size-5" />,
      role: 'She asks',
      quote: '"Why do I have so many returns?"',
      highlight: false,
      cta: 'Ask the assistant →',
      onClick: () =>
        step0
          ? dockController.newAndSend(step0.prompt)
          : dockController.open(),
    },
    {
      icon: <Brain className="size-5" />,
      role: 'AI investigates',
      quote: '"A bad production batch at one facility. 3 SKUs. Quality issue on the line."',
      highlight: true,
      cta: 'See the answer →',
      onClick: () => dockController.open(),
    },
    {
      icon: <Wrench className="size-5" />,
      role: 'AI takes action',
      quote: '"Drafted an apology with a 20% coupon. Reviewed. Sent. Refunds approved."',
      highlight: true,
      cta: 'Run the workflow →',
      onClick: () => {
        // Fire step-1 (accept + draft). If user is mid-chain the dock will
        // still open; they can then click "Yes — send it" from the chip.
        if (step1) dockController.openAndSend(step1.prompt);
        else if (step2) dockController.openAndSend(step2.prompt);
        else dockController.open();
      },
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
      {steps.map((s, i) => (
        <Fragment key={i}>
          <button
            onClick={s.onClick}
            className={`text-left rounded-xl px-4 py-4 flex flex-col gap-2 transition-all hover:shadow-sm ${
              s.highlight
                ? 'border-2 bg-card hover:bg-card'
                : 'border border-border bg-card hover:border-foreground/30'
            }`}
            style={s.highlight ? { borderColor: 'var(--accent)' } : undefined}
          >
            <div
              className="size-8 rounded-lg flex items-center justify-center"
              style={{
                background: s.highlight ? 'var(--accent)' : 'var(--muted)',
                color: s.highlight ? 'var(--accent-foreground)' : 'var(--foreground)',
              }}
            >
              {s.icon}
            </div>
            <div className="text-sm font-semibold text-foreground">{s.role}</div>
            <div className="text-xs text-muted-foreground leading-snug italic">
              {s.quote}
            </div>
            <div className="text-[11px] font-medium text-foreground/70 mt-1">
              {s.cta}
            </div>
          </button>
          {i < steps.length - 1 && (
            <>
              <div className="hidden md:flex items-center justify-center text-muted-foreground">
                <ArrowRight className="size-4" />
              </div>
              <div className="md:hidden flex items-center justify-center text-muted-foreground py-1">
                <ArrowDown className="size-4" />
              </div>
            </>
          )}
        </Fragment>
      ))}
    </div>
  );
}

// --- Activity feed ---------------------------------------------------------

function ActivityFeed({
  events,
  onJumpToReturn,
}: {
  events: ActivityEvent[];
  onJumpToReturn: (returnId: string) => void;
}) {
  return (
    <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
      {events.map((e, i) => (
        <li
          key={i}
          className="px-4 py-3 flex items-start gap-3 text-sm"
        >
          <ActivityIcon kind={e.kind} />
          <div className="flex-1 min-w-0">
            <ActivityBody event={e} onJumpToReturn={onJumpToReturn} />
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {relativeTime(e.at)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityIcon({ kind }: { kind: ActivityEvent['kind'] }) {
  const Icon = kind === 'email' ? Mail : CheckCircle2;
  const bg =
    kind === 'email'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-emerald-100 text-emerald-800';
  return (
    <div
      className={`size-7 rounded-full flex items-center justify-center shrink-0 ${bg}`}
    >
      <Icon className="size-3.5" />
    </div>
  );
}

function ActivityBody({
  event,
  onJumpToReturn,
}: {
  event: ActivityEvent;
  onJumpToReturn: (returnId: string) => void;
}) {
  if (event.kind === 'email') {
    return (
      <>
        <div className="text-foreground truncate">
          <span className="font-medium">Email</span> to{' '}
          <span className="text-muted-foreground">{event.to ?? '—'}</span>:{' '}
          <span className="text-muted-foreground">"{event.subject}"</span>
        </div>
        <button
          onClick={() => onJumpToReturn(event.return_id)}
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          View return →
        </button>
      </>
    );
  }
  return (
    <>
      <div className="text-foreground">
        <span className="font-medium capitalize">{event.action}</span>
        {event.notes && (
          <span className="text-muted-foreground"> · {event.notes}</span>
        )}
        <span className="text-xs text-muted-foreground ml-2">by {event.by}</span>
      </div>
      <button
        onClick={() => onJumpToReturn(event.return_id)}
        className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        View return →
      </button>
    </>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - d) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
