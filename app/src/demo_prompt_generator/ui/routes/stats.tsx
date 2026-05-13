/**
 * /stats — usage dashboard.
 *
 * Renders KPI tiles, a per-day projects-created bar chart, a stage breakdown,
 * top contributors, and a paginated project table. Backed by GET /api/stats.
 * No external chart library — a simple SVG renders the bars to keep the
 * bundle lean.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/layout/app-layout";
import {
  getStats,
  type Stats,
  type StatsDayCount,
} from "@/lib/custom-api";
import {
  Activity,
  BarChart3,
  Loader2,
  Users,
  FolderOpen,
  Zap,
  MessageSquare,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function StatsWithLayout() {
  return <AppLayout><StatsPage /></AppLayout>;
}

export const Route = createFileRoute("/stats")({
  component: StatsWithLayout,
});

const WINDOW_OPTIONS = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6mo" },
];

const DEFAULT_WINDOW = 180;
const PAGE_SIZE = 25;

function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(DEFAULT_WINDOW);
  const [page, setPage] = useState(1);
  const [ownerInput, setOwnerInput] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStats({ days, page, page_size: PAGE_SIZE, owner_filter: ownerFilter || undefined })
      .then((s) => {
        if (!cancelled) {
          setStats(s);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [days, page, ownerFilter]);

  const applyOwnerFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setOwnerFilter(ownerInput.trim());
  };

  if (loading && !stats) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-6 text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage stats</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aggregate project + agent activity across all users.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-muted/30 p-0.5">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                days === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={FolderOpen} label="Projects" value={stats.total_projects} />
        <Kpi icon={Users} label="Unique users" value={stats.total_users} />
        <Kpi icon={MessageSquare} label="Messages" value={stats.total_messages} />
        <Kpi icon={Zap} label="New (7d)" value={stats.projects_last_7d} />
        <Kpi icon={Activity} label="New (30d)" value={stats.projects_last_30d} />
        <Kpi
          icon={BarChart3}
          label="Live runs"
          value={stats.active_executions}
          accent={stats.active_executions > 0}
        />
      </div>

      {/* Bar charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <DayBarChart
          title={`Projects created · last ${days}d`}
          data={stats.projects_per_day}
          color="var(--primary)"
          days={days}
        />
        <DayBarChart
          title={`Messages · last ${days}d`}
          data={stats.messages_per_day}
          color="var(--chart-2)"
          days={days}
        />
      </div>

      {/* Stage + top owners side by side */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Stage distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.by_stage.map((s) => {
              const max = Math.max(...stats.by_stage.map((x) => x.count), 1);
              const pct = (s.count / max) * 100;
              return (
                <div key={s.stage} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{s.stage}</span>
                    <span className="text-muted-foreground">{s.count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Top contributors{" "}
              <span className="text-muted-foreground font-normal">
                (top {stats.top_owners.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {stats.top_owners.map((o) => (
                <div
                  key={o.user_email}
                  className="flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-muted/50"
                >
                  <span className="truncate font-medium">{o.user_email}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                    {o.project_count} project{o.project_count === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
              {stats.top_owners.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No data yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects table */}
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm">Projects</CardTitle>
            <form onSubmit={applyOwnerFilter} className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={ownerInput}
                  onChange={(e) => setOwnerInput(e.target.value)}
                  placeholder="Filter by owner email…"
                  className="pl-8 h-8 w-64 text-xs"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="h-8">
                Filter
              </Button>
              {ownerFilter && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => {
                    setOwnerInput("");
                    setOwnerFilter("");
                    setPage(1);
                  }}
                >
                  Clear
                </Button>
              )}
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <Th>Name</Th>
                  <Th>Owner</Th>
                  <Th>Stage</Th>
                  <Th className="text-right">Messages</Th>
                  <Th>Template</Th>
                  <Th>Created</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {stats.projects.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                    <Td>
                      <Link
                        to="/project/$projectId"
                        params={{ projectId: p.id }}
                        className="font-medium hover:underline truncate block max-w-[280px]"
                      >
                        {p.name}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground truncate max-w-[220px]">
                      {p.user_email}
                    </Td>
                    <Td>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {p.stage}
                      </Badge>
                      {p.has_active_execution && (
                        <span
                          className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"
                          title="Currently running"
                        />
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">{p.message_count}</Td>
                    <Td className="text-muted-foreground">
                      {p.source_template_id ? (
                        <span title={p.source_template_id}>forked</span>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </Td>
                    <Td className="text-muted-foreground whitespace-nowrap">
                      {fmtDate(p.created_at)}
                    </Td>
                    <Td className="text-muted-foreground whitespace-nowrap">
                      {fmtRelative(p.updated_at)}
                    </Td>
                  </tr>
                ))}
                {stats.projects.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No projects match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {stats.total_pages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Page {stats.page} of {stats.total_pages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page >= stats.total_pages || loading}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Kpi({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div
          className={`mt-1.5 text-2xl font-semibold tabular-nums ${
            accent ? "text-green-600" : ""
          }`}
        >
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function DayBarChart({
  title,
  data,
  color,
  days,
}: {
  title: string;
  data: StatsDayCount[];
  color: string;
  days: number;
}) {
  // Dense series so missing days render as zero bars and the x-axis stays
  // aligned to "last N days" regardless of which days had activity.
  const dense = useMemo(() => fillDays(data, days), [data, days]);

  // For longer windows, thin out the x-axis labels so they don't overlap.
  // ~10 labels along the axis works for any window size.
  const labelInterval = Math.max(0, Math.floor(dense.length / 10) - 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dense} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
              <XAxis
                dataKey="date"
                interval={labelInterval}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickFormatter={fmtDate}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                  padding: "4px 8px",
                }}
                labelFormatter={(v) => v as string}
              />
              <Bar dataKey="count" fill={color} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left font-medium px-3 py-2 ${className}`}>{children}</th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillDays(data: StatsDayCount[], days: number): StatsDayCount[] {
  // The backend's date_trunc('day', created_at) emits UTC day buckets, so we
  // generate the dense series in UTC too — otherwise a non-UTC client (e.g.
  // CEST = UTC+2) keys local midnight as the *previous* UTC day, every
  // lookup misses, and every bar renders as zero.
  const byDate = new Map(data.map((d) => [d.date, d.count]));
  const out: StatsDayCount[] = [];
  const now = new Date();
  // UTC midnight of today, expressed as an epoch ms.
  const todayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayUtcMs - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDate.get(key) ?? 0 });
  }
  return out;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}
