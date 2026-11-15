/**
 * Official Databricks product icons for architecture diagrams.
 */

import { SVGProps, useId, type CSSProperties, type ReactElement } from "react";
import { ICON_ALIASES, ICON_ALIAS_COLOR } from "../lib/icon-aliases";

type IconProps = SVGProps<SVGSVGElement>;

// Official icon artwork: the thin-line pictograms (ui/icons/databricks-line) and the
// workspace's own Databricks UI app icons (ui/icons/db). Inlined so every glyph keeps the same
// colour contract as the other built-ins.
// Vite expands import.meta.glob at build time. The bun-run unit tests (test:layout)
// load this module without Vite and never render these glyphs, so they get an empty map.
const OFFICIAL_SVG: Record<string, string> = (() => {
  try {
    return import.meta.glob(["../icons/databricks-line/*.svg", "../icons/db/*.svg"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  } catch {
    return {};
  }
})();
const OFFICIAL_NAVY = "#1B3139";

/** An official icon as an inline SVG. `path` is `databricks-line/<slug>` or `db/<name>`.
 *  Navy line artwork is rewritten to `currentColor` so it recolours and takes the band/card
 *  tint like the glyph it replaces. Orange line variants and Databricks UI (already `currentColor`)
 *  are used as-is. The DATABRICKS_ICONS entries below are the one place a key maps to an
 *  official SVG. */
function officialIcon(key: string): (props: IconProps) => ReactElement {
  const path = key.replace(/^file:/, "");
  const raw = OFFICIAL_SVG[`../icons/${path}.svg`] ?? "";
  if (!raw && Object.keys(OFFICIAL_SVG).length > 0) throw new Error(`missing official icon: ${path}`);
  const viewBox = raw.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 150 150";
  // Root-level style on the source <svg> (e.g. the Lakeflow glyph's rotate:90deg) must survive.
  const rootStyle = Object.fromEntries(
    (raw.match(/<svg[^>]*\sstyle="([^"]*)"/)?.[1] ?? "").split(";").map((d) => d.split(":").map((s) => s.trim())).filter(([k, v]) => k && v),
  ) as CSSProperties;
  let inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  if (path.startsWith("databricks-line/") && !path.endsWith("-orange")) inner = inner.split(OFFICIAL_NAVY).join("currentColor");
  // Workspace (Databricks UI) art is 16px, so it reads heavy scaled into a large slot: it caps at
  // 32px and centres in the slot the caller sizes (className goes on the slot, not the art).
  // The size sits in inline style: parents may force descendants with [&_svg]:h-full.
  if (path.startsWith("db/")) {
    return function WorkspaceIcon({ className, style }: IconProps) {
      return (
        <span className={`inline-flex items-center justify-center ${className ?? ""}`} style={style}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} fill="none"
            style={{ width: 32, height: 32, maxWidth: "100%", maxHeight: "100%", ...rootStyle }} dangerouslySetInnerHTML={{ __html: inner }} />
        </span>
      );
    };
  }
  return function OfficialIcon(props: IconProps) {
    return <svg xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} fill="none" {...props} style={{ ...rootStyle, ...props.style }} dangerouslySetInnerHTML={{ __html: inner }} />;
  };
}

// Dashboard icon
/** A built-in name's component: its canonical official artwork (see ICON_ALIASES). */
const aliased = (key: string) => {
  const Art = officialIcon(ICON_ALIASES[key]);
  const color = ICON_ALIAS_COLOR[key];
  // An alias with a colour (the Databricks orange variants) keeps its look: the colour
  // is the default, an explicit style still wins.
  return color ? function TintedIcon(props: IconProps) { return Art({ ...props, style: { color, ...props.style } }); } : Art;
};

const officialCache = new Map<string, (props: IconProps) => ReactElement>();
/** Inline component for a canonical `file:databricks-line/*` or `file:db/*` key (after
 *  alias resolution), or undefined for any other key. Lets AnyIcon / BrandMark keep the
 *  colour contract (navy line art follows the text colour) instead of falling back to an <img>. */
export function officialComponentFor(key: string): ((props: IconProps) => ReactElement) | undefined {
  if (!key.startsWith("file:databricks-line/") && !key.startsWith("file:db/")) return undefined;
  if (!OFFICIAL_SVG[`../icons/${key.slice("file:".length)}.svg`]) return undefined;
  let c = officialCache.get(key);
  if (!c) { c = officialIcon(key); officialCache.set(key, c); }
  return c;
}

export const DashboardIcon = aliased("dashboard");

// Agents icon
export const AgentsIcon = aliased("agents");

// ML Model icon
// ML Model — connected-nodes glyph (filled; the shape is designed as a fill,
// not a stroke, so outlining it inverts the read). It's a solid icon by design.
export const MLModelIcon = aliased("mlModel");

// Model Serving icon
export const ModelServingIcon = aliased("modelServing");

// AI Gateway icon
export const AIGatewayIcon = aliased("aiGateway");

// Lakeflow Connect icon (rotated 90deg)
export const LakeflowConnectIcon = aliased("lakeflowConnect");

// SQL Warehouse icon
export const SQLWarehouseIcon = aliased("sqlWarehouse");

// Genie icon
export const GenieIcon = aliased("genie");

// Jobs/Pipelines icon
export const JobsPipelinesIcon = aliased("jobsPipelines");

// Notebooks icon
export const NotebooksIcon = aliased("notebooks");

// SDP Pipeline icon
export const SDPPipelineIcon = aliased("sdpPipeline");

// Unity Catalog icon
export const UnityCatalogIcon = aliased("unityCatalog");

// Unstructured Data icon - stacked documents/papers
export const UnstructuredDataIcon = aliased("unstructuredData");

// Delta Lake icon (from Databricks CDN)
export const DeltaLakeIcon = aliased("deltaLake");

// Data icon - database cylinder with 3 stacks
export const DataIcon = aliased("data");

// Catalog / Schema / Table — nested database cylinders. Same cylinder family,
// distinguished by nesting depth (Catalog 3 rings → Schema 2 → Table 1) so the
// hierarchy reads at a glance. Red/orange (the unified accent) by default; the
// right-menu "Icon color" override can recolor them.
// Catalog — cylinder with 3 rings (deepest nesting).
export const DbCatalogIcon = aliased("dbCatalog");
// Schema — cylinder with 2 rings.
export const DbSchemaIcon = aliased("dbSchema");
// Table — a single plain cylinder (no inner rings).
export const DbTableIcon = aliased("dbTable");

// Delta Table icon (database with delta symbol)
export const DeltaTableIcon = aliased("deltaTable");

// Business User icon
export const BusinessUserIcon = aliased("businessUser");

// Input Data / External Source icon
export const InputDataIcon = aliased("inputData");

// Knowledge Assistant icon
// Knowledge Assistant — the Databricks "agent" glyph. The base fills the frame,
// so the agent is scaled into the LEFT ~70% and a document sits in the cleared
// right column (KA reads documents to ground its answers).
export const KnowledgeAssistantIcon = aliased("knowledgeAssistant");

// Multi-Agent Supervisor — the "agent" glyph (kept full-size) with small
// connection dots in the empty corners BESIDE the head, linked to it: the
// supervisor orchestrating satellite agents.
export const MultiAgentSupervisorIcon = aliased("multiAgentSupervisor");

// Vector Search icon — magnifying glass with nodes
export const VectorSearchIcon = aliased("vectorSearch");

// Lakebase icon — PostgreSQL-style database with connection
export const LakebaseIcon = aliased("lakebase");

// Databricks Apps icon — browser window with Databricks diamond
export const DatabricksAppsIcon = aliased("databricksApps");

