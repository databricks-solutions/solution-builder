import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, useState, useCallback } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  Copy,
  Check,
  Download,
  FileText,
  Code,
  Archive,
  PackageCheck,
  BookOpen,
  Table2,
  FolderTree,
  FileEdit,
  ExternalLink,
} from "lucide-react";
import { useGetGenerationSuspense } from "@/lib/api";
import { selector } from "@/lib/selector";
import { FileRendererWithFallback } from "@/components/file-renderers";

export const Route = createFileRoute("/_sidebar/generations/$id")({
  component: () => (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/generations">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to Generations
        </Link>
      </Button>
      <ErrorBoundary
        fallbackRender={({ error }) => (
          <p className="text-destructive">Error: {error.message}</p>
        )}
      >
        <Suspense fallback={<LoadingSkeleton />}>
          <GenerationDetail />
        </Suspense>
      </ErrorBoundary>
    </div>
  ),
});

const FILE_ICONS: Record<string, typeof FileText> = {
  "SKILL.md": PackageCheck,
  "storyline.md": BookOpen,
  "data-schema.md": Table2,
  "project-structure.md": FolderTree,
};

const STAGE_LABELS: Record<string, { label: string; className: string }> = {
  proposal: {
    label: "Proposal",
    className: "border-amber-500/30 text-amber-600",
  },
  approved: {
    label: "Approved",
    className: "border-blue-500/30 text-blue-600",
  },
  package: {
    label: "Package",
    className: "border-emerald-500/30 text-emerald-600",
  },
};

