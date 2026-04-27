import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
} from "lucide-react";

function AboutWithLayout() {
  return <AppLayout><AboutPage /></AppLayout>;
}

export const Route = createFileRoute("/about")({
  component: AboutWithLayout,
});

function AboutPage() {
  return (
    <div className="p-6 lg:p-10 space-y-24 lg:space-y-32 max-w-5xl mx-auto">

      {/* Hero header */}
      <header className="space-y-6 pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Compass className="h-5 w-5 text-primary" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            About
          </span>
        </div>
        <h1 className="text-3xl lg:text-4xl xl:text-5xl font-bold leading-[1.1] tracking-tight max-w-3xl">
          Encapsulate Databricks use-cases as{" "}
          <span className="text-primary">context</span> — implementable and shareable
          across our field and our customers.
        </h1>
      </header>

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

      <footer>
        <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-10 lg:p-14 text-center">
          <p className="text-2xl lg:text-3xl font-bold tracking-tight leading-tight">
            <span className="text-muted-foreground">Drop code,</span>{" "}
            <span className="text-primary">ship context.</span>
          </p>
        </div>
      </footer>
    </div>
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
  return (
    <section className="grid gap-10 md:grid-cols-2 md:gap-14 items-center">
      <div className={`space-y-4 ${align === "right" ? "md:order-2" : ""}`}>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold text-primary tabular-nums">
            {number}
          </span>
          <span className="h-px w-8 bg-primary/30" />
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
      </div>
      <div className={align === "right" ? "md:order-1" : ""}>{visual}</div>
    </section>
  );
}

function BlocksVisual() {
  const tiles = [
    { label: "Healthcare", active: true },
    { label: "Retail", active: false },
    { label: "Manufacturing", active: false },
    { label: "RAG agent", active: true },
    { label: "Lakeflow", active: false },
    { label: "Genie", active: true },
    { label: "Risk story", active: false },
    { label: "Churn", active: false },
    { label: "Onboarding", active: true },
  ];
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t, i) => (
          <div
            key={i}
            className={`rounded-lg border px-2.5 py-2 text-[11px] font-medium text-center ${
              t.active
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-card border-border/60 text-muted-foreground"
            }`}
          >
            {t.label}
          </div>
        ))}
      </div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-4 text-center">
        Pick → compose → spec
      </p>
    </div>
  );
}

function TwoSurfacesVisual() {
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-1 mb-2">
            <span className="h-2 w-2 rounded-full bg-red-400/70" />
            <span className="h-2 w-2 rounded-full bg-amber-400/70" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
            <span className="ml-2 text-[10px] text-muted-foreground">go/vibe</span>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground leading-snug">
            $ vibe demo gen
            <br />
            <span className="text-primary">›</span> healthcare + Genie
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AppWindow className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">app</span>
          </div>
          <div className="space-y-1.5">
            <div className="h-1.5 rounded bg-primary/30 w-3/4" />
            <div className="h-1.5 rounded bg-muted w-1/2" />
            <div className="h-1.5 rounded bg-muted w-2/3" />
          </div>
        </div>
      </div>

      <div className="relative h-8">
        <svg
          className="absolute inset-0 w-full h-full text-border"
          viewBox="0 0 200 32"
          preserveAspectRatio="none"
        >
          <path d="M 50 0 L 100 32" stroke="currentColor" strokeWidth="1" fill="none" />
          <path d="M 150 0 L 100 32" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>

      <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 flex items-center justify-center gap-2">
        <Library className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-primary">Shared context library</span>
      </div>
    </div>
  );
}

function FanoutVisual() {
  const customers = [
    { Icon: HeartPulse, label: "Payer" },
    { Icon: ShoppingBag, label: "Retail" },
    { Icon: Factory, label: "OEM" },
  ];
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      <div className="flex justify-center">
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-primary">Spec</span>
        </div>
      </div>

      <div className="relative h-8">
        <svg
          className="absolute inset-0 w-full h-full text-border"
          viewBox="0 0 300 32"
          preserveAspectRatio="none"
        >
          <path d="M 150 0 L 50 32" stroke="currentColor" strokeWidth="1" fill="none" />
          <path d="M 150 0 L 150 32" stroke="currentColor" strokeWidth="1" fill="none" />
          <path d="M 150 0 L 250 32" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {customers.map(({ Icon, label }, i) => (
          <div
            key={i}
            className="rounded-lg border bg-card p-3 flex flex-col items-center gap-1"
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BestPracticesVisual() {
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
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30"
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
            {guarantees.map((label) => (
              <div key={label} className="flex items-center gap-1.5">
                <Check className="h-3 w-3 text-primary" />
                <span className="text-[10px] text-primary font-medium">
                  {label}
                </span>
              </div>
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
  const navItems = [
    { Icon: Home, label: "Home" },
    { Icon: FolderOpen, label: "Projects" },
    { Icon: Library, label: "Templates" },
    { Icon: Info, label: "About", active: true },
  ];
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      {/* Mini navbar recreation */}
      <div className="rounded-lg border bg-background shadow-sm overflow-hidden">
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="h-11 flex items-center justify-between px-3">
          <div className="flex items-center gap-3">
            {/* Logo placeholder */}
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-4 rounded bg-primary/80" />
              <div className="h-2 w-12 rounded bg-foreground/70" />
            </div>
            {/* Nav links */}
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
            {/* Highlighted help button */}
            <div className="relative">
              <span className="absolute inset-0 rounded-md ring-2 ring-primary/60 animate-pulse" />
              <div className="relative flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                <HelpCircle className="h-3.5 w-3.5" />
              </div>
            </div>
            {/* Other right-side controls */}
            <div className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60">
              <Sun className="h-3.5 w-3.5" />
            </div>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground/70">
              <User className="h-3 w-3" />
            </div>
          </div>
        </div>
      </div>

      {/* Callout pointing to the help button */}
      <div className="mt-3 flex justify-end pr-12">
        <div className="flex items-start gap-1.5">
          <CornerLeftUp className="h-4 w-4 text-primary shrink-0" />
          <span className="text-[10px] font-medium text-primary leading-tight pt-0.5">
            Click here for the<br />interactive guide
          </span>
        </div>
      </div>
    </div>
  );
}
