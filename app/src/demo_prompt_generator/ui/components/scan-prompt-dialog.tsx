// "Create an architecture from an existing project": the prompt a user gives their own agent
// (one that can run the Databricks CLI in the workspace) to explore a project read-only and
// write the brief Solution Builder draws from. The text is served by the backend
// (GET /api/architecture/scan-prompt), the same one the MCP guide points to.
import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiUrl } from "@/lib/config";

type Detail = "high" | "detailed";

export function ScanPromptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [workspace, setWorkspace] = useState("");
  const [start, setStart] = useState("");
  const [detail, setDetail] = useState<Detail>("high");
  const [state, setState] = useState<"idle" | "loading" | "copied" | "error">("idle");

  // The workspace is in any resource URL: fill it from there when left empty.
  const workspaceOf = (url: string) => {
    try { const u = new URL(url); const o = u.searchParams.get("o"); return `${u.origin}/${o ? `?o=${o}` : ""}`; } catch { return ""; }
  };

  const copy = async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ detail });
      const ws = workspace.trim() || workspaceOf(start.trim());
      if (ws) params.set("workspace", ws);
      if (start.trim()) params.set("start", start.trim());
      const res = await fetch(apiUrl(`/api/architecture/scan-prompt?${params}`));
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Architecture from an existing project</DialogTitle>
          <DialogDescription>
            Copy a prompt for an agent that can run the Databricks CLI in the workspace (Claude Code,
            Cursor…). It explores the project read-only (lineage, jobs, dashboards, apps) and creates the
            diagram here through the Solution Builder MCP, every node linked to its resource. The agent
            needs the Solution Builder MCP connected (the `solution_builder` tool); the prompt stops at once if it isn't.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="scan-start">Start from</Label>
            <Input id="scan-start" value={start} onChange={(e) => setStart(e.target.value)}
              placeholder="A pipeline, job, dashboard, app or table: its URL or name" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scan-ws">Workspace <span className="font-normal text-muted-foreground">(taken from the URL if empty)</span></Label>
            <Input id="scan-ws" value={workspace} onChange={(e) => setWorkspace(e.target.value)}
              placeholder="https://<workspace>.cloud.databricks.com" />
          </div>
          <div className="space-y-1">
            <Label>Level of detail</Label>
            <RadioGroup value={detail} onValueChange={(v) => setDetail(v as Detail)} className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="high" /> High level
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="detailed" /> Detailed (every table)
              </label>
            </RadioGroup>
          </div>
          <button
            type="button"
            onClick={copy}
            disabled={state === "loading"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {state === "copied" ? "Copied" : state === "error" ? "Couldn't copy, try again" : "Copy the prompt"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
