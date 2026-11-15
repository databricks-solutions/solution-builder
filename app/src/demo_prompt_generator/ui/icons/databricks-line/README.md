# Databricks line icons (official)

Official Databricks "Primary Icon" pictograms from the Databricks Brandfolder
(Architecture Icons → Icons section). Thin-line style (150×150 viewBox, 3px strokes) —
the pictograms used in Databricks decks.

Keys: `file:databricks-line/<slug>`. ONE file per icon: the navy art renders in
`currentColor`, so a node colours it with `style.icon` (hex) — e.g. the Databricks orange
`#FF5F46`. The old `<slug>-orange` keys still resolve (aliases to the same icon in orange).
Each SVG was checked for scripts, event handlers and external links before adding.
To add more: download the icon's navy SVG from Brandfolder, run the same check, save it
here as `<slug>.svg`, and re-run `bun run build:arch-skill`.
