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
  '#173D35', // brand-1 — pine green
  '#2F6E5E', // brand-2 — spruce
  '#7FB5A2', // brand-3 — sage
  '#C9A45C', // brand-4 — brass gold
  '#B5473A', // brand-5 — brick
] as const;
