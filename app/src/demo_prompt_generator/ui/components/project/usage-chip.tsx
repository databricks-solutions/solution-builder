/**
 * The chat header's "$" chip: hover → fetch `/api/projects/{id}/usage` and show
 * what the project's agent conversations cost (tokens in / out / cache, per
 * conversation → per agent, per model). Refetched on every open so a running
 * build's cost moves; the previous figures stay visible while it loads.
 */
import { useCallback, useRef, useState } from "react";
import { DollarSign, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { getProjectUsage, type ProjectUsage, type UsageTotals } from "../../lib/custom-api";

const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);

function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

function Cells({ t, bold }: { t: UsageTotals; bold?: boolean }) {
  const cls = `px-1.5 py-0.5 text-right tabular-nums ${bold ? "font-semibold" : ""}`;
  return (
    <>
      <td className={cls}>{tokens(t.input_tokens)}</td>
      <td className={cls}>{tokens(t.output_tokens)}</td>
      <td className={cls}>{tokens(t.cache_write_tokens)}</td>
      <td className={cls}>{tokens(t.cache_read_tokens)}</td>
      <td className={`${cls} text-foreground`}>{usd(t.cost_usd)}</td>
    </>
  );
}

function UsageDetail({ data, refreshing }: { data: ProjectUsage; refreshing: boolean }) {
  if (data.totals.responses === 0) {
    return <p className="text-muted-foreground">No agent usage recorded yet.</p>;
  }
  const unpriced = data.totals.unpriced_responses;
  const estimated = data.models.filter((m) => m.estimated);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-6">
        <span className="flex items-center gap-1.5 font-semibold text-sm">
          {usd(data.totals.cost_usd)}
          {refreshing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </span>
        <span className="text-muted-foreground">
          {data.conversations.length} conversation{data.conversations.length === 1 ? "" : "s"} ·{" "}
          {data.totals.responses.toLocaleString()} model calls
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border/60">
            <th className="px-1.5 py-0.5 text-left font-medium" />
            <th className="px-1.5 py-0.5 text-right font-medium whitespace-nowrap">In</th>
            <th className="px-1.5 py-0.5 text-right font-medium whitespace-nowrap">Out</th>
            <th className="px-1.5 py-0.5 text-right font-medium whitespace-nowrap">Cache write</th>
            <th className="px-1.5 py-0.5 text-right font-medium whitespace-nowrap">Cache read</th>
            <th className="px-1.5 py-0.5 text-right font-medium whitespace-nowrap">Cost</th>
          </tr>
        </thead>
        <tbody className="text-muted-foreground">
          {data.conversations.map((c) => (
            <ConversationRows key={c.session_id} c={c} />
          ))}
          <tr className="border-t border-border/60 text-foreground">
            <td className="px-1.5 py-0.5 font-semibold">Total</td>
            <Cells t={data.totals} bold />
          </tr>
        </tbody>
      </table>
      <div className="space-y-0.5 text-muted-foreground">
        {data.models.map((m) => (
          <div key={m.model} className="flex justify-between gap-4">
            <span className="truncate">
              {m.model}
              {m.estimated && ` (priced as ${m.priced_as})`}
              {!m.priced_as && " (no price)"}
            </span>
            <span className="tabular-nums">{usd(m.totals.cost_usd)}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/80 leading-snug">
        Databricks list prices ($0.07/DBU); discounts not applied.
        {estimated.length > 0 && " Models marked \"priced as\" are estimates (a gateway endpoint or an unlisted version)."}
        {unpriced > 0 && ` ${unpriced} call${unpriced === 1 ? "" : "s"} from unpriced models excluded.`}
      </p>
    </div>
  );
}

function ConversationRows({ c }: { c: ProjectUsage["conversations"][number] }) {
  const when = new Date(c.started_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <>
      <tr className="text-foreground">
        <td className="px-1.5 pt-1.5 pb-0.5 font-medium whitespace-nowrap">{when}</td>
        <Cells t={c.totals} />
      </tr>
      {c.agents.map((a) => (
        <tr key={a.agent}>
          <td className="pl-4 pr-1.5 py-0.5 whitespace-nowrap">
            {a.agent === "main" ? "Main agent" : `${a.agent} ×${a.subagents}`}
          </td>
          <Cells t={a.totals} />
        </tr>
      ))}
    </>
  );
}

export function UsageChip({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    (open: boolean) => {
      if (!open || inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      getProjectUsage(projectId)
        .then(setData)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          inFlight.current = false;
          setLoading(false);
        });
    },
    [projectId],
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip onOpenChange={load}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted transition-all cursor-default"
            aria-label="Agent cost for this project"
          >
            <DollarSign className="h-3 w-3" />
            {data && <span className="tabular-nums">{usd(data.totals.cost_usd).slice(1)}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="bg-popover text-popover-foreground border border-border shadow-md p-3 w-[480px] max-w-[90vw]"
        >
          {loading && !data && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Counting tokens…
            </div>
          )}
          {error && !data && <p className="text-destructive">Couldn't load usage: {error}</p>}
          {data && <UsageDetail data={data} refreshing={loading} />}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
