/**
 * /internal — live runtime metrics for the single app replica.
 *
 * Polls /api/internal/metrics (in-process MetricsRegistry): current gauges,
 * monotonic counters since process start, and a bounded time-series history it
 * plots. Built to make a memory OOM / "things stack up" leak VISIBLE — watch RSS
 * and the live-session / stream / preview / collab-room counts climb over time.
 *
 * In-memory only (single replica). The SAME numbers are also exported to
 * OpenTelemetry (when the Apps observability option is on) → the app's
 * `otel_metrics` UC table — see the "Access in the OTEL table" section at the
 * bottom of the page.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppLayout } from "@/components/layout/app-layout";
import { ChevronDown } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getInternalMetrics, getActiveSessions, type InternalMetrics, type InternalMetricsSample, type ActiveSession } from "@/lib/custom-api";

export const Route = createFileRoute("/internal")({
  component: InternalPage,
});

const POLL_MS = 10_000;

/** Format a unix-seconds sample time as HH:MM:SS for the chart axis. */
function hms(t: number): string {
  const d = new Date(t * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle && <p className="text-xs font-normal text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

/** Compact duration: 45s, 12m, 3h 4m. */
function fmtDur(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function InternalPage() {
  const [data, setData] = useState<InternalMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Admin-only active-sessions list. Non-admins get {is_admin:false} (the API
  // 403s and the client maps that to an empty, hidden section).
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    let forbidden = false;
    // Hidden tabs don't poll; becoming visible refreshes once.
    const load = () => {
      if (forbidden || document.visibilityState === "hidden") return;
      getInternalMetrics()
        .then((d) => { if (alive) { setData(d); setError(null); } })
        .catch((e) => {
          if (!alive) return;
          // Admin-only endpoint: say so and stop polling it, rather than
          // showing a raw error every 10 s.
          if ((e as { status?: number }).status === 403) {
            forbidden = true;
            setError("Runtime metrics are for admins only.");
            return;
          }
          setError(String(e));
        });
      getActiveSessions()
        .then((r) => { if (alive) { setIsAdmin(r.is_admin); setSessions(r.sessions); } })
        .catch(() => { /* non-fatal: section just doesn't render */ });
    };
    const onVisibility = () => { if (document.visibilityState === "visible") load(); };
    load();
    timer.current = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // Build the chart series from history. We keep ~3 days server-side (up to
  // ~8640 points); downsample to at most MAX_POINTS so the charts stay smooth
  // (nth-point pick — cheap, preserves the trend; the KPI tiles show exact live
  // values, so the chart only needs shape). Always keep the last point (now).
  const MAX_POINTS = 600;
  const series = useMemo(() => {
    const h = data?.history ?? [];
    const step = Math.max(1, Math.ceil(h.length / MAX_POINTS));
    const picked = step === 1 ? h : h.filter((_, i) => i % step === 0 || i === h.length - 1);
    return picked.map((s: InternalMetricsSample) => ({ ...s, ts: hms(s.t) }));
  }, [data]);

  const g = data?.gauges;
  const counters = data?.counters ?? {};

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Runtime metrics</h1>
            <p className="text-sm text-muted-foreground">
              Live in-process state of this replica — refreshes every {POLL_MS / 1000}s.
              {g && <> Uptime {fmtUptime(g.uptime_s)}.</>}
            </p>
          </div>
        </div>

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        {!data && !error && <div className="text-sm text-muted-foreground">Loading…</div>}

        {g && (
          <>
            {/* KPI tiles — the leak-relevant live gauges. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile
                label="Container memory"
                value={g.cgroup_used_mb != null ? `${g.cgroup_used_mb} MB` : (g.total_rss_mb != null ? `${g.total_rss_mb} MB*` : "—")}
                sub={g.cgroup_limit_mb != null ? `of ${g.cgroup_limit_mb} MB (${g.cgroup_percent ?? "?"}%)` : (g.cgroup_used_mb == null ? "cgroup n/a — summed RSS*" : undefined)}
              />
              <Tile label="App process" value={g.main_rss_mb != null ? `${g.main_rss_mb} MB` : "—"} sub="uvicorn RSS" />
              <Tile label="Children" value={g.children ?? "—"} sub={g.children_rss_mb != null ? `${g.children_rss_mb} MB total` : undefined} />
              <Tile label="Agent sessions" value={g.agent_sessions ?? "—"} sub={g.claude_rss_mb != null ? `${g.claude_rss_mb} MB` : (g.agent_sessions_busy != null ? `${g.agent_sessions_busy} busy` : undefined)} />
              <Tile label="Previews" value={g.preview_running ?? g.preview_states ?? "—"} sub={g.preview_rss_mb != null ? `${g.preview_rss_mb} MB` : undefined} />
              <Tile label="Collab rooms" value={g.collab_rooms ?? "—"} sub={g.collab_members != null ? `${g.collab_members} members` : undefined} />
            </div>

            {/* Wedge-diagnosis tiles: the app periodically goes RUNNING-but-not-
                serving (auto-restarted by the monitor). These make the suspected
                cause visible — a saturated threadpool, a drained DB pool, or a
                blocked event loop. A red-ish value here during a "down" window
                pinpoints which one. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
              <Tile
                label="Threadpool"
                value={g.threadpool_borrowed != null ? `${g.threadpool_borrowed} / ${g.threadpool_total ?? "?"}` : "—"}
                sub={g.threadpool_waiting != null && g.threadpool_waiting > 0 ? `⚠ ${g.threadpool_waiting} waiting` : "borrowed / total"}
              />
              <Tile
                label="DB pool"
                value={g.db_pool_checked_out != null ? `${g.db_pool_checked_out} / ${(g.db_pool_size ?? 0) + (g.db_pool_overflow ?? 0)}` : "—"}
                sub="checked out / max"
              />
              <Tile
                label="Event-loop lag"
                value={g.loop_lag_ms != null ? `${g.loop_lag_ms} ms` : "—"}
                sub={g.loop_lag_ms != null && g.loop_lag_ms > 500 ? "⚠ loop blocked" : "≈0 when healthy"}
              />
            </div>

            {/* Time series. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard
                title="Memory by process group (MB)"
                subtitle="The container runs the app process PLUS a separate subprocess per Claude Code session and per live preview app, plus the Playwright Chromium the brand service spawns for website screenshots. Stacked = summed RSS of each group (main + agent sessions + previews + browser + other children). The dashed line is the real container usage (cgroup), which the OOM-killer enforces; the limit is shown when available."
              >
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="ts" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} width={44} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area stackId="mem" type="monotone" dataKey="main_rss_mb" name="app" stroke="#2563eb" fill="#2563eb" fillOpacity={0.5} isAnimationActive={false} />
                  <Area stackId="mem" type="monotone" dataKey="claude_rss_mb" name="agent sessions" stroke="#dc2626" fill="#dc2626" fillOpacity={0.5} isAnimationActive={false} />
                  <Area stackId="mem" type="monotone" dataKey="preview_rss_mb" name="previews" stroke="#9333ea" fill="#9333ea" fillOpacity={0.5} isAnimationActive={false} />
                  <Area stackId="mem" type="monotone" dataKey="browser_rss_mb" name="browser (screenshots)" stroke="#d97706" fill="#d97706" fillOpacity={0.5} isAnimationActive={false} />
                  <Area stackId="mem" type="monotone" dataKey="other_rss_mb" name="other children" stroke="#64748b" fill="#64748b" fillOpacity={0.4} isAnimationActive={false} />
                  {/* Authoritative container total (not stacked) — the OOM signal. */}
                  <Line type="monotone" dataKey="cgroup_used_mb" name="container (cgroup)" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ChartCard>

              <ChartCard title="Live sessions / streams / previews / rooms">
                <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="ts" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} width={30} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="agent_sessions" name="agent" stroke="#dc2626" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="live_streams" name="streams" stroke="#16a34a" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="preview_running" name="previews" stroke="#9333ea" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="collab_rooms" name="rooms" stroke="#ea580c" dot={false} isAnimationActive={false} />
                </LineChart>
              </ChartCard>

              <ChartCard
                title="Concurrency saturation (wedge watch)"
                subtitle="When the app goes RUNNING-but-not-serving, look here. threadpool borrowed hitting total (with 'waiting' > 0) = every sync request is queued; DB checked-out hitting max = DB calls blocking; loop lag (right axis, ms) spiking to seconds = a coroutine is blocking the single event loop. Whichever line pegs during a freeze is the cause."
              >
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="ts" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={30} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={44} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="left" type="monotone" dataKey="threadpool_borrowed" name="threadpool used" stroke="#dc2626" dot={false} isAnimationActive={false} />
                  <Line yAxisId="left" type="monotone" dataKey="threadpool_waiting" name="threadpool waiting" stroke="#b91c1c" strokeDasharray="4 2" dot={false} isAnimationActive={false} />
                  <Line yAxisId="left" type="monotone" dataKey="db_pool_checked_out" name="db checked-out" stroke="#2563eb" dot={false} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="loop_lag_ms" name="loop lag (ms)" stroke="#ea580c" strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ChartCard>
            </div>

            {/* Counters — monotonic totals since process start. */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Counters (since process start)</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(counters).length === 0 ? (
                  <div className="text-sm text-muted-foreground">No counters recorded yet.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
                    {Object.entries(counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between border-b border-muted/50 py-1 text-sm">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-medium tabular-nums">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active Claude sessions — ADMIN ONLY. Each pooled ClaudeSDKClient
                (Node subprocess) = one project holding a live agent session.
                Hidden for non-admins (the API 403s → is_admin=false). */}
            {isAdmin && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Active Claude sessions
                    <span className="ml-2 font-normal text-muted-foreground">
                      {sessions.length} project{sessions.length === 1 ? "" : "s"}
                      {sessions.some((s) => s.has_live_stream) && (
                        <> · {sessions.filter((s) => s.has_live_stream).length} with a turn in flight</>
                      )}
                    </span>
                  </CardTitle>
                  <p className="text-xs font-normal text-muted-foreground">
                    Projects currently holding a pooled agent session (one Node subprocess each). Admin-only. Click to open the project.
                  </p>
                </CardHeader>
                <CardContent>
                  {sessions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No active sessions right now.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="py-1.5 pr-4 text-left font-medium">Project</th>
                            <th className="py-1.5 pr-4 text-left font-medium">Owner</th>
                            <th className="py-1.5 pr-4 text-left font-medium">Status</th>
                            <th className="py-1.5 pr-4 text-right font-medium">Idle</th>
                            <th className="py-1.5 text-right font-medium">Session age</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-muted/50">
                          {sessions.map((s) => (
                            <tr key={s.project_id} className="hover:bg-muted/40">
                              <td className="py-1.5 pr-4">
                                <a
                                  href={s.project_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-primary hover:underline"
                                  title={s.project_id}
                                >
                                  {s.project_name ?? s.project_id}
                                </a>
                              </td>
                              <td className="py-1.5 pr-4 text-muted-foreground">{s.owner_email ?? "—"}</td>
                              <td className="py-1.5 pr-4">
                                {s.has_live_stream ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" /> turn in flight
                                  </span>
                                ) : s.is_busy ? (
                                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">busy</span>
                                ) : (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">idle</span>
                                )}
                              </td>
                              <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                                {s.has_live_stream || s.is_busy ? "—" : fmtDur(s.idle_seconds)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtDur(s.age_seconds)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* How to reach the same numbers in the OTEL / system table.
                Collapsed by default (native <details>) — reference material, not
                something you need on every visit. */}
            <Card>
              <CardContent className="p-0">
                <details className="group">
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium select-none">
                    <span>Metrics reference &amp; access in the OTEL table</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-4 border-t px-4 py-4 text-sm text-muted-foreground">
                    <p>
                      These are live in-memory numbers for the current replica (single-process app,
                      so one replica is the whole app). When the app is deployed with the Databricks{" "}
                      <strong>Observability</strong> option enabled, the exact same gauges and
                      counters are also exported to OpenTelemetry and land in the app&rsquo;s{" "}
                      <code className="rounded bg-muted px-1 py-0.5">otel_metrics</code> Unity Catalog
                      table (the catalog/schema you configured for observability), so you can chart
                      the trend over the full history — not just the ~3 days kept in memory.
                    </p>

                    <div>
                      <p className="font-medium text-foreground">Exported metrics (3)</p>
                      <p className="mt-0.5">Each carries one attribute you filter/pivot on:</p>
                      <ul className="ml-4 mt-1 list-disc space-y-1">
                        <li><code className="rounded bg-muted px-1 py-0.5">solution_builder.memory_mb</code> (gauge, MB) — memory by process group, attribute <code>group</code>.</li>
                        <li><code className="rounded bg-muted px-1 py-0.5">solution_builder.resources</code> (gauge, count) — live in-process resource counts, attribute <code>metric</code>.</li>
                        <li><code className="rounded bg-muted px-1 py-0.5">solution_builder.events_total</code> (counter, monotonic since process start) — lifetime event totals, attribute <code>counter</code>.</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-medium text-foreground"><code>solution_builder.memory_mb</code> — <code>group</code> values</p>
                      <ul className="ml-4 mt-1 list-disc space-y-1">
                        <li><code>main_rss_mb</code> — the uvicorn app process RSS.</li>
                        <li><code>claude_rss_mb</code> — summed RSS of all Claude Code agent-session subprocesses (Node, one per active project session).</li>
                        <li><code>preview_rss_mb</code> — summed RSS of all live preview-app subprocesses (npm/vite/tsx/esbuild trees under a project&rsquo;s <code>app/</code>).</li>
                        <li><code>browser_rss_mb</code> — summed RSS of the Playwright Chromium/headless-shell processes the brand service spawns for website screenshots (heavy + bursty, so tracked separately).</li>
                        <li><code>other_rss_mb</code> — summed RSS of any other descendant processes (databricks CLI, git, uv, bash the agent shells out to).</li>
                        <li><code>children_rss_mb</code> — claude + preview + other (all descendants).</li>
                        <li><code>total_rss_mb</code> — main + all children (summed RSS; over-counts shared pages, so it&rsquo;s an upper bound).</li>
                        <li><code>cgroup_used_mb</code> — the container&rsquo;s cgroup <code>memory.current</code>: the AUTHORITATIVE memory the OOM-killer enforces (charged, de-duplicated). Absent off a cgroup host (local dev).</li>
                        <li><code>cgroup_limit_mb</code> — the container memory limit (<code>memory.max</code>); absent when unlimited or off-cgroup.</li>
                      </ul>
                      <p className="mt-1 text-xs">(The registry also computes <code>cgroup_percent</code> and host <code>percent</code>; those drive the tiles but aren&rsquo;t exported as their own <code>group</code> series — derive them in SQL from used/limit.)</p>
                    </div>

                    <div>
                      <p className="font-medium text-foreground"><code>solution_builder.resources</code> — <code>metric</code> values</p>
                      <ul className="ml-4 mt-1 list-disc space-y-1">
                        <li><code>agent_sessions</code> — pooled <code>ClaudeSDKClient</code> sessions currently held (one Node subprocess each).</li>
                        <li><code>agent_sessions_busy</code> — of those, how many are mid-turn (<code>is_busy</code>).</li>
                        <li><code>active_streams</code> — SSE streams tracked by the stream manager (incl. terminal ones not yet swept).</li>
                        <li><code>live_streams</code> — of those, still running (not complete/error/cancelled) — a turn in flight.</li>
                        <li><code>preview_states</code> — projects with a preview registry entry (any state).</li>
                        <li><code>preview_running</code> — of those, actually starting/ready (a live <code>start.sh</code> web server).</li>
                        <li><code>collab_rooms</code> — live architecture-canvas collaboration rooms.</li>
                        <li><code>collab_members</code> — total connected members across all rooms.</li>
                        <li><code>children</code> — total descendant process count (the whole subprocess tree).</li>
                        <li><code>threadpool_total</code> / <code>threadpool_borrowed</code> / <code>threadpool_waiting</code> — the anyio threadpool Starlette runs every SYNC endpoint in (default 40). <code>borrowed==total</code> with <code>waiting&gt;0</code> = SATURATED: every sync request is queued and the app looks wedged.</li>
                        <li><code>db_pool_checked_out</code> / <code>db_pool_size</code> / <code>db_pool_overflow</code> — SQLAlchemy connection pool (size 10 + overflow 20 = 30 max, 5s wait). <code>checked_out</code> at the ceiling = DB calls block then error.</li>
                        <li><code>loop_lag_ms</code> — event-loop responsiveness: how far a 1s heartbeat overshoot ran. ≈0 healthy; SECONDS = a coroutine is BLOCKING the single loop (a sync/CPU call awaited on-loop). Separates &ldquo;loop blocked&rdquo; from &ldquo;threadpool/DB exhausted&rdquo; (loop fine, sync work starved).</li>
                      </ul>
                      <p className="mt-1 text-xs">(Process uptime is tracked as <code>uptime_s</code> on the page but isn&rsquo;t exported here — the OTEL row&rsquo;s own <code>time</code> gives you that.)</p>
                    </div>

                    <div>
                      <p className="font-medium text-foreground"><code>solution_builder.events_total</code> — <code>counter</code> values</p>
                      <ul className="ml-4 mt-1 list-disc space-y-1">
                        <li><code>projects_created</code> — projects created since process start.</li>
                        <li><code>agent_turns_started</code> — agent turns started (each user/agent exchange).</li>
                        <li><code>agent_clients_created</code> — new <code>ClaudeSDKClient</code> connections opened (Node subprocess spawns).</li>
                        <li><code>agent_orphans_reaped</code> — agent clients disconnected because their connect failed / turn was abandoned (the OOM-leak backstop firing).</li>
                        <li><code>collab_ws_connects</code> — collaboration WebSocket joins.</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-medium text-foreground">Example query</p>
                      <p className="mt-0.5">Replace the catalog/schema and app name:</p>
                      <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`SELECT time,
       metric_name,
       metric_attributes['group'] AS group,
       value
FROM <catalog>.<schema>.otel_metrics
WHERE service_name = '<app-name>'
  AND metric_name = 'solution_builder.memory_mb'
ORDER BY time DESC
LIMIT 200;`}</pre>
                    </div>

                    <p className="text-xs">
                      The <code>otel_metrics</code> table is only populated once the app has emitted at
                      least one metric with observability enabled. Locally / with telemetry off,
                      export is a no-op and only this in-memory page is available.
                    </p>
                  </div>
                </details>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
