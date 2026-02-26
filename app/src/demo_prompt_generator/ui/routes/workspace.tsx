import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import Navbar from "@/components/apx/navbar";
import {
  Send,
  Loader2,
  FileText,
  Code,
  Copy,
  Check,
  Download,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Bot,
  User,
  AtSign,
  Workflow,
  Database,
  BarChart3,
  Wrench,
  AppWindow,
  MessageCircle,
  BrainCircuit,
  ArrowRight,
} from "lucide-react";
import {
  streamWorkspaceGenerate,
  streamWorkspaceRefine,
  type WorkspaceEvent,
  type ChatMessage,
} from "@/lib/custom-api";

export const Route = createFileRoute("/workspace")({
  validateSearch: (search: Record<string, unknown>) => ({
    topic: (search.topic as string) || "",
  }),
  component: WorkspacePage,
});

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

interface Section {
  id: string;
  title: string;
  level: number;
}

function parseSections(md: string): Section[] {
  const sections: Section[] = [];
  const lines = md.split("\n");
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      if (level <= 2) {
        sections.push({ id, title, level });
      }
    }
  }
  return sections;
}

function extractMentions(text: string, sectionList: Section[]): string[] {
  const titles = sectionList
    .map((s) => s.title)
    .sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const title of titles) {
    if (text.includes(`@${title}`)) found.push(title);
  }
  return found;
}

function spliceSection(
  md: string,
  sectionTitle: string,
  newContent: string,
): string {
  const lines = md.split("\n");
  const header = `## ${sectionTitle}`;
  let startIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return md;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      endIdx = i;
      break;
    }
  }

  const before = lines.slice(0, startIdx + 1);
  const after = lines.slice(endIdx);
  return [...before, ...newContent.split("\n"), ...after].join("\n");
}

