import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/apx/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import { ProjectTile } from "@/components/project/project-tile";
import {
  Sparkles,
  ArrowRight,
  Search,
  Lightbulb,
  FolderPlus,
} from "lucide-react";
import {
  listProjects,
  createProject,
  type ProjectListItem,
} from "@/lib/custom-api";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [topic, setTopic] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  // Load projects on mount
  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  // Create new project and navigate
  const handleCreateProject = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = topic.trim() || "Untitled Project";
    if (isCreating) return;

    setIsCreating(true);
    try {
      const project = await createProject(name, `Generated from: ${name}`);
      navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    } catch (error) {
      console.error("Failed to create project:", error);
      setIsCreating(false);
    }
  };

  // Open existing project
  const handleOpenProject = (projectId: string) => {
    navigate({ to: "/project/$projectId", params: { projectId } });
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Navbar />
      <main className="flex flex-1 flex-col items-center px-4 pt-12 pb-20">
        <BubbleBackground
          interactive
          className="!absolute inset-0 -z-10 opacity-30"
          colors={{
            first: "255,54,33",
            second: "255,120,80",
            third: "255,85,50",
            fourth: "200,40,25",
            fifth: "255,160,100",
            sixth: "255,100,60",
          }}
        />

        {/* Hero */}
        <div className="relative z-10 mx-auto max-w-4xl space-y-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm border border-primary/20">
              <img src="/logo.svg" alt="Databricks" className="h-10 w-10" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Databricks
              </p>
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                Asset Generator
              </h1>
            </div>
            <p className="mx-auto max-w-xl text-base text-muted-foreground leading-relaxed">
              Describe a use-case and the AI architect builds a complete demo
              package with datasets, pipelines, dashboards, and build steps.
            </p>
          </div>

          {/* Input card */}
          <Card className="mx-auto w-full max-w-2xl text-left backdrop-blur-md bg-card/80 border-primary/10 shadow-lg shadow-primary/5">
            <CardContent className="p-4">
              <form onSubmit={handleCreateProject} className="space-y-2.5">
                <Input
                  placeholder='Describe your project... e.g. "predictive maintenance for wind turbines"'
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="h-12 text-base bg-background/60"
                  autoFocus
                />
                <div className="flex items-center justify-end">
                  <Button
                    type="submit"
                    disabled={isCreating}
                    className="gap-2 px-5"
                  >
                    {isCreating ? (
                      <>Creating...</>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Build Asset
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Research agent callout */}
          <div className="mx-auto max-w-2xl">
            <div className="rounded-xl border border-primary/10 bg-primary/[0.03] backdrop-blur-sm px-4 py-3 text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Search className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Tailoring for a specific customer?
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    Before building a demo, ask a research agent (Claude,
                    Genie, Glean) to summarize the customer's industry, current
                    tech stack, pain points, and Databricks usage. Paste that
                    context into the input above for a proposal that speaks
                    directly to their world.
                  </p>
                </div>
              </div>
              <div className="mt-2.5 ml-11 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Lightbulb className="h-3 w-3 text-primary/60" />
                  <span className="font-medium text-foreground/70">
                    Example prompt:
                  </span>
                </span>
                <button
                  onClick={() =>
                    setTopic(
                      "Build a demo for Acme Corp (Fortune 500 retailer, heavy on Snowflake today, interested in real-time ML). They struggle with demand forecasting accuracy across 2,000+ stores."
                    )
                  }
                  className="italic hover:text-foreground transition-colors cursor-pointer underline underline-offset-2 decoration-primary/20 hover:decoration-primary/40"
                >
                  "Build a demo for Acme Corp, a Fortune 500 retailer struggling
                  with demand forecasting across 2,000+ stores..."
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Projects grid */}
        {projects.length > 0 && (
          <div className="relative z-10 mx-auto mt-12 w-full max-w-5xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Your Projects
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Continue working on existing projects
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => handleCreateProject()}
              >
                <FolderPlus className="h-3 w-3" />
                New Project
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <ProjectTile
                  key={project.id}
                  project={project}
                  onClick={() => handleOpenProject(project.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {projects.length === 0 && (
          <div className="relative z-10 mx-auto mt-12 text-center">
            <p className="text-sm text-muted-foreground">
              No projects yet. Create your first project above!
            </p>
          </div>
        )}

        <div className="h-12" />
      </main>
      <div className="absolute inset-0 -z-20 h-full w-full bg-background" />
    </div>
  );
}
