/**
 * platform-diagram/brand-mark — trademark-safe rendering of a component's mark.
 *
 * Third-party SaaS/vendor logos (Shopify, Snowflake, SAP, …) are trademarked.
 * By default we render them as a neutral TEXT BADGE (brand-colored pill with
 * the name) instead of the real logo. Cloud (AWS/GCP/Azure) and Databricks
 * marks are always shown as logos. The real third-party logos appear only when
 * the demo opts in via `enableTrademarkLogos` (with a permission ack).
 */
import { useContext, useEffect, useState } from "react";
import { DATABRICKS_ICONS, BRAND_ICONS, TRADEMARK_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { isFileIconKey, getFileIcon, getFileIconColor, FileSvgIcon, logoMetaForKey } from "../../file-icons";
import { isCustomIconKey, customLogoId } from "@/lib/platform-architecture";
import { CustomLogosContext, InlineSvgIcon } from "./shared";

/** Brand colors for the built-in trademarked vendor logos (badge background). */
const BUILTIN_BADGE_COLOR: Partial<Record<string, string>> = {
  shopifyLogo: "#95BF47",
  zendeskLogo: "#03363D",
  sapLogo: "#0FAAFF",
};

/** Is this icon key a third-party trademarked mark (gated behind the toggle)?
 *  Cloud marks + OSS logos + Databricks built-ins are NOT gated. Driven by the
 *  logo catalog (trademark && !oss) for file icons. */
export function isTrademarkMark(iconKey: string): boolean {
  if (isFileIconKey(iconKey)) {
    const f = getFileIcon(iconKey);
    if (!f || f.group === "cloud") return false; // cloud always allowed
    const m = logoMetaForKey(iconKey);
    return m.trademark && !m.oss;
  }
  return TRADEMARK_ICONS.has(iconKey as DatabricksIconName);
}

/** A trademark-safe pill: the FULL name on a brand-colored background, white
 *  text. Used on the canvas (where there's room). */
function TextBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
      style={{ background: color }}
      title={label}
    >
      {label}
    </span>
  );
}

/** A trademark-safe MONOGRAM: the brand's first letter on a brand-colored
 *  square. Used in the tight left library list. */
function Monogram({ label, color, className }: { label: string; color: string; className?: string }) {
  const letter = (label.trim()[0] || "?").toUpperCase();
  return (
    <span
      className={`grid place-items-center rounded-[3px] font-bold leading-none text-white ${className ?? "h-full w-full"}`}
      style={{ background: color }}
      title={label}
    >
      <span style={{ fontSize: "0.7em" }}>{letter}</span>
    </span>
  );
}

/**
 * Render a component's mark, honoring the trademark policy.
 * - allowed (cloud / databricks / toggle on) → the real icon/logo,
 * - gated + toggle off → a brand-colored text badge with `label`.
 */
export function BrandMark({
  iconKey,
  label,
  bandColor,
  allowTrademark,
  className,
  style,
  mono = false,
}: {
  iconKey: string;
  label: string;
  bandColor: string;
  allowTrademark: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** When gated, render a first-letter monogram (tight UIs) instead of the
   *  full-name pill. */
  mono?: boolean;
}) {
  const customLogos = useContext(CustomLogosContext);
  const gated = isTrademarkMark(iconKey);
  const fileColor = useFileColor(isFileIconKey(iconKey) && gated && !allowTrademark ? iconKey : null);

  // Custom inline-SVG logo: never trademark-gated, always render.
  if (isCustomIconKey(iconKey)) {
    const svg = customLogos[customLogoId(iconKey)];
    if (svg) return <InlineSvgIcon svg={svg} className={className} style={style} />;
    const Data = DATABRICKS_ICONS.data;
    return <Data className={className} style={{ color: bandColor, ...style }} />;
  }

  // Label-as-logo: `icon:"text"` (or no icon) renders the name as a brand-colored
  // text badge — same visual as a trademark-gated logo with the toggle off. For
  // sources/partners we have no logo for. Nothing to fetch, no icon file.
  if (iconKey === "text" || !iconKey) {
    return mono ? (
      <Monogram label={label} color={bandColor} className={className} />
    ) : (
      <TextBadge label={label} color={bandColor} />
    );
  }

  if (!gated || allowTrademark) {
    // Show the real mark.
    if (isFileIconKey(iconKey)) return <FileSvgIcon iconKey={iconKey} className={className} style={style} />;
    const Icon = DATABRICKS_ICONS[iconKey as DatabricksIconName] || DATABRICKS_ICONS.data;
    const isBrand = BRAND_ICONS.has(iconKey as DatabricksIconName);
    return <Icon className={className} style={isBrand ? style : { color: bandColor, ...style }} />;
  }

  // Gated + not allowed → brand-colored badge. Full-name pill by default
  // (canvas), first-letter monogram in tight UIs (left library).
  const color = BUILTIN_BADGE_COLOR[iconKey] ?? fileColor ?? bandColor;
  return mono ? <Monogram label={label} color={color} className={className} /> : <TextBadge label={label} color={color} />;
}

/** Resolve a file icon's brand color (async, cached); null until resolved. */
function useFileColor(iconKey: string | null): string | null {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (!iconKey) { setColor(null); return; }
    let alive = true;
    getFileIconColor(iconKey).then((c) => { if (alive) setColor(c); });
    return () => { alive = false; };
  }, [iconKey]);
  return color;
}