// Databricks Metastore icon — a triangle over a linked square + circle (UC glyph)
export const DatabricksMetastoreIcon = aliased("databricksMetastore");

// Streaming icon — real-time data flow with lightning bolt
export const StreamingIcon = aliased("streaming");

// Metric Views icon — chart with checkmark (governed metrics)
export const MetricViewsIcon = aliased("metricViews");

// AI Functions icon — function symbol with sparkle
export const AIFunctionsIcon = aliased("aiFunctions");

// Delta Sharing icon — delta with sharing arrows
export const DeltaSharingIcon = aliased("deltaSharing");

// ---------------------------------------------------------------------------
// Official Databricks brand product icons (two-tone, multi-color).
// Extracted glyph-only from the official lockups. Unlike the line icons above
// these carry their OWN brand colors (#FF5F46 / #FABFBA) and IGNORE
// `currentColor` — callers must not recolor them. Used by the architecture
// tab's platform diagram. 200×200 canvas with 25px padding.
// ---------------------------------------------------------------------------

export function GenieBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M81.7909 159.789C75.0244 159.789 69.5392 166.599 69.5392 175H126.368C126.368 166.599 120.883 159.789 114.116 159.789H81.7909Z" fill="#FF5F46"/>
      <path d="M179.614 80.7871C167.525 100.208 149.376 126.933 141.272 133.79C133.167 140.647 121.149 153.009 93.2907 153.009C73.7741 153.009 56.9864 140.474 49.5352 122.498C49.5353 122.519 49.5356 122.54 49.5358 122.561C48.4799 119.938 45.9132 118.085 42.9121 118.085C38.969 118.085 35.7721 121.282 35.7721 125.225C35.7722 126.15 35.9484 126.997 36.2689 127.752C37.984 131.793 42.5469 131.965 42.5469 144.569C42.5469 143.103 42.5469 146.404 42.5469 144.569C30.6947 144.569 21.0865 134.96 21.0863 123.108C21.0863 111.256 30.6945 101.647 42.5469 101.647H45.4249V101.644H79.5153C82.062 101.644 84.5067 102.722 86.0978 104.71C88.8856 108.194 91.0222 111.438 92.5969 114.114C94.056 116.594 98.4255 116.618 99.8699 114.13C101.393 111.506 103.416 108.337 105.98 104.929C107.573 102.813 110.103 101.644 112.752 101.644H125.427C143.951 101.644 154.105 92.7623 159.289 86.3612C161.972 83.049 165.782 80.7871 170.045 80.7871H179.614Z" fill="#FABFBA"/>
      <path d="M96.3843 111.768C96.3842 87.8629 77.3194 68.4739 53.768 68.3843C77.3196 68.2949 96.3845 48.9049 96.3845 25C96.3845 25 96.3845 25 96.3845 25C96.3845 48.9602 115.538 68.3838 139.165 68.3838C115.538 68.3838 96.3844 87.8075 96.3843 111.768Z" fill="#FF5F46"/>
    </svg>
  );
}

// Genie Code — the Genie genie/lamp mark with a code </> glyph above it
// (instead of Genie's star), in the coral brand palette.
export function GenieCodeBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* code </> above (replaces the star) */}
      <path d="M9 5.5 3.5 12 9 18.5M15 5.5 20.5 12 15 18.5" transform="translate(14.5 -1.5)" fill="none" stroke="#EF5B3F" strokeWidth="4" strokeLinecap="butt" strokeLinejoin="miter" />
      {/* genie lamp */}
      <path fill="#F5C5BC" d="M11 28.5 C9.8 32.8 12.8 36.4 17.5 37.4 L27.5 37.4 C33 36.8 36.4 33.6 37.6 30 C38.6 26.9 40.8 24.3 44.2 22.4 C45 22 44.9 20.9 44 20.7 C40.4 20 37.1 21.3 34.9 23.6 C32.4 22.6 29.2 22.6 26.7 23.6 L17 23.6 C13.8 23.7 11.8 25.4 11 28.5 Z" />
      <path fill="#F5C5BC" d="M11.5 28 C6 27.6 4.8 33.4 9.6 35.4 C7.6 33.2 8.2 30.2 11.6 29.6 Z" />
      <path fill="#EF5B3F" d="M18.5 39.5 H30.5 C31.4 39.5 32.2 40 32.6 40.8 L33.5 42.6 C33.9 43.4 33.3 44.3 32.4 44.3 H16.6 C15.7 44.3 15.1 43.4 15.5 42.6 L16.4 40.8 C16.8 40 17.6 39.5 18.5 39.5 Z" />
    </svg>
  );
}

export function AIBIBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M94.143 100.396V18.75C49.0526 18.75 12.4995 55.3031 12.4995 100.394C12.4995 100.394 12.4995 100.393 12.4995 100.394L94.143 100.396Z" fill="#FABFBA"/>
      <path d="M62.3506 113.216C65.2535 129.02 78.0859 141.35 94.1406 143.499V181.123C57.4521 178.984 28.0252 149.801 25.5039 113.216H62.3506Z" fill="#FABFBA"/>
      <path d="M106.969 35.1527C144.98 37.7724 175.002 69.4369 175.002 108.114C175.002 146.902 144.807 178.637 106.641 181.096V143.433C124.717 140.789 138.598 125.223 138.598 106.412C138.597 87.7162 124.885 72.2229 106.969 69.4398V35.1527Z" fill="#FF5F46"/>
    </svg>
  );
}

export function UnityCatalogBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M99.7571 72.3687L75.8477 86.1844V113.816L99.7571 127.632L123.667 113.816V86.1844L99.7571 72.3687Z" fill="#FF5F46"/>
      <path d="M150.168 70.9293H177.678L163.851 47.0396L150.168 70.9293Z" fill="#FF5F46"/>
      <path d="M150.168 129.215L163.995 153.105L177.822 129.215H150.168Z" fill="#FF5F46"/>
      <path d="M85.9297 182.031H113.44L99.6128 158.142L85.9297 182.031Z" fill="#FF5F46"/>
      <path d="M21.6914 129.215L35.5186 153.105L49.3457 129.215H21.6914Z" fill="#FF5F46"/>
      <path d="M21.6914 70.9293H49.2017L35.3745 47.0396L21.6914 70.9293Z" fill="#FF5F46"/>
      <path d="M85.9297 17.9688L99.7568 41.8585L113.584 17.9688H85.9297Z" fill="#FF5F46"/>
      <path d="M125.972 22.7178L109.984 50.3493L137.639 66.3238L153.626 38.6923L125.972 22.7178Z" fill="#FABFBA"/>
      <path d="M179.839 84.0254H147.863V115.974H179.839V84.0254Z" fill="#FABFBA"/>
      <path d="M137.639 133.82L109.984 149.794L125.972 177.426L153.626 161.451L137.639 133.82Z" fill="#FABFBA"/>
      <path d="M61.7338 133.82L45.7461 161.451L73.4004 177.426L89.3881 149.794L61.7338 133.82Z" fill="#FABFBA"/>
      <path d="M51.5066 84.0254H19.5312V115.974H51.5066V84.0254Z" fill="#FABFBA"/>
      <path d="M73.4004 22.7178L45.7461 38.6923L61.7338 66.3238L89.3881 50.3493L73.4004 22.7178Z" fill="#FABFBA"/>
    </svg>
  );
}

