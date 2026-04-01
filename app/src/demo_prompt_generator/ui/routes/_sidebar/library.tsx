import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Download, GitFork, Loader2, PackageCheck } from "lucide-react";
import { useState } from "react";
import {
  useListLibrary,
  useForkLibraryPackage,
  listGenerationsKey,
} from "@/lib/api";
import type { GenerationListItem } from "@/lib/api";
import { selector } from "@/lib/selector";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_sidebar/library")({
  component: LibraryPage,
});

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

function LibraryPage() {
  const { data, isLoading, error } = useListLibrary({
    query: selector<GenerationListItem[]>().query,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [forking, setForking] = useState<number | null>(null);

  const forkMutation = useForkLibraryPackage({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: listGenerationsKey() });
        navigate({
          to: "/workspace",
          search: { topic: "", generationId: result.data.id },
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
              onFork={handleFork}
              forking={forking}
            />
          ))}
        </div>
      )}
    </div>
  );
}
