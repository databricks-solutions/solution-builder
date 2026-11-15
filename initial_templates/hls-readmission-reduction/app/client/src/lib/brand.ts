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
  '#2B2360', // brand-1 — larkspur indigo
  '#5B53A6', // brand-2 — larkspur violet
  '#8DB7E0', // brand-3 — sky
  '#F2A541', // brand-4 — amber
  '#C8553D', // brand-5 — rust
] as const;
