import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Navbar from "@/components/apx/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import {
  Sparkles,
  Plus,
  History,
  Loader2,
  Lightbulb,
  Wand2,
} from "lucide-react";
import { streamInspirationSSE } from "@/lib/custom-api";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Navbar />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <BubbleBackground interactive />

        <div className="relative z-10 mx-auto max-w-3xl space-y-10 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Wand2 className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
              Demo Prompt Generator
            </h1>
            <p className="mx-auto max-w-xl text-lg text-muted-foreground">
              Turn a business use-case into a self-contained{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-medium">
                SKILL.md
              </code>{" "}
              that any LLM with the Databricks AI Dev Kit can execute end-to-end.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" asChild>
              <Link to="/new" className="flex items-center gap-2">
                <Plus className="h-5 w-5" /> Create New Demo
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/generations" className="flex items-center gap-2">
                <History className="h-5 w-5" /> Past Generations
              </Link>
            </Button>
          </div>

          <InspireCard />
        </div>
      </main>
      <div className="absolute inset-0 -z-10 h-full w-full bg-background" />
    </div>
  );
}

function InspireCard() {
  const [topic, setTopic] = useState("");
  const [output, setOutput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleInspire = useCallback(async () => {
    if (!topic.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutput("");
    setStreaming(true);
    try {
      for await (const chunk of streamInspirationSSE(topic.trim(), ctrl.signal)) {
        setOutput((prev) => prev + chunk);
      }
    } catch {
      if (!ctrl.signal.aborted) setOutput((prev) => prev + "\n\n[Error generating inspiration]");
    } finally {
      setStreaming(false);
    }
  }, [topic]);

  return (
    <Card className="mx-auto w-full max-w-2xl text-left">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-yellow-500" />
          Get Inspired
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Enter an industry or topic and get an AI-generated business use-case to
          jumpstart your demo.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder='e.g. "predictive maintenance for manufacturing"'
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInspire()}
          />
          <Button onClick={handleInspire} disabled={streaming || !topic.trim()}>
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </div>
        {output && (
          <div className="rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {output}
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-primary" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
