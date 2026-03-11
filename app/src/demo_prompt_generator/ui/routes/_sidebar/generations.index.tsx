import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Plus,
  FileText,
  PackageCheck,
  FileEdit,
  Loader2,
} from "lucide-react";
import { useListGenerations } from "@/lib/api";
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
  package: {
    label: "Package",
    icon: PackageCheck,
    className: "border-emerald-500/30 text-emerald-600 bg-emerald-500/10",
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

function GenerationsPage() {
  const { data, isLoading, error } = useListGenerations({
    query: selector<import("@/lib/api").GenerationListItem[]>().query,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Past Generations</h1>
        <Button asChild>
          <Link to="/">
            <Plus className="mr-2 h-4 w-4" /> New Skill
          </Link>
        </Button>
      </div>

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

      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((gen) => (
            <Link
              key={gen.id}
              to="/generations/$id"
              params={{ id: String(gen.id) }}
            >
              <Card className="transition-all hover:bg-muted/50 hover:border-primary/20 hover:shadow-sm">
                <CardHeader className="py-3 pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm font-medium truncate">
                      {gen.demo_name}
                    </CardTitle>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StageBadge stage={gen.stage} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3 pt-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
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
          ))}
        </div>
      )}
    </div>
  );
}
