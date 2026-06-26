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
