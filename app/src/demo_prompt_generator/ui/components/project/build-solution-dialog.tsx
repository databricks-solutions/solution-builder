/**
 * BuildSolutionDialog — "Build the solution for this architecture".
 *
 * Shown from an architecture-first project's Architecture tab. Reproduces the
 * home page's story step around the SAME shared pieces (CapabilitiesPanel +
 * streamSuggestCapabilities): the user refines the use-case story, the
 * capability picker is PRE-SELECTED from the diagram (via
 * lib/architecture-capabilities), and the CTA kicks off the build in the
 * EXISTING project (no new project) — the parent flips architecture_first off.
 *
 * SOLUTION-BUILDER ONLY — never imported by platform-diagram/* or
 * standalone.tsx (the packaged architecture skill must not ship this).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CAPABILITY_META } from "@/lib/capabilities";
import {
  getCapabilities,
  streamSuggestCapabilities,
  type Capability,
  type CapabilityInput,
  type UseCaseIdea,
  type IdeaToRefine,
} from "@/lib/custom-api";
import { AUTO_BUILD_KICKOFF, BRAND_NOTE } from "@/lib/auto-build-prompt";
import { type ExtractedArchitecture } from "@/lib/architecture-capabilities";
import { Check, Database, Loader2, Pencil, Send, Sparkles, X, Zap } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Capabilities + name/story extracted from the project's architecture.md. */
  extracted: ExtractedArchitecture;
  /** Kick off the build in the existing project: provision the deferred
   *  remote assets (catalog/schema/warehouse — skipped by the fast
   *  architecture-first create), send the message, flip the flag. The dialog
   *  closes on success. `storyDescription` feeds the provision step's LLM
   *  name/schema generation (the story is better input than the arch topic). */
  onBuild: (initialPrompt: string, capabilities: string[], storyDescription: string) => Promise<void>;
}

