import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/apx/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import {
  Sparkles,
  History,
  ArrowRight,
  Search,
  Building2,
  HeartPulse,
  Factory,
  ShoppingCart,
  Zap,
  Radio,
  Clapperboard,
  Landmark,
  Lightbulb,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

const INDUSTRY_CATALOG = [
  {
    name: "Financial Services",
    icon: Landmark,
    color: "text-blue-400",
    border: "border-blue-500/15 hover:border-blue-500/30",
    bg: "bg-blue-500/[0.04] hover:bg-blue-500/[0.08]",
    useCases: [
      "Real-time fraud detection for credit card transactions",
      "Anti-money laundering transaction monitoring",
      "Credit risk scoring with alternative data",
      "Algorithmic trading signal generation",
    ],
  },
  {
    name: "Healthcare & Life Sciences",
    icon: HeartPulse,
    color: "text-emerald-400",
    border: "border-emerald-500/15 hover:border-emerald-500/30",
    bg: "bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]",
    useCases: [
      "Patient readmission risk scoring",
      "Clinical trial patient matching",
      "Drug interaction prediction from EHR data",
      "Medical claims anomaly detection",
    ],
  },
  {
    name: "Manufacturing",
    icon: Factory,
    color: "text-amber-400",
    border: "border-amber-500/15 hover:border-amber-500/30",
    bg: "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]",
    useCases: [
      "Predictive maintenance for industrial equipment",
      "Real-time quality control with IoT sensors",
      "Supply chain demand forecasting",
      "Digital twin simulation for factory floor",
    ],
  },
  {
    name: "Retail & CPG",
    icon: ShoppingCart,
    color: "text-pink-400",
    border: "border-pink-500/15 hover:border-pink-500/30",
    bg: "bg-pink-500/[0.04] hover:bg-pink-500/[0.08]",
    useCases: [
      "Customer churn prediction and next-best-action",
      "Dynamic pricing optimization",
      "Personalized product recommendation engine",
      "Inventory optimization across distribution centers",
    ],
  },
  {
    name: "Energy & Utilities",
    icon: Zap,
    color: "text-yellow-400",
    border: "border-yellow-500/15 hover:border-yellow-500/30",
    bg: "bg-yellow-500/[0.04] hover:bg-yellow-500/[0.08]",
    useCases: [
      "Smart grid load balancing and outage prediction",
      "Renewable energy output forecasting",
      "Pipeline integrity monitoring with sensor data",
    ],
  },
  {
    name: "Telecom",
    icon: Radio,
    color: "text-violet-400",
    border: "border-violet-500/15 hover:border-violet-500/30",
    bg: "bg-violet-500/[0.04] hover:bg-violet-500/[0.08]",
    useCases: [
      "Customer churn prediction for telecom subscribers",
      "Network anomaly detection and capacity planning",
      "Real-time call quality optimization",
    ],
  },
  {
    name: "Media & Entertainment",
    icon: Clapperboard,
    color: "text-orange-400",
    border: "border-orange-500/15 hover:border-orange-500/30",
    bg: "bg-orange-500/[0.04] hover:bg-orange-500/[0.08]",
    useCases: [
      "Content recommendation engine for streaming",
      "Ad spend optimization with real-time bidding",
      "Audience engagement analytics and segmentation",
    ],
  },
  {
    name: "Public Sector",
    icon: Building2,
    color: "text-slate-400",
    border: "border-slate-500/15 hover:border-slate-500/30",
    bg: "bg-slate-500/[0.04] hover:bg-slate-500/[0.08]",
    useCases: [
      "Benefits fraud detection across agencies",
      "Citizen service request triage and routing",
      "Infrastructure asset lifecycle management",
    ],
  },
] as const;

function Index() {
  const [topic, setTopic] = useState("");
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();

  const handleGo = (text?: string) => {
    const val = (text || topic).trim();
    if (!val) return;
    navigate({ to: "/workspace", search: { topic: val } });
  };

  const filteredCatalog = useMemo(() => {
    if (!filter) return INDUSTRY_CATALOG;
    const q = filter.toLowerCase();
    return INDUSTRY_CATALOG.map((ind) => ({
      ...ind,
      useCases: ind.useCases.filter(
        (uc) =>
          uc.toLowerCase().includes(q) || ind.name.toLowerCase().includes(q),
      ),
    })).filter((ind) => ind.useCases.length > 0);
  }, [filter]);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Navbar />
      <main className="flex flex-1 flex-col items-center px-4 pt-12 pb-20">
        <BubbleBackground
          interactive
          className="!absolute inset-0 -z-10 opacity-30"
          colors={{
            first: "255,54,33",
            second: "255,120,80",
            third: "255,85,50",
            fourth: "200,40,25",
            fifth: "255,160,100",
            sixth: "255,100,60",
          }}
        />

        {/* Hero */}
        <div className="relative z-10 mx-auto max-w-4xl space-y-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm border border-primary/20">
              <img src="/logo.svg" alt="Databricks" className="h-10 w-10" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Databricks
              </p>
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                Demo Skill Builder
              </h1>
            </div>
            <p className="mx-auto max-w-xl text-base text-muted-foreground leading-relaxed">
              Describe a use-case and the AI architect builds a complete demo
              package with datasets, pipelines, dashboards, and build steps.
            </p>
          </div>

          {/* Input card */}
          <Card className="mx-auto w-full max-w-2xl text-left backdrop-blur-md bg-card/80 border-primary/10 shadow-lg shadow-primary/5">
            <CardContent className="p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleGo();
                }}
                className="space-y-2.5"
              >
                <Input
                  placeholder='Describe a use-case... e.g. "predictive maintenance for wind turbines"'
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="h-12 text-base bg-background/60"
                  autoFocus
                />
                <div className="flex items-center justify-between">
                  <Button
                    variant="link"
                    size="sm"
                    className="text-muted-foreground px-0"
                    asChild
                  >
                    <Link to="/generations" className="gap-1.5">
                      <History className="h-3.5 w-3.5" /> Past generations
                    </Link>
                  </Button>
                  <Button
                    type="submit"
                    disabled={!topic.trim()}
                    className="gap-2 px-5"
                  >
                    <Sparkles className="h-4 w-4" /> Build Skill
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Research agent callout */}
          <div className="mx-auto max-w-2xl">
            <div className="rounded-xl border border-primary/10 bg-primary/[0.03] backdrop-blur-sm px-4 py-3 text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Search className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Tailoring for a specific customer?
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    Before building a demo skill, ask a research agent (Claude,
                    Genie, Glean) to summarize the customer's industry, current
                    tech stack, pain points, and Databricks usage. Paste that
                    context into the input above for a proposal that speaks
                    directly to their world.
                  </p>
                </div>
              </div>
              <div className="mt-2.5 ml-11 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Lightbulb className="h-3 w-3 text-primary/60" />
                  <span className="font-medium text-foreground/70">
                    Example prompt:
                  </span>
                </span>
                <button
                  onClick={() =>
                    setTopic(
                      "Build a demo for Acme Corp (Fortune 500 retailer, heavy on Snowflake today, interested in real-time ML). They struggle with demand forecasting accuracy across 2,000+ stores.",
                    )
                  }
                  className="italic hover:text-foreground transition-colors cursor-pointer underline underline-offset-2 decoration-primary/20 hover:decoration-primary/40"
                >
                  "Build a demo for Acme Corp, a Fortune 500 retailer struggling
                  with demand forecasting across 2,000+ stores..."
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Industry use-case catalog */}
        <div className="relative z-10 mx-auto mt-14 w-full max-w-6xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Browse by industry
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick a use-case to get started instantly, or use it as
                inspiration
              </p>
            </div>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter use-cases..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 pl-8 text-xs bg-background/60"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {filteredCatalog.map((industry) => {
              const Icon = industry.icon;
              return (
                <div
                  key={industry.name}
                  className={`rounded-xl border ${industry.border} ${industry.bg} p-3.5 transition-all`}
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <Icon className={`h-4 w-4 ${industry.color}`} />
                    <span className="text-sm font-semibold">
                      {industry.name}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {industry.useCases.map((uc) => (
                      <button
                        key={uc}
                        onClick={() => handleGo(uc)}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-all hover:bg-background/60 hover:text-foreground group"
                      >
                        <ArrowRight className="h-3 w-3 shrink-0 mt-0.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary" />
                        <span className="group-hover:translate-x-0 -translate-x-3 transition-transform leading-relaxed">
                          {uc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredCatalog.length === 0 && (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 opacity-30 mb-2" />
              <p className="text-sm">No matching use-cases</p>
              <p className="text-xs mt-1">
                Try a different search, or type your own above
              </p>
            </div>
          )}
        </div>
      </main>
      <div className="absolute inset-0 -z-20 h-full w-full bg-background" />
    </div>
  );
}
