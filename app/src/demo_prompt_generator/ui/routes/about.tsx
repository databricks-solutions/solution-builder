import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Compass,
  Sparkles,
  AppWindow,
  Library,
  HeartPulse,
  ShoppingBag,
  Factory,
  HelpCircle,
  Sun,
  User,
  Home,
  FolderOpen,
  Info,
  CornerLeftUp,
  Check,
  MousePointer2,
} from "lucide-react";

function AboutWithLayout() {
  return <AppLayout><AboutPage /></AppLayout>;
}

export const Route = createFileRoute("/about")({
  component: AboutWithLayout,
});

const VIEWPORT = { once: true, margin: "0px 0px -15% 0px" } as const;
const SCROLL_OFFSET = ["start end", "end start"] as const;
const FADE_STOPS = [0, 0.22, 0.78, 1] as const;
const FADE_OPACITY = [0, 1, 1, 0] as const;
const FADE_Y = [40, 0, 0, -40] as const;

function AboutPage() {
  return (
    <div className="p-6 lg:p-10 space-y-24 lg:space-y-32 max-w-5xl mx-auto">
      <Hero />

      <Block
        number="01"
        eyebrow="The unit of work"
        title="A demo is a bundle of context — not a repo."
        body="Industries, story patterns, and capabilities — captured as small Markdown blocks. The agent composes them into a tailored spec. We maintain the context; the artifacts regenerate."
        visual={<BlocksVisual />}
        align="left"
      />

      <Block
        number="02"
        eyebrow="Two surfaces, one library"
        title="Stay in your terminal, or use this app — both are first-class."
        body={
          <>
            Prefer <span className="font-medium text-foreground">go/vibe</span> or another
            LLM terminal? Generate specs from the command line. Want a guided UI with chat
            and files? Use this app. Same library, same outputs.
          </>
        }
        visual={<TwoSurfacesVisual />}
        align="right"
      />

      <Block
        number="03"
        eyebrow="Generate once, reuse everywhere"
        title="A spec built for one customer becomes context for the next."
        body="Every spec is itself a block. Reskin healthcare for another payer; swap retail for manufacturing; recombine capabilities for a new pitch. Each accepted demo enriches the library."
        visual={<FanoutVisual />}
        align="left"
      />

      <Block
        number="04"
        eyebrow="Why not just use a general LLM?"
        title="Databricks best practices baked in — not bolted on."
        body="A general LLM can piece a demo together — at 10× the tool calls, with no guarantee it follows our patterns. The AI Dev Kit ships those patterns built in: the spec hands off to an interface that already knows the right way."
        visual={<BestPracticesVisual />}
        align="right"
      />

      <Block
        number="05"
        eyebrow="Need help?"
        title="An interactive walkthrough lives on every page."
        body={
          <>
            The <HelpCircle className="inline h-3.5 w-3.5 -mt-0.5 text-primary" /> icon in
            the top-right opens a slide-by-slide guide — ideation, architecture,
            specification, and the AI Dev Kit handoff. Handy when you're new or onboarding
            a teammate.
          </>
        }
        visual={<NavbarHelpVisual />}
        align="left"
      />

      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <motion.header
      className="space-y-6 pt-4"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <motion.div
        className="flex items-center gap-3"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Compass className="h-5 w-5 text-primary" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          About
        </span>
      </motion.div>
      <motion.h1
        className="text-3xl lg:text-4xl xl:text-5xl font-bold leading-[1.1] tracking-tight max-w-3xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
      >
        Encapsulate Databricks use-cases as{" "}
        <span className="text-primary">context</span> — implementable and shareable
        across our field and our customers.
      </motion.h1>
    </motion.header>
  );
}

function Footer() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: SCROLL_OFFSET as unknown as ["start end", "end start"],
  });
  const opacity = useTransform(scrollYProgress, [...FADE_STOPS], [...FADE_OPACITY]);
  const y = useTransform(scrollYProgress, [...FADE_STOPS], [...FADE_Y]);

  return (
    <motion.footer ref={ref} style={reduce ? undefined : { opacity, y }}>
      <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-10 lg:p-14 text-center">
        <p className="text-2xl lg:text-3xl font-bold tracking-tight leading-tight">
          <span className="text-muted-foreground">Drop code,</span>{" "}
          <span className="text-primary">ship context.</span>
        </p>
      </div>
    </motion.footer>
  );
}

