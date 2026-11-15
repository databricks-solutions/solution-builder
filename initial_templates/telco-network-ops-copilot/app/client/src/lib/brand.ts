/**
 * Brand palette — TS mirror of the 5 brand stops defined in index.css
 * (--brand-1 .. --brand-5). Used where consumers need hex strings (charting
 * libs can't resolve CSS variables). Keep in sync with index.css.
 */
export const BRAND_PALETTE = [
  '#060B10', // brand-1 — wall black
  '#0C141C', // brand-2 — panel
  '#3CD7F0', // brand-3 — signal cyan
  '#FFB020', // brand-4 — amber
  '#FF4D5E', // brand-5 — alarm red
] as const;
