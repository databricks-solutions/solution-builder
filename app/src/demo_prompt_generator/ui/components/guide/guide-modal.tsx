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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bot, ArrowRight } from "lucide-react";
import { AnyIcon } from "@/components/project/platform-diagram/annotations";

interface GuideVisualProps {
  active: boolean;
}

// Drives a looping step sequence: advances 0 → 1 → … → count (a trailing
// "all done" pause), then restarts. `stepMs` per step; the full cycle lands
// around count*stepMs + pause. Used to sequence the laser/brick animations so
// exactly one beam is live at a time and the whole thing loops (~10s).
function useLoopStep(count: number, active: boolean, stepMs: number, pauseMs: number) {
  const [step, setStep] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!active || reduce) {
      setStep(count); // show the finished state, no motion
      return;
    }
    setStep(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      if (i > count) {
        // finished a cycle → hold, then restart from 0
        timer = setTimeout(() => {
          i = 0;
          setStep(0);
          timer = setTimeout(tick, stepMs);
        }, pauseMs);
        return;
      }
      setStep(i);
      timer = setTimeout(tick, stepMs);
    };
    timer = setTimeout(tick, stepMs);
    return () => clearTimeout(timer);
  }, [active, reduce, count, stepMs, pauseMs]);
  return step;
}

