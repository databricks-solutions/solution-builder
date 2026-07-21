import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  GraduationCap,
  MessagesSquare,
  Network,
  Sparkles,
} from "lucide-react";
import { AnyIcon } from "@/components/project/platform-diagram/annotations";
import { useNavigate } from "@tanstack/react-router";

// ────────────────────────────────────────────────────────────────────────────
// Motion helpers
//
// Design goal: BIG, bold, always-alive animations legible to a non-technical
// viewer at a glance. Every visual has (1) a strong overshoot entrance and
// (2) continuous ambient motion so nothing ever sits still. Reduced-motion
// users get the finished, static state.
// ────────────────────────────────────────────────────────────────────────────

interface VisualProps {
  active: boolean;
}

// Re-plays each visual's entrance on a loop by bumping a key. Snappy period so
// the "reveal" repeats often enough to feel lively without being frantic.
function useCycle(active: boolean, periodMs: number) {
  const [cycle, setCycle] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!active || reduce) return;
    const id = setInterval(() => setCycle((c) => c + 1), periodMs);
    return () => clearInterval(id);
  }, [active, reduce, periodMs]);
  return reduce ? 0 : cycle;
}

// Strong overshoot pop — the workhorse entrance for tiles/chips.
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.35 } },
};
const popBig = {
  hidden: { opacity: 0, scale: 0.4, y: 24, rotate: -6 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    rotate: 0,
    transition: { type: "spring" as const, stiffness: 460, damping: 18, mass: 0.7 },
  },
};

// A thick pipe with several particles streaming along it — the "flow" between
// two stages. Bold and continuous so the eye follows the direction of travel.
function FlowPipe({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={"relative h-2.5 shrink-0 overflow-hidden rounded-full bg-primary/15 " + className}>
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ background: "linear-gradient(90deg, transparent, var(--color-primary), transparent)" }}
        initial={{ x: "-100%" }}
        animate={reduce ? { x: 0 } : { x: ["-100%", "100%"] }}
        transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
      />
      {!reduce &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_var(--color-primary)]"
            initial={{ left: "-6%", opacity: 0 }}
            animate={{ left: ["-6%", "106%"], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.35, delay: i * 0.32 }}
          />
        ))}
    </div>
  );
}