export function LakehouseBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M174.872 81.3814V123.339H174.875L174.872 123.34V123.358H174.833C163.714 128.478 150.991 131.404 137.41 131.404C123.829 131.404 111.092 128.478 99.9877 123.358H99.9953C88.8897 118.226 76.1482 115.293 62.5609 115.293C48.9736 115.293 36.246 118.226 25.1265 123.358H25.125V81.9536H25.1334V81.3814L99.6627 22.8701L174.872 81.3814Z" fill="#FABFBA"/>
      <path d="M62.5891 131.405C76.1708 131.405 88.908 134.331 100.013 139.451H100.004C111.109 144.583 123.851 147.515 137.438 147.515C150.601 147.515 162.957 144.763 173.826 139.926L174.872 139.451V175.886H174.876C174.875 175.886 174.873 175.887 174.872 175.887V175.904H174.835C163.716 181.025 150.992 183.95 137.411 183.95C123.829 183.95 111.092 181.025 99.9869 175.904H99.9961C88.8905 170.772 76.149 167.84 62.5617 167.84C49.3988 167.84 37.0427 170.592 26.174 175.43L25.1273 175.904H25.1258L25.1265 139.469V139.451H25.1654C36.2841 134.331 49.0075 131.405 62.5891 131.405Z" fill="#FF5F46"/>
    </svg>
  );
}

export function LakebaseBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M100 119.513C88.875 115.609 76.111 113.379 62.5 113.379C48.889 113.379 36.1388 115.609 25 119.513V79.6436H175V119.513C163.861 123.259 151.111 125.399 137.5 125.399C124.314 125.399 111.924 123.391 101.048 119.859L100 119.513Z" fill="#FABFBA"/>
      <path d="M62.6758 128.042C75.7994 128.042 88.1324 129.947 98.957 133.298L101.043 133.956C111.868 137.306 124.2 139.212 137.324 139.212C150.448 139.212 162.767 137.306 173.604 133.956L174.647 133.627H175V175H25V133.627H25.3525C36.4389 130.073 49.1289 128.042 62.6758 128.042Z" fill="#FF5F46"/>
      <rect x="25" y="25" width="150" height="41.3728" fill="#FABFBA"/>
    </svg>
  );
}

// LakeWatch — the official mark (databricks.com LakeWatch promo art): a dark-red
// circle and a coral rounded triangle pointing into it, white where they overlap.
// Drawn as the two shapes each masked by the other, so the lens is exactly their
// intersection. Ids come from useId so many marks on one page don't collide.
export function LakeWatchBrandIcon(props: IconProps) {
  const id = useId().replace(/:/g, "");
  const tri = "M22.8 17.7L40.47 7.12A2 2 0 0 1 43.5 8.83V39.17A2 2 0 0 1 40.47 40.88L22.8 30.3A7.3 7.3 0 0 1 22.8 17.7Z";
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <defs>
        <mask id={`${id}-nt`} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48"><rect width="48" height="48" fill="#fff"/><path d={tri} fill="#000"/></mask>
        <mask id={`${id}-nc`} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48"><rect width="48" height="48" fill="#fff"/><circle cx="16.8" cy="24" r="12.8" fill="#000"/></mask>
      </defs>
      <circle cx="16.8" cy="24" r="12.8" fill="#BD2B26" mask={`url(#${id}-nt)`}/>
      <path d={tri} fill="#FF5F46" mask={`url(#${id}-nc)`}/>
    </svg>
  );
}

// CustomerLake (Agentic CDP) — four coral/peach shapes forming a customer/
// profile motif (from the official icon-customerlake.svg).
export function CustomerLakeBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="34.2089" cy="17.4162" r="5.41622" transform="rotate(-180 34.2089 17.4162)" fill="#FF5F46"/>
      <path d="M22.4031 37.0312L5.99999 37.0312L6 27.3746C6 22.845 9.67197 19.173 14.2016 19.173C18.7312 19.173 22.4031 22.845 22.4031 27.3746L22.4031 37.0312Z" fill="#FF5F46"/>
      <circle cx="14.2016" cy="11.4162" r="5.41622" fill="#FABFBA"/>
      <path d="M25.5938 25.4062L42.8241 25.4063L42.8241 33.3848C42.8241 38.1429 38.967 42 34.2089 42C29.4509 42 25.5937 38.1428 25.5937 33.3848L25.5938 25.4062Z" fill="#FABFBA"/>
    </svg>
  );
}

// AI Gateway — coral/peach brand mark (gateway arch + radiating nodes).
export function AIGatewayBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect x="35.2" y="23.7" width="7.6" height="7.6" fill="#F5C5BC" transform="rotate(0 39 27.5)" />
      <rect x="27.7" y="10.709618943233423" width="7.6" height="7.6" fill="#F5C5BC" transform="rotate(-60 31.5 14.509618943233422)" />
      <rect x="12.700000000000003" y="10.70961894323342" width="7.6" height="7.6" fill="#F5C5BC" transform="rotate(-120 16.500000000000004 14.50961894323342)" />
      <rect x="5.2" y="23.699999999999996" width="7.6" height="7.6" fill="#F5C5BC" transform="rotate(-180 9 27.499999999999996)" />
      <path fill="#EF5B3F" d="M16.5 36.5 V26 a7.5 7.5 0 0 1 15 0 V36.5 Z" />
      <path fill="#F5C5BC" d="M12 44.5 L36 44.5 L31.5 38.5 L16.5 38.5 Z" />
    </svg>
  );
}

export function LakeflowConnectBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M25 175.404L25.0006 104.197L57.1626 104.197L57.1625 142.872L95.5182 142.872L95.5182 175.404L25 175.404Z" fill="#FABFBA"/>
      <path d="M174.997 25.0005L174.996 96.2082L142.834 96.2082L142.835 57.5327L104.479 57.5327L104.479 25.0005L174.997 25.0005Z" fill="#FABFBA"/>
      <rect width="53.6735" height="53.6752" transform="matrix(1 0 5.39465e-06 1 25 25.0005)" fill="#FF5F46"/>
      <rect width="53.6737" height="53.6752" transform="matrix(1 0 5.39465e-06 1 121.775 121.744)" fill="#FF5F46"/>
    </svg>
  );
}

export function LakeflowJobsBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M86.0967 156.774L141.713 100.485L86.0967 44.1964L86.0967 21.875L117.024 21.875L117.024 53.3375L122.807 55.7779L144.645 33.5304L166.684 55.9846L144.846 78.2321L147.242 84.1233H178.126V115.877H147.242L144.846 121.768L166.684 144.015L144.645 166.47L122.806 144.222L117.024 146.663L117.024 178.125H86.0967L86.0967 156.774Z" fill="#FABFBA"/>
      <path d="M61.1655 39.4468V39.3445L120.617 100.001L61.1655 160.657V160.549L55.3559 166.468L33.3162 144.014L55.1546 121.767L52.7583 115.875H21.875V84.1219H52.7583L55.1546 78.2307L33.3162 55.9832L55.3559 33.5291L61.1655 39.4468Z" fill="#FF5F46"/>
    </svg>
  );
}

export function SDPBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M175.466 78.0699L149.571 78.0699L75.8379 167.969L25 167.969L25 121.066L57.8006 121.066L131.534 31.25L175.5 31.25L175.466 78.0699Z" fill="#FF5F46"/>
      <path d="M142.7 121.065L175.5 121.065L175.5 167.969L124.662 167.969L110.099 150.213L138.351 115.767L142.7 121.065ZM68.9668 31.25L90.3975 57.3545L62.1543 91.7578L50.9287 78.0703L25.0342 78.0703L25 31.25L68.9668 31.25Z" fill="#FABFBA"/>
    </svg>
  );
}

// ML / MLOps official orange product icons (line-art, self-colored #FF5F46,
// 0 0 150 150 canvas) — brand icons, do NOT recolor.
export const MLModelBrandIcon = aliased("mlModelBrand");

export const MLOpsBrandIcon = aliased("mlopsBrand");

export const ModelRegistryBrandIcon = aliased("modelRegistryBrand");

