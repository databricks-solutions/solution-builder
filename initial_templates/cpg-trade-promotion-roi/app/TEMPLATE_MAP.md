# App Template Map — Trade Promo Copilot

Reference for agents customizing this app. It is a fork of the Solution Builder app template; the
structural plumbing (OBO auth + SP fallback, SSE agent streaming, MLflow tracing, Drizzle migrations on
boot, Delta → Lakebase sync + reset) is unchanged. Domain code:

## Canonical demo arc
1. **Promo calendar** opens on next quarter's draft plan: 26 events, 4 ValuMax BOGO events flagged red.
2. The user clicks "Which events will lose money?" → the copilot calls `get_promo_calendar` +
   `get_post_event_analysis` → 4 money-losing BOGOs, with the evidence (pantry loading, cannibalization,
   forward buying on off-invoice funding, subsidised baseline).
3. "Re-plan them" → `get_replan_options` + `ask_trade_policy` (ValuMax JBP: 6 events/quarter, scan-down for
   Feature + Display) → before/after table, then STOPS for approval.
4. "Approved" → `approve_replan` → one Lakebase transaction per event (`applyReplan`), the calendar
   re-colors live, `/decisions` shows the log with the retailer notices.

## Surfaces
| Surface | File(s) | Structural vs domain |
|---|---|---|
| Promo calendar + drawer + waterfall | `client/src/planner/*` | domain |
| Post-event analysis + curve chart | `client/src/events/*` | domain |
| Approved re-plans | `client/src/decisions/*` | domain |
| Dashboard iframe | `client/src/dashboard/DashboardView.tsx` | structural (set `dashboardId`) |
| Chat dock / views / thinking panel | `client/src/chat/*` | structural (script in `config/app.json`) |
| Shell (sidebar, header, reset) | `client/src/shell/*` | structural |

## Server
| File | Role |
|---|---|
| `server/agent/promoplanner.ts` | tools + instructions (domain); `configureAgentsSdk` fetch shim (structural) |
| `server/db/schema.ts` | chat tables (structural) + `promo_events`, `plan_events`, `plan_scenarios`, `plan_decisions` |
| `server/db/sync.ts` | gold → Lakebase mirror; `wipeMirroredTables` for "Reset the demo" |
| `server/db/queries/promo.ts` | plan / events / summary queries + `applyReplan` / `revertEvent` write-back |
| `server/routes/promo.ts` | REST for the UI |

The forecast numbers are NOT computed in the app: they come from `gold_plan_scenarios` (ML baseline ×
historical response, `src/gold/build_gold.py`). The app only moves an event between precomputed scenarios.