function Block({
  number,
  eyebrow,
  title,
  body,
  visual,
  align,
}: {
  number: string;
  eyebrow: string;
  title: ReactNode;
  body: ReactNode;
  visual: ReactNode;
  align: "left" | "right";
}) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: SCROLL_OFFSET as unknown as ["start end", "end start"],
  });

  const textOffset = align === "right" ? 40 : -40;
  const visualOffset = align === "right" ? -40 : 40;

  const opacity = useTransform(scrollYProgress, [...FADE_STOPS], [...FADE_OPACITY]);
  const y = useTransform(scrollYProgress, [...FADE_STOPS], [...FADE_Y]);
  const xText = useTransform(
    scrollYProgress,
    [...FADE_STOPS],
    [textOffset, 0, 0, 0],
  );
  const xVisual = useTransform(
    scrollYProgress,
    [...FADE_STOPS],
    [visualOffset, 0, 0, 0],
  );

  return (
    <section
      ref={ref}
      className="grid gap-10 md:grid-cols-2 md:gap-14 items-center"
    >
      <motion.div
        className={`space-y-4 ${align === "right" ? "md:order-2" : ""}`}
        style={reduce ? undefined : { opacity, x: xText, y }}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold text-primary tabular-nums">
            {number}
          </span>
          <motion.span
            className="h-px w-8 bg-primary/30 origin-left"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={VIEWPORT}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
          />
          <span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-primary">
            {eyebrow}
          </span>
        </div>
        <h2 className="text-2xl lg:text-3xl font-bold tracking-tight leading-[1.15] max-w-md">
          {title}
        </h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground max-w-md">
          {body}
        </p>
      </motion.div>
      <motion.div
        className={align === "right" ? "md:order-1" : ""}
        style={reduce ? undefined : { opacity, x: xVisual, y }}
      >
        {visual}
      </motion.div>
    </section>
  );
}

const TILE_LABELS = [
  "Healthcare",
  "Retail",
  "Manufacturing",
  "RAG agent",
  "Lakeflow",
  "Genie",
  "Risk story",
  "Churn",
  "Onboarding",
] as const;

const CYCLES: number[][] = [
  [3, 5, 8],
  [0, 4, 7],
  [1, 5, 6],
  [2, 3, 8],
];
const STEP_MS = 850;
const CYCLE_LEN = 4; // 3 picks + 1 pause

