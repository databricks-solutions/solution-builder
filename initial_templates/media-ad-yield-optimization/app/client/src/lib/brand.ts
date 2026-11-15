/**
 * Brand palette — TS mirror of the 5 brand stops defined in index.css
 * (--brand-1 .. --brand-5).
 *
 * Used where consumers (third-party charting libs like ECharts/appkit
 * BarChart, Recharts) need actual hex strings — they can't resolve
 * CSS variables. Anywhere CSS works, prefer `var(--brand-N)` directly.
 *
 * Keep in sync with index.css. There is no single source of truth that
 * both sides can read; this is the seam. If you change one, change the
 * other.
 */
export const BRAND_PALETTE = [
  '#0B0F15', // brand-1 — desk black
  '#FFB020', // brand-2 — terminal amber
  '#37D4E8', // brand-3 — cyan
  '#7CE38B', // brand-4 — phosphor green
  '#FF4D5E', // brand-5 — ticker red
] as const;
