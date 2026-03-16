import { useMemo, useState } from "react";
import {
  Database,
  ArrowRight,
  FolderOpen,
  File,
  CheckCircle2,
  Circle,
  BookOpen,
  Building2,
  AlertTriangle,
  Sparkles,
  Quote,
  ChevronRight,
  ChevronDown,
  Presentation,
  Navigation,
  Eye,
  Clock,
  Users,
  Briefcase,
  Cpu,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Routes to the correct visual renderer based on filename.
 * Returns null for unrecognized files.
 */
export function FileRenderer({
  filename,
  markdown,
}: {
  filename: string;
  markdown: string;
}) {
  switch (filename) {
    case "data-schema.md":
      return <DataSchemaRenderer markdown={markdown} />;
    case "project-structure.md":
      return <ProjectStructureRenderer markdown={markdown} />;
    case "SKILL.md":
      return <SkillRenderer markdown={markdown} />;
    case "storyline.md":
      return <StorylineRenderer markdown={markdown} />;
    case "walkthrough.md":
      return <WalkthroughRenderer markdown={markdown} />;
    default:
      return null;
  }
}

/**
 * Renders the visual view for known file types, or falls back to a raw
 * markdown SkillPreview for unknown types / when the visual renderer
 * returns nothing useful. Used in the workspace preview panel.
 */
export function FileRendererWithFallback({
  filename,
  markdown,
}: {
  filename: string;
  markdown: string;
  collapsedSections?: Set<string>;
  onToggleSection?: (id: string) => void;
}) {
  const visual = FileRenderer({ filename, markdown });
  if (visual) return visual;
  // lazy-import avoided: caller must provide SkillPreview as children or we inline raw md
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <FallbackMarkdown markdown={markdown} />
    </div>
  );
}

