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
  '#0A0A0D', // brand-1 — screen black
  '#A78BFA', // brand-2 — signal violet
  '#7DD3FC', // brand-3 — lavender
  '#F5C451', // brand-4 — marquee gold
  '#FF6B57', // brand-5 — coral
] as const;
