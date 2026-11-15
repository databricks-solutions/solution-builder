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
  '#0B1116', // brand-1 — console black
  '#1B6F7A', // brand-2 — deep phosphor
  '#3FD0E0', // brand-3 — phosphor cyan
  '#FF9F1C', // brand-4 — high amber
  '#FF4D5E', // brand-5 — critical red
] as const;
