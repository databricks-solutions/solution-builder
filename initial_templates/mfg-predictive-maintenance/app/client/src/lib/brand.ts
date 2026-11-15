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
  '#0E2A3B', // brand-1 — deep steel
  '#2F5D7C', // brand-2 — slate blue
  '#2BB3A3', // brand-3 — machine teal
  '#F2B134', // brand-4 — amber
  '#F26B1D', // brand-5 — safety orange
] as const;
