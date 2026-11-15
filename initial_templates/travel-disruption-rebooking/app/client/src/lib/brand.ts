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
  '#12355B', // brand-1 — civic navy
  '#2A6F97', // brand-2 — harbor blue
  '#61A5C2', // brand-3 — lake blue
  '#F2C14E', // brand-4 — amber
  '#D1495B', // brand-5 — civic red
] as const;