export function FeatureStoreBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} style={{ color: "#FF5F46", ...(props.style || {}) }}>
      <path fillRule="evenodd" clipRule="evenodd" d="M23.2257 48.7236C21.7287 48.7236 20.5221 49.9303 20.5221 51.4273V125.841C20.5221 127.338 21.7288 128.544 23.2257 128.544H97.7286C99.2256 128.544 100.432 127.338 100.432 125.841V90.0446H76.8016C76.049 98.393 69.0729 104.891 60.5219 104.891C51.4651 104.891 44.175 97.6014 44.175 88.5446C44.175 79.4877 51.4651 72.1977 60.5219 72.1977C66.2478 72.1977 71.1661 75.1624 74.1039 79.4712L74.804 80.498L58.7331 96.5689L52.3061 90.1419L54.4274 88.0205L58.7331 92.3262L70.8862 80.1731C68.4217 77.1623 64.7268 75.1977 60.5219 75.1977C53.1219 75.1977 47.175 81.1446 47.175 88.5446C47.175 95.9445 53.1219 101.891 60.5219 101.891C67.9219 101.891 73.8688 95.9445 73.8688 88.5446V87.0446H103.432V125.841C103.432 128.995 100.882 131.544 97.7286 131.544H23.2257C20.0719 131.544 17.5221 128.995 17.5221 125.841V51.4273C17.5221 48.2734 20.0719 45.7236 23.2257 45.7236H97.6392C100.793 45.7236 103.343 48.2734 103.343 51.4273V79.1534H100.343V51.4273C100.343 49.9303 99.1362 48.7236 97.6392 48.7236H23.2257Z" fill="currentColor"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M112.218 34.6821H37.8043V31.6821H112.218C115.372 31.6821 117.921 34.2319 117.921 37.3858V111.799H114.921V37.3858C114.921 35.8888 113.715 34.6821 112.218 34.6821Z" fill="currentColor"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M126.796 20.7295H52.3829V17.7295H126.796C129.95 17.7295 132.5 20.2793 132.5 23.4331V97.8466H129.5V23.4331C129.5 21.9361 128.293 20.7295 126.796 20.7295Z" fill="currentColor"/>
    </svg>
  );
}

export function VectorSearchBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M22.15 92.7699C22.15 101.86 46.26 109.23 75.99 109.23C105.72 109.23 129.83 101.86 129.83 92.7699V73.5499C129.83 82.6399 105.72 90.0099 75.99 90.0099C46.26 90.0099 22.15 82.6399 22.15 73.5499V57.1099" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M41.04 35.5302C44.3758 35.5302 47.08 32.826 47.08 29.4902C47.08 26.1544 44.3758 23.4502 41.04 23.4502C37.7042 23.4502 35 26.1544 35 29.4902C35 32.826 37.7042 35.5302 41.04 35.5302Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M65.42 58.4301C68.7558 58.4301 71.46 55.7259 71.46 52.3901C71.46 49.0543 68.7558 46.3501 65.42 46.3501C62.0842 46.3501 59.38 49.0543 59.38 52.3901C59.38 55.7259 62.0842 58.4301 65.42 58.4301Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M85.55 30.1601C88.8858 30.1601 91.59 27.4559 91.59 24.1201C91.59 20.7843 88.8858 18.0801 85.55 18.0801C82.2142 18.0801 79.51 20.7843 79.51 24.1201C79.51 27.4559 82.2142 30.1601 85.55 30.1601Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M113.54 47.6098C116.876 47.6098 119.58 44.9056 119.58 41.5698C119.58 38.234 116.876 35.5298 113.54 35.5298C110.204 35.5298 107.5 38.234 107.5 41.5698C107.5 44.9056 110.204 47.6098 113.54 47.6098Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M49.79 37.9399L60.98 48.2899" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M73.12 41.5698L82.05 29.0298" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M96.36 30.5298L108.38 37.6498" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M125.83 48.9597C128.41 50.8897 129.84 52.9897 129.84 55.1997C129.84 64.2897 105.73 71.6597 76 71.6597C46.27 71.6597 22.16 64.2897 22.16 55.1997C22.16 50.1897 29.49 45.6997 41.05 42.6797" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      <path d="M129.83 111.99C129.83 121.08 105.72 128.45 75.99 128.45C46.25 128.45 22.15 121.08 22.15 111.99V92.77" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
    </svg>
  );
}

// Medallion layer orange product icons (line-art, self-colored #FF5F46). Brand.
export function BronzeLayerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} style={{ color: "#B08D57", ...(props.style || {}) }}>
      <g clipPath="url(#bronzeClip)">
        <path fillRule="evenodd" clipRule="evenodd" d="M49.6 42.4C46.5625 42.4 44.1 44.8624 44.1 47.9C44.1 50.9376 46.5625 53.4 49.6 53.4C52.6376 53.4 55.1 50.9376 55.1 47.9C55.1 44.8624 52.6376 42.4 49.6 42.4ZM41.1 47.9C41.1 43.2056 44.9056 39.4 49.6 39.4C54.2945 39.4 58.1 43.2056 58.1 47.9C58.1 52.5944 54.2945 56.4 49.6 56.4C44.9056 56.4 41.1 52.5944 41.1 47.9Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M106.5 53.7C103.462 53.7 101 56.1624 101 59.2C101 62.2376 103.462 64.7 106.5 64.7C109.538 64.7 112 62.2376 112 59.2C112 56.1624 109.538 53.7 106.5 53.7ZM98 59.2C98 54.5056 101.806 50.7 106.5 50.7C111.194 50.7 115 54.5056 115 59.2C115 63.8944 111.194 67.7 106.5 67.7C101.806 67.7 98 63.8944 98 59.2Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M85.8 107.5C82.7625 107.5 80.3 109.962 80.3 113C80.3 116.038 82.7625 118.5 85.8 118.5C88.8376 118.5 91.3 116.038 91.3 113C91.3 109.962 88.8376 107.5 85.8 107.5ZM77.3 113C77.3 108.306 81.1056 104.5 85.8 104.5C90.4945 104.5 94.3 108.306 94.3 113C94.3 117.694 90.4945 121.5 85.8 121.5C81.1056 121.5 77.3 117.694 77.3 113Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M72 80.3H86.8V95.1H72V80.3ZM75 83.3V92.1H83.8V83.3H75Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M27.8 63.5H42.6V78.3H27.8V63.5ZM30.8 66.5V75.3H39.6V66.5H30.8Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M75.0291 83.3201H60.2291V68.5201H75.0291V83.3201ZM72.0291 80.3201V71.5201H63.2291V80.3201H72.0291Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M73.5 32.203L78.5036 40.8579L83.4799 49.6H63.3856L68.5032 40.8461L73.5 32.203ZM73.5 38.197L71.095 42.3571L68.6145 46.6H78.3202L75.8989 42.3464L73.5 38.197Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M103.383 74.4329L108.497 83.046L113.48 91.8H93.4202L98.4014 83.0492L103.383 74.4329ZM103.417 80.3671L101.001 84.5464L98.5798 88.8H108.32L105.903 84.554L103.417 80.3671Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M53.4827 90.0983L58.5986 98.8492L63.5998 107.5H43.5002L48.4989 98.8536L53.4827 90.0983ZM53.5173 96.1017L51.0986 100.351L48.6998 104.5H58.4002L56.0033 100.354L53.5173 96.1017Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M75 19.4C44.293 19.4 19.4 44.293 19.4 75C19.4 105.707 44.293 130.6 75 130.6C105.707 130.6 130.6 105.707 130.6 75C130.6 44.293 105.707 19.4 75 19.4ZM16.4 75C16.4 42.6361 42.6361 16.4 75 16.4C107.364 16.4 133.6 42.6361 133.6 75C133.6 107.364 107.364 133.6 75 133.6C42.6361 133.6 16.4 107.364 16.4 75Z" fill="currentColor"/>
      </g>
      <defs><clipPath id="bronzeClip"><rect width="150" height="150" fill="white"/></clipPath></defs>
    </svg>
  );
}

