import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/apx/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import {
  Sparkles,
  History,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [topic, setTopic] = useState("");
  const navigate = useNavigate();

  const handleGo = () => {
    if (!topic.trim()) return;
    navigate({ to: "/workspace", search: { topic: topic.trim() } });
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Navbar />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <BubbleBackground
          interactive
          className="!absolute inset-0 -z-10 opacity-40"
          colors={{
            first: "255,54,33",
            second: "255,120,80",
            third: "255,85,50",
            fourth: "200,40,25",
            fifth: "255,160,100",
            sixth: "255,100,60",
          }}
        />

        <div className="relative z-10 mx-auto max-w-3xl space-y-10 text-center">
          <div className="space-y-5">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm border border-primary/20">
              <img src="/logo.svg" alt="Databricks" className="h-12 w-12" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
                Databricks
              </p>
              <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
                Demo Skill Builder
              </h1>
            </div>
            <p className="mx-auto max-w-xl text-lg text-muted-foreground leading-relaxed">
              Describe a use-case and the AI architect will build a complete{" "}
              <code className="rounded-md bg-primary/10 px-1.5 py-0.5 text-sm font-medium text-primary">
                SKILL.md
              </code>{" "}
              with datasets, pipelines, dashboards, and build steps -- ready for any LLM to execute.
            </p>
          </div>

          <Card className="mx-auto w-full max-w-2xl text-left backdrop-blur-md bg-card/80 border-primary/10 shadow-lg shadow-primary/5">
            <CardContent className="p-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleGo();
                }}
                className="space-y-3"
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
                  <Button type="submit" disabled={!topic.trim()} className="gap-2 px-5">
                    <Sparkles className="h-4 w-4" /> Build Skill
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-center gap-2">
            {[
              "Predictive maintenance for manufacturing",
              "Real-time fraud detection in banking",
              "Patient readmission risk scoring",
              "Supply chain demand forecasting",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {
                  setTopic(suggestion);
                  navigate({ to: "/workspace", search: { topic: suggestion } });
                }}
                className="rounded-full border border-primary/15 bg-background/60 backdrop-blur-sm px-3.5 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground hover:bg-primary/5"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </main>
      <div className="absolute inset-0 -z-20 h-full w-full bg-background" />
    </div>
  );
}
