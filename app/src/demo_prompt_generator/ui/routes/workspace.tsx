import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
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
  PackageCheck,
  Archive,
  CheckCircle2,
  Blocks,
  Layers,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { useBuildoutStore } from "@/lib/buildout-store";
import {
  streamWorkspacePropose,
  streamProposalRefine,
  streamFileRefine,
  streamAgentRefine,
  streamParallelBuildout,
  streamModifyBlocks,
  streamCollectionSuggestion,
  saveConversation,
  listConversations,
  getConversation,
  type ChatMessage,
} from "@/lib/custom-api";
import { FileRendererWithFallback } from "@/components/file-renderers";
import { ProposalCards } from "@/components/proposal-cards";
import { BlockPicker, BlockPills } from "@/components/block-picker";
import { CollectionInfo, CollectionDetailView, ParallelBuildoutProgress } from "@/components/collection-builder";

const ArchitectureBuilder = lazy(() => import("@/components/architecture-builder"));

export const Route = createFileRoute("/workspace")({
  validateSearch: (search: Record<string, unknown>) => ({
    topic: (search.topic as string) || "",
    generationId: search.generationId
      ? Number(search.generationId)
      : undefined,
    collection: (search.collection as string) || "",
  }),
  component: WorkspacePage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage = "collection" | "proposal" | "buildout" | "package";

const PACKAGE_FILES = [
  "reference.md",
] as const;

type PackageFilename = (typeof PACKAGE_FILES)[number];

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARCH_SECTION_MARKER = "\n\n## Architecture\n";
const ARCH_SECTION_RE = /(?:^|\n)\s*##\s+Architecture\s*\n/;

/** Strip the ## Architecture section from proposal markdown */
function stripArchSection(md: string): string {
  const match = ARCH_SECTION_RE.exec(md);
  return match ? md.slice(0, match.index) : md;
}

/** Extract the ## Architecture section from proposal markdown */
function _extractArchSection(md: string): string {
  const match = ARCH_SECTION_RE.exec(md);
  if (!match) return "";
  return md.slice(match.index + match[0].length).trim();
}

let _idCounter = 0;
function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${++_idCounter}`;
}

function parseSections(md: string): Section[] {
  const sections: Section[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      const id = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (level <= 2) sections.push({ id, title, level });
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

function _spliceSection(
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

const _FILE_ICONS: Record<string, any> = {
  "reference.md": FileText,
};

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

function WorkspacePage() {
  const { topic, generationId: loadId, collection: collectionParam } = Route.useSearch();
  const navigate = useNavigate();

  // Stage management
  const [stage, setStage] = useState<Stage>("proposal");
  const [proposalMd, setProposalMd] = useState("");
  const [packageFiles, setPackageFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<PackageFilename>("reference.md");

  // Common state
  const [generationId, setGenerationId] = useState<number | null>(null);
  const [demoName, setDemoName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [copied, setCopied] = useState(false);
  const [_activeSection, _setActiveSection] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState("preview");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [_proposalArchMermaid, _setProposalArchMermaid] = useState("");
  const [agentMode] = useState(true); // Agent mode is always on — this is an agent SDK product

  // Collection/block state
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [collectionOutputFiles, setCollectionOutputFiles] = useState<{ filename: string; purpose: string; depends_on: string[] }[]>([]);
  const [suggestingCollection, setSuggestingCollection] = useState(false);
  const [showBlockPicker, setShowBlockPicker] = useState(false);
  const [buildoutTiers, setBuildoutTiers] = useState<{ tier: number; files: string[] }[]>([]);
  const [currentBuildoutTier, setCurrentBuildoutTier] = useState(-1);
  const [completedBuildoutFiles, setCompletedBuildoutFiles] = useState<Set<string>>(new Set());
  const [activeBuildoutFiles, setActiveBuildoutFiles] = useState<Set<string>>(new Set());

  // Buildout store — global state that survives route changes
  const buildoutStore = useBuildoutStore();
  const buildingFile = buildoutStore.status === "building" ? buildoutStore.currentFile : null;
  // When architecture changes in the builder, sync into proposalMd
  const archSyncRef = useRef(false); // prevent loop: builder change → proposalMd update → builder re-parse

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasStarted = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const architectureBuilderRef = useRef<{ getSerializedArchitecture: () => string | null }>(null);

  // Reset archSyncRef after the proposalMd update from architecture builder is processed
  useEffect(() => {
    if (archSyncRef.current) {
      archSyncRef.current = false;
    }
  }, [proposalMd]);

  // Abort any in-flight streaming on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      hasStarted.current = false;
    };
  }, []);

  const currentMd =
    stage === "proposal"
      ? proposalMd
      : packageFiles[activeFile] || "";

  const sections = useMemo(() => parseSections(stage === "proposal" ? stripArchSection(currentMd) : currentMd), [currentMd, stage]);

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
    setTimeout(
      () => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  }, []);

  const addMessage = useCallback(
    (msg: UIMessage) => {
      setMessages((prev) => [...prev, msg]);
      scrollToBottom();
    },
    [scrollToBottom],
  );

  // Scroll-spy
  useEffect(() => {
    const container = previewRef.current;
    if (!container || sections.length === 0) return;
    const handleScroll = () => {
      const headings =
        container.querySelectorAll<HTMLElement>("[data-section-id]");
      let current = "";
      for (const el of headings) {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.top - containerRect.top < 80) current = el.dataset.sectionId || "";
      }
      if (current) setActiveSection(current);
    };
    const scrollEl =
      container.querySelector("[data-radix-scroll-area-viewport]") || container;
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [sections]);

  const _scrollToSection = useCallback((sectionId: string) => {
    const container = previewRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-section-id="${sectionId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      _setActiveSection(sectionId);
    }
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
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

  // -----------------------------------------------------------------------
  // Stage 1: Proposal generation
  // -----------------------------------------------------------------------

  const handlePropose = useCallback(
    async (topicText: string) => {
      if (!topicText.trim() || isGenerating) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setIsGenerating(true);
      setProposalMd("");
      setGenerationId(null);
      setStage("proposal");
      setCollapsedSections(new Set());
      addMessage({
        id: uid(),
        role: "system",
        content: `Generating a demo proposal for: **${topicText}**`,
      });

      let collected = "";
      try {
        for await (const event of streamWorkspacePropose(
          topicText,
          ctrl.signal,
        )) {
          if (event.type === "proposal") {
            collected += event.content;
            setProposalMd(collected);
          } else if (event.type === "complete") {
            setGenerationId(event.id);
            setDemoName(event.demo_name);
          } else if (event.type === "error") {
            addMessage({
              id: uid(),
              role: "system",
              content: `Error: ${event.content}`,
            });
          }
        }
        addMessage({
          id: uid(),
          role: "assistant",
          content:
            'Your proposal is ready! Review the storyline and architecture on the left. I\'m also suggesting a **collection** of building blocks for parallel generation.',
        });

        // Auto-suggest a matching collection
        setSuggestingCollection(true);
        try {
          let suggestionRaw = "";
          for await (const event of streamCollectionSuggestion(topicText)) {
            if (event.type === "suggestion") {
              suggestionRaw += (event as { type: string; content: string }).content;
            } else if (event.type === "complete") {
              const ev = event as { type: string; collection?: { slug: string; blocks: string[]; output_files: { filename: string; purpose: string; depends_on: string[] }[] } };
              if (ev.collection) {
                setCollectionSlug(ev.collection.slug);
                setSelectedBlocks(ev.collection.blocks);
                setCollectionOutputFiles(ev.collection.output_files || []);
                addMessage({
                  id: uid(),
                  role: "assistant",
                  content: `Suggested collection: **${ev.collection.slug}** with ${ev.collection.blocks.length} blocks. You can adjust the blocks below, then Approve & Build for parallel generation.`,
                });
              }
            }
          }
        } catch {
          // Collection suggestion is best-effort — don't block the flow
        } finally {
          setSuggestingCollection(false);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          addMessage({
            id: uid(),
            role: "system",
            content: `Proposal failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          });
        }
      } finally {
        setIsGenerating(false);
        inputRef.current?.focus();
      }
    },
    [isGenerating, addMessage],
  );

  // Refine proposal via chat
  const handleRefineProposal = useCallback(async () => {
    if (!chatInput.trim() || !generationId || isRefining) return;

    const userMsg = chatInput.trim();
    const focused = extractMentions(userMsg, sections);
    setChatInput("");
    setMentionDismissed(false);
    addMessage({ id: uid(), role: "user", content: userMsg });

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsRefining(true);
    // Keep old content visible — don't blank the preview
    setCollapsedSections(new Set());

    let collected = "";
    let firstChunk = true;
    try {
      for await (const event of streamProposalRefine(
        generationId,
        userMsg,
        chatHistory,
        ctrl.signal,
        focused.length > 0 ? focused : undefined,
      )) {
        if (event.type === "proposal") {
          // On first chunk, replace old content so we don't show stale+new mixed
          if (firstChunk) {
            collected = event.content;
            firstChunk = false;
          } else {
            collected += event.content;
          }
          setProposalMd(collected);
        } else if (event.type === "complete") {
          setDemoName(event.demo_name);
        } else if (event.type === "error") {
          addMessage({
            id: uid(),
            role: "system",
            content: `Error: ${event.content}`,
          });
        }
      }
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: userMsg },
        { role: "assistant", content: "Updated the proposal." },
      ]);
      addMessage({
        id: uid(),
        role: "assistant",
        content:
          "Done! I've updated the proposal. Review the changes and refine further or approve to start the buildout.",
      });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        addMessage({
          id: uid(),
          role: "system",
          content: `Refinement failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    } finally {
      setIsRefining(false);
      inputRef.current?.focus();
    }
  }, [
    chatInput,
    generationId,
    isRefining,
    chatHistory,
    addMessage,
    sections,
  ]);

  // -----------------------------------------------------------------------
  // Approve proposal → trigger buildout
  // -----------------------------------------------------------------------

  const handleApproveAndBuild = useCallback(async () => {
    if (!generationId || isGenerating) return;
    if (buildoutStore.status === "building") return;

    // Capture user's architecture diagram before transitioning
    const userArchitecture = architectureBuilderRef.current?.getSerializedArchitecture() || undefined;

    setStage("buildout");
    setPackageFiles({});
    setChatHistory([]);
    setCollapsedSections(new Set());
    setIsGenerating(true);

    if (collectionSlug) {
      // --- Parallel buildout via collection ---
      setBuildoutTiers([]);
      setCurrentBuildoutTier(-1);
      setCompletedBuildoutFiles(new Set());
      setActiveBuildoutFiles(new Set());

      addMessage({
        id: uid(),
        role: "system",
        content: `Proposal approved! Building with collection **${collectionSlug}** — ${collectionOutputFiles.length} files will generate in parallel tiers...`,
      });

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        for await (const event of streamParallelBuildout(
          generationId,
          collectionSlug,
          ctrl.signal,
        )) {
          if (event.type === "tier_start") {
            const { tier, files } = event as { type: string; tier: number; files: string[] };
            setBuildoutTiers((prev) => [...prev, { tier, files }]);
            setCurrentBuildoutTier(tier);
            setActiveBuildoutFiles(new Set(files));
          } else if (event.type === "file_start") {
            // file is being generated
          } else if (event.type === "file_complete") {
            const { filename, content } = event as { type: string; filename: string; content: string };
            setPackageFiles((prev) => ({ ...prev, [filename]: content }));
            setCompletedBuildoutFiles((prev) => new Set([...prev, filename]));
            setActiveBuildoutFiles((prev) => {
              const next = new Set(prev);
              next.delete(filename);
              return next;
            });
          } else if (event.type === "tier_complete") {
            setActiveBuildoutFiles(new Set());
          } else if (event.type === "all_complete") {
            const ev = event as { type: string; files: Record<string, string>; id?: number; demo_name?: string };
            setPackageFiles(ev.files);
            if (ev.demo_name) setDemoName(ev.demo_name);
            setStage("package");
            setIsGenerating(false);
            addMessage({
              id: uid(),
              role: "assistant",
              content: `Demo package ready! ${Object.keys(ev.files).length} files generated in parallel. Review each file using the tabs.`,
            });
          } else if (event.type === "error") {
            addMessage({
              id: uid(),
              role: "system",
              content: `Error: ${(event as { content: string }).content}`,
            });
          }
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          addMessage({
            id: uid(),
            role: "system",
            content: `Parallel buildout failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          });
        }
      } finally {
        setIsGenerating(false);
      }
    } else {
      // --- Legacy single-file buildout ---
      addMessage({
        id: uid(),
        role: "system",
        content: userArchitecture
          ? "Proposal approved with user architecture! Building the full demo package..."
          : "Proposal approved! Building the full demo package...",
      });

      // Delegate to global buildout store — survives route changes
      buildoutStore.startBuildout(generationId, demoName, userArchitecture);
    }
  }, [generationId, isGenerating, demoName, collectionSlug, buildoutStore, addMessage, setStage, setPackageFiles, setChatHistory, setCollapsedSections, setIsGenerating]);

  // Sync buildout store state → local component state
  useEffect(() => {
    if (buildoutStore.generationId !== generationId) return;
    if (buildoutStore.status === "building") {
      setPackageFiles(buildoutStore.files);
      if (buildoutStore.currentFile) {
        setActiveFile(buildoutStore.currentFile as PackageFilename);
      }
      setIsGenerating(true);
      setStage("buildout");
    }
  }, [buildoutStore.files, buildoutStore.currentFile, buildoutStore.status, buildoutStore.generationId, generationId]);

  // Handle buildout completion
  useEffect(() => {
    if (buildoutStore.generationId !== generationId) return;
    if (buildoutStore.status === "complete") {
      setPackageFiles(buildoutStore.files);
      setStage("package");
      setIsGenerating(false);
      addMessage({
        id: uid(),
        role: "assistant",
        content:
          "Your demo package is ready! All files have been generated. Review each file using the tabs on the left. You can refine any file by chatting here.",
      });
      buildoutStore.reset();
    } else if (buildoutStore.status === "error") {
      setIsGenerating(false);
      addMessage({
        id: uid(),
        role: "system",
        content: buildoutStore.error || "Buildout failed",
      });
    } else if (buildoutStore.status === "stopped") {
      setIsGenerating(false);
      setPackageFiles(buildoutStore.files);
    }
  }, [buildoutStore.status, buildoutStore.generationId, generationId]);

  // Handle stop button in workspace
  const handleStopBuildout = useCallback(() => {
    buildoutStore.stopBuildout();
  }, [buildoutStore]);

  // Handle resume in workspace
  const handleResumeBuildout = useCallback(() => {
    if (!generationId) return;
    setIsGenerating(true);
    buildoutStore.resumeBuildout(
      generationId,
      demoName,
      packageFiles,
      buildoutStore.userArchitecture,
    );
  }, [generationId, demoName, packageFiles, buildoutStore]);

  // -----------------------------------------------------------------------
  // Stage 2: Per-file refinement
  // -----------------------------------------------------------------------

  const handleRefineFile = useCallback(async () => {
    if (!chatInput.trim() || !generationId || isRefining) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setMentionDismissed(false);
    addMessage({ id: uid(), role: "user", content: userMsg });

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsRefining(true);

    let collected = "";
    try {
      for await (const event of streamFileRefine(
        generationId,
        activeFile,
        userMsg,
        chatHistory,
        ctrl.signal,
      )) {
        if (event.type === "file_content") {
          collected += event.content;
          setPackageFiles((prev) => ({
            ...prev,
            [event.filename]: collected,
          }));
        } else if (event.type === "complete") {
          setDemoName(event.demo_name);
        } else if (event.type === "error") {
          addMessage({
            id: uid(),
            role: "system",
            content: `Error: ${event.content}`,
          });
        }
      }
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: userMsg },
        { role: "assistant", content: `Updated ${activeFile}.` },
      ]);
      addMessage({
        id: uid(),
        role: "assistant",
        content: `Done! I've updated **${activeFile}**. What else would you like to change?`,
      });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        addMessage({
          id: uid(),
          role: "system",
          content: `Refinement failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    } finally {
      setIsRefining(false);
      inputRef.current?.focus();
    }
  }, [
    chatInput,
    generationId,
    isRefining,
    activeFile,
    chatHistory,
    addMessage,
  ]);

  // -----------------------------------------------------------------------
  // Agent mode: cross-file editing
  // -----------------------------------------------------------------------

  const handleAgentRefine = useCallback(async () => {
    if (!chatInput.trim() || !generationId || isRefining) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setMentionDismissed(false);
    addMessage({ id: uid(), role: "user", content: userMsg });

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsRefining(true);

    try {
      for await (const event of streamAgentRefine(
        generationId,
        userMsg,
        chatHistory,
        ctrl.signal,
      )) {
        if (event.type === "agent_reading") {
          addMessage({
            id: uid(),
            role: "system",
            content: `Reading ${event.filename}...`,
          });
        } else if (event.type === "file_start") {
          addMessage({
            id: uid(),
            role: "system",
            content: `Writing ${event.filename}...`,
          });
        } else if (event.type === "file_content") {
          setPackageFiles((prev) => ({
            ...prev,
            [event.filename]: event.content,
          }));
          setActiveFile(event.filename as PackageFilename);
        } else if (event.type === "agent_message") {
          addMessage({
            id: uid(),
            role: "assistant",
            content: event.content,
          });
        } else if (event.type === "complete") {
          setDemoName(event.demo_name);
        } else if (event.type === "error") {
          addMessage({
            id: uid(),
            role: "system",
            content: `Error: ${event.content}`,
          });
        }
      }
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: userMsg },
        { role: "assistant", content: "Updated package files." },
      ]);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        addMessage({
          id: uid(),
          role: "system",
          content: `Agent failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    } finally {
      setIsRefining(false);
      inputRef.current?.focus();
    }
  }, [chatInput, generationId, isRefining, chatHistory, addMessage]);

  // -----------------------------------------------------------------------
  // Architecture Builder: apply diagram to reference.md
  // -----------------------------------------------------------------------

  const handleApplyArchitecture = useCallback(
    (architectureDescription: string) => {
      if (!generationId || isRefining) return;

      if (stage === "buildout" || stage === "package") {
        // Buildout/package: refine reference.md via file refinement
        const msg = `Replace the architecture content with this updated architecture:\n\n${architectureDescription}`;
        addMessage({ id: uid(), role: "user", content: "Updated architecture from visual builder" });

        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setIsRefining(true);

        let collected = "";
        (async () => {
          try {
            for await (const event of streamFileRefine(
              generationId,
              "reference.md",
              msg,
              chatHistory,
              ctrl.signal,
            )) {
              if (event.type === "file_content") {
                collected += event.content;
                setPackageFiles((prev) => ({
                  ...prev,
                  [event.filename]: collected,
                }));
              } else if (event.type === "complete") {
                setDemoName(event.demo_name);
              } else if (event.type === "error") {
                addMessage({
                  id: uid(),
                  role: "system",
                  content: `Error: ${event.content}`,
                });
              }
            }
            setChatHistory((prev) => [
              ...prev,
              { role: "user", content: msg },
              { role: "assistant", content: "Updated reference.md from builder." },
            ]);
            addMessage({
              id: uid(),
              role: "assistant",
              content: "Done! I've updated **reference.md** from your diagram.",
            });
            setActiveFile("reference.md" as PackageFilename);
            setActiveTab("preview");
          } catch (err) {
            if (!ctrl.signal.aborted) {
              addMessage({
                id: uid(),
                role: "system",
                content: `Architecture update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
              });
            }
          } finally {
            setIsRefining(false);
          }
        })();
      } else if (stage === "proposal") {
        // Proposal stage: refine the Proposed Solution to reflect the diagram
        const msg = `Update the Proposed Solution section to reflect this architecture design. Ensure the Build Steps align with these components and connections:\n\n${architectureDescription}`;
        addMessage({ id: uid(), role: "user", content: "Refining Proposed Solution from architecture diagram" });

        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setIsRefining(true);

        let collected = "";
        let firstChunk = true;
        (async () => {
          try {
            for await (const event of streamProposalRefine(
              generationId,
              msg,
              chatHistory,
              ctrl.signal,
              ["Proposed Solution", "Build Steps"],
            )) {
              if (event.type === "proposal") {
                if (firstChunk) { collected = event.content; firstChunk = false; }
                else collected += event.content;
                setProposalMd(collected);
              } else if (event.type === "complete") {
                setDemoName(event.demo_name);
              } else if (event.type === "error") {
                addMessage({ id: uid(), role: "system", content: `Error: ${event.content}` });
              }
            }
            setChatHistory((prev) => [
              ...prev,
              { role: "user", content: msg },
              { role: "assistant", content: "Updated the Proposed Solution from architecture." },
            ]);
            addMessage({
              id: uid(),
              role: "assistant",
              content: "Done! I've updated the **Proposed Solution** and **Build Steps** to match your architecture diagram.",
            });
            setActiveTab("preview");
          } catch (err) {
            if (!ctrl.signal.aborted) {
              addMessage({ id: uid(), role: "system", content: `Refinement failed: ${err instanceof Error ? err.message : "Unknown error"}` });
            }
          } finally {
            setIsRefining(false);
          }
        })();
      }
    },
    [generationId, isRefining, stage, chatHistory, addMessage, setIsRefining, setPackageFiles, setProposalMd, setDemoName, setChatHistory, setActiveFile, setActiveTab],
  );

  // -----------------------------------------------------------------------
  // Start generation on mount OR load existing generation
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    if (loadId) {
      (async () => {
        try {
          const resp = await fetch(`/api/generations/${loadId}`);
          if (!resp.ok) throw new Error("Generation not found");
          const gen = await resp.json();

          setGenerationId(gen.id);
          setDemoName(gen.demo_name);

          if (gen.stage === "building" && gen.skill_files && Object.keys(gen.skill_files).length > 0) {
            // Partially-completed buildout — check if store is already running
            const store = useBuildoutStore.getState();
            if (store.status === "building" && store.generationId === gen.id) {
              // Store is actively building this generation — sync local state
              setPackageFiles(store.files);
              setStage("buildout");
              setIsGenerating(true);
            } else {
              // Offer resume — show partial files and stopped state
              setPackageFiles(gen.skill_files);
              setStage("buildout");
            }
          } else if (gen.skill_files && Object.keys(gen.skill_files).length > 0) {
            setPackageFiles(gen.skill_files);
            setStage("package");
          } else if (gen.proposal_md) {
            setProposalMd(gen.proposal_md);
            setStage("proposal");
          } else if (gen.skill_md) {
            setProposalMd(gen.skill_md);
            setStage("proposal");
          }

          // Load saved conversation messages
          try {
            const convos = await listConversations(gen.id);
            if (convos.length > 0) {
              const convo = await getConversation(convos[0].id);
              const restored: UIMessage[] = convo.messages.map((m) => ({
                id: uid(),
                role: m.role as UIMessage["role"],
                content: m.content,
              }));
              setMessages(restored);
              // Rebuild chatHistory from user/assistant pairs
              const history: ChatMessage[] = convo.messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
              setChatHistory(history);
            } else {
              // No saved conversation — add welcome messages
              addMessage({
                id: uid(),
                role: "system",
                content: `Loaded: **${gen.demo_name}**`,
              });
              addMessage({
                id: uid(),
                role: "assistant",
                content: gen.stage === "building"
                  ? `Buildout was interrupted (${Object.keys(gen.skill_files || {}).length}/${PACKAGE_FILES.length} files). Click "Resume" to continue.`
                  : gen.skill_files
                    ? "Your demo package is loaded. Review each file using the tabs, or refine any file by chatting here."
                    : 'Your proposal is loaded. Refine it here, or click "Approve & Build" to generate the full package.',
              });
            }
          } catch {
            // Conversation load failed — show welcome messages anyway
            addMessage({
              id: uid(),
              role: "system",
              content: `Loaded: **${gen.demo_name}**`,
            });
          }
        } catch {
          addMessage({
            id: uid(),
            role: "system",
            content: "Failed to load generation. Starting fresh.",
          });
        }
      })();
    } else if (collectionParam) {
      // Collection mode: show detail view, skip proposal
      setStage("collection");
      setCollectionSlug(collectionParam);
      setDemoName(collectionParam.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
      addMessage({
        id: uid(),
        role: "assistant",
        content: `Viewing collection **${collectionParam}**. Review the blocks below, then click **Generate Demo** to build.`,
      });
      // Load the collection's blocks into selectedBlocks
      import("@/lib/custom-api").then(({ getCollection: fetchColl }) => {
        fetchColl(collectionParam).then((coll) => {
          setSelectedBlocks(coll.block_slugs);
        }).catch(() => {});
      });
    } else if (topic) {
      handlePropose(topic);
    }
    // Run once on mount — topic/loadId come from URL search params and don't change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Auto-save conversation to Lakebase (debounced)
  // -----------------------------------------------------------------------

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!generationId || messages.length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      const toSave: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      saveConversation(generationId, toSave).catch(() => {
        // Silent fail — conversation save is best-effort
      });
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [generationId, messages]);

  // -----------------------------------------------------------------------
  // Copy / Download
  // -----------------------------------------------------------------------

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(currentMd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [currentMd]);

  const handleDownload = useCallback(() => {
    if (stage === "proposal") {
      const blob = new Blob([proposalMd], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${demoName || "proposal"}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (generationId) {
      window.open(`/api/workspace/${generationId}/download`, "_blank");
    }
  }, [stage, proposalMd, demoName, generationId]);

  const busy = isGenerating || isRefining;

  // Handle chat from collection view — agent modifies blocks via tool use
  const handleCollectionChat = useCallback(async () => {
    if (!chatInput.trim() || isRefining) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    addMessage({ id: uid(), role: "user", content: userMsg });
    setIsRefining(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      for await (const event of streamModifyBlocks(
        selectedBlocks,
        userMsg,
        chatHistory,
        ctrl.signal,
      )) {
        if (event.type === "agent_thinking") {
          // Show what the agent is doing
          addMessage({
            id: uid(),
            role: "system",
            content: (event as { content: string }).content,
          });
        } else if (event.type === "block_added") {
          const ev = event as { slug: string; name: string; category: string };
          setSelectedBlocks((prev) => prev.includes(ev.slug) ? prev : [...prev, ev.slug]);
          addMessage({
            id: uid(),
            role: "system",
            content: `Added **${ev.name}** (${ev.category})`,
          });
        } else if (event.type === "block_created") {
          const ev = event as { slug: string; name: string; category: string };
          addMessage({
            id: uid(),
            role: "system",
            content: `Created new block: **${ev.name}** (${ev.category})`,
          });
        } else if (event.type === "block_removed") {
          const ev = event as { slug: string };
          setSelectedBlocks((prev) => prev.filter((s) => s !== ev.slug));
          addMessage({
            id: uid(),
            role: "system",
            content: `Removed **${ev.slug}**`,
          });
        } else if (event.type === "blocks_updated") {
          const ev = event as { slugs: string[] };
          setSelectedBlocks(ev.slugs);
        } else if (event.type === "agent_message") {
          addMessage({
            id: uid(),
            role: "assistant",
            content: (event as { content: string }).content,
          });
        } else if (event.type === "error") {
          addMessage({
            id: uid(),
            role: "system",
            content: `Error: ${(event as { content: string }).content}`,
          });
        }
      }

      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: userMsg },
        { role: "assistant", content: "Modified collection blocks." },
      ]);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        addMessage({
          id: uid(),
          role: "system",
          content: `Agent failed: ${err instanceof Error ? err.message : "Unknown"}`,
        });
      }
    } finally {
      setIsRefining(false);
      inputRef.current?.focus();
    }
  }, [chatInput, isRefining, selectedBlocks, chatHistory, addMessage]);

  const handleSubmit = useCallback(() => {
    if (stage === "collection") {
      handleCollectionChat();
    } else if (stage === "proposal") {
      handleRefineProposal();
    } else if (agentMode) {
      handleAgentRefine();
    } else {
      handleRefineFile();
    }
  }, [stage, agentMode, handleCollectionChat, handleRefineProposal, handleAgentRefine, handleRefineFile]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

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
              {/* Stage stepper */}
              <div className="flex items-center gap-1 ml-2">
                {(collectionParam
                  ? [
                      { key: "collection", label: "Collection", icon: Layers },
                      { key: "buildout", label: "Generate", icon: Blocks },
                      { key: "package", label: "Package", icon: PackageCheck },
                    ]
                  : [
                      { key: "proposal", label: "Propose", icon: Sparkles },
                      { key: "buildout", label: "Generate", icon: Blocks },
                      { key: "package", label: "Package", icon: PackageCheck },
                    ]
                ).map((s, i) => {
                  const stageOrder = collectionParam
                    ? ["collection", "buildout", "package"]
                    : ["proposal", "buildout", "package"];
                  const currentIdx = stageOrder.indexOf(stage);
                  const stepIdx = stageOrder.indexOf(s.key);
                  const isActive = stage === s.key;
                  const isPast = stepIdx < currentIdx;
                  const Icon = s.icon;
                  return (
                    <div key={s.key} className="flex items-center">
                      {i > 0 && (
                        <ChevronRight className={`h-3 w-3 mx-0.5 ${isPast || isActive ? "text-primary/60" : "text-muted-foreground/30"}`} />
                      )}
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                        isActive
                          ? "bg-primary/15 text-primary"
                          : isPast
                            ? "text-primary/60"
                            : "text-muted-foreground/40"
                      }`}>
                        {isActive && busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : isPast ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Icon className="h-3 w-3" />
                        )}
                        {s.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        }
      />

      <div className="relative flex flex-1 overflow-hidden">
        {/* ============================================================= */}
        {/* Left Panel */}
        {/* ============================================================= */}
        <div className={`flex flex-col border-r border-border/60 transition-all duration-200 ${chatCollapsed ? "w-full" : "w-[62%]"}`}>
          <div className="flex items-center justify-between border-b px-3 py-1.5 shrink-0">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <div className="flex items-center justify-between">
                {/* Tab bar changes based on stage */}
                <TabsList className="h-8">
                  <TabsTrigger
                    value="preview"
                    className="gap-1.5 text-xs px-2.5 h-6"
                  >
                    <FileText className="h-3 w-3" /> {stage === "proposal" ? "Proposal" : "Preview"}
                  </TabsTrigger>
                  <TabsTrigger
                    value="architecture"
                    className="gap-1.5 text-xs px-2.5 h-6"
                  >
                    <Blocks className="h-3 w-3" /> Architecture
                  </TabsTrigger>
                  <TabsTrigger
                    value="raw"
                    className="gap-1.5 text-xs px-2.5 h-6"
                  >
                    <Code className="h-3 w-3" /> Raw
                  </TabsTrigger>
                </TabsList>

                <div className="flex gap-1">
                  {stage === "proposal" && generationId && !busy && !suggestingCollection && (
                    <Button
                      size="sm"
                      onClick={handleApproveAndBuild}
                      className={`h-7 px-3 text-xs gap-1.5 text-white ${
                        collectionSlug
                          ? "bg-primary hover:bg-primary/90"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      <PackageCheck className="h-3 w-3" />
                      {collectionSlug ? "Approve & Parallel Build" : "Approve & Build"}
                    </Button>
                  )}
                  {stage === "buildout" && buildoutStore.status === "building" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStopBuildout}
                      className="h-7 px-3 text-xs gap-1.5 border-red-500/30 text-red-600 hover:bg-red-50"
                    >
                      Stop
                    </Button>
                  )}
                  {stage === "buildout" && buildoutStore.status === "stopped" && (
                    <Button
                      size="sm"
                      onClick={handleResumeBuildout}
                      className="h-7 px-3 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Resume
                    </Button>
                  )}
                  {stage === "buildout" && !isGenerating && buildoutStore.status !== "building" && buildoutStore.status !== "stopped" && generationId && (
                    <Button
                      size="sm"
                      onClick={handleResumeBuildout}
                      className="h-7 px-3 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Resume Build
                    </Button>
                  )}
                  {stage === "package" && generationId && !busy && (
                    <Link to="/build" search={{ generationId }}>
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <Wrench className="h-3 w-3" />
                        Build Demo
                      </Button>
                    </Link>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    disabled={!currentMd || busy}
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
                    disabled={!currentMd || busy}
                    className="h-7 px-2 text-xs"
                  >
                    {(stage === "buildout" || stage === "package") ? (
                      <>
                        <Archive className="mr-1 h-3 w-3" /> ZIP
                      </>
                    ) : (
                      <>
                        <Download className="mr-1 h-3 w-3" /> Download
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* File tabs for multi-file packages */}
              {(stage === "buildout" || stage === "package") && Object.keys(packageFiles).length > 1 && (
                <div className="flex items-center gap-1.5 mt-2 pb-1 overflow-x-auto scrollbar-none">
                  {Object.keys(packageFiles).sort().map((fname) => {
                    const isActive = activeFile === fname;
                    return (
                      <button
                        key={fname}
                        onClick={() => setActiveFile(fname as PackageFilename)}
                        className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          isActive
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        }`}
                      >
                        {fname}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Section navigation for single-file packages */}
              {(stage === "buildout" || stage === "package") && Object.keys(packageFiles).length <= 1 && currentMd && (
                <div className="flex items-center gap-1.5 mt-2 pb-1 overflow-x-auto scrollbar-none">
                  {currentMd.split('\n')
                    .filter(line => line.startsWith('## '))
                    .map(line => line.replace('## ', ''))
                    .map((section) => (
                      <button
                        key={section}
                        onClick={() => {
                          const el = document.getElementById(`section-${section.toLowerCase().replace(/\s+/g, '-')}`);
                          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      >
                        {section}
                      </button>
                    ))}
                </div>
              )}

              {/* Section outline removed — proposal cards are self-navigating */}

              <TabsContent value="preview" className="mt-0">
                <div ref={previewRef}>
                  <ScrollArea className="h-[calc(100vh-8.5rem)]">
                    <div className="px-5 py-4">
                      {stage === "collection" && collectionSlug ? (
                        <CollectionDetailView
                          slug={collectionSlug}
                          overrideBlockSlugs={selectedBlocks.length > 0 ? selectedBlocks : undefined}
                          onGenerate={async (slug, blockSlugs) => {
                            setCollectionSlug(slug);
                            setSelectedBlocks(blockSlugs);
                            setStage("buildout");
                            setPackageFiles({});
                            setIsGenerating(true);
                            setBuildoutTiers([]);
                            setCurrentBuildoutTier(-1);
                            setCompletedBuildoutFiles(new Set());
                            setActiveBuildoutFiles(new Set());

                            addMessage({
                              id: uid(),
                              role: "system",
                              content: `Generating demo from collection **${slug}**...`,
                            });

                            const ctrl = new AbortController();
                            abortRef.current = ctrl;

                            try {
                              for await (const event of streamParallelBuildout(
                                0, // no generation ID yet — the endpoint handles this
                                slug,
                                ctrl.signal,
                              )) {
                                if (event.type === "tier_start") {
                                  const { tier, files } = event as { type: string; tier: number; files: string[] };
                                  setBuildoutTiers((prev) => [...prev, { tier, files }]);
                                  setCurrentBuildoutTier(tier);
                                  setActiveBuildoutFiles(new Set(files));
                                } else if (event.type === "file_complete") {
                                  const { filename, content } = event as { type: string; filename: string; content: string };
                                  setPackageFiles((prev) => ({ ...prev, [filename]: content }));
                                  setCompletedBuildoutFiles((prev) => new Set([...prev, filename]));
                                  setActiveBuildoutFiles((prev) => { const n = new Set(prev); n.delete(filename); return n; });
                                } else if (event.type === "tier_complete") {
                                  setActiveBuildoutFiles(new Set());
                                } else if (event.type === "all_complete") {
                                  const ev = event as { type: string; files: Record<string, string>; id?: number; demo_name?: string };
                                  setPackageFiles(ev.files);
                                  if (ev.id) setGenerationId(ev.id);
                                  if (ev.demo_name) setDemoName(ev.demo_name);
                                  setStage("package");
                                  addMessage({ id: uid(), role: "assistant", content: `Demo package ready! ${Object.keys(ev.files).length} files generated.` });
                                } else if (event.type === "error") {
                                  addMessage({ id: uid(), role: "system", content: `Error: ${(event as { content: string }).content}` });
                                }
                              }
                            } catch (err) {
                              if (!ctrl.signal.aborted) {
                                addMessage({ id: uid(), role: "system", content: `Generation failed: ${err instanceof Error ? err.message : "Unknown"}` });
                              }
                            } finally {
                              setIsGenerating(false);
                            }
                          }}
                        />
                      ) : currentMd ? (
                        <>
                          {stage === "proposal" ? (
                            <div className="space-y-6">
                              <ProposalCards
                                markdown={stripArchSection(currentMd)}
                                streaming={busy}
                              />
                              {/* Collection suggestion & block picker */}
                              {suggestingCollection && (
                                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-2 text-xs text-primary animate-pulse">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Suggesting a collection of building blocks...
                                </div>
                              )}
                              {collectionSlug && selectedBlocks.length > 0 && !suggestingCollection && (
                                <div className="space-y-3">
                                  <CollectionInfo
                                    collectionSlug={collectionSlug}
                                    blockSlugs={selectedBlocks}
                                    outputFileCount={collectionOutputFiles.length || undefined}
                                  />
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => setShowBlockPicker(!showBlockPicker)}
                                      className="text-xs text-primary hover:underline flex items-center gap-1"
                                    >
                                      <Blocks className="h-3 w-3" />
                                      {showBlockPicker ? "Hide" : "Edit"} blocks
                                    </button>
                                    {collectionOutputFiles.length > 0 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        {collectionOutputFiles.length} files will generate in parallel tiers
                                      </span>
                                    )}
                                  </div>
                                  {showBlockPicker && (
                                    <div className="rounded-lg border p-3 bg-background">
                                      <BlockPicker
                                        selectedSlugs={selectedBlocks}
                                        onToggle={(slug) => {
                                          setSelectedBlocks((prev) =>
                                            prev.includes(slug)
                                              ? prev.filter((s) => s !== slug)
                                              : [...prev, slug],
                                          );
                                        }}
                                        compact
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                              {!busy && currentMd && (
                                <div className="rounded-xl border border-border/50 p-5 bg-muted/[0.02]">
                                  <ArchitectureGraph markdown={stripArchSection(currentMd)} />
                                </div>
                              )}
                            </div>
                          ) : (stage === "buildout" && buildoutTiers.length > 0) ? (
                            <div className="space-y-4">
                              <ParallelBuildoutProgress
                                tiers={buildoutTiers}
                                currentTier={currentBuildoutTier}
                                completedFiles={completedBuildoutFiles}
                                activeFiles={activeBuildoutFiles}
                              />
                              {/* Show completed files as expandable sections */}
                              {Object.entries(packageFiles).sort().map(([fname, content]) => (
                                <details key={fname} className="rounded-lg border border-border/50 overflow-hidden">
                                  <summary className="flex items-center gap-2 px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted/30 transition-colors">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                    <span className="text-foreground">{fname}</span>
                                    <span className="text-muted-foreground ml-auto">{content.split("\n").length} lines</span>
                                  </summary>
                                  <div className="border-t px-3 py-2 max-h-64 overflow-y-auto">
                                    <FileRendererWithFallback filename={fname} markdown={content} />
                                  </div>
                                </details>
                              ))}
                              {isGenerating && (
                                <div className="text-center text-xs text-muted-foreground py-4">
                                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                                  Generating files... {completedBuildoutFiles.size} of {buildoutTiers.reduce((n, t) => n + t.files.length, 0)} complete
                                </div>
                              )}
                            </div>
                          ) : (stage === "buildout" || stage === "package") ? (
                            <FileRendererWithFallback
                              filename={activeFile}
                              markdown={currentMd}
                            />
                          ) : (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <SkillPreview
                                markdown={currentMd}
                                collapsedSections={collapsedSections}
                                onToggleSection={toggleSection}
                              />
                            </div>
                          )}
                          {busy && stage !== "proposal" && (
                            <span className="inline-block h-4 w-1 animate-pulse bg-primary rounded-full" />
                          )}
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                          {busy ? (
                            <>
                              <div className="relative mb-4">
                                <Sparkles className="h-10 w-10 opacity-30 animate-pulse" />
                                <div className="absolute inset-0 h-10 w-10 rounded-full bg-primary/10 animate-ping" />
                              </div>
                              <p className="text-sm font-medium">
                                {stage === "proposal"
                                  ? "Crafting your proposal..."
                                  : `Building ${buildingFile || "package files"}...`}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground/60">
                                This usually takes 15–30 seconds
                              </p>
                            </>
                          ) : (
                            <>
                              <Sparkles className="mb-3 h-10 w-10 opacity-20" />
                              <p className="text-sm">Enter a topic to get started</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="architecture" className="mt-0" forceMount style={{ display: activeTab === "architecture" ? undefined : "none" }}>
                <div className="h-[calc(100vh-8.5rem)]">
                  <ErrorBoundary
                    fallback={
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Failed to load architecture builder.
                      </div>
                    }
                  >
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    }
                  >
                    <ArchitectureBuilder
                      ref={architectureBuilderRef}
                      onApplyArchitecture={generationId ? handleApplyArchitecture : undefined}
                      onArchitectureChange={stage === "proposal" ? (mermaid: string) => {
                        setProposalArchMermaid(mermaid);
                        // Sync architecture into proposalMd so the refine endpoint sees it
                        archSyncRef.current = true;
                        setProposalMd((prev) => stripArchSection(prev) + ARCH_SECTION_MARKER + mermaid);
                      } : undefined}
                      busy={busy}
                      architectureMd={(stage === "buildout" || stage === "package") ? packageFiles["reference.md"] : undefined}
                      proposalBuildSteps={stage === "proposal" ? proposalMd : undefined}
                      isVisible={activeTab === "architecture"}
                      stage={stage}
                    />
                  </Suspense>
                  </ErrorBoundary>
                </div>
              </TabsContent>

              <TabsContent value="raw" className="mt-0">
                <ScrollArea className="h-[calc(100vh-8.5rem)]">
                  <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-relaxed text-foreground/80">
                    {currentMd || "No content yet."}
                    {busy && (
                      <span className="inline-block h-3 w-0.5 animate-pulse bg-primary rounded-full" />
                    )}
                  </pre>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* ============================================================= */}
        {/* Collapse/Expand divider button */}
        {/* ============================================================= */}
        <button
          onClick={() => setChatCollapsed((c) => !c)}
          className={`absolute z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background shadow-md hover:bg-muted transition-all duration-200 top-1/2 -translate-y-1/2 ${
            chatCollapsed ? "right-3" : "right-[37%]"
          }`}
          style={chatCollapsed ? undefined : { transform: "translateY(-50%) translateX(50%)" }}
          title={chatCollapsed ? "Show chat panel" : "Hide chat panel"}
        >
          {chatCollapsed ? (
            <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
          ) : (
            <PanelRightClose className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {/* ============================================================= */}
        {/* Right Panel: Chat */}
        {/* ============================================================= */}
        <div className={`flex flex-col transition-all duration-200 ${chatCollapsed ? "w-0 overflow-hidden" : "w-[38%]"}`}>
          <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Use-Case Architect</span>
            {(stage === "buildout" || stage === "package") && (
              <Badge className="text-[10px] ml-auto bg-violet-500/15 text-violet-600 border-violet-500/30">
                Agent Mode
              </Badge>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-3 p-4">
              {messages.length === 0 && !busy && (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <Bot className="mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm font-medium">Use-Case Architect</p>
                  <p className="mt-1 text-xs max-w-xs">
                    Describe a use-case and I'll build a complete demo package
                    with storyline, data schemas, and build steps.
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
            {!topic && !generationId && !collectionParam ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chatInput.trim()) {
                    navigate({
                      to: "/workspace",
                      search: { topic: chatInput.trim(), generationId: undefined, collection: "" },
                    });
                    setChatInput("");
                  }
                }}
                className="flex gap-2"
              >
                <Input
                  ref={inputRef}
                  placeholder="Describe a use-case to generate a demo proposal..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={busy}
                  className="bg-muted/40"
                />
                <Button
                  type="submit"
                  disabled={busy || !chatInput.trim()}
                  size="icon"
                  className="shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit();
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
                      : stage === "collection"
                        ? "Customize this collection... e.g. \"tailor for Acme Corp\" or \"add lakebase\""
                        : stage === "proposal"
                          ? "Refine the proposal... Type @ to focus on a section"
                          : "Ask the agent to edit any files..."
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
                  disabled={busy || (!generationId && stage !== "collection")}
                  className="bg-muted/40"
                />
                <Button
                  type="submit"
                  disabled={busy || !chatInput.trim() || (!generationId && stage !== "collection")}
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

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

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
    <div
      className={`flex gap-2.5 items-start ${isUser ? "flex-row-reverse" : ""}`}
    >
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
          ? message.content
              .split(/(@\S+(?:\s\S+)*?)(?=\s+[^@]|$)/g)
              .map((part, i) =>
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
          : message.content
              .split(/\*\*(.+?)\*\*/g)
              .map((part, i) =>
                i % 2 === 1 ? (
                  <strong key={i}>{part}</strong>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
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
  const rendered = useMemo(() => renderToSections(markdown), [markdown]);

  return (
    <div>
      {rendered.preamble && (
        <div dangerouslySetInnerHTML={{ __html: rendered.preamble }} />
      )}
      {rendered.sections.map((section) => {
        const isCollapsed = collapsedSections.has(section.id);
        return (
          <div
            key={section.id}
            className="group"
            data-section-id={section.id}
          >
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

  const parts = text.split(/^(?=## )/gm);
  const sections: RenderedSection[] = [];
  let preParts = "";

  for (const part of parts) {
    const headerMatch = part.match(/^## (.+)\n/);
    if (headerMatch) {
      const title = headerMatch[1].trim();
      const id = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const body = part.slice(headerMatch[0].length);
      sections.push({ id, title, html: renderInlineMarkdown(body) });
    } else {
      preParts += part;
    }
  }

  if (preParts.trim()) preamble += renderInlineMarkdown(preParts);

  return { preamble, sections };
}

function renderInlineMarkdown(text: string): string {
  let result = text;

  result = result.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_, _lang, code) =>
      `<pre class="bg-muted rounded-lg p-3 overflow-x-auto my-2"><code class="text-xs">${esc(code.trim())}</code></pre>`,
  );

  result = result.replace(
    /^#### (.+)$/gm,
    '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>',
  );
  result = result.replace(
    /^### (.+)$/gm,
    '<h3 class="text-base font-semibold mt-4 mb-1.5">$1</h3>',
  );
  result = result.replace(
    /^# (.+)$/gm,
    '<h1 class="text-xl font-bold mb-2">$1</h1>',
  );

  result = result.replace(
    /^- \[ \] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-1 my-0.5"><input type="checkbox" disabled class="mt-1 accent-primary" /><span class="text-sm">$1</span></div>',
  );
  result = result.replace(
    /^- \[x\] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-1 my-0.5"><input type="checkbox" checked disabled class="mt-1 accent-primary" /><span class="text-sm">$1</span></div>',
  );

  result = result.replace(
    /^(\d+)\.\s+(.+)$/gm,
    '<div class="flex gap-2 ml-1 my-0.5"><span class="text-xs font-semibold text-primary/60 mt-0.5 shrink-0 w-4 text-right">$1.</span><span class="text-sm">$2</span></div>',
  );

  result = result.replace(
    /^- (.+)$/gm,
    '<div class="flex gap-2 ml-1 my-0.5"><span class="text-primary/40 mt-1 shrink-0">&#8226;</span><span class="text-sm">$1</span></div>',
  );

  result = result.replace(/^\|(.+)\|$/gm, (match) => {
    if (match.match(/^\|\s*[-:]+/)) return "";
    const cells = match
      .split("|")
      .filter(Boolean)
      .map((c) => c.trim());
    return `<tr>${cells.map((c) => `<td class="border border-border/50 px-2 py-1 text-xs">${c}</td>`).join("")}</tr>`;
  });
  result = result.replace(
    /(<tr>[\s\S]*?<\/tr>(\s*<tr>[\s\S]*?<\/tr>)*)/g,
    '<table class="w-full border-collapse my-2">$1</table>',
  );

  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(
    /`([^`]+)`/g,
    '<code class="bg-muted px-1 py-0.5 rounded text-xs text-primary/80">$1</code>',
  );

  result = result.replace(
    /\n{2,}/g,
    '</p><p class="text-sm leading-relaxed my-1.5">',
  );
  result = `<p class="text-sm leading-relaxed my-1.5">${result}</p>`;
  result = result.replace(
    /<p class="text-sm leading-relaxed my-1.5">\s*<\/p>/g,
    "",
  );

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
// Architecture graph
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

    if (title.includes("dataset") || title.includes("data source") || (title.includes("data") && !title.includes("available"))) {
      // Try subsection headers first
      const subHeaders = [...body.matchAll(/^### (.+)$/gm)];
      if (subHeaders.length > 0) {
        for (const m of subHeaders) {
          const label = m[1].trim();
          const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const blockEnd = body.indexOf("###", body.indexOf(m[0]) + m[0].length);
          const block = body.slice(body.indexOf(m[0]) + m[0].length, blockEnd > -1 ? blockEnd : undefined);
          const rowMatch = block.match(/(?:~?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:K|M|B)?\s*rows?/i);
          sources.push({ id, label, detail: rowMatch ? `~${rowMatch[0].trim()}` : undefined });
        }
      }
      // Also try markdown table rows
      for (const m of body.matchAll(/^\|\s*`?([^|`]+?)`?\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/gm)) {
        const name = m[1].trim();
        if (name.match(/^[-:]+$/) || name.toLowerCase() === "table" || name.toLowerCase() === "name") continue;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (!sources.find((s) => s.id === id)) {
          sources.push({ id, label: name, detail: m[3]?.trim() || undefined });
        }
      }
      // Fallback: try bullet list items for datasets
      if (sources.length === 0) {
        for (const m of body.matchAll(/^[-*]\s+\*\*(.+?)\*\*/gm)) {
          const label = m[1].trim();
          const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          sources.push({ id, label });
        }
      }
    } else if (title.includes("transform") || title.includes("pipeline")) {
      const subHeaders = [...body.matchAll(/^### (.+)$/gm)];
      if (subHeaders.length > 0) {
        for (const m of subHeaders) {
          transforms.push({ id: m[1].toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: m[1].trim() });
        }
      }
      // Try bold bullet lists: - **Name** — description
      for (const m of body.matchAll(/^[-*]\s+\*\*(.+?)\*\*/gm)) {
        const label = m[1].trim();
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (!transforms.find((t) => t.id === id)) transforms.push({ id, label });
      }
      // Try plain bullet lists: - Name — description
      if (transforms.length === 0) {
        for (const m of body.matchAll(/^[-*]\s+(.+?)(?:\s*[—\-–:]\s|$)/gm)) {
          const label = m[1].trim().replace(/\*\*/g, "");
          if (label.length > 2 && label.length < 60) {
            const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            transforms.push({ id, label });
          }
        }
      }
      if (transforms.length === 0) {
        transforms.push({ id: "transformations", label: "Data Pipeline" });
      }
    } else if (title.includes("output") || title.includes("deliverable")) {
      for (const m of body.matchAll(/^### (.+)$/gm)) {
        outputs.push({ id: m[1].toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: m[1].trim() });
      }
      // Also try bullet lists
      for (const m of body.matchAll(/^[-*]\s+\*\*(.+?)\*\*/gm)) {
        const label = m[1].trim();
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (!outputs.find((o) => o.id === id)) outputs.push({ id, label });
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
  if (
    l.includes("dashboard") ||
    l.includes("chart") ||
    l.includes("analytics")
  )
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
          Could not extract architecture from this content
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