// A "funky" laser beam between two points: a soft glowing underlay, a bright
// core that draws in, and a hot dot that races along it. Rendered inside an
// SVG using the shared <LaserDefs/> gradient + glow filter. `k` keys the
// AnimatePresence enter/exit so each firing animates fresh.
function LaserDefs() {
  return (
    <defs>
      <linearGradient id="laserGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.15" />
        <stop offset="55%" stopColor="var(--color-primary)" stopOpacity="1" />
        <stop offset="100%" stopColor="#fff" stopOpacity="1" />
      </linearGradient>
      <filter id="laserGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.2" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function LaserBeam({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const common = { x1, y1, x2, y2, strokeLinecap: "round" as const };
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
    >
      {/* soft glow underlay */}
      <motion.line
        {...common}
        stroke="var(--color-primary)" strokeWidth={5} strokeOpacity={0.18}
        filter="url(#laserGlow)"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
      {/* bright core drawing in */}
      <motion.line
        {...common}
        stroke="url(#laserGrad)" strokeWidth={2}
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
      {/* hot dot racing along the beam */}
      <motion.circle
        r={2.6} fill="#fff" filter="url(#laserGlow)"
        initial={{ cx: x1, cy: y1, opacity: 0 }}
        animate={{ cx: [x1, x2], cy: [y1, y2], opacity: [0, 1, 1, 0] }}
        transition={{ duration: 0.6, ease: "easeOut", repeat: Infinity, repeatDelay: 0.4 }}
      />
    </motion.g>
  );
}

// ── Story: an agent wiring bricks with a laser, one by one ──────────────────
// The bot fires a laser to a brick → the brick lands → the laser vanishes →
// the next beam fires. Loops with a short pause. Coords are in the SVG viewBox
// (0..300 × 0..180), stretched to the band; the beam ends AT the brick's left
// edge (BEAM_END) so there's no gap.
function AgentBuildsVisual({ active }: GuideVisualProps) {
  const bricks = [
    { label: "Data", icon: "dbTable" },
    { label: "Pipeline", icon: "sdpBrand" },
    { label: "Dashboard", icon: "aibiBrand" },
    { label: "Genie", icon: "genieBrand" },
  ];
  const step = useLoopStep(bricks.length, active, 1400, 1800);
  // Flow: Agent ⇒ "Build the story" (vertical) → laser → bricks.
  // The beam emits from just past the vertical label box.
  const ORIGIN = { x: 112, y: 90 }; // right edge of the [agent ⇒ label] group
  const BEAM_END = 200; // brick left edge
  const rowY = (i: number) => 22 + i * 45; // matches the 4 stacked bricks
  return (
    <div className="relative flex h-full w-full items-center justify-between gap-3 px-5">
      {/* laser overlay — exactly ONE beam live at a time (step === i+1) */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 180" preserveAspectRatio="none">
        <LaserDefs />
        <AnimatePresence>
          {bricks.map((_, i) =>
            step === i + 1 ? (
              <LaserBeam key={i} x1={ORIGIN.x} y1={ORIGIN.y} x2={BEAM_END} y2={rowY(i)} />
            ) : null,
          )}
        </AnimatePresence>
      </svg>
      <div className="relative z-10 flex h-full items-center gap-2">
        {/* Agent */}
        <div className="flex flex-col items-center gap-1 text-primary">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
            <Bot className="h-6 w-6" />
          </div>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Agent</span>
        </div>
        {/* Agent ⇒ Build the story */}
        <span className="shrink-0 text-sm text-primary/70">⇒</span>
        {/* vertical "Build the story" label in a small white box — laser emits from here */}
        <span className="shrink-0 rounded-md border border-border bg-card px-1.5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground shadow-sm [writing-mode:vertical-rl] rotate-180">
          Build the story
        </span>
      </div>
      <div className="relative z-10 flex h-full items-center">
        <div className="flex flex-col items-stretch gap-2">
          {bricks.map((b, i) => (
            <motion.div
              key={b.label}
              className="flex items-center gap-1.5 rounded-md border border-primary/25 bg-card px-2.5 py-1.5 text-[11px] font-medium shadow-sm"
              initial={false}
              // Land the brick shortly after its beam starts drawing.
              animate={step >= i + 1 ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 14, scale: 0.9 }}
              transition={{ delay: 0.35, type: "spring", stiffness: 320, damping: 22 }}
            >
              <AnyIcon iconKey={b.icon} className="h-3.5 w-3.5 [&_svg]:h-3.5 [&_svg]:w-3.5" />
              {b.label}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Architecture: the real diagram SVG, gently revealed ─────────────────────
function ArchitectureSvgVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();
  return (
    <motion.img
      src="/architecture.svg"
      alt="Example Databricks architecture"
      className="h-full w-full object-contain p-3"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={active ? { opacity: 1, scale: 1 } : { opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }}
    />
  );
}

// ── Genie Code: stacked prompts → arrow → Genie Code logo → lasers build bricks ─
// The prompts stack on the left and feed (arrow) the Genie Code logo; the logo
// then fires a laser to each brick in turn — beam draws → brick lands → beam
// vanishes → next. Loops with a short pause.
function GenieCodeVisual({ active }: GuideVisualProps) {
  const prompts = ["build the silver table", "create the dashboard", "wire up Genie"];
  const bricks = ["sdpBrand", "aibiBrand", "genieBrand"];
  const step = useLoopStep(bricks.length, active, 1400, 1800);
  // Emitter (Genie logo) is the last item of the left group; beam starts at its
  // right edge and goes to each brick on the right.
  const LOGO = { x: 230, y: 90 }; // logo RIGHT edge, viewBox units
  const BEAM_END = 258; // brick left edge
  const rowY = (i: number) => 44 + i * 46; // matches the 3 stacked bricks
  const firing = step >= 1 && step <= bricks.length; // logo is "emitting"
  return (
    <div className="relative flex h-full w-full items-center justify-between gap-3 px-4">
      {/* laser overlay — Genie → each brick, one live at a time */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 180" preserveAspectRatio="none">
        <LaserDefs />
        <AnimatePresence>
          {bricks.map((_, i) =>
            step === i + 1 ? (
              <LaserBeam key={i} x1={LOGO.x} y1={LOGO.y} x2={BEAM_END} y2={rowY(i)} />
            ) : null,
          )}
        </AnimatePresence>
      </svg>

      {/* left group: prompts → arrow → Genie Code logo (the emitter) */}
      <div className="relative z-10 flex items-center gap-2">
        <div className="flex flex-col gap-1">
          {prompts.map((p) => (
            <div
              key={p}
              className="rounded border border-border bg-card px-2 py-1 text-[9px] font-mono leading-tight text-muted-foreground shadow-sm"
            >
              &gt; {p}
            </div>
          ))}
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-primary/70" />
        {/* Logo pulses each time it fires a beam (keyed on step) so it reads as
            the emitter, and the ring brightens while firing. */}
        <motion.div
          key={step}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30"
          animate={firing ? { scale: [1, 1.12, 1], boxShadow: ["0 0 0px var(--color-primary)", "0 0 12px var(--color-primary)", "0 0 0px var(--color-primary)"] } : { scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <AnyIcon iconKey="genieCodeBrand" className="h-8 w-8 [&_svg]:h-8 [&_svg]:w-8" />
        </motion.div>
      </div>

      {/* bricks Genie builds — one at a time as its beam lands */}
      <div className="relative z-10 flex flex-col gap-2.5">
        {bricks.map((icon, i) => (
          <motion.div
            key={icon}
            className="flex items-center justify-center rounded-md border border-primary/25 bg-card p-1.5 shadow-sm"
            initial={false}
            animate={step >= i + 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
            transition={{ delay: 0.35, type: "spring", stiffness: 300, damping: 20 }}
          >
            <AnyIcon iconKey={icon} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// Bump suffix when the guide content changes materially so returning users see
// the new guide once on their next visit.
const STORAGE_KEY = "guide-seen-v3";
// URL param that force-opens the guide regardless of the seen-cookie
// (e.g. /?guide=1 to re-show or share it).
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
      <GuideModal open={isOpen} onOpenChange={handleOpenChange} />
    </GuideContext.Provider>
  );
}

interface GuideCard {
  id: string;
  tab: string; // the home-page tab this maps to
  title: string;
  body: string;
  Visual: ComponentType<GuideVisualProps>;
}

// One card per home-page use-case, left → right in the same order as the tabs.
const GUIDE_CARDS: GuideCard[] = [
  {
    id: "story",
    tab: "Describe your story",
    title: "Build your solution end-to-end",
    body: "Paste a rough idea. The agent then designs a coherent story and assembles every Databricks resource for you.",
    Visual: AgentBuildsVisual,
  },
  {
    id: "architecture",
    tab: "Describe your architecture",
    title: "Draw the architecture first",
    body: "Need an architecture diagram? The agent pulls the components out of your notes and bootstraps your diagram. Edit it, then generate the solution from it.",
    Visual: ArchitectureSvgVisual,
  },
  {
    id: "workshop",
    tab: "Genie Code workshop",
    title: "Prepare a Genie Code workshop",
    body: "The agent designs the story and writes the prompts. You then build the bricks live with Genie Code — a hands-on workshop to learn to build like a pro.",
    Visual: GenieCodeVisual,
  },
];

interface GuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function GuideModal({ open, onOpenChange }: GuideModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(96vw,1100px)] sm:max-w-[min(96vw,1100px)] max-h-[92vh] gap-0 overflow-y-auto p-0"
      >
        {/* Pitch header — what the Solution Builder can do. */}
        <DialogHeader className="bg-muted/15 px-8 pt-7 pb-6 text-center">
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            One place to build Databricks solutions — three ways
          </DialogTitle>
          <DialogDescription className="sr-only">
            Pick how to start: build end-to-end, lead with an architecture diagram, or prepare a Genie Code workshop.
          </DialogDescription>
        </DialogHeader>

        {/* Three use-cases, side by side. */}
        <div className="grid gap-0 p-6 md:grid-cols-3 md:gap-5 md:p-8">
          {GUIDE_CARDS.map((card) => {
            const Visual = card.Visual;
            return (
              <div
                key={card.id}
                className="flex flex-col rounded-xl bg-card/40 shadow-md overflow-hidden"
              >
                {/* Title on top — blue banner, white text. */}
                <div className="bg-primary px-5 py-3">
                  <h3 className="text-base font-semibold leading-snug text-primary-foreground">
                    {card.title}
                  </h3>
                </div>
                {/* Animation. */}
                <div className="h-[180px] shrink-0 border-b border-border/40 bg-muted/20 flex items-center justify-center overflow-hidden">
                  <Visual active={open} />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {card.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-center bg-muted/20 px-8 py-4">
          <Button size="lg" onClick={() => onOpenChange(false)}>
            Get started
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