export function BuildSolutionDialog({ open, onOpenChange, extracted, onBuild }: Props) {
  // --- Story topic — prefilled from the architecture's name + story ---------
  const [topic, setTopic] = useState("");

  // --- Capability selection (same semantics as the home page) ---------------
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [explicitSelections, setExplicitSelections] = useState<Map<string, "selected" | "unselected">>(new Map());

  // --- Suggestion stream state ----------------------------------------------
  const [ideas, setIdeas] = useState<UseCaseIdea[]>([]);
  const [expectedIdeaCount, setExpectedIdeaCount] = useState(0);
  const [selectedIdeaIdx, setSelectedIdeaIdx] = useState(0);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isRefiningStories, setIsRefiningStories] = useState(false);
  const [refiningIdeaIdx, setRefiningIdeaIdx] = useState<number | null>(null);
  const [refineText, setRefineText] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  // Refs so the stream runner keeps a stable identity (same pattern as home).
  const capabilitiesRef = useRef<Capability[]>([]);
  useEffect(() => { capabilitiesRef.current = capabilities; }, [capabilities]);
  const explicitSelectionsRef = useRef(explicitSelections);
  useEffect(() => { explicitSelectionsRef.current = explicitSelections; }, [explicitSelections]);
  const selectedProductsRef = useRef(selectedProducts);
  useEffect(() => { selectedProductsRef.current = selectedProducts; }, [selectedProducts]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const ideasCapabilitySnapshotRef = useRef<string[]>([]);
  const ideasRef = useRef<UseCaseIdea[]>([]);
  useEffect(() => { ideasRef.current = ideas; }, [ideas]);
  // The diagram's datasource names, read by the stable stream runner.
  const datasourcesRef = useRef<string[]>([]);
  datasourcesRef.current = extracted.datasources;

  // --- Seed on open ----------------------------------------------------------
  // No capability PICKER anymore — the architecture IS the selection. Seed the
  // capabilities straight from the diagram, pinned as explicit "selected" so
  // the suggestion stream anchors its ideas on exactly these (and never drops
  // them). No topic prefill: the diagram's name/story describe the ARCHITECTURE,
  // not the use-case; its datasources feed the suggester invisibly.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open || seededRef.current) return;
    seededRef.current = true;
    const s = new Set(extracted.capabilities);
    setSelectedProducts(s);
    const m = new Map<string, "selected" | "unselected">();
    for (const id of s) m.set(id, "selected");
    setExplicitSelections(m);
  }, [open, extracted]);

  // Load the capability universe once the dialog opens, then drop any extracted
  // slug the backend doesn't know (we stay with what maps cleanly).
  useEffect(() => {
    if (!open || capabilities.length > 0) return;
    getCapabilities()
      .then((caps) => {
        setCapabilities(caps);
        const valid = new Set(caps.map((c) => c.id));
        setSelectedProducts((prev) => new Set([...prev].filter((id) => valid.has(id))));
        setExplicitSelections((prev) => {
          const m = new Map(prev);
          for (const id of prev.keys()) if (!valid.has(id)) m.delete(id);
          return m;
        });
      })
      .catch((e) => console.error("Failed to load capabilities:", e));
  }, [open, capabilities.length]);

  // --- Suggestion stream (lean copy of the home page's runSuggestionStream) --
  const runSuggestionStream = useCallback(async (
    promptText: string,
    refineIdea?: IdeaToRefine,
    refineComment?: string,
    previousIdeas?: IdeaToRefine[],
    previousCapabilities?: string[],
  ) => {
    const caps = capabilitiesRef.current;
    const explicit = explicitSelectionsRef.current;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (!promptText.trim() || caps.length === 0) {
      setIsSuggesting(false);
      return;
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const isCapabilityChangeRefresh = !!previousIdeas && previousIdeas.length > 0;
    if (!isCapabilityChangeRefresh) {
      setIdeas([]);
      setExpectedIdeaCount(0);
      setSelectedIdeaIdx(0);
    } else {
      setExpectedIdeaCount(previousIdeas.length);
    }
    setIsSuggesting(true);
    const nextIdeas: UseCaseIdea[] = [];

    try {
      const capabilityInputs: CapabilityInput[] = caps.map((cap) => ({
        id: cap.id,
        status: explicit.get(cap.id) ?? null,
      }));
      for await (const event of streamSuggestCapabilities(
        promptText.trim(),
        capabilityInputs,
        abortController.signal,
        refineIdea,
        refineComment,
        previousIdeas,
        previousCapabilities,
        undefined, // contextText — no file uploads in this dialog
        // Anchor the ideas in the exact data sources the user drew.
        datasourcesRef.current,
      )) {
        if (abortController.signal.aborted) return;
        if (event.type === "count") {
          setExpectedIdeaCount(event.data.count);
        } else if (event.type === "idea") {
          if (isCapabilityChangeRefresh) nextIdeas.push(event.data);
          else setIdeas((prev) => [...prev, event.data]);
        } else if (event.type === "capabilities") {
          if (isCapabilityChangeRefresh) continue;
          const explicitNow = explicitSelectionsRef.current;
          setSelectedProducts(() => {
            const next = new Set<string>();
            for (const capId of event.data.capabilities) next.add(capId);
            for (const [capId, status] of explicitNow) {
              if (status === "selected") next.add(capId);
              else if (status === "unselected") next.delete(capId);
            }
            return next;
          });
        } else if (event.type === "error") {
          console.error("Suggestion error:", event.data.error);
        }
      }
      if (isCapabilityChangeRefresh && nextIdeas.length > 0) {
        setIdeas(nextIdeas);
        setSelectedIdeaIdx((idx) => Math.min(idx, nextIdeas.length - 1));
      }
      ideasCapabilitySnapshotRef.current = Array.from(selectedProductsRef.current);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to suggest capabilities:", err);
    } finally {
      if (!abortController.signal.aborted) {
        setIsSuggesting(false);
        setIsRefiningStories(false);
      }
    }
  }, []);

  // Debounced (1000ms) suggestion on topic change — same as home.
  const lastTopicRef = useRef("");
  const capabilitiesReady = capabilities.length > 0;
  useEffect(() => {
    if (!open) return;
    const trimmed = topic.trim();
    if (trimmed === lastTopicRef.current) return;
    lastTopicRef.current = trimmed;
    if (trimmed.length < 3 || !capabilitiesReady) {
      setIsSuggesting(false);
      return;
    }
    setIsSuggesting(true);
    const timer = setTimeout(() => runSuggestionStream(trimmed), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, topic, capabilitiesReady]);

  // Debounced (2000ms) minimal story rewrite when the user toggles a
  // capability — same semantics as home (refining overlay + atomic swap).
  const lastExplicitKeyRef = useRef("");
  useEffect(() => {
    if (!open) return;
    const key = Array.from(explicitSelections.entries())
      .map(([id, st]) => `${id}=${st}`)
      .sort()
      .join("|");
    if (lastExplicitKeyRef.current === "" && key === "") return;
    if (key === lastExplicitKeyRef.current) return;
    lastExplicitKeyRef.current = key;
    if (topic.trim().length < 3 || !capabilitiesReady) return;

    const liveNow = Array.from(selectedProductsRef.current).sort();
    const snapNow = [...ideasCapabilitySnapshotRef.current].sort();
    if (liveNow.join("|") !== snapNow.join("|")) setIsRefiningStories(true);

    const timer = setTimeout(() => {
      const liveCaps = Array.from(selectedProductsRef.current).sort();
      const snapshotCaps = [...ideasCapabilitySnapshotRef.current].sort();
      if (liveCaps.join("|") === snapshotCaps.join("|")) {
        setIsRefiningStories(false);
        return;
      }
      const currentIdeas = ideasRef.current.length > 0
        ? ideasRef.current.map((i) => ({ title: i.title, hook: i.hook, datasources: i.datasources }))
        : undefined;
      runSuggestionStream(
        topic.trim(),
        undefined,
        undefined,
        currentIdeas,
        currentIdeas ? snapshotCaps : undefined,
      );
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, explicitSelections, capabilitiesReady, selectedProducts]);

  const handleRefineSubmit = async (idea: UseCaseIdea) => {
    if (!refineText.trim() || isRefining) return;
    setIsRefining(true);
    setRefiningIdeaIdx(null);
    try {
      await runSuggestionStream(
        topic.trim(),
        { title: idea.title, hook: idea.hook, datasources: idea.datasources },
        refineText.trim(),
      );
      setRefineText("");
    } finally {
      setIsRefining(false);
    }
  };

  // --- Build CTA — same prompt assembly as the home page's story mode -------
  const handleBuild = async () => {
    if (isBuilding) return;
    const capabilityIds = Array.from(selectedProducts);
    const idea = ideas[selectedIdeaIdx];
    const authoritativeCapsLine = capabilityIds.length > 0
      ? `\n\nUse these capabilities within the solution: ${capabilityIds.join(", ")} (do not add extra unless it's a strict missing dependency)`
      : "";
    // LEAD with the architecture framing — the design already exists; the
    // build must honor it. The story body matches the home page's wording.
    let initialPrompt =
      `This project was started architecture-first: architecture.md already contains the full design — treat it as the source of truth and keep the solution consistent with it.\n\nNow build this use-case on that architecture:\n\nUser request:\n${topic.trim()}`;
    if (idea) {
      initialPrompt += `\n\n**${idea.title}**\n\n${idea.hook}`;
    }
    initialPrompt += authoritativeCapsLine;
    initialPrompt += `\n\n${BRAND_NOTE}`;
    initialPrompt += `\n\n---\n\n${AUTO_BUILD_KICKOFF}`;
    // The provision step regenerates the project name/schema from the story —
    // richer input than the original architecture topic.
    const storyDescription = idea ? `${topic.trim()}\n\n${idea.title}` : topic.trim();

    setIsBuilding(true);
    setBuildError(null);
    try {
      await onBuild(initialPrompt, capabilityIds, storyDescription);
      onOpenChange(false);
    } catch (e) {
      console.error("Failed to start the build:", e);
      setBuildError(e instanceof Error ? e.message : "Failed to start the build.");
    } finally {
      setIsBuilding(false);
    }
  };

  const canBuild = topic.trim().length >= 3 && !isBuilding;
  const totalSlots = expectedIdeaCount > 0 ? expectedIdeaCount : ideas.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[min(980px,95vw)] !max-w-[980px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Tell us which use-case you'd like to have on top of this architecture
          </DialogTitle>
          <DialogDescription>
            Describe the use case (or pick a suggestion). We'll build the full
            solution in this project using the capabilities from your diagram.
          </DialogDescription>
        </DialogHeader>

        {/* Story topic — empty on purpose (the user's use-case, not the
            diagram's name/story). The diagram's datasources + components
            already shape the suggestions behind the scenes. */}
        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Describe the use-case you want to build on this architecture (e.g. reduce churn for a retail bank, optimize store inventory…)"
          className="min-h-[84px] text-sm"
          autoFocus
        />

        {/* Initial loading state before the count event arrives. */}
        {isSuggesting && expectedIdeaCount === 0 && ideas.length === 0 && (
          <div className="flex min-h-[140px] items-center justify-center rounded-lg border border-border bg-card/50">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
              <span className="text-xs">Analyzing your architecture…</span>
            </div>
          </div>
        )}

        {/* Idea cards — same select/refine UX as the home page. */}
        {totalSlots > 0 && (
          <div className={`grid gap-3 ${
            totalSlots === 1 ? "grid-cols-1" : totalSlots === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3"
          }`}>
            {Array.from({ length: totalSlots }, (_, idx) => {
              const idea = ideas[idx];
              if (!idea) {
                return (
                  <div key={`skeleton-${idx}`} className={`space-y-3 rounded-lg border border-border bg-card/50 p-4 ${totalSlots > 1 ? "min-h-[150px]" : ""}`}>
                    <div className="h-4 w-3/4 animate-pulse rounded-md bg-primary/10" />
                    <div className="space-y-2">
                      <div className="h-3 w-full animate-pulse rounded-md bg-muted-foreground/10" />
                      <div className="h-3 w-5/6 animate-pulse rounded-md bg-muted-foreground/10" />
                    </div>
                    <div className="h-3 w-2/3 animate-pulse rounded-md bg-muted-foreground/10" />
                  </div>
                );
              }
              const isRefiningThis = refiningIdeaIdx === idx;
              const isSelectedIdea = selectedIdeaIdx === idx;
              return (
                <div
                  key={idx}
                  onClick={() => setSelectedIdeaIdx(idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedIdeaIdx(idx);
                    }
                  }}
                  className={`relative flex h-full flex-col rounded-lg border bg-white p-4 transition-all dark:bg-card ${totalSlots > 1 ? "min-h-[150px]" : ""} ${
                    isSelectedIdea
                      ? "border-primary/60 shadow-sm ring-1 ring-primary/40"
                      : "border-slate-200 hover:border-primary/40 dark:border-border/50"
                  } ${isRefiningStories ? "pointer-events-none" : "cursor-pointer"}`}
                >
                  {isRefiningStories && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 backdrop-blur-[1px] dark:bg-card/70">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">Refining…</span>
                    </div>
                  )}
                  <p className="mb-1.5 text-sm font-medium text-slate-900 dark:text-foreground">{idea.title}</p>
                  <p className="mb-3 flex-1 text-xs leading-relaxed text-slate-600 dark:text-muted-foreground">{idea.hook}</p>
                  {idea.datasources && idea.datasources.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <Database className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                      {idea.datasources.map((ds, dsIdx) => (
                        <span key={dsIdx} className="inline-flex items-center rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {ds}
                        </span>
                      ))}
                    </div>
                  )}
                  {isRefiningThis && (
                    <div className="mb-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleRefineSubmit(idea);
                          }
                          if (e.key === "Escape") {
                            setRefiningIdeaIdx(null);
                            setRefineText("");
                          }
                        }}
                        placeholder="How should we adjust this story?"
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                        autoFocus
                        disabled={isRefining}
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRefineSubmit(idea); }}
                        disabled={!refineText.trim() || isRefining}
                        className="cursor-pointer rounded-md bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isRefining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setRefiningIdeaIdx(null); setRefineText(""); }}
                        className="cursor-pointer rounded-md bg-muted p-1.5 text-muted-foreground hover:bg-muted/80"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-2">
                    <span
                      className={`flex w-[128px] items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-semibold ${
                        isSelectedIdea
                          ? "border-destructive bg-destructive text-destructive-foreground shadow-sm"
                          : "border-destructive/40 bg-transparent text-destructive hover:bg-destructive/5"
                      }`}
                    >
                      {isSelectedIdea ? (
                        <><Check className="h-3 w-3" strokeWidth={2.5} /> Picked</>
                      ) : (
                        <><Sparkles className="h-3 w-3" /> Click to pick</>
                      )}
                    </span>
                    {!isRefiningThis && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setRefiningIdeaIdx(idx); setRefineText(""); }}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                      >
                        <Pencil className="h-3 w-3" /> Refine
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Capabilities are taken straight from the architecture (no picker —
            the diagram IS the selection). Shown read-only so the user knows
            what will be built. */}
        {selectedProducts.size > 0 && (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Capabilities from your architecture
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedProducts).map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11.5px] text-foreground"
                >
                  {CAPABILITY_META[id]?.display ?? id}
                </span>
              ))}
            </div>
          </div>
        )}

        {buildError && (
          <p className="text-xs text-destructive">{buildError}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBuilding}>
            Cancel
          </Button>
          <Button onClick={handleBuild} disabled={!canBuild} className="gap-2">
            {isBuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {isBuilding ? "Preparing resources…" : "Build the solution"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
