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
  '#14213D', // brand-1 — ink navy
  '#2E6F95', // brand-2 — tidewell teal-blue
  '#7FB7BE', // brand-3 — sage
  '#E0A458', // brand-4 — ochre
  '#C8553D', // brand-5 — brick red
] as const;
