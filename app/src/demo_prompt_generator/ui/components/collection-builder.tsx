import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Layers,
  X,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  FileText,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react";
import {
  listCollections,
  getCollection,
  type CollectionSummary,
  type CollectionFull,
} from "@/lib/custom-api";
import { BlockPills } from "./block-picker";
import { Prose } from "@/components/markdown-prose";

interface CollectionBrowserProps {
  onSelect: (slug: string, blockSlugs: string[]) => void;
  selectedSlug?: string;
}

export function CollectionBrowser({ onSelect, selectedSlug }: CollectionBrowserProps) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCollections()
      .then(setCollections)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading collections...
      </div>
    );
  }

  if (!collections.length) {
    return (
      <div className="text-center py-8 text-xs text-muted-foreground">
        No collections available
      </div>
    );
  }

  return (
    <ScrollArea className="h-64">
      <div className="space-y-2 pr-2">
        {collections.map((coll) => (
          <button
            key={coll.slug}
            onClick={() => onSelect(coll.slug, coll.block_slugs)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              selectedSlug === coll.slug
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-muted/30"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-xs font-medium truncate">
                    {coll.name}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                  {coll.description}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {coll.industry}
              </Badge>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <BlockPills slugs={coll.block_slugs} />
            </div>

            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>{coll.output_file_count} output files</span>
              <ArrowRight className="h-2.5 w-2.5" />
              <span>parallel generation</span>
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

/** Inline collection status shown during proposal */
export function CollectionInfo({
  collectionSlug,
  blockSlugs,
  outputFileCount,
}: {
  collectionSlug: string;
  blockSlugs: string[];
  outputFileCount?: number;
}) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        Collection: {collectionSlug}
      </div>
      <BlockPills slugs={blockSlugs} />
      {outputFileCount != null && (
        <div className="text-[10px] text-muted-foreground">
          {outputFileCount} files will be generated in parallel tiers
        </div>
      )}
    </div>
  );
}

/** Progress display for parallel buildout */
export function ParallelBuildoutProgress({
  tiers,
  currentTier,
  completedFiles,
  activeFiles,
}: {
  tiers: { tier: number; files: string[] }[];
  currentTier: number;
  completedFiles: Set<string>;
  activeFiles: Set<string>;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        Generation Progress
      </div>
      {tiers.map(({ tier, files }) => (
        <div key={tier} className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Badge
              variant={
                tier < currentTier
                  ? "default"
                  : tier === currentTier
                    ? "secondary"
                    : "outline"
              }
              className="text-[9px] px-1 py-0"
            >
              Tier {tier}
            </Badge>
            {tier < currentTier && (
              <span className="text-green-600">Complete</span>
            )}
            {tier === currentTier && (
              <span className="text-primary animate-pulse">Generating...</span>
            )}
          </div>
          <div className="ml-4 space-y-0.5">
            {files.map((filename) => {
              const done = completedFiles.has(filename);
              const active = activeFiles.has(filename);
              return (
                <div
                  key={filename}
                  className={`flex items-center gap-1.5 text-[10px] ${
                    done
                      ? "text-green-600"
                      : active
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {done ? (
                    <span>&#10003;</span>
                  ) : active ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full border border-muted-foreground/30" />
                  )}
                  {filename}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block category config — colors and labels for visual blocks
// ---------------------------------------------------------------------------

const BLOCK_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  domain: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    label: "Industry",
  },
  pattern: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-400",
    label: "Use Case",
  },
  capability: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    label: "Capability",
  },
};

// ---------------------------------------------------------------------------
// BlockGrid — visual colored squares showing what's in a collection
// ---------------------------------------------------------------------------

export function BlockGrid({
  blocks,
  selectedSlug,
  onSelect,
  compact,
}: {
  blocks: { slug: string; name: string; category: string; description: string }[];
  selectedSlug?: string | null;
  onSelect?: (slug: string) => void;
  compact?: boolean;
}) {
  // Group blocks by category
  const groups: Record<string, typeof blocks> = {};
  for (const b of blocks) {
    (groups[b.category] ??= []).push(b);
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      {["domain", "pattern", "capability"].map((cat) => {
        const items = groups[cat];
        if (!items?.length) return null;
        const style = BLOCK_STYLES[cat] ?? BLOCK_STYLES.capability;

        return (
          <div key={cat}>
            <div className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${style.text}`}>
              {style.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {items.map((block) => {
                const isSelected = selectedSlug === block.slug;
                return (
                  <button
                    key={block.slug}
                    onClick={() => onSelect?.(block.slug)}
                    className={`group relative rounded-xl ${style.border} ${style.bg} px-3.5 py-2.5 text-left transition-all hover:scale-[1.02] ${
                      compact ? "min-w-[120px] max-w-[160px]" : "min-w-[140px] max-w-[200px]"
                    } ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                  >
                    <div className={`text-xs font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
                      {block.name}
                    </div>
                    {!compact && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                        {block.description.slice(0, 80)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollectionDetailView — visual block layout + generate action
// ---------------------------------------------------------------------------

interface CollectionDetailViewProps {
  slug: string;
  onClose?: () => void;
  onGenerate?: (slug: string, blockSlugs: string[]) => void;
  /** When provided, overrides the collection's block list (for live editing via chat) */
  overrideBlockSlugs?: string[];
  onSaveCollection?: (name: string, slug: string, blockSlugs: string[]) => void;
}

export function CollectionDetailView({
  slug,
  onClose,
  onGenerate,
  overrideBlockSlugs,
  onSaveCollection,
}: CollectionDetailViewProps) {
  const [collection, setCollection] = useState<CollectionFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [extraBlocks, setExtraBlocks] = useState<{ slug: string; name: string; category: string; description: string; content: string }[]>([]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getCollection(slug)
      .then(setCollection)
      .catch((err) => setError(err.message ?? "Failed to load collection"))
      .finally(() => setLoading(false));
  }, [slug]);

  // When overrideBlockSlugs changes, fetch any blocks not in the original collection
  useEffect(() => {
    if (!overrideBlockSlugs || !collection) return;
    const existing = new Set(collection.blocks.map((b) => b.slug));
    const missing = overrideBlockSlugs.filter((s) => !existing.has(s));
    if (missing.length === 0) { setExtraBlocks([]); return; }

    Promise.all(
      missing.map((s) =>
        import("@/lib/custom-api").then(({ getBlock }) => getBlock(s)).catch(() => null)
      )
    ).then((results) => {
      setExtraBlocks(
        results.filter((r): r is NonNullable<typeof r> => r !== null)
      );
    });
  }, [overrideBlockSlugs, collection]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading collection...
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="text-center py-8 text-sm text-destructive">
        {error ?? "Collection not found"}
      </div>
    );
  }

  // Merge original blocks with any extras from override, filtered by current selection
  const activeBlockSlugs = overrideBlockSlugs ?? collection.block_slugs;
  const allAvailableBlocks = [...collection.blocks, ...extraBlocks];
  const displayBlocks = activeBlockSlugs
    .map((slug) => allAvailableBlocks.find((b) => b.slug === slug))
    .filter((b): b is NonNullable<typeof b> => b !== undefined);

  const selectedBlockData = selectedBlock
    ? displayBlocks.find((b) => b.slug === selectedBlock)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold">{collection.name}</h2>
            <Badge variant="outline" className="text-xs">
              {collection.industry}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            {collection.description}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onGenerate && (
            <Button
              onClick={() => onGenerate(collection.slug, activeBlockSlugs)}
              className="gap-1.5"
            >
              <Sparkles className="h-4 w-4" />
              Generate Demo
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Visual block grid */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-3">
          {displayBlocks.length} context blocks power this demo
        </div>
        <BlockGrid
          blocks={displayBlocks}
          selectedSlug={selectedBlock}
          onSelect={(slug) => setSelectedBlock(slug === selectedBlock ? null : slug)}
        />
      </div>

      {/* Selected block detail */}
      {selectedBlockData && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{selectedBlockData.name}</h3>
              <Badge
                className={`text-[10px] px-1.5 py-0 ${
                  BLOCK_STYLES[selectedBlockData.category]?.bg ?? ""
                } ${BLOCK_STYLES[selectedBlockData.category]?.text ?? ""}`}
              >
                {BLOCK_STYLES[selectedBlockData.category]?.label ?? selectedBlockData.category}
              </Badge>
            </div>
            <button
              onClick={() => setSelectedBlock(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{selectedBlockData.description}</p>
          <div className="rounded-lg border bg-background/50 p-3 max-h-48 overflow-y-auto">
            <Prose compact className="text-xs">
              {selectedBlockData.content}
            </Prose>
          </div>
        </div>
      )}

      {/* Save as Collection — shown when blocks have been modified */}
      {overrideBlockSlugs && overrideBlockSlugs.join(",") !== collection.block_slugs.join(",") && (
        <SaveCollectionInline
          originalName={collection.name}
          blockSlugs={activeBlockSlugs}
          outputFiles={collection.output_files}
          onSave={onSaveCollection}
        />
      )}

      {/* What gets generated — simple list, no tech jargon */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          What gets generated
        </div>
        <div className="grid grid-cols-2 gap-2">
          {collection.output_files.map((f) => (
            <div
              key={f.filename}
              className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
            >
              <div className="text-xs font-medium">{f.purpose}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline save — appears when blocks have been modified
// ---------------------------------------------------------------------------

function SaveCollectionInline({
  originalName,
  blockSlugs,
  outputFiles,
  onSave,
}: {
  originalName: string;
  blockSlugs: string[];
  outputFiles: { filename: string; purpose: string; depends_on: string[] }[];
  onSave?: (name: string, slug: string, blockSlugs: string[]) => void;
}) {
  const [name, setName] = useState(`${originalName} (custom)`);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const { createCollection } = await import("@/lib/custom-api");
      await createCollection({
        slug,
        name: name.trim(),
        description: `Custom collection based on ${originalName}`,
        industry: "",
        block_slugs: blockSlugs,
        output_files: outputFiles,
      });
      setSaved(true);
      onSave?.(name.trim(), slug, blockSlugs);
    } catch {
      // Could already exist — try update
      try {
        const { updateCollection } = await import("@/lib/custom-api");
        await updateCollection(slug, {
          slug,
          name: name.trim(),
          description: `Custom collection based on ${originalName}`,
          industry: "",
          block_slugs: blockSlugs,
          output_files: outputFiles,
        });
        setSaved(true);
        onSave?.(name.trim(), slug, blockSlugs);
      } catch (e2) {
        setSaveError(`Failed to save: ${e2 instanceof Error ? e2.message : "Unknown error"}`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 text-xs text-emerald-400">
        <Save className="h-3.5 w-3.5" />
        Collection saved as <strong>{name}</strong>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="text-xs font-medium text-amber-400">
        Blocks modified — save as a new collection?
      </div>
      {saveError && (
        <div className="text-xs text-red-400">{saveError}</div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-xs flex-1"
          placeholder="Collection name..."
        />
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5"
          disabled={saving || !name.trim()}
          onClick={handleSave}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>
    </div>
  );
}