// A soft radial glow that breathes — dropped behind hero elements to add depth
// and constant, gentle motion.
function BreathingGlow({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <motion.div
      aria-hidden
      className={"pointer-events-none absolute rounded-full blur-3xl " + className}
      style={{ background: "radial-gradient(circle, var(--color-primary), transparent 70%)" }}
      animate={{ opacity: [0.12, 0.28, 0.12], scale: [0.9, 1.1, 0.9] }}
      transition={{ duration: 4, ease: "easeInOut", repeat: Infinity }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page 1 — a prompt turns into a real, complete Databricks project
// ────────────────────────────────────────────────────────────────────────────

const PROJECT_TILES = [
  { icon: "dbTable", label: "Data" },
  { icon: "sdpBrand", label: "Pipeline" },
  { icon: "aibiBrand", label: "Dashboard" },
  { icon: "genieBrand", label: "Genie" },
  { icon: "databricksAppsBrand", label: "App" },
] as const;

function PromptToProjectVisual({ active }: VisualProps) {
  const reduce = useReducedMotion();
  const cycle = useCycle(active, 4600);
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-3 px-6">
      <BreathingGlow className="left-1/3 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2" />

      {/* the prompt — floats gently, forever */}
      <motion.div
        className="relative z-10 w-[260px] shrink-0"
        animate={reduce ? {} : { y: [0, -8, 0] }}
        transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
      >
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            <MessagesSquare className="h-4 w-4" />
            Your prompt
          </div>
          <p className="text-[15px] font-medium leading-snug text-foreground">
            &ldquo;A customer-churn demo for a telco — with a dashboard and a Genie space.&rdquo;
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary ring-1 ring-primary/25">
            <Database className="h-3 w-3" />
            synthetic or your own data
          </div>
        </div>
      </motion.div>

      <FlowPipe className="z-10 w-16" />

      {/* the resulting project — big tiles slam in on a loop */}
      <motion.div
        key={cycle}
        className="relative z-10 w-[300px] shrink-0 rounded-2xl border-2 border-primary/30 bg-primary/[0.05] p-4 shadow-xl"
        variants={container}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <div className="mb-3 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-primary">
          <Sparkles className="h-4 w-4" />
          Your Databricks project
        </div>
        <div className="flex flex-wrap gap-2.5">
          {PROJECT_TILES.map((t) => (
            <motion.div
              key={t.label}
              variants={popBig}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-[14px] font-semibold shadow-md"
            >
              <AnyIcon iconKey={t.icon} className="h-6 w-6 [&_svg]:h-6 [&_svg]:w-6" />
              {t.label}
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page 2 — publish a project as a template; other teams fork + re-adapt it
// ────────────────────────────────────────────────────────────────────────────

const SHARE_TARGETS = [
  { industry: "Retail", note: "re-adapted the blueprint", primary: true },
  { industry: "Financial services", note: "Risk & fraud team", primary: false },
  { industry: "Healthcare", note: "Patient insights team", primary: false },
];

function ShareTemplateVisual({ active }: VisualProps) {
  const reduce = useReducedMotion();
  const cycle = useCycle(active, 5200);
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-3 px-6">
      <BreathingGlow className="left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2" />

      {/* source blueprint — floats; the Template badge slams in */}
      <motion.div
        key={cycle}
        className="relative z-10 w-[250px] shrink-0"
        animate={reduce ? {} : { y: [0, -8, 0] }}
        transition={{ duration: 3.4, ease: "easeInOut", repeat: Infinity }}
      >
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
          <div className="text-[16px] font-bold leading-snug text-foreground">
            Customer Segmentation
          </div>
          <div className="mt-2 inline-block rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            Media &amp; Advertising
          </div>
          <div className="mt-3 flex gap-1.5">
            {["sdpBrand", "aibiBrand", "genieBrand"].map((icon) => (
              <span key={icon} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/40">
                <AnyIcon iconKey={icon} className="h-5 w-5 [&_svg]:h-5 [&_svg]:w-5" />
              </span>
            ))}
          </div>
        </div>
        <motion.div
          className="absolute -right-3 -top-3 flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[12px] font-bold text-primary-foreground shadow-lg"
          initial={reduce ? false : { opacity: 0, scale: 0, rotate: -20 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 14, delay: 0.4 }}
        >
          <Check className="h-3.5 w-3.5" />
          Published
        </motion.div>
      </motion.div>

      <FlowPipe className="z-10 w-16" />

      {/* other teams fork + re-adapt it to their industry — big chips */}
      <motion.div
        key={`t-${cycle}`}
        className="z-10 flex w-[280px] shrink-0 flex-col gap-2.5"
        variants={container}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        {SHARE_TARGETS.map((t) => (
          <motion.div
            key={t.industry}
            variants={popBig}
            className={
              "flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 shadow-md " +
              (t.primary ? "border-primary/50 bg-primary/[0.07]" : "border-border bg-card")
            }
          >
            <span
              className={
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[16px] font-black " +
                (t.primary ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
              }
            >
              {t.industry[0]}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[14px] font-bold text-foreground">{t.industry}</div>
              <div className="truncate text-[11px] font-medium text-muted-foreground">{t.note}</div>
            </div>
            {t.primary && (
              <motion.span
                className="ml-auto text-primary"
                animate={reduce ? {} : { scale: [1, 1.25, 1] }}
                transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
              >
                <Sparkles className="h-5 w-5" />
              </motion.span>
            )}
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pages
// ────────────────────────────────────────────────────────────────────────────

function HeroPage({
  eyebrow,
  title,
  body,
  Visual,
  active,
}: {
  eyebrow: string;
  title: string;
  body: string;
  Visual: ComponentType<VisualProps>;
  active: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center px-10 pt-9 text-center">
      <span className="text-[12px] font-bold uppercase tracking-[0.2em] text-primary">
        {eyebrow}
      </span>
      <h2 className="mt-2 text-[28px] font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="relative mt-6 flex w-full flex-1 items-center justify-center overflow-hidden rounded-3xl border border-border/50 bg-gradient-to-b from-muted/10 to-muted/30">
        <Visual active={active} />
      </div>
    </div>
  );
}

// The three ways to start — big, plainly-worded cards (revamp of the old 3-pane).
// `id` matches the home page's entry-mode tab so a click can deep-link straight
// to it (see GuideProvider.onStart → /?start=<id>).
export type StartMode = "story" | "architecture" | "workshop";

const START_MODES: { id: StartMode; Icon: typeof MessagesSquare; title: string; body: string }[] = [
  {
    id: "story",
    Icon: MessagesSquare,
    title: "Describe it — we build it",
    body: "Type an idea. The agent designs the story and builds every resource.",
  },
  {
    id: "architecture",
    Icon: Network,
    title: "Start from a diagram",
    body: "Sketch the architecture, then generate the whole solution from it.",
  },
  {
    id: "workshop",
    Icon: GraduationCap,
    title: "Run a live workshop",
    body: "The agent writes the prompts; your team builds it live in Genie Code.",
  },
];

function StartPage({ active, onPick }: VisualProps & { onPick?: (mode: StartMode) => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full flex-col items-center px-10 pt-9 text-center">
      <span className="text-[12px] font-bold uppercase tracking-[0.2em] text-primary">
        Get started
      </span>
      <h2 className="mt-2 text-[28px] font-bold tracking-tight text-foreground">
        Pick how you want to begin
      </h2>
      <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
        Three ways in — every one lands you a complete, editable Databricks project.
      </p>
      <motion.div
        className="mt-7 grid w-full flex-1 grid-cols-1 gap-5 md:grid-cols-3"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } } }}
        initial={reduce || !active ? false : "hidden"}
        animate="show"
      >
        {START_MODES.map((m) => {
          const Icon = m.Icon;
          return (
            <motion.button
              key={m.id}
              type="button"
              onClick={() => onPick?.(m.id)}
              variants={popBig}
              whileHover={reduce ? undefined : { y: -6, scale: 1.03 }}
              className="flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-border bg-card p-6 text-center shadow-md transition-colors hover:border-primary/50 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <motion.span
                className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/25"
                animate={reduce ? {} : { y: [0, -5, 0] }}
                transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity }}
              >
                <Icon className="h-8 w-8" />
              </motion.span>
              <div>
                <h3 className="text-[17px] font-bold leading-snug text-foreground">{m.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{m.body}</p>
              </div>
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}

interface Page {
  id: string;
  render: (active: boolean, onPick: (mode: StartMode) => void) => ReactNode;
}

const PAGES: Page[] = [
  {
    id: "welcome",
    render: (active) => (
      <HeroPage
        active={active}
        eyebrow="Welcome to Solution Builder"
        title="Your prompt becomes a real project"
        body="Describe a use-case and the agent assembles a complete, working Databricks solution — pipelines, dashboards, Genie, apps — on synthetic or your own data."
        Visual={PromptToProjectVisual}
      />
    ),
  },
  {
    id: "share",
    render: (active) => (
      <HeroPage
        active={active}
        eyebrow="Build once, share everywhere"
        title="Share your work as a template"
        body="Publish any project as a template and other teams can fork it. A great segmentation blueprint for Media & Advertising becomes a Retail one in minutes."
        Visual={ShareTemplateVisual}
      />
    ),
  },
  {
    id: "start",
    render: (active, onPick) => <StartPage active={active} onPick={onPick} />,
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Provider + storage (unchanged behaviour: auto-open first launch or ?guide=1)
// ────────────────────────────────────────────────────────────────────────────

// Bump suffix when the guide content changes materially so returning users see
// the new guide once on their next visit.
const STORAGE_KEY = "guide-seen-v4";
const URL_PARAM = "guide";

interface GuideContextValue {
  open: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) {
    throw new Error("useGuide must be used within a <GuideProvider />");
  }
  return ctx;
}

interface GuideProviderProps {
  children: ReactNode;
}

export function GuideProvider({ children }: GuideProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  // Persist "guide seen" so it doesn't auto-open again. Shared by the normal
  // close and the start-card deep-link.
  const markSeen = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignore — we'll just re-prompt next session.
    }
  }, []);

  // A start-card click deep-links to the home page with the matching entry
  // tab pre-selected (index.tsx reads ?start=<mode>). Workshop is behind the
  // preview flag, so also flip preview=on there or the tab won't render.
  const handleStart = useCallback(
    (mode: StartMode) => {
      setIsOpen(false);
      markSeen();
      const search: Record<string, string> = { start: mode };
      if (mode === "workshop") search.preview = "on";
      navigate({ to: "/", search });
    },
    [navigate, markSeen],
  );

  // Auto-open on first launch OR when ?guide=1 is present in the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const forced = new URLSearchParams(window.location.search).get(URL_PARAM);
      if (forced) {
        setIsOpen(true);
        return;
      }
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setIsOpen(true);
      }
    } catch {
      // localStorage / URL may be unavailable — skip auto-open silently.
    }
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setIsOpen(next);
    if (!next && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, "true");
        // Strip the ?guide param so a refresh doesn't reopen it.
        const url = new URL(window.location.href);
        if (url.searchParams.has(URL_PARAM)) {
          url.searchParams.delete(URL_PARAM);
          window.history.replaceState({}, "", url.toString());
        }
      } catch {
        // Ignore — we'll just re-prompt next session.
      }
    }
  }, []);

  const open = useCallback(() => setIsOpen(true), []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <GuideContext.Provider value={value}>
      {children}
      <GuideModal open={isOpen} onOpenChange={handleOpenChange} onStart={handleStart} />
    </GuideContext.Provider>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// The paginated modal
// ────────────────────────────────────────────────────────────────────────────

const pageVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 64 : -64, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -64 : 64, opacity: 0 }),
};

interface GuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A start-card click — deep-links to the home page's matching entry tab. */
  onStart: (mode: StartMode) => void;
}

function GuideModal({ open, onOpenChange, onStart }: GuideModalProps) {
  // [page index, direction] — direction drives the slide on navigation.
  const [[page, dir], setPage] = useState<[number, number]>([0, 0]);
  const isLast = page === PAGES.length - 1;

  // Reset to the first page whenever the modal (re)opens.
  useEffect(() => {
    if (open) setPage([0, 0]);
  }, [open]);

  const paginate = useCallback((delta: number) => {
    setPage(([p]) => {
      const next = Math.min(Math.max(p + delta, 0), PAGES.length - 1);
      return [next, delta];
    });
  }, []);

  const goTo = useCallback(
    (idx: number) => setPage(([p]) => [idx, idx > p ? 1 : -1]),
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[680px] max-h-[94vh] max-w-[min(96vw,1040px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1040px)]">
        <DialogTitle className="sr-only">Welcome to Solution Builder</DialogTitle>
        <DialogDescription className="sr-only">
          A quick tour: turn prompts into real Databricks projects, share them as templates
          across teams, and pick how you want to start.
        </DialogDescription>

        {/* Paginated body */}
        <div className="relative flex-1 overflow-hidden">
          <AnimatePresence custom={dir} mode="wait" initial={false}>
            <motion.div
              key={PAGES[page].id}
              custom={dir}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="absolute inset-0"
            >
              {PAGES[page].render(open, onStart)}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer: Back · dots · Next / Get started */}
        <div className="flex shrink-0 items-center justify-between border-t border-border/60 bg-muted/20 px-6 py-4">
          <div className="w-[120px]">
            {page > 0 && (
              <Button variant="ghost" size="sm" onClick={() => paginate(-1)}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {PAGES.map((p, i) => (
              <button
                key={p.id}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => goTo(i)}
                className={
                  "h-2.5 rounded-full transition-all " +
                  (i === page ? "w-7 bg-primary" : "w-2.5 bg-border hover:bg-primary/40")
                }
              />
            ))}
          </div>

          <div className="flex w-[120px] justify-end">
            {isLast ? (
              <Button size="lg" onClick={() => onOpenChange(false)}>
                Get started
              </Button>
            ) : (
              <Button size="lg" onClick={() => paginate(1)}>
                Next
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