function WorkspacePage() {
  const { topic } = Route.useSearch();
  const navigate = useNavigate();

  const [skillMd, setSkillMd] = useState("");
  const [generationId, setGenerationId] = useState<number | null>(null);
  const [demoName, setDemoName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState("preview");

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasStarted = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => parseSections(skillMd), [skillMd]);

  const mentionContext = useMemo(() => {
    const lastAt = chatInput.lastIndexOf("@");
    if (lastAt < 0) return null;
    const afterAt = chatInput.slice(lastAt + 1);
    for (const s of sections) {
      if (afterAt.startsWith(s.title + " ")) return null;
    }
    return { query: afterAt, startIndex: lastAt };
  }, [chatInput, sections]);

  const filteredMentions = useMemo(() => {
    if (!mentionContext || mentionDismissed) return [];
    const q = mentionContext.query.toLowerCase();
    return sections
      .filter(
        (s) => s.level <= 2 && (q === "" || s.title.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [mentionContext, mentionDismissed, sections]);

  const showMentionDropdown = filteredMentions.length > 0;

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const addMessage = useCallback(
    (msg: UIMessage) => {
      setMessages((prev) => [...prev, msg]);
      scrollToBottom();
    },
    [scrollToBottom],
  );

  // Scroll-spy: track which section is in view
  useEffect(() => {
    const container = previewRef.current;
    if (!container || sections.length === 0) return;

    const handleScroll = () => {
      const headings = container.querySelectorAll<HTMLElement>("[data-section-id]");
      let current = "";
      for (const el of headings) {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.top - containerRect.top < 80) {
          current = el.dataset.sectionId || "";
        }
      }
      if (current) setActiveSection(current);
    };

    const scrollEl = container.querySelector("[data-radix-scroll-area-viewport]") || container;
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [sections]);

  const scrollToSection = useCallback((sectionId: string) => {
    const container = previewRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-section-id="${sectionId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(sectionId);
    }
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const insertMention = useCallback(
    (title: string) => {
      if (!mentionContext) return;
      const before = chatInput.slice(0, mentionContext.startIndex);
      const afterQuery = chatInput.slice(
        mentionContext.startIndex + 1 + mentionContext.query.length,
      );
      setChatInput(`${before}@${title} ${afterQuery}`);
      setMentionDismissed(false);
      setMentionIndex(0);
      inputRef.current?.focus();
    },
    [chatInput, mentionContext],
  );

  const handleGenerate = useCallback(
    async (topicText: string) => {
      if (!topicText.trim() || isGenerating) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setIsGenerating(true);
      setSkillMd("");
      setGenerationId(null);
      setCollapsedSections(new Set());
      addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: `Generating a demo skill for: **${topicText}**`,
      });

      let collected = "";
      try {
        for await (const event of streamWorkspaceGenerate(topicText, ctrl.signal)) {
          if (event.type === "skill") {
            collected += event.content;
            setSkillMd(collected);
          } else if (event.type === "complete") {
            setGenerationId(event.id);
            setDemoName(event.demo_name);
          } else if (event.type === "error") {
            addMessage({
              id: crypto.randomUUID(),
              role: "system",
              content: `Error: ${event.content}`,
            });
          }
        }
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Your demo skill is ready! Review it on the left. You can ask me to refine any part -- change the datasets, add features, adjust the story, or restructure the build steps.",
        });
      } catch (err) {
        if (!ctrl.signal.aborted) {
          addMessage({
            id: crypto.randomUUID(),
            role: "system",
            content: `Generation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          });
        }
      } finally {
        setIsGenerating(false);
        inputRef.current?.focus();
      }
    },
    [isGenerating, addMessage],
  );

  useEffect(() => {
    if (topic && !hasStarted.current) {
      hasStarted.current = true;
      handleGenerate(topic);
    }
  }, [topic, handleGenerate]);

  const handleRefine = useCallback(async () => {
    if (!chatInput.trim() || !generationId || isRefining) return;

    const userMsg = chatInput.trim();
    const focused = extractMentions(userMsg, sections);
    const isSectionEdit = focused.length === 1;
    setChatInput("");
    setMentionDismissed(false);
    addMessage({ id: crypto.randomUUID(), role: "user", content: userMsg });

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setIsRefining(true);

    if (isSectionEdit) {
      // Expand the targeted section so the user sees it updating
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        const sectionId = focused[0]
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        next.delete(sectionId);
        return next;
      });
    } else {
      setSkillMd("");
      setCollapsedSections(new Set());
    }

    let sectionTitle = "";
    let sectionCollected = "";
    let fullCollected = "";

    try {
      for await (const event of streamWorkspaceRefine(
        generationId,
        userMsg,
        chatHistory,
        ctrl.signal,
        focused.length > 0 ? focused : undefined,
      )) {
        if (event.type === "section_start") {
          sectionTitle = event.title;
          sectionCollected = "";
        } else if (event.type === "skill") {
          if (isSectionEdit && sectionTitle) {
            sectionCollected += event.content;
            // Strip header if the LLM included it
            let body = sectionCollected;
            const headerPrefix = `## ${sectionTitle}`;
            const stripped = body.trimStart();
            if (stripped.startsWith(headerPrefix)) {
              body = stripped.slice(headerPrefix.length).replace(/^\n+/, "");
            }
            setSkillMd((prev) => spliceSection(prev, sectionTitle, body));
          } else {
            fullCollected += event.content;
            setSkillMd(fullCollected);
          }
        } else if (event.type === "complete") {
          setDemoName(event.demo_name);
        } else if (event.type === "error") {
          addMessage({
            id: crypto.randomUUID(),
            role: "system",
            content: `Error: ${event.content}`,
          });
        }
      }
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: userMsg },
        { role: "assistant", content: "Updated the SKILL.md." },
      ]);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          isSectionEdit
            ? `Done! I've updated the "${focused[0]}" section. Everything else is untouched. What else?`
            : focused.length > 1
              ? `Done! I've updated the ${focused.map((s) => `"${s}"`).join(", ")} sections. What else?`
              : "Done! I've updated the skill. What else would you like to change?",
      });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        addMessage({
          id: crypto.randomUUID(),
          role: "system",
          content: `Refinement failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    } finally {
      setIsRefining(false);
      inputRef.current?.focus();
    }
  }, [chatInput, generationId, isRefining, chatHistory, addMessage, sections]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(skillMd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [skillMd]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([skillMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${demoName || "skill"}-SKILL.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [skillMd, demoName]);

  const busy = isGenerating || isRefining;

  return (
    <div className="flex h-screen flex-col bg-background">
      <Navbar
        leftContent={
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link to="/">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="Databricks" className="h-5 w-5" />
              <span className="text-sm font-medium">
                {demoName || "New Skill"}
              </span>
              {busy && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {isGenerating ? "Generating" : "Refining"}
                </Badge>
              )}
            </div>
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: SKILL.md viewer with outline */}
        <div className="flex w-1/2 flex-col border-r border-border/60">
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b px-3 py-1.5 shrink-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <div className="flex items-center justify-between">
                <TabsList className="h-8">
                  <TabsTrigger value="preview" className="gap-1.5 text-xs px-2.5 h-6">
                    <FileText className="h-3 w-3" /> Preview
                  </TabsTrigger>
                  <TabsTrigger value="architecture" className="gap-1.5 text-xs px-2.5 h-6">
                    <Workflow className="h-3 w-3" /> Architecture
                  </TabsTrigger>
                  <TabsTrigger value="raw" className="gap-1.5 text-xs px-2.5 h-6">
                    <Code className="h-3 w-3" /> Raw
                  </TabsTrigger>
                </TabsList>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    disabled={!skillMd}
                    className="h-7 px-2 text-xs"
                  >
                    {copied ? (
                      <Check className="mr-1 h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="mr-1 h-3 w-3" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownload}
                    disabled={!skillMd}
                    className="h-7 px-2 text-xs"
                  >
                    <Download className="mr-1 h-3 w-3" /> Download
                  </Button>
                </div>
              </div>

              {/* Section outline - only on Preview tab */}
              {sections.length > 0 && activeTab === "preview" && (
                <div className="flex items-center gap-1 mt-1.5 pb-0.5 overflow-x-auto scrollbar-none">
                  {sections.filter(s => s.level <= 2).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => scrollToSection(s.id)}
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all whitespace-nowrap ${
                        activeSection === s.id
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              )}

              <TabsContent value="preview" className="mt-0">
                <div ref={previewRef}>
                  <ScrollArea className="h-[calc(100vh-8.5rem)]">
                    <div className="px-5 py-4">
                      {skillMd ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <SkillPreview
                            markdown={skillMd}
                            collapsedSections={collapsedSections}
                            onToggleSection={toggleSection}
                          />
                          {busy && (
                            <span className="inline-block h-4 w-1 animate-pulse bg-primary rounded-full" />
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                          <Sparkles className="mb-3 h-10 w-10 opacity-30" />
                          <p className="text-sm">
                            {busy
                              ? "Generating your SKILL.md..."
                              : "Enter a topic to get started"}
                          </p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="architecture" className="mt-0">
                <ScrollArea className="h-[calc(100vh-8.5rem)]">
                  <div className="p-5">
                    <ArchitectureGraph markdown={skillMd} />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="raw" className="mt-0">
                <ScrollArea className="h-[calc(100vh-8.5rem)]">
                  <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-relaxed text-foreground/80">
                    {skillMd || "No content yet."}
                    {busy && (
                      <span className="inline-block h-3 w-0.5 animate-pulse bg-primary rounded-full" />
                    )}
                  </pre>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Right Panel: Chat */}
        <div className="flex w-1/2 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Skill Architect</span>
          </div>

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-3 p-4">
              {messages.length === 0 && !busy && (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <Bot className="mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm font-medium">Skill Architect</p>
                  <p className="mt-1 text-xs max-w-xs">
                    Describe a use-case and I'll build a complete SKILL.md with
                    datasets, transformations, and build steps.
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}

              {busy && messages.length > 0 && (
                <div className="flex gap-2.5 items-start">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="rounded-xl bg-muted/60 px-3.5 py-2.5">
                    <div className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          {/* Chat input */}
          <div className="border-t bg-background p-3 shrink-0">
            {!topic && !generationId ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chatInput.trim()) {
                    navigate({
                      to: "/workspace",
                      search: { topic: chatInput.trim() },
                    });
                    setChatInput("");
                  }
                }}
                className="flex gap-2"
              >
                <Input
                  ref={inputRef}
                  placeholder="Describe a use-case to generate a demo skill..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={busy}
                  className="bg-muted/40"
                />
                <Button type="submit" disabled={busy || !chatInput.trim()} size="icon" className="shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRefine();
                }}
                className="relative flex gap-2"
              >
                {showMentionDropdown && (
                  <div className="absolute bottom-full left-0 mb-1.5 w-72 max-h-52 overflow-y-auto rounded-lg border bg-popover/95 backdrop-blur-sm shadow-lg z-50">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b">
                      Focus on section
                    </div>
                    {filteredMentions.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                          i === mentionIndex
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted"
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertMention(s.title);
                        }}
                        onMouseEnter={() => setMentionIndex(i)}
                      >
                        <AtSign className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{s.title}</span>
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  ref={inputRef}
                  placeholder={
                    busy
                      ? "Waiting for generation..."
                      : "Refine the skill... Type @ to focus on a section"
                  }
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);
                    if (mentionDismissed) setMentionDismissed(false);
                    setMentionIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (!showMentionDropdown) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((i) =>
                        Math.min(i + 1, filteredMentions.length - 1),
                      );
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      insertMention(filteredMentions[mentionIndex].title);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setMentionDismissed(true);
                    }
                  }}
                  disabled={busy || !generationId}
                  className="bg-muted/40"
                />
                <Button
                  type="submit"
                  disabled={busy || !chatInput.trim() || !generationId}
                  size="icon"
                  className="shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
          {message.content.replace(/\*\*/g, "")}
        </span>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2.5 items-start ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-foreground/10" : "bg-primary/10"
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-primary" />
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted/60 text-foreground"
        }`}
      >
        {isUser
          ? message.content.split(/(@\S+(?:\s\S+)*?)(?=\s+[^@]|$)/g).map((part, i) =>
              part.startsWith("@") ? (
                <span
                  key={i}
                  className="rounded bg-white/20 px-1 font-medium"
                >
                  {part}
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )
          : message.content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown rendering with collapsible sections + anchor IDs
// ---------------------------------------------------------------------------

function SkillPreview({
  markdown,
  collapsedSections,
  onToggleSection,
}: {
  markdown: string;
  collapsedSections: Set<string>;
  onToggleSection: (id: string) => void;
}) {
  const rendered = useMemo(
    () => renderToSections(markdown),
    [markdown],
  );

  return (
    <div>
      {rendered.preamble && (
        <div dangerouslySetInnerHTML={{ __html: rendered.preamble }} />
      )}
      {rendered.sections.map((section) => {
        const isCollapsed = collapsedSections.has(section.id);
        return (
          <div key={section.id} className="group" data-section-id={section.id}>
            <button
              onClick={() => onToggleSection(section.id)}
              className="flex w-full items-center gap-1.5 text-left mt-6 mb-2 border-b pb-1.5 border-primary/10 hover:border-primary/25 transition-colors"
            >
              <span className="text-muted-foreground/60 group-hover:text-primary transition-colors">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </span>
              <span className="text-lg font-bold">{section.title}</span>
            </button>
            {!isCollapsed && (
              <div
                className="animate-in fade-in slide-in-from-top-1 duration-200"
                dangerouslySetInnerHTML={{ __html: section.html }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface RenderedSection {
  id: string;
  title: string;
  html: string;
}

interface RenderedSkill {
  preamble: string;
  sections: RenderedSection[];
}

function renderToSections(md: string): RenderedSkill {
  let text = md;
  let preamble = "";

  // Strip YAML frontmatter into preamble
  if (text.startsWith("---")) {
    const end = text.indexOf("---", 3);
    if (end !== -1) {
      const fm = text.slice(3, end).trim();
      text = text.slice(end + 3);
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
      if (nameMatch)
        preamble += `<div class="mb-1"><span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Skill</span> <code class="text-sm text-primary">${esc(nameMatch[1])}</code></div>`;
      if (descMatch)
        preamble += `<p class="text-sm text-muted-foreground italic mb-2">${esc(descMatch[1])}</p>`;
    }
  }

  // Split on ## headers (level 2) into sections
  const parts = text.split(/^(?=## )/gm);
  const sections: RenderedSection[] = [];
  let preParts = "";

  for (const part of parts) {
    const headerMatch = part.match(/^## (.+)\n/);
    if (headerMatch) {
      const title = headerMatch[1].trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const body = part.slice(headerMatch[0].length);
      sections.push({
        id,
        title,
        html: renderInlineMarkdown(body),
      });
    } else {
      preParts += part;
    }
  }

  // Render any content before the first ## (like # title) into preamble
  if (preParts.trim()) {
    preamble += renderInlineMarkdown(preParts);
  }

  return { preamble, sections };
}

function renderInlineMarkdown(text: string): string {
  let result = text;

  // Code blocks
  result = result.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_, _lang, code) =>
      `<pre class="bg-muted rounded-lg p-3 overflow-x-auto my-2"><code class="text-xs">${esc(code.trim())}</code></pre>`,
  );

  // Sub-headers
  result = result.replace(/^#### (.+)$/gm, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>');
  result = result.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1.5">$1</h3>');
  result = result.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mb-2">$1</h1>');

  // Checkbox lists
  result = result.replace(
    /^- \[ \] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-1 my-0.5"><input type="checkbox" disabled class="mt-1 accent-primary" /><span class="text-sm">$1</span></div>',
  );
  result = result.replace(
    /^- \[x\] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-1 my-0.5"><input type="checkbox" checked disabled class="mt-1 accent-primary" /><span class="text-sm">$1</span></div>',
  );

  // Numbered lists
  result = result.replace(/^(\d+)\.\s+(.+)$/gm, '<div class="flex gap-2 ml-1 my-0.5"><span class="text-xs font-semibold text-primary/60 mt-0.5 shrink-0 w-4 text-right">$1.</span><span class="text-sm">$2</span></div>');

  // Bullet lists
  result = result.replace(/^- (.+)$/gm, '<div class="flex gap-2 ml-1 my-0.5"><span class="text-primary/40 mt-1 shrink-0">&#8226;</span><span class="text-sm">$1</span></div>');

  // Tables
  result = result.replace(
    /^\|(.+)\|$/gm,
    (match) => {
      if (match.match(/^\|\s*[-:]+/)) return "";
      const cells = match.split("|").filter(Boolean).map((c) => c.trim());
      return `<tr>${cells.map((c) => `<td class="border border-border/50 px-2 py-1 text-xs">${c}</td>`).join("")}</tr>`;
    },
  );
  result = result.replace(
    /(<tr>[\s\S]*?<\/tr>(\s*<tr>[\s\S]*?<\/tr>)*)/g,
    '<table class="w-full border-collapse my-2">$1</table>',
  );

  // Inline formatting
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(
    /`([^`]+)`/g,
    '<code class="bg-muted px-1 py-0.5 rounded text-xs text-primary/80">$1</code>',
  );

  // Paragraphs
  result = result.replace(/\n{2,}/g, "</p><p class=\"text-sm leading-relaxed my-1.5\">");
  result = `<p class="text-sm leading-relaxed my-1.5">${result}</p>`;
  result = result.replace(/<p class="text-sm leading-relaxed my-1.5">\s*<\/p>/g, "");

  return result;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Architecture graph: parse SKILL.md and render a component flow diagram
// ---------------------------------------------------------------------------

interface ArchNode {
  id: string;
  label: string;
  detail?: string;
}

interface Architecture {
  sources: ArchNode[];
  transforms: ArchNode[];
  outputs: ArchNode[];
  tools: string[];
}

function parseArchitecture(md: string): Architecture {
  const sources: ArchNode[] = [];
  const transforms: ArchNode[] = [];
  const outputs: ArchNode[] = [];
  const tools: string[] = [];

  const parts = md.split(/^(?=## )/gm);
  for (const part of parts) {
    const hdr = part.match(/^## (.+)\n/);
    if (!hdr) continue;
    const title = hdr[1].trim().toLowerCase();
    const body = part.slice(hdr[0].length);

    if (title.includes("dataset") || title.includes("data source")) {
      for (const m of body.matchAll(/^### (.+)$/gm)) {
        const label = m[1].trim();
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const blockEnd = body.indexOf("###", body.indexOf(m[0]) + m[0].length);
        const block = body.slice(
          body.indexOf(m[0]) + m[0].length,
          blockEnd > -1 ? blockEnd : undefined,
        );
        const rowMatch = block.match(
          /(?:~?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:K|M|B)?\s*rows?/i,
        );
        sources.push({
          id,
          label,
          detail: rowMatch ? `~${rowMatch[0].trim()}` : undefined,
        });
      }
    } else if (title.includes("transform")) {
      const subHeaders = [...body.matchAll(/^### (.+)$/gm)];
      if (subHeaders.length > 0) {
        for (const m of subHeaders) {
          const label = m[1].trim();
          const id = label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-");
          transforms.push({ id, label });
        }
      } else {
        transforms.push({
          id: "transformations",
          label: "Data Pipeline",
        });
      }
    } else if (
      title.includes("output") ||
      title.includes("deliverable")
    ) {
      for (const m of body.matchAll(/^### (.+)$/gm)) {
        const label = m[1].trim();
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        outputs.push({ id, label });
      }
    } else if (title.includes("build step")) {
      for (const m of body.matchAll(
        /`(databricks-[a-z-]+|instrumenting-[a-z-]+|spark-[a-z-]+|agent-[a-z-]+)`/g,
      )) {
        if (!tools.includes(m[1])) tools.push(m[1]);
      }
    }
  }

  return { sources, transforms, outputs, tools };
}

function getOutputIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes("dashboard") || l.includes("chart") || l.includes("analytics"))
    return BarChart3;
  if (l.includes("genie")) return MessageCircle;
  if (
    l.includes("model") ||
    l.includes("agent") ||
    l.includes("ai") ||
    l.includes("ml")
  )
    return BrainCircuit;
  if (l.includes("app")) return AppWindow;
  return BarChart3;
}

function ArchitectureGraph({ markdown }: { markdown: string }) {
  const arch = useMemo(() => parseArchitecture(markdown), [markdown]);

  if (!markdown) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Workflow className="h-10 w-10 opacity-30 mb-3" />
        <p className="text-sm">Architecture will appear after generation</p>
      </div>
    );
  }

  const hasNodes =
    arch.sources.length > 0 ||
    arch.transforms.length > 0 ||
    arch.outputs.length > 0;

  if (!hasNodes) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Workflow className="h-10 w-10 opacity-30 mb-3" />
        <p className="text-sm">
          Could not extract architecture from this skill
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Workflow className="h-4 w-4" />
        Component Architecture
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-x-3 gap-y-0 items-stretch">
        {/* Sources */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-500/80 mb-3 flex items-center gap-1.5">
            <Database className="h-3 w-3" />
            Data Sources
          </div>
          {arch.sources.length > 0 ? (
            arch.sources.map((node) => (
              <div
                key={node.id}
                className="flex items-start gap-2.5 rounded-lg border border-blue-500/15 bg-blue-500/[0.06] p-2.5 transition-colors hover:border-blue-500/25"
              >
                <Database className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {node.label}
                  </div>
                  {node.detail && (
                    <div className="text-[11px] text-muted-foreground">
                      {node.detail}
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-xs text-muted-foreground/50 italic py-4 text-center">
              No datasets detected
            </div>
          )}
        </div>

        <div className="flex items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <div className="h-8 w-px bg-gradient-to-b from-transparent via-muted-foreground/20 to-transparent" />
            <ArrowRight className="h-4 w-4 text-muted-foreground/30" />
            <div className="h-8 w-px bg-gradient-to-b from-transparent via-muted-foreground/20 to-transparent" />
          </div>
        </div>

        {/* Transforms */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-500/80 mb-3 flex items-center gap-1.5">
            <Workflow className="h-3 w-3" />
            Processing
          </div>
          {arch.transforms.map((node) => (
            <div
              key={node.id}
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/15 bg-amber-500/[0.06] p-2.5 transition-colors hover:border-amber-500/25"
            >
              <Workflow className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <div className="text-sm font-medium truncate">{node.label}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <div className="h-8 w-px bg-gradient-to-b from-transparent via-muted-foreground/20 to-transparent" />
            <ArrowRight className="h-4 w-4 text-muted-foreground/30" />
            <div className="h-8 w-px bg-gradient-to-b from-transparent via-muted-foreground/20 to-transparent" />
          </div>
        </div>

        {/* Outputs */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500/80 mb-3 flex items-center gap-1.5">
            <BarChart3 className="h-3 w-3" />
            Deliverables
          </div>
          {arch.outputs.length > 0 ? (
            arch.outputs.map((node) => {
              const Icon = getOutputIcon(node.label);
              return (
                <div
                  key={node.id}
                  className="flex items-start gap-2.5 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] p-2.5 transition-colors hover:border-emerald-500/25"
                >
                  <Icon className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                  <div className="text-sm font-medium truncate">
                    {node.label}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-xs text-muted-foreground/50 italic py-4 text-center">
              No outputs detected
            </div>
          )}
        </div>
      </div>

      {arch.tools.length > 0 && (
        <div className="space-y-2.5 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-500/80">
            <Wrench className="h-3 w-3" />
            Referenced Skills
          </div>
          <div className="flex flex-wrap gap-1.5">
            {arch.tools.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center rounded-md border border-violet-500/15 bg-violet-500/[0.06] px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
