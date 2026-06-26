/**
 * file-icons — a file-based SVG icon registry. Drop `.svg` files under
 * `ui/icons/<group>/<category>/<name>.svg` and they're auto-discovered at build
 * time (Vite `import.meta.glob`, eager raw import) — no per-icon React component
 * to hand-write. Used for the long tail of source-system / SaaS / database
 * vendor logos and the cloud (AWS / GCP / Azure) service marks.
 *
 * Each icon gets a stable key `file:<group>/<rest>` (e.g. `file:vendor/snowflake`,
 * `file:cloud/aws/storage/s3`) plus searchable metadata (group, category, name).
 */

// Glob the SVGs as URL assets (NOT inlined into JS) — Vite emits each as a
// hashed file served on demand, so a few hundred icons don't bloat the bundle.
// We only need metadata (path) eagerly for search/tabs; the bytes load via
// <img src> when an icon actually renders.
const urls = import.meta.glob("../icons/**/*.svg", { query: "?url", import: "default", eager: true }) as Record<string, string>;

export interface FileIcon {
  /** Stable key: `file:<group>/<path-without-extension>`. */
  key: string;
  /** Top-level group: "vendor" | "cloud" | … (first path segment). */
  group: string;
  /** Sub-folder category (e.g. "aws/storage", "database"); "" if none. */
  category: string;
  /** File name without extension (e.g. "snowflake", "s3"). */
  name: string;
  /** Built asset URL for the SVG. */
  url: string;
}

function parse(path: string): Omit<FileIcon, "url"> {
  // path like "../icons/cloud/aws/storage/s3.svg"
  const rel = path.replace(/^.*\/icons\//, "").replace(/\.svg$/i, "");
  const parts = rel.split("/");
  const group = parts[0] ?? "misc";
  const name = parts[parts.length - 1] ?? rel;
  const category = parts.slice(1, -1).join("/");
  return { key: `file:${rel}`, group, category, name };
}

export const FILE_ICONS: FileIcon[] = Object.entries(urls)
  .map(([path, url]) => ({ ...parse(path), url }))
  .sort((a, b) => a.key.localeCompare(b.key));

const BY_KEY = new Map(FILE_ICONS.map((i) => [i.key, i]));

export function getFileIcon(key: string): FileIcon | undefined {
  return BY_KEY.get(key);
}

export function isFileIconKey(key: string | undefined | null): key is string {
  return typeof key === "string" && key.startsWith("file:") && BY_KEY.has(key);
}

// --- Logo metadata catalog (trademark / oss / data-source) ------------------
import LOGO_CATALOG from "../icons/logo-catalog.json";

export interface LogoMeta { trademark: boolean; oss: boolean; source: boolean; label?: string; ingest?: string }
const CAT = LOGO_CATALOG as unknown as Record<string, Partial<LogoMeta>> & { defaults: LogoMeta };
const LOGO_DEFAULTS: LogoMeta = CAT.defaults ?? { trademark: true, oss: false, source: true };

/** A human label for a logo key (catalog `label`, else Title-Cased name). */
export function logoLabel(name: string): string {
  const e = CAT[name];
  if (e && typeof e === "object" && e.label) return e.label;
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Metadata for a logo by its canonical NAME (e.g. "kafka", "shopify", "s3"). */
export function logoMetaByName(name: string): LogoMeta {
  const e = CAT[name];
  return { ...LOGO_DEFAULTS, ...(e && typeof e === "object" ? e : {}) };
}

/** Metadata for a file-icon KEY ("file:vendor/kafka" / "file:cloud/aws/storage/s3"). */
export function logoMetaForKey(iconKey: string): LogoMeta {
  const icon = getFileIcon(iconKey);
  return icon ? logoMetaByName(icon.name) : LOGO_DEFAULTS;
}

/** Render a file-based SVG icon by key as an <img> pointing at the built asset
 *  URL (loaded on demand, not inlined into the JS bundle). */
export function FileSvgIcon({ iconKey, className, style }: { iconKey: string; className?: string; style?: React.CSSProperties }) {
  const icon = getFileIcon(iconKey);
  if (!icon) return null;
  return (
    <img
      src={icon.url}
      alt={icon.name}
      draggable={false}
      className={className}
      style={{ objectFit: "contain", ...style }}
    />
  );
}

// --- Brand color extraction (for the trademark-safe text badge) -------------
// We don't inline the SVGs, so derive a file icon's dominant brand color
// lazily: fetch the (local) asset once, grab its first fill/stroke hex, cache.
const colorCache = new Map<string, string | null>();
const colorWaiters = new Map<string, Set<(c: string | null) => void>>();

function firstHex(svg: string): string | null {
  // Prefer a fill on a <path>/<rect>; ignore #fff/#ffffff/none/currentColor.
  const re = /(?:fill|stop-color)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const hex = m[1].toLowerCase();
    if (hex === "#fff" || hex === "#ffffff" || hex === "#000" || hex === "#000000") continue;
    return m[1];
  }
  return null;
}

/** Dominant brand color of a file icon, or null. Resolves async (cached). */
export function getFileIconColor(iconKey: string): Promise<string | null> {
  if (colorCache.has(iconKey)) return Promise.resolve(colorCache.get(iconKey)!);
  const icon = getFileIcon(iconKey);
  if (!icon) return Promise.resolve(null);
  return new Promise((resolve) => {
    const set = colorWaiters.get(iconKey) ?? new Set();
    set.add(resolve);
    if (colorWaiters.has(iconKey)) { colorWaiters.set(iconKey, set); return; } // fetch already in flight
    colorWaiters.set(iconKey, set);
    fetch(icon.url)
      .then((r) => r.text())
      .then((svg) => firstHex(svg))
      .catch(() => null)
      .then((c) => {
        colorCache.set(iconKey, c ?? null);
        colorWaiters.get(iconKey)?.forEach((fn) => fn(c ?? null));
        colorWaiters.delete(iconKey);
      });
  });
}
