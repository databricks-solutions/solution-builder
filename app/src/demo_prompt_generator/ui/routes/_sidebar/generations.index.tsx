import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  FileText,
  PackageCheck,
  FileEdit,
  Loader2,
  Upload,
  Search,
  Star,
  Hammer,
  Play,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGenerations,
  listGenerationsKey,
  useToggleGenerationStar,
} from "@/lib/api";
import type { GenerationListItem } from "@/lib/api";
import { selector } from "@/lib/selector";

export const Route = createFileRoute("/_sidebar/generations/")({
  component: GenerationsPage,
});

const STAGE_CONFIG: Record<
  string,
  { label: string; icon: typeof FileText; className: string }
> = {
  proposal: {
    label: "Proposal",
    icon: FileEdit,
    className: "border-amber-500/30 text-amber-600 bg-amber-500/10",
  },
  approved: {
    label: "Approved",
    icon: Loader2,
    className: "border-blue-500/30 text-blue-600 bg-blue-500/10",
  },
  building: {
    label: "Building",
    icon: Hammer,
    className: "border-orange-500/30 text-orange-600 bg-orange-500/10",
  },
  package: {
    label: "Package",
    icon: PackageCheck,
    className: "border-emerald-500/30 text-emerald-600 bg-emerald-500/10",
  },
  executing: {
    label: "Executing",
    icon: Play,
    className: "border-purple-500/30 text-purple-600 bg-purple-500/10",
  },
  built: {
    label: "Built",
    icon: CheckCircle2,
    className: "border-green-500/30 text-green-600 bg-green-500/10",
  },
  execute_error: {
    label: "Error",
    icon: AlertCircle,
    className: "border-red-500/30 text-red-600 bg-red-500/10",
  },
};

function StageBadge({ stage }: { stage: string }) {
  const config = STAGE_CONFIG[stage] || STAGE_CONFIG.package;
  const Icon = config.icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] ${config.className}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function GenerationCard({
  gen,
  onToggleStar,
}: {
  gen: GenerationListItem;
  onToggleStar: (id: number, starred: boolean) => void;
}) {
  return (
    <Link to="/generations/$id" params={{ id: String(gen.id) }}>
      <Card className="transition-all hover:bg-muted/50 hover:border-primary/20 hover:shadow-sm">
        <CardHeader className="py-3 pb-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleStar(gen.id, !gen.is_starred);
                }}
                className="p-1 rounded hover:bg-muted shrink-0"
              >
                <Star
                  className={`h-4 w-4 ${gen.is_starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                />
              </button>
              <CardTitle className="text-sm font-medium truncate">
                {gen.demo_name}
              </CardTitle>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <StageBadge stage={gen.stage ?? "package"} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-3 pt-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {gen.industry}
            </Badge>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {new Date(gen.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function GenerationsPage() {
  const { data, isLoading, error } = useListGenerations({
    query: selector<GenerationListItem[]>().query,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Filter / search state
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alpha">(
    "newest",
  );

  const starMutation = useToggleGenerationStar({
    mutation: {
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey: listGenerationsKey() });
        queryClient.setQueryData(
          listGenerationsKey(),
          (old: { data: GenerationListItem[] } | undefined) => {
            if (!old?.data) return old;
            return {
              data: old.data.map((g) =>
                g.id === vars.params.generation_id
                  ? { ...g, is_starred: vars.data.is_starred }
                  : g,
              ),
            };
          },
        );
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: listGenerationsKey() });
      },
    },
  });

  function handleToggleStar(id: number, starred: boolean) {
    starMutation.mutate({
      params: { generation_id: id },
      data: { is_starred: starred },
    });
  }

  const { starred, unstarred } = useMemo(() => {
    if (!data) return { starred: [], unstarred: [] };
    let items = [...data];

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (g) =>
          g.demo_name.toLowerCase().includes(q) ||
          g.industry.toLowerCase().includes(q),
      );
    }

    if (stageFilter !== "all") {
      items = items.filter((g) => g.stage === stageFilter);
    }

    if (sortBy === "oldest") {
      items.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    } else if (sortBy === "alpha") {
      items.sort((a, b) => a.demo_name.localeCompare(b.demo_name));
    }

    return {
      starred: items.filter((g) => g.is_starred),
      unstarred: items.filter((g) => !g.is_starred),
    };
  }, [data, search, stageFilter, sortBy]);

  const hasFilters = search.trim() !== "" || stageFilter !== "all";
  const totalFiltered = starred.length + unstarred.length;

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/generations/import", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.text();
        let message = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(body);
          message = parsed?.detail || message;
        } catch {
          message = body || message;
        }
        throw new Error(message);
      }
      const gen = await res.json();
      await queryClient.invalidateQueries({ queryKey: listGenerationsKey() });
      navigate({ to: "/generations/$id", params: { id: String(gen.id) } });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Past Generations</h1>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            variant="outline"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Import ZIP
          </Button>
          <Button asChild>
            <Link to="/">
              <Plus className="mr-2 h-4 w-4" /> New Skill
            </Link>
          </Button>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      {data && data.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              <SelectItem value="proposal">Proposal</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="building">Building</SelectItem>
              <SelectItem value="package">Package</SelectItem>
              <SelectItem value="executing">Executing</SelectItem>
              <SelectItem value="built">Built</SelectItem>
              <SelectItem value="execute_error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sortBy}
            onValueChange={(v) =>
              setSortBy(v as "newest" | "oldest" | "alpha")
            }
          >
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="alpha">A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {importError && (
        <p className="text-sm text-destructive">Import failed: {importError}</p>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          Failed to load generations: {error.message}
        </p>
      )}

      {data && data.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No generations yet</p>
            <p className="text-sm text-muted-foreground">
              Create your first demo skill to get started.
            </p>
          </div>
          <Button asChild>
            <Link to="/">
              <Plus className="mr-2 h-4 w-4" /> Create Demo
            </Link>
          </Button>
        </div>
      )}

      {data && data.length > 0 && totalFiltered === 0 && hasFilters && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Search className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No skills match your filters.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setStageFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {/* Starred section */}
      {starred.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-yellow-500 uppercase tracking-wider">
            <Star className="h-3.5 w-3.5 fill-yellow-500" />
            Starred ({starred.length})
          </div>
          <div className="space-y-2 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.03] p-2">
            {starred.map((gen) => (
              <GenerationCard
                key={gen.id}
                gen={gen}
                onToggleStar={handleToggleStar}
              />
            ))}
          </div>
        </div>
      )}

      {/* All others */}
      {unstarred.length > 0 && (
        <div className="space-y-2">
          {starred.length > 0 && (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              All others ({unstarred.length})
            </div>
          )}
          <div className="space-y-2">
            {unstarred.map((gen) => (
              <GenerationCard
                key={gen.id}
                gen={gen}
                onToggleStar={handleToggleStar}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