function GenerationDetail() {
  const { id } = Route.useParams();
  const { data: gen } = useGetGenerationSuspense({
    params: { generation_id: Number(id) },
    query: selector<import("@/lib/api").GenerationOut>().query,
  });

  const hasPackageFiles =
    gen.skill_files && Object.keys(gen.skill_files).length > 0;
  const isProposal = gen.stage === "proposal" || gen.stage === "approved";
  const displayContent = isProposal
    ? gen.proposal_md || gen.skill_md
    : gen.skill_md;

  const [activeFile, setActiveFile] = useState<string>("SKILL.md");
  const [copied, setCopied] = useState(false);

  const currentFileContent = hasPackageFiles
    ? gen.skill_files![activeFile] || ""
    : displayContent;

  const handleCopy = useCallback(async () => {
    const text = hasPackageFiles ? currentFileContent : displayContent;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [currentFileContent, displayContent, hasPackageFiles]);

  const handleDownload = useCallback(() => {
    if (hasPackageFiles) {
      window.open(`/api/workspace/${gen.id}/download`, "_blank");
    } else {
      const blob = new Blob([displayContent], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${gen.demo_name}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [gen.id, gen.demo_name, displayContent, hasPackageFiles]);

  const stageInfo = STAGE_LABELS[gen.stage] || STAGE_LABELS.package;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold">{gen.demo_name}</h1>
            <Badge
              variant="outline"
              className={`text-xs ${stageInfo.className}`}
            >
              {stageInfo.label}
            </Badge>
          </div>
          <div className="mt-1.5 flex items-center gap-2.5 text-xs text-muted-foreground">
            <span>{gen.owner_name}</span>
            <Badge variant="secondary" className="text-[10px]">
              {gen.industry}
            </Badge>
            <span>{new Date(gen.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="default" size="sm" asChild>
            <Link
              to="/workspace"
              search={{ generationId: gen.id, topic: "" }}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in
              Workspace
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            {hasPackageFiles ? (
              <>
                <Archive className="mr-1.5 h-3.5 w-3.5" /> ZIP
              </>
            ) : (
              <>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download
              </>
            )}
          </Button>
        </div>
      </div>

      {/* File tabs for multi-file packages */}
      {hasPackageFiles && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {Object.keys(gen.skill_files!).map((fn) => {
            const Icon = FILE_ICONS[fn] || FileText;
            const isActive = activeFile === fn;
            return (
              <button
                key={fn}
                onClick={() => setActiveFile(fn)}
                className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {fn}
              </button>
            );
          })}
        </div>
      )}

      <Tabs defaultValue="preview">
        <TabsList>
          <TabsTrigger value="preview" className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Preview
          </TabsTrigger>
          <TabsTrigger value="raw" className="flex items-center gap-1.5">
            <Code className="h-3.5 w-3.5" /> Raw Markdown
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preview">
          <Card>
            <CardContent className="py-6">
              {isProposal && !hasPackageFiles ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <FileEdit className="h-4 w-4" />
                    <span className="font-medium">
                      This is a proposal — open in workspace to approve and
                      build
                    </span>
                  </div>
                  <SkillPreview markdown={displayContent} />
                </div>
              ) : hasPackageFiles ? (
                <FileRendererWithFallback
                  filename={activeFile}
                  markdown={currentFileContent}
                />
              ) : (
                <SkillPreview markdown={currentFileContent} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                {hasPackageFiles ? activeFile : `${gen.demo_name}.md`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[70vh]">
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed">
                  {currentFileContent || "No content."}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SkillPreview({ markdown }: { markdown: string }) {
  const html = renderMarkdown(markdown);
  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderMarkdown(md: string): string {
  let text = md;

  if (text.startsWith("---")) {
    const end = text.indexOf("---", 3);
    if (end !== -1) {
      const fm = text.slice(3, end).trim();
      text = text.slice(end + 3);
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
      let header = "";
      if (nameMatch)
        header += `<div class="mb-1"><span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Skill</span> <code class="text-sm">${esc(nameMatch[1])}</code></div>`;
      if (descMatch)
        header += `<p class="text-sm text-muted-foreground italic mb-4">${esc(descMatch[1])}</p>`;
      text = header + text;
    }
  }

  text = text.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_, _lang, code) =>
      `<pre class="bg-muted rounded-lg p-3 overflow-x-auto"><code class="text-sm">${esc(code.trim())}</code></pre>`,
  );

  text = text.replace(
    /^#### (.+)$/gm,
    '<h4 class="text-base font-semibold mt-4 mb-1">$1</h4>',
  );
  text = text.replace(
    /^### (.+)$/gm,
    '<h3 class="text-lg font-semibold mt-5 mb-2">$1</h3>',
  );
  text = text.replace(
    /^## (.+)$/gm,
    '<h2 class="text-xl font-bold mt-6 mb-2 border-b pb-1">$1</h2>',
  );
  text = text.replace(
    /^# (.+)$/gm,
    '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>',
  );

  text = text.replace(
    /^- \[ \] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-2 my-0.5"><input type="checkbox" disabled class="mt-1" /><span>$1</span></div>',
  );
  text = text.replace(
    /^- \[x\] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-2 my-0.5"><input type="checkbox" checked disabled class="mt-1" /><span>$1</span></div>',
  );

  text = text.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>');

  text = text.replace(/^\|(.+)\|$/gm, (match) => {
    if (match.match(/^\|\s*[-:]+/)) return "";
    const cells = match
      .split("|")
      .filter(Boolean)
      .map((c) => c.trim());
    return `<tr>${cells.map((c) => `<td class="border px-2 py-1 text-sm">${c}</td>`).join("")}</tr>`;
  });
  text = text.replace(
    /(<tr>[\s\S]*?<\/tr>(\s*<tr>[\s\S]*?<\/tr>)*)/g,
    '<table class="w-full border-collapse my-3">$1</table>',
  );

  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(
    /`([^`]+)`/g,
    '<code class="bg-muted px-1 py-0.5 rounded text-sm">$1</code>',
  );

  text = text.replace(/\n{2,}/g, "</p><p>");
  text = `<p>${text}</p>`;
  text = text.replace(/<p>\s*<\/p>/g, "");

  return text;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-[400px] w-full rounded-lg" />
    </div>
  );
}
