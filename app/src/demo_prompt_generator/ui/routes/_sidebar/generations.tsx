import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, FileText } from "lucide-react";
import { useListGenerations } from "@/lib/api";
import { selector } from "@/lib/selector";

export const Route = createFileRoute("/_sidebar/generations")({
  component: GenerationsPage,
});

function GenerationsPage() {
  const { data, isLoading, error } = useListGenerations({
    query: selector<import("@/lib/api").GenerationListItem[]>().query,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Past Generations</h1>
        <Button asChild>
          <Link to="/new">
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
              Create your first demo prompt to get started.
            </p>
          </div>
          <Button asChild>
            <Link to="/new">
              <Plus className="mr-2 h-4 w-4" /> Create Demo
            </Link>
          </Button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((gen) => (
            <Link key={gen.id} to="/generations/$id" params={{ id: String(gen.id) }}>
              <Card className="transition-all hover:bg-muted/50 hover:border-primary/20 hover:shadow-sm">
                <CardHeader className="py-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{gen.demo_name}</CardTitle>
                    <Badge variant="secondary">{gen.industry}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pb-4 pt-0">
                  <p className="text-xs text-muted-foreground">
                    {new Date(gen.created_at).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
