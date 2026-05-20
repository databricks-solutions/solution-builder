import { motion, useReducedMotion } from "motion/react";
import {
  Hammer,
  Wrench,
  Sparkles,
  ArrowRight,
  Bookmark,
  ShoppingBag,
  HeartPulse,
  FileCode,
  Workflow,
  BarChart3,
  Database,
  AppWindow,
  Folder,
  Check,
  Loader2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface GuideVisualProps {
  active: boolean;
}

// ---------------------------------------------------------------------------
// Sales: Time-to-demo comparison
// ---------------------------------------------------------------------------

const TIME_ROWS = [
  {
    Icon: Hammer,
    label: "Hand-built",
    time: "~2 days",
    pct: 100,
    tone: "muted" as const,
    delay: 0,
  },
  {
    Icon: Wrench,
    label: "AI Dev Kit",
    time: "~4 hours",
    pct: 28,
    tone: "primary-soft" as const,
    delay: 0.45,
  },
  {
    Icon: Sparkles,
    label: "This framework",
    time: "15–30 min",
    pct: 8,
    tone: "primary" as const,
    delay: 0.9,
    highlight: true,
  },
];

export function TimelineVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();

  return (
    <div className="w-full h-full py-5 flex flex-col justify-center bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      {/* px-14 keeps bars clear of the carousel's left/right arrow buttons. */}
      <div className="space-y-2.5 w-full px-14">
        {TIME_ROWS.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[130px_1fr_72px] items-center gap-3"
          >
            <div className="flex items-center gap-2 text-[11px] font-medium text-foreground/85">
              <row.Icon className="h-3.5 w-3.5 text-muted-foreground" />
              {row.label}
            </div>
            <div className="h-5 rounded-md bg-muted/40 overflow-hidden relative">
              <motion.div
                className={cn(
                  "h-full rounded-md origin-left",
                  row.tone === "muted" && "bg-muted-foreground/30",
                  row.tone === "primary-soft" && "bg-primary/45",
                  row.tone === "primary" && "bg-primary",
                )}
                style={{ width: `${row.pct}%` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: active ? 1 : 0 }}
                transition={
                  row.highlight && !reduce
                    ? {
                        scaleX: {
                          duration: 0.85,
                          ease: "easeOut",
                          delay: row.delay,
                        },
                      }
                    : {
                        duration: reduce ? 0 : 0.85,
                        ease: "easeOut",
                        delay: reduce ? 0 : row.delay,
                      }
                }
              />
              {row.highlight && active && !reduce && (
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-md bg-primary/60 pointer-events-none"
                  style={{ width: `${row.pct}%` }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.7, 0] }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    delay: row.delay + 0.85,
                    ease: "easeInOut",
                  }}
                />
              )}
            </div>
            <div
              className={cn(
                "text-[11px] font-mono text-right tabular-nums",
                row.highlight
                  ? "text-primary font-semibold"
                  : "text-muted-foreground",
              )}
            >
              {row.time}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 px-14 text-[10px] uppercase tracking-[0.18em] text-center text-muted-foreground/70">
        Time to a working Databricks solution
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales: Blocks → spec → live resources
// ---------------------------------------------------------------------------

const BLOCK_LIBRARY = [
  "Healthcare",
  "Risk pattern",
  "Lakeflow",
  "Genie",
  "RAG agent",
];

const LIVE_RESOURCES = [
  { Icon: Database, label: "Tables" },
  { Icon: Workflow, label: "Pipelines" },
  { Icon: BarChart3, label: "Dashboards" },
];