function BlocksVisual() {
  const reduce = useReducedMotion();
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [tilePositions, setTilePositions] = useState<
    Array<{ x: number; y: number }>
  >([]);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    if (reduce) return;
    const measure = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const gr = grid.getBoundingClientRect();
      setTilePositions(
        tileRefs.current.map((el) => {
          if (!el) return { x: 0, y: 0 };
          const r = el.getBoundingClientRect();
          return {
            x: r.left - gr.left + r.width / 2,
            y: r.top - gr.top + r.height / 2,
          };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (gridRef.current) ro.observe(gridRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [reduce]);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setTick((t) => t + 1), STEP_MS);
    return () => clearInterval(id);
  }, [reduce]);

  const total = CYCLES.length * CYCLE_LEN;
  const phase = tick % total;
  const cycleIdx = Math.floor(phase / CYCLE_LEN);
  const step = phase % CYCLE_LEN;
  const cycle = CYCLES[cycleIdx];
  const cursorIdx = cycle[Math.min(step, 2)];
  const activeCount = Math.min(step + 1, 3);
  const activeSet = reduce
    ? new Set([3, 5, 8])
    : new Set(cycle.slice(0, activeCount));
  const cursorPos = tilePositions[cursorIdx];
  const cursorReady = !reduce && tilePositions.length > 0 && cursorPos;
  const showRipple = !reduce && cursorReady && step <= 2;

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <motion.div
        ref={gridRef}
        className="relative grid grid-cols-3 gap-2"
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {TILE_LABELS.map((label, i) => {
          const active = activeSet.has(i);
          return (
            <motion.div
              key={label}
              ref={(el) => {
                tileRefs.current[i] = el;
              }}
              animate={{
                backgroundColor: active
                  ? "color-mix(in oklch, var(--primary) 12%, transparent)"
                  : "transparent",
                borderColor: active
                  ? "color-mix(in oklch, var(--primary) 40%, transparent)"
                  : "color-mix(in oklch, var(--border) 60%, transparent)",
                color: active ? "var(--primary)" : "var(--muted-foreground)",
                scale: active ? 1.05 : 1,
              }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="rounded-lg border px-2.5 py-2 text-[11px] font-medium text-center"
            >
              {label}
            </motion.div>
          );
        })}

        {/* Click ripple — fresh per step */}
        {showRipple && (
          <motion.span
            key={`ripple-${cycleIdx}-${step}`}
            className="absolute pointer-events-none rounded-full border-2 border-primary"
            style={{
              left: cursorPos.x - 14,
              top: cursorPos.y - 14,
              width: 28,
              height: 28,
            }}
            initial={{ opacity: 0.7, scale: 0.4 }}
            animate={{ opacity: 0, scale: 1.7 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          />
        )}

        {/* Animated cursor */}
        {cursorReady && (
          <motion.div
            className="absolute pointer-events-none top-0 left-0 text-foreground"
            style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.25))" }}
            initial={{ opacity: 0, x: cursorPos.x - 4, y: cursorPos.y - 4 }}
            animate={{
              opacity: 1,
              x: cursorPos.x - 4,
              y: cursorPos.y - 4,
              scale: step <= 2 ? [1, 0.85, 1] : 1,
            }}
            transition={{
              x: { type: "spring", stiffness: 90, damping: 16 },
              y: { type: "spring", stiffness: 90, damping: 16 },
              opacity: { duration: 0.4, delay: 0.3 },
              scale: { duration: 0.3, times: [0, 0.4, 1], ease: "easeOut" },
            }}
          >
            <MousePointer2 className="h-3.5 w-3.5 fill-foreground" />
          </motion.div>
        )}
      </motion.div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-4 text-center">
        Pick → compose → spec
      </p>
    </div>
  );
}

const TERMINAL_LINE = "$ vibe demo gen";

function TwoSurfacesVisual() {
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState(reduce ? TERMINAL_LINE.length : 0);

  useEffect(() => {
    if (reduce) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(i);
      if (i >= TERMINAL_LINE.length) clearInterval(id);
    }, 55);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <motion.div
        className="grid grid-cols-2 gap-3"
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-1 mb-2">
            <span className="h-2 w-2 rounded-full bg-red-400/70" />
            <span className="h-2 w-2 rounded-full bg-amber-400/70" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
            <span className="ml-2 text-[10px] text-muted-foreground">go/vibe</span>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground leading-snug min-h-[2.4em]">
            {TERMINAL_LINE.slice(0, typed)}
            {!reduce && typed < TERMINAL_LINE.length && (
              <motion.span
                className="inline-block w-1.5 h-2.5 bg-primary/70 ml-0.5 align-middle"
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
            )}
            {typed >= TERMINAL_LINE.length && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                <br />
                <span className="text-primary">›</span> healthcare + Genie
              </motion.span>
            )}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AppWindow className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">app</span>
          </div>
          <div className="space-y-1.5">
            <motion.div
              className="h-1.5 rounded bg-primary/30 origin-left"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 0.75 }}
              viewport={VIEWPORT}
              transition={{ duration: 0.5, ease: "easeOut", delay: 0.3 }}
            />
            <motion.div
              className="h-1.5 rounded bg-muted origin-left"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 0.5 }}
              viewport={VIEWPORT}
              transition={{ duration: 0.5, ease: "easeOut", delay: 0.45 }}
            />
            <motion.div
              className="h-1.5 rounded bg-muted origin-left"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 0.66 }}
              viewport={VIEWPORT}
              transition={{ duration: 0.5, ease: "easeOut", delay: 0.6 }}
            />
          </div>
        </div>
      </motion.div>

      <div className="relative h-8">
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 200 32"
          preserveAspectRatio="none"
        >
          <motion.path
            d="M 50 0 L 100 32"
            className="text-border"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={VIEWPORT}
            transition={{ duration: 0.6, ease: "easeOut", delay: 0.7 }}
          />
          <motion.path
            d="M 150 0 L 100 32"
            className="text-border"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={VIEWPORT}
            transition={{ duration: 0.6, ease: "easeOut", delay: 0.8 }}
          />
          {/* Flowing particles — terminal → library */}
          {!reduce && (
            <motion.circle
              r={1.6}
              className="text-primary"
              fill="currentColor"
              initial={{ cx: 50, cy: 0, opacity: 0 }}
              animate={{
                cx: [50, 100],
                cy: [0, 32],
                opacity: [0, 1, 1, 0],
              }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "linear",
                times: [0, 0.15, 0.85, 1],
                delay: 1.4,
              }}
            />
          )}
          {/* Flowing particles — app → library */}
          {!reduce && (
            <motion.circle
              r={1.6}
              className="text-primary"
              fill="currentColor"
              initial={{ cx: 150, cy: 0, opacity: 0 }}
              animate={{
                cx: [150, 100],
                cy: [0, 32],
                opacity: [0, 1, 1, 0],
              }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "linear",
                times: [0, 0.15, 0.85, 1],
                delay: 1.9,
              }}
            />
          )}
        </svg>
      </div>

      <motion.div
        className="rounded-lg border border-primary/40 bg-primary/10 p-3 flex items-center justify-center gap-2"
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.4, ease: "easeOut", delay: 1 }}
      >
        <Library className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-primary">Shared context library</span>
      </motion.div>
    </div>
  );
}

