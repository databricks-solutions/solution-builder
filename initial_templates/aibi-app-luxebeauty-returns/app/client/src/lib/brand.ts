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
  '#094074', // brand-1 — deep navy
  '#3C6997', // brand-2 — slate blue
  '#5ADBFF', // brand-3 — electric cyan
  '#FFDD4A', // brand-4 — lemon
  '#FE9000', // brand-5 — warm orange
] as const;