export function SilverLayerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} style={{ color: "#9BA7B0", ...(props.style || {}) }}>
      <g clipPath="url(#silverClip)">
        <path fillRule="evenodd" clipRule="evenodd" d="M52.8 36.8C49.7625 36.8 47.3 39.2624 47.3 42.3C47.3 45.3376 49.7625 47.8 52.8 47.8C55.8376 47.8 58.3 45.3376 58.3 42.3C58.3 39.2624 55.8376 36.8 52.8 36.8ZM44.3 42.3C44.3 37.6056 48.1056 33.8 52.8 33.8C57.4945 33.8 61.3 37.6056 61.3 42.3C61.3 46.9944 57.4945 50.8 52.8 50.8C48.1056 50.8 44.3 46.9944 44.3 42.3Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M89.8 34.9H104.6V49.7H89.8V34.9ZM92.8 37.9V46.7H101.6V37.9H92.8Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M74.9 58.8C71.8625 58.8 69.4 61.2624 69.4 64.3C69.4 67.3376 71.8625 69.8 74.9 69.8C77.9376 69.8 80.4 67.3376 80.4 64.3C80.4 61.2624 77.9376 58.8 74.9 58.8ZM66.4 64.3C66.4 59.6056 70.2056 55.8 74.9 55.8C79.5944 55.8 83.4 59.6056 83.4 64.3C83.4 68.9944 79.5944 72.8 74.9 72.8C70.2056 72.8 66.4 68.9944 66.4 64.3Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M60.1566 71.7342H45.3566V56.9342H60.1566V71.7342ZM57.1566 68.7342V59.9342H48.3566V68.7342H57.1566Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M74.9 81.3C71.8625 81.3 69.4 83.7624 69.4 86.8C69.4 89.8376 71.8625 92.3 74.9 92.3C77.9376 92.3 80.4 89.8376 80.4 86.8C80.4 83.7624 77.9376 81.3 74.9 81.3ZM66.4 86.8C66.4 82.1056 70.2056 78.3 74.9 78.3C79.5944 78.3 83.4 82.1056 83.4 86.8C83.4 91.4944 79.5944 95.3 74.9 95.3C70.2056 95.3 66.4 91.4944 66.4 86.8Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M82.3589 116.19H67.5589V101.39H82.3589V116.19ZM79.3589 113.19V104.39H70.5589V113.19H79.3589Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M74.8826 32.2983L79.9986 41.0492L84.9998 49.7H64.9001L69.8988 41.0536L74.8826 32.2983ZM74.9173 38.3017L72.4986 42.5508L70.0998 46.7H79.8001L77.4032 42.5539L74.9173 38.3017Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M97.2 54.303L102.199 62.9492L107.314 71.7H87.2202L92.2014 62.9492L97.2 54.303ZM97.2 60.297L94.8011 64.4464L92.3799 68.7H102.086L99.6014 64.4508L97.2 60.297Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M52.8 76.7679L57.8011 85.5536L62.7998 94.2H42.6649L47.8032 85.546L52.8 76.7679ZM52.8 82.8322L50.3968 87.054L47.9351 91.2H57.6002L55.1964 87.0421L52.8 82.8322Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M75 19.4C44.293 19.4 19.4 44.293 19.4 75C19.4 105.707 44.293 130.6 75 130.6C105.707 130.6 130.6 105.707 130.6 75C130.6 44.293 105.707 19.4 75 19.4ZM16.4 75C16.4 42.6361 42.6361 16.4 75 16.4C107.364 16.4 133.6 42.6361 133.6 75C133.6 107.364 107.364 133.6 75 133.6C42.6361 133.6 16.4 107.364 16.4 75Z" fill="currentColor"/>
      </g>
      <defs><clipPath id="silverClip"><rect width="150" height="150" fill="white"/></clipPath></defs>
    </svg>
  );
}

export function GoldLayerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} style={{ color: "#D4A82C", ...(props.style || {}) }}>
      <g clipPath="url(#goldClip)">
        <path fillRule="evenodd" clipRule="evenodd" d="M52.5 48.4C49.4624 48.4 47 50.8624 47 53.9C47 56.9376 49.4624 59.4 52.5 59.4C55.5376 59.4 58 56.9376 58 53.9C58 50.8624 55.5376 48.4 52.5 48.4ZM44 53.9C44 49.2056 47.8056 45.4 52.5 45.4C57.1944 45.4 61 49.2056 61 53.9C61 58.5944 57.1944 62.4 52.5 62.4C47.8056 62.4 44 58.5944 44 53.9Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M89.5 46.4H104.3V61.2H89.5V46.4ZM92.5 49.4V58.2H101.3V49.4H92.5Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M52.5 70.3C49.4624 70.3 47 72.7624 47 75.8C47 78.8376 49.4624 81.3 52.5 81.3C55.5376 81.3 58 78.8376 58 75.8C58 72.7624 55.5376 70.3 52.5 70.3ZM44 75.8C44 71.1056 47.8056 67.3 52.5 67.3C57.1944 67.3 61 71.1056 61 75.8C61 80.4944 57.1944 84.3 52.5 84.3C47.8056 84.3 44 80.4944 44 75.8Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M104.347 83.2378H89.5474V68.4378H104.347V83.2378ZM101.347 80.2378V71.4378H92.5474V80.2378H101.347Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M74.5827 43.9329L79.6968 52.546L84.6798 61.3H64.6201L69.6013 52.5492L74.5827 43.9329ZM74.6172 49.8671L72.201 54.0465L69.7798 58.3H79.5201L77.1032 54.054L74.6172 49.8671Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M74.5827 65.7983L79.6987 74.5492L84.6999 83.2H64.6002L69.5989 74.5536L74.5827 65.7983ZM74.6174 71.8017L72.1987 76.0508L69.7999 80.2H79.5002L77.1033 76.0539L74.6174 71.8017Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M52.5 92.6C49.4624 92.6 47 95.0624 47 98.1C47 101.138 49.4624 103.6 52.5 103.6C55.5376 103.6 58 101.138 58 98.1C58 95.0624 55.5376 92.6 52.5 92.6ZM44 98.1C44 93.4056 47.8056 89.6 52.5 89.6C57.1944 89.6 61 93.4056 61 98.1C61 102.794 57.1944 106.6 52.5 106.6C47.8056 106.6 44 102.794 44 98.1Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M104.347 105.575H89.5474V90.775H104.347V105.575ZM101.347 102.575V93.775H92.5474V102.575H101.347Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M74.5827 88.2329L79.6968 96.846L84.6798 105.6H64.6201L69.6013 96.8492L74.5827 88.2329ZM74.6172 94.1671L72.2011 98.3464L69.7798 102.6H79.5201L77.1032 98.354L74.6172 94.1671Z" fill="currentColor"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M75 19.4C44.293 19.4 19.4 44.293 19.4 75C19.4 105.707 44.293 130.6 75 130.6C105.707 130.6 130.6 105.707 130.6 75C130.6 44.293 105.707 19.4 75 19.4ZM16.4 75C16.4 42.6361 42.6361 16.4 75 16.4C107.364 16.4 133.6 42.6361 133.6 75C133.6 107.364 107.364 133.6 75 133.6C42.6361 133.6 16.4 107.364 16.4 75Z" fill="currentColor"/>
      </g>
      <defs><clipPath id="goldClip"><rect width="150" height="150" fill="white"/></clipPath></defs>
    </svg>
  );
}

