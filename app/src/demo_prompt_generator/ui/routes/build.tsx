import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import Navbar from "@/components/apx/navbar";
import {
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  FileCode,
  FolderPlus,
  Play,
  Square,
  Wrench,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { streamWorkspaceBuild } from "@/lib/custom-api";

export const Route = createFileRoute("/build")({
  validateSearch: (search: Record<string, unknown>) => ({
    generationId: search.generationId ? Number(search.generationId) : undefined,
  }),
  component: BuildPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BuildStatus = "idle" | "executing" | "complete" | "error";

interface BuildLogEntry {
  id: string;
  type: string;
  timestamp: number;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  content?: string;
  projectDir?: string;
  filesCreated?: string[];
  collapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function BuildPage() {
  const { generationId } = Route.useSearch();
  const [status, setStatus] = useState<BuildStatus>("idle");
  const [logs, setLogs] = useState<BuildLogEntry[]>([]);
  const [projectDir, setProjectDir] = useState<string>("");
  const [filesCreated, setFilesCreated] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = useCallback((entry: Omit<BuildLogEntry, "id" | "timestamp">) => {
    idCounter.current += 1;
    setLogs((prev) => [
      ...prev,
      { ...entry, id: String(idCounter.current), timestamp: Date.now() },
    ]);
  }, []);

  const handleStartBuild = useCallback(async () => {
    if (!generationId) return;
    setStatus("executing");
    setLogs([]);
    setFilesCreated([]);
    setProjectDir("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of streamWorkspaceBuild(generationId, controller.signal)) {
        switch (event.type) {
          case "build_start":
            if ("project_dir" in event) {
              setProjectDir(event.project_dir);
              addLog({ type: "start", content: `Build started in ${event.project_dir}` });
            }
            break;
          case "build_init":
            if ("session_id" in event) {
              addLog({ type: "thinking", content: `Agent session: ${event.session_id}` });
            }
            break;
          case "build_tool_call":
            if ("tool" in event && "args" in event) {
              addLog({ type: "tool_call", tool: event.tool, args: event.args, collapsed: true });
            }
            break;
          case "build_tool_result":
            if ("tool" in event && "result" in event) {
              addLog({ type: "tool_result", tool: event.tool, result: event.result, collapsed: true });
            }
            break;
          case "build_message":
            if ("content" in event) {
              addLog({ type: "message", content: event.content });
            }
            break;
          case "build_complete":
            if ("project_dir" in event && "files_created" in event) {
              setFilesCreated(event.files_created);
              setProjectDir(event.project_dir);
              addLog({
                type: "complete",
                content: `Build complete! ${event.files_created.length} files created.`,
                filesCreated: event.files_created,
                projectDir: event.project_dir,
              });
              setStatus("complete");
            }
            break;
          case "build_error":
            if ("content" in event) {
              addLog({ type: "error", content: event.content });
              setStatus("error");
            }
            break;
        }
      }
      // If we haven't set complete/error from events, mark complete
      setStatus((prev) => (prev === "executing" ? "complete" : prev));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        addLog({ type: "error", content: String(err) });
        setStatus("error");
      }
    } finally {
      abortRef.current = null;
    }
  }, [generationId, addLog]);

  const handleStopBuild = useCallback(() => {
    abortRef.current?.abort();
    setStatus("error");
    addLog({ type: "error", content: "Build cancelled by user." });
  }, [addLog]);

  const toggleCollapse = useCallback((id: string) => {
    setLogs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, collapsed: !l.collapsed } : l)),
    );
  }, []);

  if (!generationId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">No generation ID provided.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <Navbar />
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Link to="/workspace" search={{ topic: "", generationId }}>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            <ChevronLeft className="h-3 w-3" />
            Back to Workspace
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-purple-500" />
          <h1 className="text-sm font-semibold">Build Demo</h1>
          <StatusBadge status={status} />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {status === "idle" && (
            <Button
              size="sm"
              onClick={handleStartBuild}
              className="h-7 px-3 text-xs gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Play className="h-3 w-3" />
              Start Build
            </Button>
          )}
          {status === "executing" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStopBuild}
              className="h-7 px-3 text-xs gap-1.5 border-red-500/30 text-red-600 hover:bg-red-50"
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          {(status === "complete" || status === "error") && (
            <Button
              size="sm"
              onClick={handleStartBuild}
              className="h-7 px-3 text-xs gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Play className="h-3 w-3" />
              Rebuild
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Build log */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Build Log</span>
            {projectDir && (
              <span className="text-xs text-muted-foreground/60 font-mono truncate">
                {projectDir}
              </span>
            )}
          </div>
          <ScrollArea className="flex-1" ref={scrollRef}>
            <div className="p-4 space-y-1 font-mono text-xs">
              {logs.length === 0 && status === "idle" && (
                <p className="text-muted-foreground py-8 text-center text-sm font-sans">
                  Click <strong>Start Build</strong> to execute the demo package.
                </p>
              )}
              {logs.map((entry) => (
                <LogEntry
                  key={entry.id}
                  entry={entry}
                  onToggle={toggleCollapse}
                />
              ))}
              {status === "executing" && (
                <div className="flex items-center gap-2 text-muted-foreground py-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Working...</span>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Files sidebar */}
        {filesCreated.length > 0 && (
          <div className="w-64 border-l flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
              <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Files Created ({filesCreated.length})
              </span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {filesCreated.map((f) => (
                  <div
                    key={f}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-muted/50 font-mono truncate"
                    title={f}
                  >
                    <FileCode className="h-3 w-3 shrink-0 text-green-500" />
                    {f}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: BuildStatus }) {
  switch (status) {
    case "idle":
      return (
        <Badge variant="outline" className="text-xs gap-1">
          Ready
        </Badge>
      );
    case "executing":
      return (
        <Badge variant="outline" className="text-xs gap-1 border-purple-500/30 text-purple-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Building
        </Badge>
      );
    case "complete":
      return (
        <Badge variant="outline" className="text-xs gap-1 border-green-500/30 text-green-600">
          <CheckCircle2 className="h-3 w-3" />
          Complete
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="text-xs gap-1 border-red-500/30 text-red-600">
          <XCircle className="h-3 w-3" />
          Error
        </Badge>
      );
  }
}

function LogEntry({
  entry,
  onToggle,
}: {
  entry: BuildLogEntry;
  onToggle: (id: string) => void;
}) {
  const time = new Date(entry.timestamp).toLocaleTimeString();

  switch (entry.type) {
    case "start":
      return (
        <div className="flex items-start gap-2 text-purple-400 py-0.5">
          <span className="text-muted-foreground/50 shrink-0">{time}</span>
          <Play className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{entry.content}</span>
        </div>
      );

    case "thinking":
      return (
        <div className="flex items-start gap-2 text-muted-foreground py-0.5">
          <span className="text-muted-foreground/50 shrink-0">{time}</span>
          <Eye className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{entry.content}</span>
        </div>
      );

    case "tool_call":
      return (
        <div className="py-0.5">
          <button
            onClick={() => onToggle(entry.id)}
            className="flex items-start gap-2 text-blue-400 hover:text-blue-300 w-full text-left"
          >
            <span className="text-muted-foreground/50 shrink-0">{time}</span>
            {entry.collapsed ? (
              <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
            ) : (
              <ChevronDown className="h-3 w-3 mt-0.5 shrink-0" />
            )}
            <ToolIcon tool={entry.tool || ""} />
            <span>
              {entry.tool}
              {entry.args?.path ? ` → ${entry.args.path}` : ""}
              {entry.args?.command ? ` → ${String(entry.args.command).slice(0, 60)}` : ""}
            </span>
          </button>
          {!entry.collapsed && entry.args && (
            <pre className="ml-[4.5rem] mt-1 p-2 rounded bg-muted/50 text-muted-foreground overflow-x-auto max-h-40">
              {JSON.stringify(entry.args, null, 2)}
            </pre>
          )}
        </div>
      );

    case "tool_result":
      return (
        <div className="py-0.5">
          <button
            onClick={() => onToggle(entry.id)}
            className="flex items-start gap-2 text-emerald-400 hover:text-emerald-300 w-full text-left"
          >
            <span className="text-muted-foreground/50 shrink-0">{time}</span>
            {entry.collapsed ? (
              <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
            ) : (
              <ChevronDown className="h-3 w-3 mt-0.5 shrink-0" />
            )}
            <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="truncate">
              {entry.tool}: {entry.result?.split("\n")[0]?.slice(0, 80)}
            </span>
          </button>
          {!entry.collapsed && entry.result && (
            <pre className="ml-[4.5rem] mt-1 p-2 rounded bg-muted/50 text-muted-foreground overflow-x-auto max-h-40 whitespace-pre-wrap">
              {entry.result}
            </pre>
          )}
        </div>
      );

    case "message":
      return (
        <div className="flex items-start gap-2 text-foreground py-0.5">
          <span className="text-muted-foreground/50 shrink-0">{time}</span>
          <Terminal className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{entry.content}</span>
        </div>
      );

    case "complete":
      return (
        <div className="flex items-start gap-2 text-green-400 py-1 mt-2 border-t border-green-500/20 pt-2">
          <span className="text-muted-foreground/50 shrink-0">{time}</span>
          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{entry.content}</span>
        </div>
      );

    case "error":
      return (
        <div className="flex items-start gap-2 text-red-400 py-0.5">
          <span className="text-muted-foreground/50 shrink-0">{time}</span>
          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{entry.content}</span>
        </div>
      );

    default:
      return null;
  }
}

function ToolIcon({ tool }: { tool: string }) {
  switch (tool) {
    case "create_file":
      return <FileCode className="h-3 w-3 mt-0.5 shrink-0" />;
    case "create_directory":
      return <FolderPlus className="h-3 w-3 mt-0.5 shrink-0" />;
    case "run_command":
      return <Terminal className="h-3 w-3 mt-0.5 shrink-0" />;
    default:
      return <Wrench className="h-3 w-3 mt-0.5 shrink-0" />;
  }
}
