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
  '#13293D', // brand-1 — slate navy
  '#1B6E7A', // brand-2 — deep teal
  '#5FB3B3', // brand-3 — light teal
  '#F2A541', // brand-4 — amber
  '#E4572E', // brand-5 — signal orange
] as const;
