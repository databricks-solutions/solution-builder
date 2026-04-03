import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Download,
  GitFork,
  Loader2,
  PackageCheck,
  Layers,
  Blocks,
  Library,
  X,
  Plus,
  Pencil,
  Trash2,
  Save,
} from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import {
  useListLibrary,
  useForkLibraryPackage,
  listGenerationsKey,
} from "@/lib/api";
import type { GenerationListItem } from "@/lib/api";
import { selector } from "@/lib/selector";
import { useQueryClient } from "@tanstack/react-query";
import { BlockPicker } from "@/components/block-picker";
import {
  getBlock,
  createBlock,
  updateBlock,
  deleteBlock,
  createCollection,
  updateCollection,
  deleteCollection,
  listCollections,
  getCollection,
  type BlockFull,
  type CollectionSummary,
  type CollectionFull,
} from "@/lib/custom-api";
import { Prose } from "@/components/markdown-prose";

export const Route = createFileRoute("/_sidebar/library")({
  component: LibraryPage,
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function toKebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const BLOCK_CATEGORIES = ["domain", "capability", "pattern"] as const;

/* ------------------------------------------------------------------ */
/*  Block create / edit form                                          */
/* ------------------------------------------------------------------ */

interface BlockFormData {
  name: string;
  slug: string;
  category: string;
  tags: string;
  description: string;
  content: string;
}

function emptyBlockForm(): BlockFormData {
  return { name: "", slug: "", category: "domain", tags: "", description: "", content: "" };
}

function blockToForm(block: BlockFull): BlockFormData {
  return {
    name: block.name,
    slug: block.slug,
    category: block.category,
    tags: block.tags.join(", "),
    description: block.description,
    content: block.content,
  };
}

function BlockForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: BlockFormData;
  onSave: (data: BlockFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<BlockFormData>(initial);
  const [slugTouched, setSlugTouched] = useState(!!initial.slug);

  function set<K extends keyof BlockFormData>(key: K, value: BlockFormData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "name" && !slugTouched) {
        next.slug = toKebab(value as string);
      }
      return next;
    });
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-5 space-y-4">
        {/* Name & Slug */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              placeholder="e.g. Financial Fraud Detection"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Slug</Label>
            <Input
              placeholder="auto-generated-from-name"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value);
              }}
              className="h-8 text-sm font-mono"
            />
          </div>
        </div>

        {/* Category & Tags */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <div className="flex gap-1.5">
              {BLOCK_CATEGORIES.map((cat) => (
                <Button
                  key={cat}
                  type="button"
                  size="sm"
                  variant={form.category === cat ? "default" : "outline"}
                  className="h-7 text-xs px-3 capitalize"
                  onClick={() => set("category", cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tags (comma-separated)</Label>
            <Input
              placeholder="e.g. fraud, ml, real-time"
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Textarea
            placeholder="Short description of what this block provides..."
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            className="text-sm resize-none"
          />
        </div>

        {/* Content */}
        <div className="space-y-1.5">
          <Label className="text-xs">Content (markdown)</Label>
          <Textarea
            placeholder="The main block content in markdown..."
            value={form.content}
            onChange={(e) => set("content", e.target.value)}
            rows={10}
            className="text-sm font-mono resize-y"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={saving || !form.name.trim() || !form.slug.trim()}
            onClick={() => onSave(form)}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Block
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Collection create / edit form                                     */
/* ------------------------------------------------------------------ */

interface CollectionFormData {
  name: string;
  slug: string;
  description: string;
  industry: string;
  blockSlugs: string[];
}

function emptyCollectionForm(): CollectionFormData {
  return { name: "", slug: "", description: "", industry: "", blockSlugs: [] };
}

function collectionToForm(coll: CollectionSummary | CollectionFull): CollectionFormData {
  return {
    name: coll.name,
    slug: coll.slug,
    description: coll.description,
    industry: coll.industry,
    blockSlugs: coll.block_slugs,
  };
}

function CollectionForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: CollectionFormData;
  onSave: (data: CollectionFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<CollectionFormData>(initial);
  const [slugTouched, setSlugTouched] = useState(!!initial.slug);

  function set<K extends keyof CollectionFormData>(key: K, value: CollectionFormData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "name" && !slugTouched) {
        next.slug = toKebab(value as string);
      }
      return next;
    });
  }

  const toggleBlock = useCallback(
    (slug: string) => {
      setForm((prev) => {
        const has = prev.blockSlugs.includes(slug);
        return {
          ...prev,
          blockSlugs: has
            ? prev.blockSlugs.filter((s) => s !== slug)
            : [...prev.blockSlugs, slug],
        };
      });
    },
    [],
  );

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-5 space-y-4">
        {/* Name & Slug */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              placeholder="e.g. Healthcare Patient Readmissions"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Slug</Label>
            <Input
              placeholder="auto-generated-from-name"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value);
              }}
              className="h-8 text-sm font-mono"
            />
          </div>
        </div>

        {/* Industry & Description */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Industry</Label>
            <Input
              placeholder="e.g. Healthcare"
              value={form.industry}
              onChange={(e) => set("industry", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea
              placeholder="What this collection is for..."
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </div>

        {/* Block picker */}
        <div className="space-y-1.5">
          <Label className="text-xs">
            Blocks ({form.blockSlugs.length} selected)
          </Label>
          <BlockPicker
            selectedSlugs={form.blockSlugs}
            onToggle={toggleBlock}
            compact
          />
        </div>

        {/* Output files note */}
        <p className="text-xs text-muted-foreground italic">
          Output files will be auto-suggested based on selected blocks.
        </p>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={saving || !form.name.trim() || !form.slug.trim()}
            onClick={() => onSave(form)}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Collection
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Templates tab — library package card                              */
/* ------------------------------------------------------------------ */

function LibraryPackageCard({
  pkg,
  onFork,
  forking,
}: {
  pkg: GenerationListItem;
  onFork: (id: number) => void;
  forking: number | null;
}) {
  const tags: string[] = pkg.library_tags ?? [];

  return (
    <Card className="flex flex-col transition-all hover:border-primary/20 hover:shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold leading-tight">
              {pkg.demo_name}
            </CardTitle>
            <Badge
              variant="secondary"
              className="mt-1.5 text-[10px] px-1.5 py-0"
            >
              {pkg.industry}
            </Badge>
          </div>
          <PackageCheck className="h-5 w-5 shrink-0 text-emerald-500 mt-0.5" />
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 pt-0">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[10px] px-1.5 py-0 text-muted-foreground"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            disabled={forking === pkg.id}
            onClick={() => onFork(pkg.id)}
          >
            {forking === pkg.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitFork className="h-3.5 w-3.5" />
            )}
            Use as Template
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              window.open(`/api/workspace/${pkg.id}/download`, "_blank")
            }
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Templates tab content                                             */
/* ------------------------------------------------------------------ */

function TemplatesTab({
  onFork,
  forking,
}: {
  onFork: (id: number) => void;
  forking: number | null;
}) {
  const { data, isLoading, error } = useListLibrary({
    query: selector<GenerationListItem[]>().query,
  });

  return (
    <>
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          Failed to load library: {error.message}
        </p>
      )}

      {data && data.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <PackageCheck className="h-12 w-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No library packages yet</p>
            <p className="text-sm text-muted-foreground">
              Library packages will appear here once they're added to the repo.
            </p>
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((pkg) => (
            <LibraryPackageCard
              key={pkg.id}
              pkg={pkg}
              onFork={onFork}
              forking={forking}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Collections tab content                                           */
/* ------------------------------------------------------------------ */

function CollectionsTab() {
  const navigate = useNavigate();
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [formInitial, setFormInitial] = useState<CollectionFormData>(emptyCollectionForm());
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // State for inline collection list with edit buttons
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Load collections
  const loadCollections = useCallback(() => {
    setLoadingList(true);
    listCollections()
      .then(setCollections)
      .catch(console.error)
      .finally(() => setLoadingList(false));
  }, []);

  // Reload on mount and whenever refreshKey bumps after a mutation
  useEffect(() => {
    loadCollections();
  }, [loadCollections, refreshKey]);

  function openCreate() {
    setFormInitial(emptyCollectionForm());
    setEditingSlug(null);
    setFormMode("create");
  }

  async function openEdit(slug: string) {
    try {
      const full = await getCollection(slug);
      setFormInitial(collectionToForm(full));
      setEditingSlug(slug);
      setFormMode("edit");
    } catch (err) {
      console.error("Failed to load collection for editing:", err);
    }
  }

  function closeForm() {
    setFormMode(null);
    setEditingSlug(null);
  }

  async function handleSave(data: CollectionFormData) {
    setSaving(true);
    try {
      const payload = {
        slug: data.slug,
        name: data.name,
        description: data.description,
        industry: data.industry,
        block_slugs: data.blockSlugs,
        output_files: [
          { filename: "01-story-and-data.md", purpose: "Narrative, data schemas, and synthetic data spec", depends_on: [] },
          { filename: "02-pipeline.md", purpose: "Data pipeline and transformations", depends_on: ["01-story-and-data.md"] },
          { filename: "03-components.md", purpose: "Dashboards, agents, and application specs", depends_on: ["01-story-and-data.md"] },
          { filename: "04-walkthrough.md", purpose: "Demo script and talk track", depends_on: ["*"] },
        ] as { filename: string; purpose: string; depends_on: string[] }[],
      };

      if (formMode === "edit" && editingSlug) {
        await updateCollection(editingSlug, payload);
      } else {
        await createCollection(payload);
      }
      setFormMode(null);
      setEditingSlug(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to save collection:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(slug: string) {
    try {
      await deleteCollection(slug);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to delete collection:", err);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Pre-built collections of blocks that target a specific industry or use
          case. Select one to start a new workspace with those blocks
          pre-configured.
        </p>
        {!formMode && (
          <Button size="sm" className="gap-1.5 shrink-0 ml-4" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New Collection
          </Button>
        )}
      </div>

      {/* Inline form */}
      {formMode && (
        <CollectionForm
          initial={formInitial}
          onSave={handleSave}
          onCancel={closeForm}
          saving={saving}
        />
      )}

      {/* Collection cards with edit buttons */}
      {!formMode && (
        <>
          {loadingList && (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading collections...
            </div>
          )}

          {!loadingList && collections.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <Layers className="h-12 w-12 text-muted-foreground/50" />
              <div>
                <p className="font-medium">No collections yet</p>
                <p className="text-sm text-muted-foreground">
                  Create a collection to group blocks for a specific industry demo.
                </p>
              </div>
            </div>
          )}

          {!loadingList && collections.length > 0 && (
            <div className="space-y-2">
              {collections.map((coll) => (
                <CollectionCard
                  key={coll.slug}
                  coll={coll}
                  onSelect={() => {
                    navigate({
                      to: "/workspace",
                      search: { topic: "", generationId: undefined, collection: coll.slug },
                    });
                  }}
                  onEdit={() => openEdit(coll.slug)}
                  onDelete={() => handleDelete(coll.slug)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collection card with edit/delete actions                          */
/* ------------------------------------------------------------------ */

function CollectionCard({
  coll,
  onSelect,
  onEdit,
  onDelete,
}: {
  coll: CollectionSummary;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="w-full text-left rounded-lg border border-border hover:border-primary/40 hover:bg-muted/30 p-3 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <button className="flex-1 min-w-0 text-left" onClick={onSelect}>
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-xs font-medium truncate">{coll.name}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
            {coll.description}
          </p>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className="text-[10px]">
            {coll.industry}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            title="Edit collection"
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-6 p-0 ${confirmDelete ? "text-destructive px-1.5 w-auto" : "w-6"}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              onDelete();
              setConfirmDelete(false);
            }}
            onBlur={() => setConfirmDelete(false)}
            title="Delete collection"
          >
            {confirmDelete ? (
              <span className="text-[10px] font-medium">Delete?</span>
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span>{coll.block_slugs.length} blocks</span>
        <span className="mx-1">&#183;</span>
        <span>{coll.output_file_count} output files</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Block detail panel                                                */
/* ------------------------------------------------------------------ */

function BlockDetailPanel({
  block,
  onClose,
  onEdit,
  onDelete,
}: {
  block: BlockFull;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteBlock(block.slug);
      onDelete();
    } catch (err) {
      console.error("Failed to delete block:", err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Card className="flex flex-col max-h-[70vh] overflow-hidden">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold leading-tight">
              {block.name}
            </CardTitle>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {block.category}
              </Badge>
              {block.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-muted-foreground"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={onEdit}
              title="Edit block"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 p-0 ${confirmDelete ? "text-destructive px-2 w-auto" : "w-7"}`}
              onClick={handleDelete}
              disabled={deleting}
              title="Delete block"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : confirmDelete ? (
                <span className="text-xs font-medium">Confirm?</span>
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => {
                setConfirmDelete(false);
                onClose();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {block.description}
        </p>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto pt-0">
        <Prose compact>{block.content}</Prose>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Blocks tab content                                                */
/* ------------------------------------------------------------------ */

function BlocksTab() {
  const [selectedBlock, setSelectedBlock] = useState<BlockFull | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [formInitial, setFormInitial] = useState<BlockFormData>(emptyBlockForm());
  const [saving, setSaving] = useState(false);
  // Bump to force BlockPicker to refetch after mutations
  const [refreshKey, setRefreshKey] = useState(0);

  async function handleBlockClick(slug: string) {
    if (formMode) return; // don't switch while form is open
    if (selectedBlock?.slug === slug) {
      setSelectedBlock(null);
      return;
    }
    setLoadingSlug(slug);
    try {
      const block = await getBlock(slug);
      setSelectedBlock(block);
    } catch (err) {
      console.error("Failed to load block details:", err);
    } finally {
      setLoadingSlug(null);
    }
  }

  function openCreate() {
    setSelectedBlock(null);
    setFormInitial(emptyBlockForm());
    setFormMode("create");
  }

  function openEdit() {
    if (!selectedBlock) return;
    setFormInitial(blockToForm(selectedBlock));
    setFormMode("edit");
  }

  function closeForm() {
    setFormMode(null);
  }

  async function handleSave(data: BlockFormData) {
    setSaving(true);
    try {
      const payload = {
        slug: data.slug,
        name: data.name,
        category: data.category,
        tags: data.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        description: data.description,
        content: data.content,
        related: [] as string[],
      };

      let saved: BlockFull;
      if (formMode === "edit" && selectedBlock) {
        saved = await updateBlock(selectedBlock.slug, payload);
      } else {
        saved = await createBlock(payload);
      }
      setSelectedBlock(saved);
      setFormMode(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to save block:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleDeleted() {
    setSelectedBlock(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      {/* Header with New Block button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Reusable instruction blocks that can be composed into collections.
          Click a block to view its full content.
        </p>
        {!formMode && (
          <Button size="sm" className="gap-1.5 shrink-0 ml-4" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New Block
          </Button>
        )}
      </div>

      {/* Inline form for create / edit */}
      {formMode && (
        <BlockForm
          initial={formInitial}
          onSave={handleSave}
          onCancel={closeForm}
          saving={saving}
        />
      )}

      {/* Two-column layout: picker + detail */}
      {!formMode && (
        <div className="grid gap-6 lg:grid-cols-[minmax(300px,1fr)_2fr]">
          <div>
            <BlockPicker
              key={refreshKey}
              selectedSlugs={selectedBlock ? [selectedBlock.slug] : []}
              onToggle={handleBlockClick}
            />
          </div>

          <div>
            {loadingSlug && (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading block...
              </div>
            )}

            {!loadingSlug && selectedBlock && (
              <BlockDetailPanel
                block={selectedBlock}
                onClose={() => setSelectedBlock(null)}
                onEdit={openEdit}
                onDelete={handleDeleted}
              />
            )}

            {!loadingSlug && !selectedBlock && (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <Blocks className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No block selected</p>
                <p className="text-xs mt-1">
                  Click a block on the left to view its details and content.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                         */
/* ------------------------------------------------------------------ */

function LibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [forking, setForking] = useState<number | null>(null);

  const forkMutation = useForkLibraryPackage({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: listGenerationsKey() });
        navigate({
          to: "/workspace",
          search: { topic: "", generationId: result.data.id, collection: "" },
        });
      },
      onSettled: () => setForking(null),
    },
  });

  function handleFork(id: number) {
    setForking(id);
    forkMutation.mutate({ params: { package_id: id } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Template Library</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vetted demo packages ready to use. Fork one as a starting point and
          customize it for your customer.
        </p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" className="gap-1.5">
            <Library className="h-3.5 w-3.5" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="collections" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Collections
          </TabsTrigger>
          <TabsTrigger value="blocks" className="gap-1.5">
            <Blocks className="h-3.5 w-3.5" />
            Blocks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          <TemplatesTab onFork={handleFork} forking={forking} />
        </TabsContent>

        <TabsContent value="collections">
          <CollectionsTab />
        </TabsContent>

        <TabsContent value="blocks">
          <BlocksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