export function BlocksToSpecVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();

  return (
    <div className="w-full h-full p-4 flex items-center justify-center bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <div className="grid grid-cols-[110px_22px_92px_22px_104px] items-center gap-2">
        {/* Blocks library */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
            Blocks
          </div>
          {BLOCK_LIBRARY.map((label, i) => (
            <motion.div
              key={label}
              className="rounded border bg-card text-[10px] px-2 py-1 text-foreground/85 truncate"
              initial={{ opacity: 0, x: -10 }}
              animate={
                active ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }
              }
              transition={{
                duration: reduce ? 0 : 0.35,
                ease: "easeOut",
                delay: reduce ? 0 : 0.05 + i * 0.07,
              }}
            >
              {label}
            </motion.div>
          ))}
        </div>

        {/* Arrow */}
        <motion.div
          className="text-muted-foreground flex justify-center"
          initial={{ opacity: 0 }}
          animate={active ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3, delay: reduce ? 0 : 0.55 }}
        >
          <ArrowRight className="h-4 w-4" />
        </motion.div>

        {/* Spec */}
        <motion.div
          className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-3 flex flex-col items-center gap-1 relative"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={
            active ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }
          }
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", stiffness: 360, damping: 22, delay: 0.7 }
          }
        >
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-[10px] font-semibold text-primary">Spec</span>
          {active && !reduce && (
            <motion.span
              className="absolute inset-0 rounded-lg pointer-events-none"
              animate={{
                boxShadow: [
                  "0 0 0 0 color-mix(in oklch, var(--primary) 30%, transparent)",
                  "0 0 0 6px color-mix(in oklch, var(--primary) 0%, transparent)",
                ],
              }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeOut",
                delay: 1.0,
              }}
            />
          )}
        </motion.div>

        {/* Arrow */}
        <motion.div
          className="text-muted-foreground flex justify-center"
          initial={{ opacity: 0 }}
          animate={active ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3, delay: reduce ? 0 : 0.95 }}
        >
          <ArrowRight className="h-4 w-4" />
        </motion.div>

        {/* Live resources */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
            Live on Databricks
          </div>
          {LIVE_RESOURCES.map(({ Icon, label }, i) => (
            <motion.div
              key={label}
              className="rounded border bg-card text-[10px] px-2 py-1 text-foreground/85 flex items-center gap-1.5"
              initial={{ opacity: 0, x: 10 }}
              animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: 10 }}
              transition={{
                duration: reduce ? 0 : 0.35,
                ease: "easeOut",
                delay: reduce ? 0 : 1.1 + i * 0.08,
              }}
            >
              <Icon className="h-3 w-3 text-muted-foreground" />
              {label}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales: One demo → many (compounding library)
// ---------------------------------------------------------------------------

const REUSE_TARGETS = [
  {
    Icon: ShoppingBag,
    customer: "Acme Retail",
    skin: "Loyalty cohorts",
    industry: "Retail",
  },
  {
    Icon: HeartPulse,
    customer: "BayerCo Pharma",
    skin: "Patient cohorts",
    industry: "Healthcare",
  },
];

export function ShareVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();

  return (
    <div className="w-full h-full p-4 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      {/* Saved template (the hub) */}
      <motion.div
        className="rounded-lg border border-primary/50 bg-primary/10 px-3.5 py-2 flex items-center gap-2 relative"
        initial={{ opacity: 0, y: -6 }}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
        transition={{ duration: reduce ? 0 : 0.4, ease: "easeOut" }}
      >
        <Bookmark className="h-4 w-4 text-primary fill-primary/30" />
        <span className="text-xs font-semibold text-primary">
          Customer segmentation
        </span>
        <span className="text-[9px] uppercase tracking-wider text-primary/70 font-semibold border border-primary/30 rounded px-1.5 py-0.5">
          template
        </span>
        {active && !reduce && (
          <motion.span
            className="absolute inset-0 rounded-lg pointer-events-none"
            animate={{
              boxShadow: [
                "0 0 0 0 color-mix(in oklch, var(--primary) 35%, transparent)",
                "0 0 0 8px color-mix(in oklch, var(--primary) 0%, transparent)",
              ],
            }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.6,
            }}
          />
        )}
      </motion.div>

      {/* "Fork & reskin" label */}
      <motion.div
        className="text-[9px] uppercase tracking-[0.18em] text-primary/70 font-semibold"
        initial={{ opacity: 0 }}
        animate={active ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.45 }}
      >
        Fork &amp; reskin
      </motion.div>

      {/* Branching arrows */}
      <div className="relative h-5 w-full max-w-[380px]">
        <svg
          className="absolute inset-0 w-full h-full text-border"
          viewBox="0 0 380 20"
          preserveAspectRatio="none"
        >
          {[100, 280].map((x, i) => (
            <motion.path
              key={x}
              d={`M 190 0 L ${x} 20`}
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={active ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{
                duration: reduce ? 0 : 0.5,
                ease: "easeOut",
                delay: reduce ? 0 : 0.75 + i * 0.1,
              }}
            />
          ))}
        </svg>
      </div>

      {/* Two concrete customer reskins */}
      <div className="flex gap-3">
        {REUSE_TARGETS.map(({ Icon, customer, skin, industry }, i) => (
          <motion.div
            key={customer}
            className="rounded-lg border bg-card px-3 py-2 flex items-start gap-2 min-w-[156px]"
            initial={{ opacity: 0, y: 10, scale: 0.92 }}
            animate={
              active
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 10, scale: 0.92 }
            }
            transition={{
              duration: reduce ? 0 : 0.4,
              ease: "easeOut",
              delay: reduce ? 0 : 1.05 + i * 0.12,
            }}
          >
            <Icon className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="text-[11px] font-semibold text-foreground/90 leading-tight truncate">
                {customer}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {skin}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-primary/70 font-medium">
                {industry}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 mt-1">
        Same blueprint, different customer
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Walkthrough: Ideation
// ---------------------------------------------------------------------------

const SCENARIO_TAGS = ["Healthcare", "Genie", "RAG"];

export function IdeationVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();

  return (
    <div className="w-full h-full p-5 flex items-center justify-center bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <div className="rounded-lg border bg-card p-4 w-full max-w-sm space-y-2.5 shadow-sm">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Customer scenario
        </div>
        {[0.85, 0.6, 0.7].map((w, i) => (
          <motion.div
            key={i}
            className="h-2 rounded bg-muted origin-left"
            initial={{ scaleX: 0 }}
            animate={active ? { scaleX: w } : { scaleX: 0 }}
            transition={{
              duration: reduce ? 0 : 0.45,
              ease: "easeOut",
              delay: reduce ? 0 : 0.15 + i * 0.12,
            }}
          />
        ))}
        <div className="flex gap-1.5 pt-1">
          {SCENARIO_TAGS.map((t, i) => (
            <motion.span
              key={t}
              className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] text-primary font-medium"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={
                active
                  ? { opacity: 1, scale: 1 }
                  : { opacity: 0, scale: 0.85 }
              }
              transition={{
                duration: reduce ? 0 : 0.3,
                ease: "easeOut",
                delay: reduce ? 0 : 0.7 + i * 0.1,
              }}
            >
              {t}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Walkthrough: Architecture
// ---------------------------------------------------------------------------

const ARCH_NODES = [
  { id: "src", label: "Source", x: 8, y: 50 },
  { id: "etl", label: "Lakeflow", x: 32, y: 50 },
  { id: "uc", label: "UC", x: 56, y: 50 },
  { id: "genie", label: "Genie", x: 86, y: 22 },
  { id: "dash", label: "Dashboard", x: 86, y: 78 },
];

const ARCH_EDGES: Array<[string, string]> = [
  ["src", "etl"],
  ["etl", "uc"],
  ["uc", "genie"],
  ["uc", "dash"],
];

export function ArchitectureVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();
  const nodeMap = new Map(ARCH_NODES.map((n) => [n.id, n]));

  return (
    <div className="w-full h-full p-5 flex items-center justify-center bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <div className="relative w-full max-w-md h-32">
        <svg
          className="absolute inset-0 w-full h-full text-primary/60"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {ARCH_EDGES.map(([from, to], i) => {
            const a = nodeMap.get(from)!;
            const b = nodeMap.get(to)!;
            const edgeDelay = 0.3 + i * 0.08;
            return (
              <motion.path
                key={`${from}-${to}`}
                d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeDasharray="5 4"
                fill="none"
                initial={{ opacity: 0, strokeDashoffset: 0 }}
                animate={
                  active
                    ? {
                        opacity: 1,
                        strokeDashoffset: reduce ? 0 : -9,
                      }
                    : { opacity: 0, strokeDashoffset: 0 }
                }
                transition={
                  active
                    ? {
                        opacity: {
                          duration: reduce ? 0 : 0.4,
                          ease: "easeOut",
                          delay: reduce ? 0 : edgeDelay,
                        },
                        strokeDashoffset: reduce
                          ? { duration: 0 }
                          : {
                              duration: 1.0,
                              repeat: Infinity,
                              ease: "linear",
                              repeatType: "loop",
                            },
                      }
                    : { duration: reduce ? 0 : 0.2 }
                }
              />
            );
          })}
        </svg>
        {ARCH_NODES.map((n, i) => (
          <motion.div
            key={n.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-primary/40 bg-card text-[10px] font-medium px-2 py-1 text-foreground/85 shadow-sm whitespace-nowrap"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={
              active
                ? { opacity: 1, scale: 1 }
                : { opacity: 0, scale: 0.85 }
            }
            transition={{
              duration: reduce ? 0 : 0.35,
              ease: "easeOut",
              delay: reduce ? 0 : i * 0.1,
            }}
          >
            {n.label}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Walkthrough: Specification — code editor streaming the spec
// ---------------------------------------------------------------------------

const SPEC_TABS = [
  { name: "01-lakeflow.md", active: true },
  { name: "02-uc-governance.md", active: false },
  { name: "03-ai-bi.md", active: false },
  { name: "04-agent-bricks.md", active: false },
];

type SpecLineKind = "h1" | "h2" | "li" | "p";

const SPEC_LINES: { text: string; kind: SpecLineKind }[] = [
  { text: "# Lakeflow — Data + Pipeline", kind: "h1" },
  { text: "## Synthetic data", kind: "h2" },
  { text: "- customers.parquet   ~50K", kind: "li" },
  { text: "- products.parquet    ~80", kind: "li" },
  { text: "- orders.parquet      ~200K", kind: "li" },
  { text: "## Pipeline (SDP)", kind: "h2" },
  { text: "bronze → silver → gold", kind: "p" },
];

function SpecLine({ text, kind }: { text: string; kind: SpecLineKind }) {
  if (kind === "h1") {
    return <span className="text-primary font-semibold">{text}</span>;
  }
  if (kind === "h2") {
    return <span className="text-primary/80 font-medium">{text}</span>;
  }
  if (kind === "li") {
    return (
      <span>
        <span className="text-muted-foreground/60">- </span>
        <span className="text-foreground/85">{text.slice(2)}</span>
      </span>
    );
  }
  return <span className="text-foreground/85">{text}</span>;
}

export function SpecVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();
  const lastLineDelay = 0.2 + (SPEC_LINES.length - 1) * 0.13;

  return (
    <div className="w-full h-full p-4 flex items-center justify-center bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <div className="rounded-lg border bg-card overflow-hidden w-full max-w-md shadow-sm">
        {/* Tab bar */}
        <div className="flex items-end gap-0.5 border-b border-border/40 bg-muted/30 px-2 pt-1.5">
          {SPEC_TABS.map((t) => (
            <div
              key={t.name}
              className={cn(
                "rounded-t px-2 py-1 text-[10px] font-mono",
                t.active
                  ? "bg-card text-foreground border-x border-t border-border/60 -mb-px"
                  : "text-muted-foreground/60",
              )}
            >
              {t.name}
            </div>
          ))}
        </div>
        {/* Code body */}
        <div className="p-3 flex font-mono text-[11px] leading-[1.5]">
          <div className="flex flex-col text-muted-foreground/40 pr-2.5 border-r border-border/40 mr-3 select-none tabular-nums">
            {SPEC_LINES.map((_, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0 }}
                animate={active ? { opacity: 1 } : { opacity: 0 }}
                transition={{
                  duration: reduce ? 0 : 0.2,
                  delay: reduce ? 0 : 0.18 + i * 0.13,
                }}
              >
                {i + 1}
              </motion.span>
            ))}
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            {SPEC_LINES.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={
                  active
                    ? { opacity: 1, x: 0 }
                    : { opacity: 0, x: -4 }
                }
                transition={{
                  duration: reduce ? 0 : 0.25,
                  ease: "easeOut",
                  delay: reduce ? 0 : 0.2 + i * 0.13,
                }}
              >
                <SpecLine text={line.text} kind={line.kind} />
              </motion.div>
            ))}
            {active && !reduce && (
              <motion.span
                className="inline-block w-1.5 h-3 bg-primary/70 mt-0.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{
                  duration: 0.9,
                  repeat: Infinity,
                  delay: lastLineDelay + 0.25,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Walkthrough: Prompt package — handed off to the AI Dev Kit
// ---------------------------------------------------------------------------

const PACKAGE_TREE = [
  { Icon: FileCode, label: "README.md", indent: 0 },
  { Icon: FileCode, label: "META-PROMPT.md", indent: 0 },
  { Icon: FileCode, label: "resources.json", indent: 0 },
  { Icon: Folder, label: "specifications/", indent: 0 },
  { Icon: FileCode, label: "01-lakeflow.md", indent: 1 },
  { Icon: FileCode, label: "02-uc-governance.md", indent: 1 },
  { Icon: FileCode, label: "03-ai-bi.md", indent: 1 },
  { Icon: FileCode, label: "04-agent-bricks.md", indent: 1 },
];

type LogStatus = "done" | "active" | "pending";

const DEV_KIT_LOG: { text: string; status: LogStatus }[] = [
  { text: "Reading specifications/", status: "done" },
  { text: "Generating data + SDP pipeline", status: "done" },
  { text: "Applying UC governance", status: "done" },
  { text: "Creating AI/BI + Genie", status: "active" },
  { text: "Wiring Agent Bricks", status: "pending" },
];

function LogStatusIcon({
  status,
  reduce,
}: {
  status: LogStatus;
  reduce: boolean | null;
}) {
  if (status === "done") {
    return <Check className="h-2.5 w-2.5 text-emerald-400 shrink-0 mt-[3px]" />;
  }
  if (status === "active") {
    return (
      <motion.div
        className="h-2.5 w-2.5 shrink-0 mt-[3px] flex items-center justify-center text-sky-300"
        animate={!reduce ? { rotate: 360 } : undefined}
        transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="h-2.5 w-2.5" />
      </motion.div>
    );
  }
  return (
    <span className="h-2 w-2 mt-1 rounded-full border border-zinc-600 shrink-0" />
  );
}

export function ResourcesVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();
  const baseLogDelay = 0.65;
  const stepLogDelay = 0.25;

  return (
    <div className="w-full h-full p-4 flex items-center justify-center bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <div className="grid grid-cols-[140px_28px_1fr] gap-2 items-stretch w-full max-w-md">
        {/* Package tree */}
        <div className="rounded-md border bg-card p-2 font-mono">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-sans mb-1.5">
            Package
          </div>
          <div className="space-y-0.5">
            {PACKAGE_TREE.map(({ Icon, label, indent }, i) => (
              <motion.div
                key={label}
                className="text-[10px] text-foreground/85 flex items-center gap-1"
                style={{ paddingLeft: `${indent * 8}px` }}
                initial={{ opacity: 0, x: -4 }}
                animate={
                  active ? { opacity: 1, x: 0 } : { opacity: 0, x: -4 }
                }
                transition={{
                  duration: reduce ? 0 : 0.28,
                  ease: "easeOut",
                  delay: reduce ? 0 : 0.05 + i * 0.06,
                }}
              >
                <Icon
                  className={cn(
                    "h-2.5 w-2.5 shrink-0",
                    indent === 0
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                />
                <span className="truncate">{label}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Hand-off arrow */}
        <motion.div
          className="flex flex-col items-center justify-center text-primary"
          initial={{ opacity: 0 }}
          animate={active ? { opacity: 1 } : { opacity: 0 }}
          transition={{
            duration: reduce ? 0 : 0.3,
            delay: reduce ? 0 : 0.5,
          }}
        >
          <ArrowRight className="h-4 w-4" />
          <span className="text-[8px] uppercase tracking-[0.15em] font-semibold mt-0.5 leading-none whitespace-nowrap">
            Run
          </span>
        </motion.div>

        {/* Terminal log */}
        <div className="rounded-md border border-border/60 bg-zinc-950 p-2 font-mono shadow-sm overflow-hidden">
          <div className="flex items-center gap-1 mb-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400/70" />
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
            <span className="ml-1 text-[8px] text-zinc-500 font-sans tracking-wider uppercase">
              ai-dev-kit
            </span>
          </div>
          <div className="space-y-0.5">
            {DEV_KIT_LOG.map((entry, i) => (
              <motion.div
                key={i}
                className="text-[9px] flex items-start gap-1.5 leading-tight"
                initial={{ opacity: 0, x: -4 }}
                animate={
                  active
                    ? { opacity: 1, x: 0 }
                    : { opacity: 0, x: -4 }
                }
                transition={{
                  duration: reduce ? 0 : 0.3,
                  delay: reduce ? 0 : baseLogDelay + i * stepLogDelay,
                }}
              >
                <LogStatusIcon status={entry.status} reduce={reduce} />
                <span
                  className={cn(
                    entry.status === "pending"
                      ? "text-zinc-500"
                      : "text-zinc-300",
                  )}
                >
                  {entry.text}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Walkthrough: Live Databricks resources — tiles inside a workspace shell
// ---------------------------------------------------------------------------

const LIVE_TILES = [
  { Icon: Database, label: "Tables", count: "× 6" },
  { Icon: Workflow, label: "Pipeline", count: "× 1" },
  { Icon: BarChart3, label: "Dashboard", count: "× 1" },
  { Icon: AppWindow, label: "App", count: "× 1" },
];

const WORKSPACE_SIDEBAR: { Icon: typeof Database; activeIdx: number }[] = [
  { Icon: Database, activeIdx: 0 },
  { Icon: Workflow, activeIdx: 1 },
  { Icon: BarChart3, activeIdx: 2 },
  { Icon: AppWindow, activeIdx: 3 },
];

export function LiveVisual({ active }: GuideVisualProps) {
  const reduce = useReducedMotion();

  return (
    <div className="w-full h-full p-4 flex items-center justify-center bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      {/* Databricks workspace shell — the canvas the assets are deployed onto */}
      <motion.div
        className="rounded-lg border bg-background overflow-hidden w-full max-w-md shadow-md"
        initial={{ opacity: 0, y: 8 }}
        animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        transition={{ duration: reduce ? 0 : 0.4, ease: "easeOut" }}
      >
        {/* Top bar: workspace URL + live indicator */}
        <div className="border-b border-border/40 bg-card px-2.5 py-1.5 flex items-center gap-2">
          <div className="flex items-center justify-center h-3.5 w-3.5 rounded-sm bg-red-500/90 shrink-0">
            <Zap className="h-2 w-2 text-white fill-white" />
          </div>
          <span className="text-[10px] font-semibold text-foreground/85 truncate">
            my_workspace.databricks.com
          </span>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              animate={
                active && !reduce
                  ? { scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }
                  : undefined
              }
              transition={{
                duration: 1.6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
              live
            </span>
          </div>
        </div>
        {/* Breadcrumb */}
        <div className="border-b border-border/40 bg-muted/15 px-3 py-1 text-[9px] font-mono">
          <span className="text-muted-foreground/55">Unity Catalog /</span>
          <span className="text-foreground/85 ml-1">solution_segmentation</span>
        </div>
        {/* Body: sidebar + tile grid */}
        <div className="flex">
          <div className="w-8 border-r border-border/40 bg-muted/10 py-2.5 flex flex-col items-center gap-2 shrink-0">
            {WORKSPACE_SIDEBAR.map(({ Icon }, i) => (
              <Icon
                key={i}
                className={cn(
                  "h-3 w-3",
                  i === 0 ? "text-primary" : "text-muted-foreground/45",
                )}
              />
            ))}
          </div>
          <div className="flex-1 p-2.5">
            <div className="grid grid-cols-2 gap-1.5">
              {LIVE_TILES.map((t, i) => (
                <motion.div
                  key={t.label}
                  className="rounded-md border bg-card p-2 flex items-center gap-1.5"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={
                    active
                      ? { opacity: 1, scale: 1 }
                      : { opacity: 0, scale: 0.85 }
                  }
                  transition={{
                    duration: reduce ? 0 : 0.3,
                    ease: "easeOut",
                    delay: reduce ? 0 : 0.4 + i * 0.1,
                  }}
                >
                  <t.Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium leading-tight">
                      {t.label}
                    </div>
                    <div className="text-[9px] text-muted-foreground tabular-nums leading-tight">
                      {t.count}
                    </div>
                  </div>
                  <motion.div
                    className="h-1 w-1 rounded-full bg-emerald-500 shrink-0"
                    animate={
                      active && !reduce
                        ? {
                            scale: [1, 1.4, 1],
                            opacity: [0.65, 1, 0.65],
                          }
                        : undefined
                    }
                    transition={{
                      duration: 1.6,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeInOut",
                    }}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