function FallbackMarkdown({ markdown }: { markdown: string }) {
  // Minimal markdown → HTML for unknown file types
  const html = markdown
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-6 mb-2">$1</h1>')
    .replace(/`([^`]+)`/g, '<code class="text-xs bg-muted px-1 py-0.5 rounded">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
  return <div dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}

// ---------------------------------------------------------------------------
// data-schema.md — Interactive schema tables + relationships
// ---------------------------------------------------------------------------

interface SchemaColumn {
  name: string;
  type: string;
  description: string;
}

interface TableSchema {
  name: string;
  columns: SchemaColumn[];
  rowCount?: string;
  source?: string;
}

interface Relationship {
  from: string;
  to: string;
  description: string;
}

interface TransformBlock {
  name: string;
  sql: string;
  description: string;
}

function parseDataSchema(md: string) {
  const tables: TableSchema[] = [];
  const relationships: Relationship[] = [];
  const transforms: TransformBlock[] = [];

  const sections = md.split(/^(?=## )/gm);

  for (const section of sections) {
    const headerMatch = section.match(/^## (.+)\n/);
    if (!headerMatch) continue;
    const sectionTitle = headerMatch[1].trim().toLowerCase();

    if (
      sectionTitle.includes("table") ||
      sectionTitle.includes("schema") ||
      sectionTitle.includes("dataset")
    ) {
      const tableSections = section.split(/^(?=### )/gm);
      for (const ts of tableSections) {
        const tableMatch = ts.match(/^### (.+)\n/);
        if (!tableMatch) continue;

        const name = tableMatch[1].trim().replace(/`/g, "");
        const columns: SchemaColumn[] = [];
        let rowCount: string | undefined;
        let source: string | undefined;

        const rowCountMatch = ts.match(
          /(?:~?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:K|M|B)?\s*rows?/i,
        );
        if (rowCountMatch) rowCount = rowCountMatch[0].trim();

        const sourceMatch = ts.match(
          /source[:\s]+(?:type[:\s]+)?([^\n]+)/i,
        );
        if (sourceMatch) source = sourceMatch[1].trim();

        const tableRows = [
          ...ts.matchAll(
            /^\|\s*`?(\w+)`?\s*\|\s*`?([^|]+?)`?\s*\|\s*([^|]+?)\s*\|$/gm,
          ),
        ];
        for (const row of tableRows) {
          const colName = row[1].trim();
          const colType = row[2].trim();
          const colDesc = row[3].trim();
          if (
            colName.match(/^[-:]+$/) ||
            colName.toLowerCase() === "column"
          )
            continue;
          columns.push({ name: colName, type: colType, description: colDesc });
        }

        if (columns.length > 0 || rowCount) {
          tables.push({ name, columns, rowCount, source });
        }
      }
    } else if (sectionTitle.includes("relationship")) {
      const relLines = section.match(
        /^\s*[-*]\s+`?(\w+)`?.*?→\s*`?(\w+)`?[:\s]*(.+)$/gm,
      );
      if (relLines) {
        for (const line of relLines) {
          const m = line.match(
            /`?(\w+)`?.*?→\s*`?(\w+)`?[:\s]*(.+)$/,
          );
          if (m) {
            relationships.push({
              from: m[1],
              to: m[2],
              description: m[3].trim(),
            });
          }
        }
      }
      const fkLines = section.match(
        /^\s*[-*]\s+`?(\w+)\.(\w+)`?\s*(?:→|->|references)\s*`?(\w+)\.(\w+)`?/gm,
      );
      if (fkLines) {
        for (const line of fkLines) {
          const m = line.match(
            /`?(\w+)\.(\w+)`?\s*(?:→|->|references)\s*`?(\w+)\.(\w+)`?/,
          );
          if (m)
            relationships.push({
              from: `${m[1]}.${m[2]}`,
              to: `${m[3]}.${m[4]}`,
              description: "Foreign key",
            });
        }
      }
    } else if (sectionTitle.includes("transform")) {
      const transformSections = section.split(/^(?=### )/gm);
      for (const ts of transformSections) {
        const nameMatch = ts.match(/^### (.+)\n/);
        if (!nameMatch) continue;
        const name = nameMatch[1].trim();
        const sqlMatch = ts.match(/```sql\n([\s\S]*?)```/);
        const sql = sqlMatch ? sqlMatch[1].trim() : "";
        const descLines = ts
          .slice(nameMatch[0].length)
          .split(/```/)[0]
          .trim();
        transforms.push({ name, sql, description: descLines });
      }
    }
  }

  return { tables, relationships, transforms };
}

const TYPE_COLORS: Record<string, string> = {
  string: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  varchar: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  text: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  int: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  integer: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  bigint: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  long: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  double: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  float: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  decimal: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  boolean: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  bool: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  timestamp: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  date: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  datetime: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  array: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  map: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  struct: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function typeColor(t: string) {
  const base = t.toLowerCase().replace(/[^a-z]/g, "");
  for (const [key, val] of Object.entries(TYPE_COLORS)) {
    if (base.startsWith(key)) return val;
  }
  return "bg-muted text-muted-foreground border-border";
}

function DataSchemaRenderer({ markdown }: { markdown: string }) {
  const { tables, relationships, transforms } = useMemo(
    () => parseDataSchema(markdown),
    [markdown],
  );

  if (tables.length === 0 && transforms.length === 0) return null;

  const totalCols = tables.reduce((a, t) => a + t.columns.length, 0);

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-xl border border-violet-500/15 bg-violet-500/[0.03] px-4 py-3">
        <Database className="h-5 w-5 text-violet-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Data Schema</p>
          <p className="text-[11px] text-muted-foreground">
            {tables.length} table{tables.length !== 1 ? "s" : ""}
            {totalCols > 0 && ` · ${totalCols} columns`}
            {relationships.length > 0 &&
              ` · ${relationships.length} relationship${relationships.length !== 1 ? "s" : ""}`}
            {transforms.length > 0 &&
              ` · ${transforms.length} transformation${transforms.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Relationship map (compact) */}
      {relationships.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {relationships.map((rel, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/20 pl-2.5 pr-3 py-1 text-[11px]"
            >
              <code className="font-semibold text-blue-400">{rel.from}</code>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/60" />
              <code className="font-semibold text-emerald-400">{rel.to}</code>
            </div>
          ))}
        </div>
      )}

      {/* Table cards */}
      {tables.map((table) => (
        <div
          key={table.name}
          className="rounded-xl border border-border/50 overflow-hidden shadow-sm"
        >
          <div className="flex items-center justify-between bg-gradient-to-r from-violet-500/[0.06] to-transparent px-4 py-3 border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15">
                <Database className="h-3.5 w-3.5 text-violet-400" />
              </div>
              <div>
                <code className="text-sm font-bold text-foreground">
                  {table.name}
                </code>
                {table.columns.length > 0 && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {table.columns.length} columns
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {table.rowCount && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono border-violet-500/20 text-violet-400"
                >
                  {table.rowCount}
                </Badge>
              )}
              {table.source && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono"
                >
                  {table.source}
                </Badge>
              )}
            </div>
          </div>

          {table.columns.length > 0 && (
            <div>
              <div className="grid grid-cols-[minmax(120px,1fr)_auto_2fr] gap-px bg-border/10">
                <div className="px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 bg-muted/20">
                  Column
                </div>
                <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 bg-muted/20">
                  Type
                </div>
                <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 bg-muted/20">
                  Description
                </div>

                {table.columns.map((col, i) => (
                  <>
                    <div
                      key={`n-${i}`}
                      className={`px-4 py-2 flex items-center ${i % 2 === 0 ? "bg-transparent" : "bg-muted/[0.04]"}`}
                    >
                      <code className="text-xs font-medium text-foreground">
                        {col.name}
                      </code>
                    </div>
                    <div
                      key={`t-${i}`}
                      className={`px-3 py-2 flex items-center ${i % 2 === 0 ? "bg-transparent" : "bg-muted/[0.04]"}`}
                    >
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono ${typeColor(col.type)}`}
                      >
                        {col.type}
                      </Badge>
                    </div>
                    <div
                      key={`d-${i}`}
                      className={`px-3 py-2 flex items-center ${i % 2 === 0 ? "bg-transparent" : "bg-muted/[0.04]"}`}
                    >
                      <span className="text-xs text-muted-foreground leading-snug">
                        {col.description}
                      </span>
                    </div>
                  </>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Transformations */}
      {transforms.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ChevronRight className="h-4 w-4" />
            Transformations
          </div>
          {transforms.map((t, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/50 overflow-hidden shadow-sm"
            >
              <div className="bg-gradient-to-r from-orange-500/[0.06] to-transparent px-4 py-2.5 border-b border-border/40">
                <span className="text-sm font-semibold">{t.name}</span>
              </div>
              {t.description && (
                <p className="px-4 py-2 text-xs text-muted-foreground border-b border-border/20">
                  {t.description}
                </p>
              )}
              {t.sql && (
                <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto bg-muted/[0.03]">
                  <code>{t.sql}</code>
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// project-structure.md — File tree visualization
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  comment?: string;
  children: TreeNode[];
  isFile: boolean;
}

function parseProjectTree(md: string): TreeNode[] {
  const codeMatch = md.match(/```[\w]*\n([\s\S]*?)```/);
  if (!codeMatch) return [];

  const lines = codeMatch[1].split("\n").filter((l) => l.trim());
  const root: TreeNode[] = [];
  const stack: { node: TreeNode; indent: number }[] = [];

  for (const line of lines) {
    const cleanLine = line.replace(/[│├└─┬\s]*/, "");
    const indent = line.search(/[├└]/) >= 0 ? line.search(/[├└]/) : 0;

    const parts = cleanLine.split(/\s{2,}#\s*|\s+#\s+/);
    const name = (parts[0] || "").replace(/[├└─│┬]/g, "").trim();
    const comment = parts[1]?.trim();

    if (!name) continue;

    const isFile = name.includes(".") && !name.endsWith("/");
    const node: TreeNode = {
      name: name.replace(/\/$/, ""),
      comment,
      children: [],
      isFile,
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    if (!isFile) {
      stack.push({ node, indent });
    }
  }

  return root;
}

function TreeItem({
  node,
  depth = 0,
}: {
  node: TreeNode;
  depth?: number;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-muted/30 transition-colors group"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {node.isFile ? (
          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        )}
        <code
          className={`text-xs ${node.isFile ? "text-foreground" : "font-semibold text-foreground"}`}
        >
          {node.name}
        </code>
        {node.comment && (
          <span className="text-[10px] text-muted-foreground/60 ml-auto truncate max-w-[50%]">
            {node.comment}
          </span>
        )}
      </div>
      {node.children.map((child, i) => (
        <TreeItem key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function ProjectStructureRenderer({ markdown }: { markdown: string }) {
  const tree = useMemo(() => parseProjectTree(markdown), [markdown]);

  if (tree.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <FolderOpen className="h-4 w-4" />
        Project Structure
      </div>
      <div className="rounded-xl border border-border/60 py-2 overflow-hidden">
        {tree.map((node, i) => (
          <TreeItem key={i} node={node} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SKILL.md — Build steps checklist + prerequisites
// ---------------------------------------------------------------------------

interface BuildStep {
  number: number;
  title: string;
  skills: string[];
  description: string;
}

interface SkillData {
  name: string;
  description: string;
  overview: string;
  prerequisites: string[];
  mandatoryReads: string[];
  steps: BuildStep[];
  acceptance: string[];
}

function parseSkillMd(md: string): SkillData {
  const data: SkillData = {
    name: "",
    description: "",
    overview: "",
    prerequisites: [],
    mandatoryReads: [],
    steps: [],
    acceptance: [],
  };

  if (md.startsWith("---")) {
    const end = md.indexOf("---", 3);
    if (end !== -1) {
      const fm = md.slice(3, end);
      const nameM = fm.match(/^name:\s*(.+)$/m);
      const descM = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
      if (nameM) data.name = nameM[1].trim();
      if (descM) data.description = descM[1].trim();
    }
  }

  const sections = md.split(/^(?=## )/gm);
  for (const section of sections) {
    const hdr = section.match(/^## (.+)\n/);
    if (!hdr) continue;
    const title = hdr[1].trim().toLowerCase();
    const body = section.slice(hdr[0].length);

    if (title.includes("overview")) {
      data.overview = body.trim().split("\n\n")[0].trim();
    } else if (title.includes("before") || title.includes("mandatory")) {
      const reads = [...body.matchAll(/\[(.+?)\]\((.+?)\)/g)];
      data.mandatoryReads = reads.map((m) => m[1]);
      if (data.mandatoryReads.length === 0) {
        data.mandatoryReads = body
          .split("\n")
          .filter((l) => l.match(/^\d+\.|^-/))
          .map((l) => l.replace(/^\d+\.\s*|^-\s*/, "").trim());
      }
    } else if (title.includes("prerequisite")) {
      data.prerequisites = body
        .split("\n")
        .filter((l) => l.match(/^\d+\.|^-/))
        .map((l) => l.replace(/^\d+\.\s*|^-\s*/, "").trim())
        .filter(Boolean);
    } else if (title.includes("build step")) {
      const stepSections = body.split(/^(?=### )/gm);
      for (const ss of stepSections) {
        const stepMatch = ss.match(/^### (?:Step\s+)?(\d+)[.:]\s*(.+)\n/);
        if (!stepMatch) continue;
        const skills = [
          ...ss.matchAll(/`(databricks-[a-z-]+|instrumenting-[a-z-]+|spark-[a-z-]+)`/g),
        ].map((m) => m[1]);
        const descLines = ss
          .slice(stepMatch[0].length)
          .split("\n")
          .filter((l) => l.trim() && !l.startsWith("###"))
          .slice(0, 3)
          .map((l) => l.replace(/^[-*]\s+/, "").trim());
        data.steps.push({
          number: parseInt(stepMatch[1]),
          title: stepMatch[2].trim(),
          skills,
          description: descLines.join(" "),
        });
      }
      if (data.steps.length === 0) {
        const numberedSteps = [
          ...body.matchAll(
            /^(\d+)\.\s+(.+)$/gm,
          ),
        ];
        for (const m of numberedSteps) {
          const skills = [
            ...m[2].matchAll(/`(databricks-[a-z-]+|instrumenting-[a-z-]+|spark-[a-z-]+)`/g),
          ].map((s) => s[1]);
          data.steps.push({
            number: parseInt(m[1]),
            title: m[2].replace(/`[^`]+`/g, "").trim(),
            skills,
            description: "",
          });
        }
      }
    } else if (title.includes("acceptance")) {
      data.acceptance = body
        .split("\n")
        .filter((l) => l.match(/^[-*]\s+\[?\s*\]?|^\d+\./))
        .map((l) =>
          l
            .replace(/^[-*]\s+\[?\s*[x ]?\]?\s*|^\d+\.\s*/, "")
            .trim(),
        )
        .filter(Boolean);
    }
  }

  return data;
}

function SkillRenderer({ markdown }: { markdown: string }) {
  const skill = useMemo(() => parseSkillMd(markdown), [markdown]);

  if (!skill.steps.length && !skill.overview) return null;

  return (
    <div className="space-y-6">
      {(skill.name || skill.description) && (
        <div className="space-y-1">
          {skill.name && (
            <div className="flex items-center gap-2">
              <code className="text-base font-bold text-primary">
                {skill.name}
              </code>
            </div>
          )}
          {skill.description && (
            <p className="text-xs text-muted-foreground italic">
              {skill.description}
            </p>
          )}
        </div>
      )}

      {skill.overview && (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
          <p className="text-sm leading-relaxed">{skill.overview}</p>
        </div>
      )}

      {skill.mandatoryReads.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            Required Reading
          </div>
          <div className="space-y-1">
            {skill.mandatoryReads.map((read, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2 text-xs"
              >
                <BookOpen className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>{read}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {skill.prerequisites.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            Prerequisites
          </div>
          <div className="space-y-1">
            {skill.prerequisites.map((pre, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-3 py-1.5 text-xs text-muted-foreground"
              >
                <Circle className="h-2 w-2 shrink-0 mt-1.5 fill-muted-foreground/30" />
                {pre}
              </div>
            ))}
          </div>
        </div>
      )}

      {skill.steps.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            Build Steps
            <Badge variant="secondary" className="text-[10px]">
              {skill.steps.length} steps
            </Badge>
          </div>
          <div className="space-y-2">
            {skill.steps.map((step) => (
              <div
                key={step.number}
                className="rounded-xl border border-border/60 p-3.5 hover:border-primary/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {step.number}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">
                      {step.title}
                    </p>
                    {step.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {step.description}
                      </p>
                    )}
                    {step.skills.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {step.skills.map((s) => (
                          <Badge
                            key={s}
                            variant="outline"
                            className="text-[10px] font-mono border-violet-500/20 text-violet-400 bg-violet-500/[0.04]"
                          >
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {skill.acceptance.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            Acceptance Criteria
          </div>
          <div className="space-y-1">
            {skill.acceptance.map((criterion, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2 text-xs"
              >
                <Circle className="h-2 w-2 shrink-0 mt-1.5 fill-emerald-400/50" />
                {criterion}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// storyline.md — Narrative cards
// ---------------------------------------------------------------------------

interface StorySection {
  title: string;
  content: string;
  icon: typeof BookOpen;
  color: string;
}

const STORY_SECTION_MAP: Record<
  string,
  { icon: typeof BookOpen; color: string }
> = {
  industry: { icon: Building2, color: "text-blue-400" },
  company: { icon: Building2, color: "text-emerald-400" },
  persona: { icon: Building2, color: "text-emerald-400" },
  problem: { icon: AlertTriangle, color: "text-red-400" },
  business: { icon: AlertTriangle, color: "text-red-400" },
  narrative: { icon: BookOpen, color: "text-amber-400" },
  arc: { icon: BookOpen, color: "text-amber-400" },
  solution: { icon: Sparkles, color: "text-violet-400" },
  wow: { icon: Sparkles, color: "text-primary" },
  moment: { icon: Sparkles, color: "text-primary" },
  terminology: { icon: Quote, color: "text-muted-foreground" },
  glossary: { icon: Quote, color: "text-muted-foreground" },
  domain: { icon: Quote, color: "text-muted-foreground" },
};

function parseStoryline(md: string): StorySection[] {
  const sections: StorySection[] = [];
  const parts = md.split(/^(?=## )/gm);

  for (const part of parts) {
    const hdr = part.match(/^## (.+)\n/);
    if (!hdr) continue;
    const title = hdr[1].trim();
    const content = part.slice(hdr[0].length).trim();

    const titleLower = title.toLowerCase();
    let icon = BookOpen;
    let color = "text-muted-foreground";

    for (const [key, val] of Object.entries(STORY_SECTION_MAP)) {
      if (titleLower.includes(key)) {
        icon = val.icon;
        color = val.color;
        break;
      }
    }

    sections.push({ title, content, icon, color });
  }

  return sections;
}

function StorySectionCard({ section, defaultOpen = false }: { section: StorySection; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const Icon = section.icon;

  // Extract a 1-2 line preview from the content
  const preview = useMemo(() => {
    const lines = section.content.split("\n").filter((l) => l.trim().length > 10);
    const first = lines[0] || section.content.slice(0, 140);
    const clean = first.replace(/\*\*/g, "").replace(/`[^`]+`/g, "").trim();
    return clean.length > 140 ? clean.slice(0, 137) + "..." : clean;
  }, [section.content]);

  const lineCount = section.content.split("\n").filter((l) => l.trim()).length;
  const isShort = lineCount <= 4;

  // Short sections just render inline (no collapse needed)
  if (isShort) {
    return (
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="flex items-center gap-2 bg-muted/30 px-4 py-2.5 border-b border-border/40">
          <Icon className={`h-4 w-4 ${section.color}`} />
          <span className="text-sm font-semibold">{section.title}</span>
        </div>
        <div className="px-4 py-3">
          <div className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">
            {section.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden transition-all">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2.5 border-b border-border/40 text-left hover:bg-muted/50 transition-colors"
      >
        <Icon className={`h-4 w-4 shrink-0 ${section.color}`} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold">{section.title}</span>
          {!isOpen && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
          )}
        </div>
        <span className="text-muted-foreground/50 shrink-0">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {isOpen && (
        <div className="px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">
            {section.content}
          </div>
        </div>
      )}
    </div>
  );
}

function StorylineRenderer({ markdown }: { markdown: string }) {
  const sections = useMemo(() => parseStoryline(markdown), [markdown]);

  if (sections.length === 0) return null;

  const titleMatch = markdown.match(/^# (.+)\n/m);

  // Key sections that should be open by default
  const keyKeywords = ["narrative", "arc", "wow", "moment", "solution"];

  return (
    <div className="space-y-3">
      {titleMatch && (
        <h2 className="text-lg font-bold">{titleMatch[1].trim()}</h2>
      )}
      {sections.map((section, i) => {
        const titleLower = section.title.toLowerCase();
        const isKey = keyKeywords.some((k) => titleLower.includes(k));
        return (
          <StorySectionCard
            key={i}
            section={section}
            defaultOpen={isKey || i === 0}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// walkthrough.md — Demo walkthrough script with navigation cues
// ---------------------------------------------------------------------------

interface WalkthroughStep {
  number: number;
  title: string;
  timeEstimate: string;
  cues: { type: "navigate" | "show"; text: string }[];
  talkingPoints: string[];
  contrast?: { without: string; withAI: string };
}

interface AssetRow {
  name: string;
  type: string;
  url: string;
}

interface AssetGroup {
  heading: string;
  rows: AssetRow[];
}

interface WalkthroughData {
  overview: string;
  assetGroups: AssetGroup[];
  architectureSummary: string;
  kpis: string[];
  steps: WalkthroughStep[];
  pitchShort: string;
  pitchExpanded: string;
  architectureFlow: string;
  audiences: { label: string; icon: typeof Users; points: string[] }[];
}

function parseWalkthrough(md: string): WalkthroughData {
  const data: WalkthroughData = {
    overview: "",
    assetGroups: [],
    architectureSummary: "",
    kpis: [],
    steps: [],
    pitchShort: "",
    pitchExpanded: "",
    architectureFlow: "",
    audiences: [],
  };

  const sections = md.split(/^(?=## )/gm);

  for (const section of sections) {
    const hdr = section.match(/^## (.+)\n/);
    if (!hdr) continue;
    const title = hdr[1].trim().toLowerCase();
    const body = section.slice(hdr[0].length).trim();

    if (title.includes("execution instructions") || title.includes("script output")) {
      // LLM-only sections — skip rendering
      continue;
    } else if (title.includes("asset") && title.includes("overview")) {
      // Demo Assets Overview — LLM-only, skip rendering
      const subSections = body.split(/^(?=### )/gm);
      for (const sub of subSections) {
        const subHdr = sub.match(/^### (.+)\n/);
        if (!subHdr) {
          // Check for architecture summary (bold text after tables)
          const summaryMatch = sub.match(/\*\*Architecture Summary[:\*]*\*?\*?\s*([\s\S]+)/i);
          if (summaryMatch) data.architectureSummary = summaryMatch[1].trim();
          continue;
        }
        const groupName = subHdr[1].trim();
        const rows: AssetRow[] = [];
        for (const m of sub.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/gm)) {
          const name = m[1].trim();
          const type = m[2].trim();
          const url = m[3].trim().replace(/`/g, "");
          if (name && !name.startsWith("---") && name !== "Asset Name") {
            rows.push({ name, type, url });
          }
        }
        if (rows.length > 0) data.assetGroups.push({ heading: groupName, rows });
      }
      // Also grab trailing architecture summary outside ### sections
      if (!data.architectureSummary) {
        const summaryMatch = body.match(/\*\*Architecture Summary[:\*]*\*?\*?\s*([\s\S]+?)(?=\n## |\n$|$)/i);
        if (summaryMatch) data.architectureSummary = summaryMatch[1].trim();
      }
    } else if (title.includes("overview")) {
      // Demo Overview (non-asset): Extract KPI bullets and overview text
      const lines = body.split("\n");
      const overviewLines: string[] = [];
      for (const line of lines) {
        const bulletMatch = line.match(/^[-*]\s+\*\*(.+?)\*\*/);
        if (bulletMatch) {
          data.kpis.push(line.replace(/^[-*]\s+/, "").trim());
        } else if (line.trim()) {
          overviewLines.push(line);
        }
      }
      data.overview = overviewLines.join("\n").trim();
    } else if (title.includes("demo script") || title.includes("script")) {
      const stepSections = body.split(/^(?=### )/gm);
      let autoStepNum = 0;
      for (const ss of stepSections) {
        // Try numbered format: ### Step 1: Title (~2 min)
        let stepMatch = ss.match(
          /^### (?:Step\s+)?(\d+)[.:]\s*(.+?)(?:\s*\(([^)]+)\))?\s*\n/,
        );
        // Fall back to non-numbered: ### Title (~2 min) or ### Title (45 seconds)
        if (!stepMatch) {
          const namedMatch = ss.match(
            /^### (.+?)(?:\s*\(([^)]+)\))?\s*\n/,
          );
          if (!namedMatch) continue;
          autoStepNum++;
          stepMatch = [namedMatch[0], String(autoStepNum), namedMatch[1].trim(), namedMatch[2] || ""] as unknown as RegExpMatchArray;
        }

        const cues: WalkthroughStep["cues"] = [];
        const talkingPoints: string[] = [];
        let contrast: WalkthroughStep["contrast"] | undefined;

        const lines = ss.slice(stepMatch[0].length).split("\n");
        let withinWithout = false;
        let withinWith = false;

        for (const line of lines) {
          const navMatch = line.match(/\[Navigate to (.+?)\]/);
          const showMatch = line.match(/\[Show (.+?)\]/);
          if (navMatch) {
            cues.push({ type: "navigate", text: navMatch[1] });
          } else if (showMatch) {
            cues.push({ type: "show", text: showMatch[1] });
          }

          if (/without ai/i.test(line)) {
            withinWithout = true;
            withinWith = false;
            if (!contrast) contrast = { without: "", withAI: "" };
          } else if (/with ai/i.test(line) && contrast) {
            withinWith = true;
            withinWithout = false;
          } else if (withinWithout && contrast && line.trim()) {
            contrast.without +=
              (contrast.without ? " " : "") +
              line.replace(/^[-*]\s+/, "").trim();
          } else if (withinWith && contrast && line.trim()) {
            contrast.withAI +=
              (contrast.withAI ? " " : "") +
              line.replace(/^[-*]\s+/, "").trim();
          }

          const bulletMatch = line.match(/^[-*]\s+(.+)/);
          if (
            bulletMatch &&
            !navMatch &&
            !showMatch &&
            !withinWithout &&
            !withinWith
          ) {
            talkingPoints.push(bulletMatch[1].trim());
          }
        }

        data.steps.push({
          number: parseInt(stepMatch[1]),
          title: stepMatch[2].trim(),
          timeEstimate: stepMatch[3]?.trim() || "",
          cues,
          talkingPoints,
          contrast,
        });
      }
    } else if (
      title.includes("executive") ||
      title.includes("talk track")
    ) {
      const subSections = body.split(/^(?=### )/gm);
      for (const sub of subSections) {
        const subHdr = sub.match(/^### (.+)\n/);
        if (!subHdr) {
          if (!data.pitchShort) data.pitchShort = sub.trim();
          continue;
        }
        const subTitle = subHdr[1].trim().toLowerCase();
        const subBody = sub.slice(subHdr[0].length).trim();
        if (subTitle.includes("60") || subTitle.includes("pitch") || subTitle.includes("elevator")) {
          data.pitchShort = subBody;
        } else if (subTitle.includes("expand") || subTitle.includes("summary") || subTitle.includes("3-min")) {
          data.pitchExpanded = subBody;
        }
      }
    } else if (title.includes("architecture") || title.includes("flow")) {
      const codeMatch = body.match(/```[\w]*\n([\s\S]*?)```/);
      data.architectureFlow = codeMatch ? codeMatch[1].trim() : body.trim();
    } else if (title.includes("audience") || title.includes("adaptation")) {
      const subSections = body.split(/^(?=### )/gm);
      for (const sub of subSections) {
        const subHdr = sub.match(/^### (.+)\n/);
        if (!subHdr) continue;
        const label = subHdr[1].trim();
        const subBody = sub.slice(subHdr[0].length).trim();
        const points = subBody
          .split("\n")
          .filter((l) => l.match(/^[-*]\s+/))
          .map((l) => l.replace(/^[-*]\s+/, "").trim());

        const labelLower = label.toLowerCase();
        let icon: typeof Users = Users;
        if (labelLower.includes("c-suite") || labelLower.includes("executive")) icon = Briefcase;
        else if (labelLower.includes("technical")) icon = Cpu;
        else if (labelLower.includes("individual") || labelLower.includes("ic")) icon = Wrench;

        data.audiences.push({ label, icon, points });
      }
    }
  }

  return data;
}

function NavigationCue({
  cue,
}: {
  cue: { type: "navigate" | "show"; text: string };
}) {
  const isNav = cue.type === "navigate";
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
        isNav
          ? "border border-blue-500/20 bg-blue-500/[0.06] text-blue-400"
          : "border border-amber-500/20 bg-amber-500/[0.06] text-amber-400"
      }`}
    >
      {isNav ? (
        <Navigation className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Eye className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>
        {isNav ? "Navigate to " : "Show "}
        {cue.text}
      </span>
    </div>
  );
}

function WalkthroughRenderer({ markdown }: { markdown: string }) {
  const wt = useMemo(() => parseWalkthrough(markdown), [markdown]);
  const [expandedAudience, setExpandedAudience] = useState<string | null>(null);

  if (!wt.steps.length && !wt.overview && !wt.assetGroups.length) return null;

  const titleMatch = markdown.match(/^# (.+)\n/m);

  return (
    <div className="space-y-6">
      {/* Title */}
      {titleMatch && (
        <div className="flex items-center gap-2">
          <Presentation className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">{titleMatch[1].trim()}</h2>
        </div>
      )}

      {/* Demo Overview */}
      {(wt.overview || wt.kpis.length > 0) && (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="flex items-center gap-2 bg-primary/[0.04] px-4 py-2.5 border-b border-border/40">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Demo Overview</span>
          </div>
          <div className="px-4 py-3 space-y-3">
            {wt.overview && (
              <p className="text-sm leading-relaxed text-foreground/80">
                {wt.overview}
              </p>
            )}
            {wt.kpis.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {wt.kpis.map((kpi, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-[10px] border-emerald-500/20 text-emerald-400 bg-emerald-500/[0.04]"
                  >
                    {kpi.replace(/\*\*/g, "")}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Demo Script Steps */}
      {wt.steps.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Presentation className="h-4 w-4" />
            Demo Script
            <Badge variant="secondary" className="text-[10px]">
              {wt.steps.length} steps
            </Badge>
          </div>
          <div className="space-y-3">
            {wt.steps.map((step) => (
              <div
                key={step.number}
                className="rounded-xl border border-border/60 overflow-hidden"
              >
                <div className="flex items-center gap-3 bg-muted/30 px-4 py-2.5 border-b border-border/40">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {step.number}
                  </div>
                  <span className="text-sm font-semibold flex-1">
                    {step.title}
                  </span>
                  {step.timeEstimate && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {step.timeEstimate}
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 space-y-2">
                  {/* Navigation cues */}
                  {step.cues.length > 0 && (
                    <div className="space-y-1.5">
                      {step.cues.map((cue, i) => (
                        <NavigationCue key={i} cue={cue} />
                      ))}
                    </div>
                  )}

                  {/* Talking points */}
                  {step.talkingPoints.length > 0 && (
                    <div className="space-y-1">
                      {step.talkingPoints.map((pt, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-xs text-foreground/80"
                        >
                          <Circle className="h-1.5 w-1.5 shrink-0 mt-1.5 fill-muted-foreground/40" />
                          <span>{pt}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Contrast: Without vs With AI */}
                  {step.contrast && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="rounded-lg border border-red-500/15 bg-red-500/[0.03] px-3 py-2">
                        <p className="text-[10px] font-semibold text-red-400 mb-1">
                          Without AI
                        </p>
                        <p className="text-[11px] text-foreground/70">
                          {step.contrast.without}
                        </p>
                      </div>
                      <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] px-3 py-2">
                        <p className="text-[10px] font-semibold text-emerald-400 mb-1">
                          With AI
                        </p>
                        <p className="text-[11px] text-foreground/70">
                          {step.contrast.withAI}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Executive Talk Track */}
      {(wt.pitchShort || wt.pitchExpanded) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Briefcase className="h-4 w-4" />
            Executive Talk Track
          </div>
          {wt.pitchShort && (
            <div className="rounded-xl border border-primary/15 bg-primary/[0.03] px-4 py-3">
              <p className="text-[10px] font-semibold text-primary mb-1.5">
                60-Second Pitch
              </p>
              <p className="text-sm leading-relaxed text-foreground/80">
                {wt.pitchShort}
              </p>
            </div>
          )}
          {wt.pitchExpanded && (
            <div className="rounded-xl border border-border/60 px-4 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">
                Expanded Summary
              </p>
              <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">
                {wt.pitchExpanded}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Architecture Flow */}
      {wt.architectureFlow && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
            Architecture Flow
          </div>
          <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.03] px-4 py-3 overflow-x-auto">
            <pre className="text-xs font-mono text-violet-300 leading-relaxed whitespace-pre">
              {wt.architectureFlow}
            </pre>
          </div>
        </div>
      )}

      {/* Audience Adaptations */}
      {wt.audiences.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Users className="h-4 w-4" />
            Audience Adaptations
          </div>
          <div className="space-y-2">
            {wt.audiences.map((aud) => {
              const Icon = aud.icon;
              const isOpen = expandedAudience === aud.label;
              return (
                <div
                  key={aud.label}
                  className="rounded-xl border border-border/60 overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedAudience(isOpen ? null : aud.label)
                    }
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold flex-1">
                      {aud.label}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] mr-1"
                    >
                      {aud.points.length} points
                    </Badge>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-4 py-3 border-t border-border/40 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                      {aud.points.map((pt, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-xs text-foreground/80"
                        >
                          <Circle className="h-1.5 w-1.5 shrink-0 mt-1.5 fill-muted-foreground/40" />
                          <span>{pt}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
