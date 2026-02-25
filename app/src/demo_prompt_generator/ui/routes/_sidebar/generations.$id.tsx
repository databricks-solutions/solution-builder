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
} from "lucide-react";
import { useGetGenerationSuspense } from "@/lib/api";
import { selector } from "@/lib/selector";

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

function GenerationDetail() {
  const { id } = Route.useParams();
  const { data: gen } = useGetGenerationSuspense({
    params: { generation_id: Number(id) },
    query: selector<import("@/lib/api").GenerationOut>().query,
  });
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(gen.skill_md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [gen.skill_md]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([gen.skill_md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gen.demo_name}-SKILL.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [gen.skill_md, gen.demo_name]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{gen.demo_name}</h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            <span>{gen.owner_name}</span>
            <Badge variant="secondary">{gen.industry}</Badge>
            <span>{new Date(gen.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <Check className="mr-1.5 h-4 w-4 text-green-500" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" />
            )}
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-1.5 h-4 w-4" /> Download
          </Button>
        </div>
      </div>

      {/* Tabs: Preview / Raw */}
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
              <SkillPreview markdown={gen.skill_md} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                {gen.demo_name}-SKILL.md
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[70vh]">
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-sm leading-relaxed">
                  {gen.skill_md}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Simple markdown-to-HTML renderer for skill preview.
 * Handles frontmatter, headers, lists, code blocks, bold, and backticks.
 */
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

  // Strip YAML frontmatter
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

  // Code blocks
  text = text.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_, lang, code) =>
      `<pre class="bg-muted rounded-lg p-3 overflow-x-auto"><code class="text-sm">${esc(code.trim())}</code></pre>`,
  );

  // Headers
  text = text.replace(/^#### (.+)$/gm, '<h4 class="text-base font-semibold mt-4 mb-1">$1</h4>');
  text = text.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-5 mb-2">$1</h3>');
  text = text.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-6 mb-2 border-b pb-1">$1</h2>');
  text = text.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>');

  // Checkbox lists
  text = text.replace(
    /^- \[ \] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-2 my-0.5"><input type="checkbox" disabled class="mt-1" /><span>$1</span></div>',
  );
  text = text.replace(
    /^- \[x\] (.+)$/gm,
    '<div class="flex items-start gap-2 ml-2 my-0.5"><input type="checkbox" checked disabled class="mt-1" /><span>$1</span></div>',
  );

  // Bullet lists
  text = text.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>');

  // Tables (simple)
  text = text.replace(
    /^\|(.+)\|$/gm,
    (match) => {
      if (match.match(/^\|\s*[-:]+/)) return "";
      const cells = match
        .split("|")
        .filter(Boolean)
        .map((c) => c.trim());
      return `<tr>${cells.map((c) => `<td class="border px-2 py-1 text-sm">${c}</td>`).join("")}</tr>`;
    },
  );
  text = text.replace(
    /(<tr>[\s\S]*?<\/tr>(\s*<tr>[\s\S]*?<\/tr>)*)/g,
    '<table class="w-full border-collapse my-3">$1</table>',
  );

  // Inline formatting
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm">$1</code>');

  // Paragraphs
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