function FanoutVisual() {
  const customers = [
    { Icon: HeartPulse, label: "Payer" },
    { Icon: ShoppingBag, label: "Retail" },
    { Icon: Factory, label: "OEM" },
  ] as const;

  const reduce = useReducedMotion();

  // 3 paths — all originate at (150, 0) and fan out to bottom
  const paths = [
    { d: "M 150 0 L 50 32", endX: 50 },
    { d: "M 150 0 L 150 32", endX: 150 },
    { d: "M 150 0 L 250 32", endX: 250 },
  ];

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <motion.div
        className="flex justify-center"
        initial={{ opacity: 0, y: -8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <motion.div
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 flex items-center gap-2"
          animate={
            reduce
              ? undefined
              : {
                  boxShadow: [
                    "0 0 0 0 color-mix(in oklch, var(--primary) 25%, transparent)",
                    "0 0 0 8px color-mix(in oklch, var(--primary) 0%, transparent)",
                  ],
                }
          }
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        >
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-primary">Spec</span>
        </motion.div>
      </motion.div>

      <div className="relative h-8">
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 300 32"
          preserveAspectRatio="none"
        >
          {paths.map((p, i) => (
            <motion.path
              key={p.d}
              d={p.d}
              className="text-border"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={VIEWPORT}
              transition={{ duration: 0.5, ease: "easeOut", delay: 0.3 + i * 0.1 }}
            />
          ))}
          {/* Particles flowing from spec out to each customer */}
          {!reduce &&
            paths.map((p, i) => (
              <motion.circle
                key={`particle-${p.d}`}
                r={1.6}
                className="text-primary"
                fill="currentColor"
                initial={{ cx: 150, cy: 0, opacity: 0 }}
                animate={{
                  cx: [150, p.endX],
                  cy: [0, 32],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  ease: "linear",
                  times: [0, 0.15, 0.85, 1],
                  delay: 1.0 + i * 0.4,
                }}
              />
            ))}
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {customers.map(({ Icon, label }, i) => (
          <motion.div
            key={label}
            className="rounded-lg border bg-card p-3 flex flex-col items-center gap-1"
            initial={{ opacity: 0, y: 12, scale: 0.92 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={VIEWPORT}
            transition={{
              duration: 0.4,
              ease: "easeOut",
              delay: 0.7 + i * 0.12,
            }}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function BestPracticesVisual() {
  const reduce = useReducedMotion();
  const generalDots = Array.from({ length: 30 });
  const guarantees = ["Schemas", "Pipelines", "Governance"];

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            General LLM
          </div>
          <div className="grid grid-cols-6 gap-1 py-0.5">
            {generalDots.map((_, i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30"
                animate={
                  reduce ? undefined : { opacity: [0.3, 1, 0.3] }
                }
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: (i * 0.07) % 1.4,
                }}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            ~30+ tool calls.<br />Best-effort patterns.
          </p>
        </div>
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="text-[10px] font-semibold text-primary uppercase tracking-wider">
            AI Dev Kit
          </div>
          <div className="space-y-1 py-0.5">
            {guarantees.map((label, i) => (
              <motion.div
                key={label}
                className="flex items-center gap-1.5"
                initial={{ opacity: 0, x: -6 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={VIEWPORT}
                transition={{
                  duration: 0.35,
                  ease: "easeOut",
                  delay: 0.3 + i * 0.18,
                }}
              >
                <motion.span
                  initial={{ scale: 0, rotate: -45 }}
                  whileInView={{ scale: 1, rotate: 0 }}
                  viewport={VIEWPORT}
                  transition={{
                    type: "spring",
                    stiffness: 360,
                    damping: 18,
                    delay: 0.35 + i * 0.18,
                  }}
                >
                  <Check className="h-3 w-3 text-primary" />
                </motion.span>
                <span className="text-[10px] text-primary font-medium">
                  {label}
                </span>
              </motion.div>
            ))}
          </div>
          <p className="text-[10px] text-primary/80 leading-snug">
            Right way,<br />by construction.
          </p>
        </div>
      </div>
    </div>
  );
}

function NavbarHelpVisual() {
  const reduce = useReducedMotion();
  const navItems: { Icon: typeof Home; label: string; active?: boolean }[] = [
    { Icon: Home, label: "Home" },
    { Icon: FolderOpen, label: "Projects" },
    { Icon: Library, label: "Templates" },
    { Icon: Info, label: "About", active: true },
  ];

  const pointerKeyframes = reduce
    ? undefined
    : {
        x: [-90, -90, -8, -8, -8, -90],
        y: [22, 22, 0, 0, 0, 22],
        opacity: [0, 1, 1, 1, 1, 0],
        scale: [1, 1, 1, 0.85, 1, 1],
      };

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <div className="rounded-lg border bg-background shadow-sm overflow-hidden">
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="h-11 flex items-center justify-between px-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-4 rounded bg-primary/80" />
              <div className="h-2 w-12 rounded bg-foreground/70" />
            </div>
            <div className="hidden sm:flex items-center gap-0.5">
              {navItems.map(({ Icon, label, active }) => (
                <div
                  key={label}
                  className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <motion.span
                className="absolute inset-0 rounded-md ring-2 ring-primary/60"
                animate={
                  reduce
                    ? undefined
                    : {
                        boxShadow: [
                          "0 0 0 0 color-mix(in oklch, var(--primary) 50%, transparent)",
                          "0 0 0 6px color-mix(in oklch, var(--primary) 0%, transparent)",
                        ],
                        scale: [1, 1.06, 1],
                      }
                }
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="relative flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary"
                animate={
                  reduce ? undefined : { scale: [1, 1, 0.92, 1, 1] }
                }
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, 0.55, 0.62, 0.7, 1],
                }}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </motion.div>
              {!reduce && (
                <motion.div
                  className="absolute top-0 left-0 pointer-events-none text-foreground"
                  style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.25))" }}
                  initial={{ x: -90, y: 22, opacity: 0, scale: 1 }}
                  animate={pointerKeyframes}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: [0, 0.15, 0.55, 0.62, 0.75, 1],
                  }}
                >
                  <MousePointer2 className="h-3.5 w-3.5 fill-foreground" />
                </motion.div>
              )}
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60">
              <Sun className="h-3.5 w-3.5" />
            </div>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground/70">
              <User className="h-3 w-3" />
            </div>
          </div>
        </div>
      </div>

      <motion.div
        className="mt-3 flex justify-end pr-12"
        initial={{ opacity: 0, y: -6 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.4, ease: "easeOut", delay: 0.3 }}
      >
        <div className="flex items-start gap-1.5">
          <CornerLeftUp className="h-4 w-4 text-primary shrink-0" />
          <span className="text-[10px] font-medium text-primary leading-tight pt-0.5">
            Click here for the<br />interactive guide
          </span>
        </div>
      </motion.div>
    </div>
  );
}
