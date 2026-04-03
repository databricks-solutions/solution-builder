import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Database,
  Blocks,
  Workflow,
  Globe,
  Search,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  listBlocks,
  type BlockSummary,
} from "@/lib/custom-api";

const CATEGORY_CONFIG: Record<
  string,
  { label: string; icon: typeof Database; color: string }
> = {
  domain: { label: "Domain", icon: Globe, color: "bg-blue-100 text-blue-700" },
  capability: {
    label: "Capability",
    icon: Blocks,
    color: "bg-emerald-100 text-emerald-700",
  },
  pattern: {
    label: "Pattern",
    icon: Workflow,
    color: "bg-violet-100 text-violet-700",
  },
};

interface BlockPickerProps {
  selectedSlugs: string[];
  onToggle: (slug: string) => void;
  compact?: boolean;
}

export function BlockPicker({ selectedSlugs, onToggle, compact }: BlockPickerProps) {
  const [blocks, setBlocks] = useState<BlockSummary[]>([]);
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["domain", "capability", "pattern"]),
  );

  useEffect(() => {
    listBlocks().then(setBlocks).catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return blocks;
    const q = search.toLowerCase();
    return blocks.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.tags.some((t) => t.includes(q)),
    );
  }, [blocks, search]);

  const byCategory = useMemo(() => {
    const map: Record<string, BlockSummary[]> = {};
    for (const b of filtered) {
      (map[b.category] ??= []).push(b);
    }
    return map;
  }, [filtered]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search blocks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      <ScrollArea className={compact ? "h-48" : "h-64"}>
        <div className="space-y-1">
          {["domain", "capability", "pattern"].map((category) => {
            const items = byCategory[category];
            if (!items?.length) return null;
            const config = CATEGORY_CONFIG[category];
            const Icon = config?.icon ?? Database;
            const expanded = expandedCategories.has(category);

            return (
              <div key={category}>
                <button
                  onClick={() => toggleCategory(category)}
                  className="flex items-center gap-1.5 w-full px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <Icon className="h-3 w-3" />
                  {config?.label ?? category} ({items.length})
                </button>

                {expanded && (
                  <div className="ml-3 space-y-0.5">
                    {items.map((block) => {
                      const selected = selectedSlugs.includes(block.slug);
                      return (
                        <button
                          key={block.slug}
                          onClick={() => onToggle(block.slug)}
                          className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-xs transition-colors ${
                            selected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          <span className="flex-1 truncate">{block.name}</span>
                          {selected ? (
                            <X className="h-3 w-3 shrink-0" />
                          ) : (
                            <Plus className="h-3 w-3 shrink-0 opacity-40" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Compact pill display for selected blocks */
export function BlockPills({
  slugs,
  onRemove,
}: {
  slugs: string[];
  onRemove?: (slug: string) => void;
}) {
  if (!slugs.length) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {slugs.map((slug) => {
        // Determine category from slug naming convention
        const cat = slug.match(/^(retail|financial|healthcare|manufacturing)/)
          ? "domain"
          : slug.match(
                /^(anomaly|customer-seg|predictive|compliance|real-time)/,
              )
            ? "pattern"
            : "capability";
        const config = CATEGORY_CONFIG[cat];

        return (
          <Badge
            key={slug}
            variant="secondary"
            className={`text-[10px] px-1.5 py-0 gap-1 ${config?.color ?? ""}`}
          >
            {slug}
            {onRemove && (
              <button
                onClick={() => onRemove(slug)}
                className="hover:opacity-70"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </Badge>
        );
      })}
    </div>
  );
}