// MLflow wordmark (multi-color, 954×408) — brand icon, self-colored.
export function MLflowBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 954 408" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path fill="#1F272D" d="M102,286.9V173.6h25.8V188c6.5-11.6,20.7-17.7,33.5-17.7c14.9,0,27.9,6.7,34,20c8.8-14.9,22.1-20,36.8-20c20.5,0,40,13,40,43.1v73.5H246v-69.1c0-13.3-6.7-23.3-21.9-23.3c-14.2,0-23.5,11.2-23.5,25.1v67.3h-26.5v-69.1c0-13-6.5-23.3-21.9-23.3c-14.4,0-23.5,10.7-23.5,25.1v67.3H102z"/>
      <path fill="#1F272D" d="M305.1,286.9V118.4h27v168.5H305.1z"/>
      <path fill="#0194E2" d="M321.3,348.6c6.1,1.7,11.5,2.7,23.1,2.7c21.5,0,46.9-12.1,53.6-46.2l27.6-136.7h40.1l6-22.7h-41.5l5.5-27.2c4.3-21.1,15.9-31.8,34.7-31.8c4.9,0,3.5,0.4,7.9,1.3l6-23.3c-5.7-1.7-10.9-2.7-22.1-2.7c-12.4,0-23.9,3.7-33,10.8c-10.5,8.1-17.4,20-20.6,35.5l-7.8,37.4H364l-3,22.7h35.2l-25.3,126.4c-2.7,14.3-10.9,31.5-34.3,31.5c-5.3,0-3.4-0.4-8.2-1.2L321.3,348.6z"/>
      <path fill="#43C9ED" d="M625.7,180.8c-14.2-10.1-32.2-13.3-48.9-8.7c-24.7,7-42.8,30-42.4,56.9c0.2,13.3,4.8,25.4,12.3,35.1l17.7-13c-5-6.1-8-13.9-8.1-22.4c-0.2-20.2,15.9-36.7,36.1-37l-0.4,13.8L625.7,180.8z"/>
      <polygon fill="#0194E2" points="491,286 464,286 501,116 528,116"/>
      <path fill="#0194E2" d="M638.7,193.7c-0.6-0.8-1.2-1.6-1.8-2.4l-17,12.5c5.8,6.4,9.4,14.8,9.5,24.1c0.2,20.2-15.9,36.7-36.1,37l0.4-13.8l-34.1,25c19.7,13.3,46.5,13.6,66.8-1.3C652.1,255.8,657.7,219.5,638.7,193.7z"/>
      <polygon fill="#0194E2" points="671.5,173.6 701,173.6 707,251 749,173.6 777,174 788,251 825,173.6 852,174 796,287 769,287 756,206 713,287 685,287"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Source-system vendor logos (real brand SVGs, single-path, brand color).
// Used for the demo's data-source tiles. Like the brand product icons these
// carry their own color and must not be recolored. 0 0 24 24 canvas.
// ---------------------------------------------------------------------------

export function ShopifyLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path fill="#95BF47" d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z" />
    </svg>
  );
}

export function ZendeskLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path fill="#03363D" d="M12.914 2.904V16.29L24 2.905H12.914zM0 2.906C0 5.966 2.483 8.45 5.543 8.45s5.542-2.484 5.543-5.544H0zm11.086 4.807L0 21.096h11.086V7.713zm7.37 7.84c-3.063 0-5.542 2.48-5.542 5.543H24c0-3.06-2.48-5.543-5.543-5.543z" />
    </svg>
  );
}

export function SAPLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path fill="#0FAAFF" d="M0 6.064v11.872h12.13L24 6.064zm3.264 2.208h.005c.863.001 1.915.245 2.676.633l-.82 1.43c-.835-.404-1.255-.442-1.73-.467-.708-.038-1.064.215-1.069.488-.007.332.669.633 1.305.838.964.306 2.19.715 2.377 1.9L7.77 8.437h2.046l2.064 5.576-.007-5.575h2.37c2.257 0 3.318.764 3.318 2.519 0 1.575-1.09 2.514-2.936 2.514h-.763l-.01 2.094-3.588-.003-.25-.908c-.37.122-.787.189-1.23.189-.456 0-.885-.071-1.263-.2l-.358.919-2 .006.09-.462c-.029.025-.057.05-.087.074-.535.43-1.208.629-2.037.644l-.213.002a5.075 5.075 0 0 1-2.581-.675l.73-1.448c.79.467 1.286.572 1.956.558.347-.007.598-.07.761-.239a.557.557 0 0 0 .156-.369c.007-.376-.53-.553-1.185-.756-.531-.164-1.135-.389-1.606-.735-.559-.41-.825-.924-.812-1.65a1.99 1.99 0 0 1 .566-1.377c.519-.537 1.357-.863 2.363-.863zm10.597 1.67v1.904h.521c.694 0 1.247-.23 1.248-.964 0-.709-.554-.94-1.248-.94zm-5.087.767l-.748 2.362c.223.085.481.133.757.133.268 0 .52-.047.742-.126l-.736-2.37z" />
    </svg>
  );
}

/** PDF document logo — red dog-eared page with "PDF" wordmark. */
export function PdfLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="#E0392B"
        d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
      />
      <path fill="#B71C1C" d="M14 2l4 4h-4z" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="6"
        fontWeight="700"
        fill="#fff"
        fontFamily="Arial, sans-serif"
      >
        PDF
      </text>
    </svg>
  );
}

/** Unity Catalog Volume — a storage drum / disk stack (governed file storage). */
export function VolumeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.6" fill="#C2410C" />
      <path
        fill="#EF5B3F"
        d="M5 5.5v13c0 1.44 3.13 2.6 7 2.6s7-1.16 7-2.6v-13c0 1.44-3.13 2.6-7 2.6s-7-1.16-7-2.6z"
      />
      <ellipse cx="12" cy="5.5" rx="7" ry="2.6" fill="#FB8C6E" />
    </svg>
  );
}

/** Zerobus — lightning bolt (real-time direct ingest). */
export function ZerobusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="#EF5B3F" {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

/** Delta Lake logo (cyan triangle). */
export function DeltaLakeLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 35 35" {...props}>
      <path fill="#00ADD4" d="M34.5592717,28.0928444 L18.5379045,0.69978358 C18.1796084,0.0873136379 17.2944486,0.0873136379 16.9361525,0.69978358 L3.32065957,23.9789316 C3.08139471,24.3884473 3.51327379,24.8612058 3.94250773,24.6599347 C4.11877018,24.5769735 4.32220543,24.4935314 4.54559945,24.4103298 L4.54103057,24.4194675 C4.54103057,24.4194675 4.91303332,24.2751872 5.54161457,24.0760804 C6.23440055,23.8632669 6.99355548,23.6617554 7.68081072,23.4915046 C9.60382686,23.0476022 12.1236826,22.68618 14.3958571,23.063473 C16.4869598,23.4104672 17.9432291,23.9709962 19.0039299,24.5219066 C19.4901546,24.774878 19.9494469,24.1400447 19.5562831,23.7579423 C18.0355685,22.2800309 15.6955823,20.4960048 12.1364273,19.7483923 C11.9806046,19.7156888 11.9024528,19.5399072 11.9830093,19.40236 L17.3432635,10.2374339 C17.5195259,9.93636895 17.9545311,9.93636895 18.1307935,10.2374339 L28.3679629,27.7408004 C28.583662,28.1094366 28.4028306,28.5802714 27.9978839,28.7158949 C27.1956853,28.9840158 26.2374236,29.1845654 25.1646994,29.1845654 C24.4822535,29.1845654 23.7957197,29.1040089 23.1075026,28.9440982 C23.1070216,28.9440982 21.1236482,28.63101 18.4720165,27.0489763 C15.8203847,25.4671831 10.7078117,23.4491824 4.97098592,26.7161697 C2.52663689,28.2869014 0.897952594,30.4352353 0.0397251804,31.7840158 C-0.0946959808,31.995146 0.137354861,32.2469151 0.358103744,32.1290862 C2.32921333,31.0760804 7.64377877,28.5891687 12.4326829,29.4832257 C15.2790931,30.0144177 18.5318928,32.1632326 21.9133425,33.3953865 C27.5070903,35.4682137 32.9911852,31.9953865 33.0029681,31.987932 C33.5827345,31.6048677 33.923236,31.313662 33.9811886,31.2631639 L34.0511645,31.2020852 C34.9449811,30.4220096 35.1582755,29.1167537 34.5592717,28.0928444 Z" />
    </svg>
  );
}

/** Apache Iceberg logo (blue facets). */
export function IcebergLogo(props: IconProps) {
  return (
    <svg viewBox="170 -2 56 56" fill="none" {...props}>
      <path d="M219.858 12.0673C221.827 14.267 222.7 17.0055 223.325 19.7648C226.537 33.9756 217.996 47.6386 203.764 50.6969C188.21 54.0394 174.997 43.177 173.013 29.5702C172.134 23.9752 173.141 18.2467 175.876 13.2871C176.128 12.8222 176.293 12.2657 176.877 12.0584L184.222 12.1798L181.717 17.4763C181.717 17.6579 181.717 17.8394 181.717 18.021C183.526 23.2701 186.898 27.5837 190.098 31.9979C190.442 33.8719 190.187 35.8466 191.022 37.6378C193.355 40.2727 195.687 42.9096 198.018 45.5484C198.19 45.7438 198.397 45.8682 198.61 45.5781C199.676 44.9267 199.987 43.7307 200.576 42.7566C201.914 40.554 203.368 38.4105 204.425 36.045L204.75 35.5299C206.059 35.0206 206.885 33.8483 208.043 33.1348C208.43 32.9221 208.746 32.6001 208.952 32.209C209.158 31.8179 209.244 31.3748 209.2 30.935C209.132 28.7235 209.176 26.4942 209.173 24.2915C209.698 23.7726 210.192 23.224 210.654 22.6484C211.782 21.0645 213.558 19.9839 214.221 18.0477C214.338 18.0629 214.457 18.0429 214.563 17.9901C214.668 17.9374 214.755 17.8543 214.813 17.7516C215.281 17.0411 214.778 16.446 214.574 15.8213C214.183 14.6193 213.434 13.5357 213.357 12.2272L219.858 12.0673Z" fill="#287ABE" />
      <path d="M184.225 12.1798L176.88 12.0584C177.848 9.53897 179.763 7.73598 181.741 6.07806C185.145 3.22111 189.05 1.24936 193.459 0.452969C201.127 -0.911856 208.102 0.749027 214.275 5.52739C216.575 7.30374 218.662 9.31693 219.864 12.0584L213.351 12.2005L208.022 12.1354V10.3383L211.841 10.3176L211.965 10.2495L211.844 10.0482C211.201 9.41788 210.433 8.92919 209.589 8.61357C208.746 8.29794 207.846 8.16238 206.947 8.2156C201.695 8.33994 196.44 8.26593 191.188 8.25408C189.346 8.25408 187.813 9.0416 186.336 10.0156C184.974 10.0748 184.95 11.2383 184.598 12.1265L184.225 12.1798Z" fill="#B8E1F2" />
      <path d="M181.717 18.0151C181.717 17.8335 181.717 17.6519 181.717 17.4704C184.787 16.5585 187.606 15.0427 190.495 13.7104C191.41 13.2871 192.671 13.3226 193.16 12.1502C194.918 12.2242 196.712 11.8541 198.438 12.3811C198.452 16.5259 198.466 20.6806 198.48 24.8451H198.208C194.835 23.4033 191.487 21.9053 188.085 20.5405C185.974 19.7026 184.041 18.3644 181.717 18.0151Z" fill="#B6E0F2" />
      <path d="M209.176 24.2797C209.176 26.4942 209.135 28.7205 209.203 30.9232C209.247 31.363 209.161 31.806 208.955 32.1971C208.749 32.5883 208.433 32.9102 208.046 33.1229C206.888 33.8364 206.062 35.0088 204.753 35.518C203.356 33.7417 202.486 31.6219 201.233 29.7567C200.381 28.4896 200.028 26.8554 198.569 26.0264C198.569 25.7461 198.574 25.4659 198.584 25.1856L199.149 24.8895C199.404 25.2034 199.762 25.1619 200.093 25.1323C203.115 24.856 206.143 24.5718 209.176 24.2797Z" fill="#4D8AC8" />
      <path d="M198.208 38.7687C198.295 38.7778 198.383 38.7778 198.471 38.7687C198.518 41.0346 198.565 43.3043 198.61 45.578C198.397 45.8741 198.193 45.7409 198.018 45.5484C195.683 42.9175 193.351 40.2845 191.022 37.6496C192.938 37.6496 194.744 38.3187 196.615 38.6089C197.141 38.6985 197.674 38.7519 198.208 38.7687Z" fill="#90D4F0" />
      <path d="M198.45 12.39L208.034 12.2153C208.034 14.9627 208.039 17.7092 208.048 20.4546C207.376 21.3221 206.316 21.5323 205.408 21.9793C203.335 22.9948 201.23 23.9303 199.137 24.8984L198.572 25.1945L198.492 24.8599L198.45 12.39Z" fill="#68C1EA" />
    </svg>
  );
}

/** Generic realtime-sensor source (no vendor) — radio/signal waves. */
export function SensorIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#0EA5E9" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="2" fill="#0EA5E9" stroke="none" />
      <path d="M7.76 7.76a6 6 0 0 0 0 8.48M16.24 16.24a6 6 0 0 0 0-8.48M4.93 4.93a10 10 0 0 0 0 14.14M19.07 19.07a10 10 0 0 0 0-14.14" />
    </svg>
  );
}

// Genie One — official brand lockup: the Genie flame mark + a dark "One" pill.
// Self-colored — do not recolor. Normalized so the lockup fills the viewBox.
export function GenieOneBrandIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 230 84" fill="none" {...props}>
      <rect x="0" y="0" width="230.131" height="84" rx="42" fill="#0B2026" />
      <path d="M117.673 55.164C115.292 55.164 113.183 54.634 111.345 53.574C109.53 52.489 108.104 50.993 107.067 49.084C106.03 47.151 105.511 44.912 105.511 42.367C105.511 39.8447 106.03 37.6293 107.067 35.7202C108.104 33.7875 109.53 32.2791 111.345 31.195C113.183 30.1108 115.292 29.5687 117.673 29.5687C120.1 29.5687 122.233 30.1108 124.072 31.195C125.91 32.2791 127.336 33.7875 128.349 35.7202C129.363 37.6293 129.87 39.8447 129.87 42.367C129.87 44.912 129.363 47.151 128.349 49.084C127.336 50.993 125.91 52.489 124.072 53.574C122.233 54.634 120.1 55.164 117.673 55.164ZM117.708 51.346C119.287 51.346 120.666 50.993 121.844 50.286C123.023 49.555 123.93 48.518 124.567 47.175C125.203 45.831 125.521 44.229 125.521 42.367C125.521 40.5047 125.203 38.902 124.567 37.5585C123.93 36.2151 123.023 35.1899 121.844 34.4828C120.666 33.7522 119.287 33.3869 117.708 33.3869C116.129 33.3869 114.75 33.7522 113.572 34.4828C112.393 35.1899 111.474 36.2151 110.814 37.5585C110.178 38.902 109.86 40.5047 109.86 42.367C109.86 44.229 110.178 45.831 110.814 47.175C111.474 48.518 112.393 49.555 113.572 50.286C114.75 50.993 116.129 51.346 117.708 51.346ZM138.257 54.74V29.9929H142.5L154.414 47.882V29.9929H158.656V54.74H154.414L142.5 36.8868V54.74H138.257ZM167.875 54.74V29.9929H183.855V33.4222H172.118V40.5282H182.794V43.887H172.118V51.311H183.855V54.74H167.875Z" fill="white" />
      <path d="M81.736 29.0215V54.958L64.745 64.691V28.0166H59.61L48.711 32.8662V39.8281L55.844 37.8877V66.126L36.347 54.958V29.0215L59.042 16.0215L81.736 29.0215Z" fill="#FF3621" />
    </svg>
  );
}

// Databricks Apps — official brand mark: four rounded squares (coral / light
// coral checker). Self-colored — do not recolor.
export function DatabricksAppsBrandIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 146.875 150" fill="none" {...props}>
      <path d="M0 8C0 3.582 3.582 0 8 0h54.5c4.418 0 8 3.582 8 8v54.5c0 4.418-3.582 8-8 8H8c-4.418 0-8-3.582-8-8z" fill="#FABFBA" />
      <path d="M84.375 8c0-4.418 3.582-8 8-8h54.5c4.418 0 8 3.582 8 8v54.5c0 4.418-3.582 8-8 8h-54.5c-4.418 0-8-3.582-8-8z" fill="#FF5F46" />
      <path d="M0 95.5c0-4.418 3.582-8 8-8h54.5c4.418 0 8 3.582 8 8V150c0 4.418-3.582 8-8 8H8c-4.418 0-8-3.582-8-8z" fill="#FF5F46" />
      <path d="M84.375 95.5c0-4.418 3.582-8 8-8h54.5c4.418 0 8 3.582 8 8V150c0 4.418-3.582 8-8 8h-54.5c-4.418 0-8-3.582-8-8z" fill="#FABFBA" />
    </svg>
  );
}

// MCP (Model Context Protocol) — the tool/connector layer. Rendered as a plug
// connecting into a socket, a clear "tools the agent can call" glyph.
export const McpIcon = aliased("mcp");

// Export an icon map for easy lookup
export const DATABRICKS_ICONS = {
  dashboard: DashboardIcon,
  agents: AgentsIcon,
  mlModel: MLModelIcon,
  modelServing: ModelServingIcon,
  aiGateway: AIGatewayIcon,
  lakeflowConnect: LakeflowConnectIcon,
  sqlWarehouse: SQLWarehouseIcon,
  genie: GenieIcon,
  jobsPipelines: JobsPipelinesIcon,
  notebooks: NotebooksIcon,
  sdpPipeline: SDPPipelineIcon,
  unityCatalog: UnityCatalogIcon,
  unstructuredData: UnstructuredDataIcon,
  deltaLake: DeltaLakeIcon,
  data: DataIcon,
  deltaTable: DeltaTableIcon,
  businessUser: BusinessUserIcon,
  inputData: InputDataIcon,
  knowledgeAssistant: KnowledgeAssistantIcon,
  multiAgentSupervisor: MultiAgentSupervisorIcon,
  vectorSearch: VectorSearchIcon,
  lakebase: LakebaseIcon,
  databricksApps: DatabricksAppsIcon,
  databricksMetastore: DatabricksMetastoreIcon,
  dbCatalog: DbCatalogIcon,
  dbSchema: DbSchemaIcon,
  dbTable: DbTableIcon,
  streaming: StreamingIcon,
  metricViews: MetricViewsIcon,
  aiFunctions: AIFunctionsIcon,
  mcp: McpIcon,
  deltaSharing: DeltaSharingIcon,
  // Official brand product icons (multi-color, self-colored — do not recolor).
  genieBrand: GenieBrandIcon,
  aibiBrand: AIBIBrandIcon,
  unityCatalogBrand: UnityCatalogBrandIcon,
  lakehouseBrand: LakehouseBrandIcon,
  lakebaseBrand: LakebaseBrandIcon,
  lakeWatchBrand: LakeWatchBrandIcon,
  customerLakeBrand: CustomerLakeBrandIcon,
  aiGatewayBrand: AIGatewayBrandIcon,
  genieCodeBrand: GenieCodeBrandIcon,
  databricksAppsBrand: DatabricksAppsBrandIcon,
  genieOneBrand: GenieOneBrandIcon,
  lakeflowConnectBrand: LakeflowConnectBrandIcon,
  lakeflowJobsBrand: LakeflowJobsBrandIcon,
  sdpBrand: SDPBrandIcon,
  mlModelBrand: MLModelBrandIcon,
  mlopsBrand: MLOpsBrandIcon,
  modelRegistryBrand: ModelRegistryBrandIcon,
  featureStoreBrand: FeatureStoreBrandIcon,
  vectorSearchBrand: VectorSearchBrandIcon,
  bronzeLayer: BronzeLayerIcon,
  silverLayer: SilverLayerIcon,
  goldLayer: GoldLayerIcon,
  mlflowBrand: MLflowBrandIcon,
  // Source-system vendor logos (brand-colored, self-colored).
  shopifyLogo: ShopifyLogo,
  zendeskLogo: ZendeskLogo,
  sapLogo: SAPLogo,
  sensorSource: SensorIcon,
  pdfLogo: PdfLogo,
  volume: VolumeIcon,
  zerobus: ZerobusIcon,
  deltaLakeLogo: DeltaLakeLogo,
  icebergLogo: IcebergLogo,
} as const;

export type DatabricksIconName = keyof typeof DATABRICKS_ICONS;

/** Brand icons carry their own colors and must NOT be recolored by the caller
 *  (no `color`/`currentColor` override). The platform diagram checks this set
 *  to decide whether to skip its band-tinting. */
export const BRAND_ICONS = new Set<DatabricksIconName>([
  "genieBrand",
  "aibiBrand",
  "unityCatalogBrand",
  "lakehouseBrand",
  "lakebaseBrand",
  "lakeWatchBrand",
  "customerLakeBrand",
  "lakeflowConnectBrand",
  "lakeflowJobsBrand",
  "sdpBrand",
  "aiGatewayBrand",
  "genieCodeBrand",
  "databricksAppsBrand",
  "genieOneBrand",
  "mlModelBrand",
  "mlopsBrand",
  "modelRegistryBrand",
  "featureStoreBrand",
  "vectorSearchBrand",
  "bronzeLayer",
  "silverLayer",
  "goldLayer",
  "mlflowBrand",
  "databricksMetastore",
  "shopifyLogo",
  "zendeskLogo",
  "sapLogo",
  "sensorSource",
  "pdfLogo",
  "volume",
  "zerobus",
  "deltaLakeLogo",
  "icebergLogo",
]);

/** Default LABEL color for icons whose caption reads best in the icon's own hue
 *  (the medallion layers are DEFINED by their metallic color, so a black label
 *  looks disconnected). Used as the caption fallback when no explicit `fontColor`
 *  is set. Matches the `color` baked into each layer icon above. */
export const BRAND_ICON_LABEL_COLOR: Partial<Record<DatabricksIconName, string>> = {
  bronzeLayer: "#B08D57",
  silverLayer: "#9BA7B0",
  goldLayer: "#D4A82C",
};

/** Built-in icon keys that are THIRD-PARTY trademarked brand marks — gated
 *  behind `enableTrademarkLogos` (otherwise rendered as a neutral text badge).
 *  Databricks/Delta/Iceberg/cloud marks are NOT here (always allowed). */
export const TRADEMARK_ICONS = new Set<DatabricksIconName>([
  "shopifyLogo",
  "zendeskLogo",
  "sapLogo",
]);
