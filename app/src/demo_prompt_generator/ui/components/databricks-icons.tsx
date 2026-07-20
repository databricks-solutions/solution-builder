/**
 * Official Databricks product icons for architecture diagrams.
 */

import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

// Dashboard icon
export function DashboardIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M1 1.75A.75.75 0 0 1 1.75 1h12.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75zm1.5 8.75v3h4.75v-3zm0-1.5h4.75V2.5H2.5zm6.25-6.5v3h4.75v-3zm0 11V7h4.75v6.5z" clipRule="evenodd" />
    </svg>
  );
}

// Agents icon
export function AgentsIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" d="M8 1c.664 0 1.282.2 1.797.542l-.014.072-.062.357-.357.062c-.402.07-.765.245-1.06.493a1.75 1.75 0 1 0 0 3.447c.295.25.658.424 1.06.494l.357.062.062.357.014.072A3.25 3.25 0 1 1 8 1" />
      <path fill="currentColor" d="M9.59 4.983A.75.75 0 0 1 9.62 3.51l.877-.152a.75.75 0 0 0 .61-.61l.153-.878a.75.75 0 0 1 1.478 0l.152.877a.75.75 0 0 0 .61.61l.878.153a.75.75 0 0 1 0 1.478l-.877.152a.75.75 0 0 0-.61.61l-.153.878a.75.75 0 0 1-1.478 0l-.152-.877a.75.75 0 0 0-.61-.61l-.878-.153z" />
      <path fill="currentColor" fillRule="evenodd" d="M1.164 12.287A8.74 8.74 0 0 1 8 9a8.74 8.74 0 0 1 6.836 3.287.75.75 0 0 1 .164.469v1.494a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-1.494a.75.75 0 0 1 .164-.469m1.336.74v.473h11v-.474A7.23 7.23 0 0 0 8 10.5c-2.2 0-4.17.978-5.5 2.526" clipRule="evenodd" />
    </svg>
  );
}

// ML Model icon
// ML Model — connected-nodes glyph (filled; the shape is designed as a fill,
// not a stroke, so outlining it inverts the read). It's a solid icon by design.
export function MLModelIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <g clipPath="url(#ModelsIcon_clip)">
        <path fill="currentColor" fillRule="evenodd" d="M0 4.75a2.75 2.75 0 0 1 5.145-1.353l4.372-.95a2.75 2.75 0 1 1 3.835 2.823l.282 2.257a2.75 2.75 0 1 1-2.517 4.46l-2.62 1.145.003.118a2.75 2.75 0 1 1-4.415-2.19L3.013 7.489A2.75 2.75 0 0 1 0 4.75M2.75 3.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5m2.715 1.688q.027-.164.033-.333l4.266-.928a2.75 2.75 0 0 0 2.102 1.546l.282 2.257c-.377.165-.71.412-.976.719zM4.828 6.55a2.8 2.8 0 0 1-.413.388l1.072 3.573q.13-.012.263-.012c.945 0 1.778.476 2.273 1.202l2.5-1.093a2.8 2.8 0 0 1 .012-.797zM12 10.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0M5.75 12a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5M11 2.75a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0" clipRule="evenodd" />
      </g>
      <defs>
        <clipPath id="ModelsIcon_clip">
          <path fill="#fff" d="M0 0h16v16H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

// Model Serving icon
export function ModelServingIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" d="M3.394 5.586a4.752 4.752 0 0 1 9.351.946A3.75 3.75 0 0 1 15.787 9H14.12a2.25 2.25 0 0 0-1.871-1H12a.75.75 0 0 1-.75-.75v-.5a3.25 3.25 0 0 0-6.475-.402.75.75 0 0 1-.698.657A2.75 2.75 0 0 0 4 12.49V14a.8.8 0 0 1-.179-.021 4.25 4.25 0 0 1-.427-8.393" />
      <path fill="currentColor" fillRule="evenodd" d="M8 7a2.25 2.25 0 0 1 2.03 3.22l.5.5a2.25 2.25 0 1 1-1.06 1.06l-.5-.5A2.25 2.25 0 1 1 8 7m.75 2.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0m3.5 3.5a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0" clipRule="evenodd" />
    </svg>
  );
}

// AI Gateway icon
export function AIGatewayIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M0 12.25c0-1.26.848-2.322 2.004-2.648A2.75 2.75 0 0 1 4.75 7h2.5V4h1.5v3h2.5a2.75 2.75 0 0 1 2.746 2.602 2.751 2.751 0 1 1-3.371 3.47 2.751 2.751 0 0 1-5.25 0A2.751 2.751 0 0 1 0 12.25M2.75 11a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5m2.625.428a2.76 2.76 0 0 0-1.867-1.822A1.25 1.25 0 0 1 4.75 8.5h2.5v1.104c-.892.252-1.6.942-1.875 1.824M8.75 9.604V8.5h2.5c.642 0 1.17.483 1.242 1.106a2.76 2.76 0 0 0-1.867 1.822A2.76 2.76 0 0 0 8.75 9.604M12 12.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0m-5.25 0a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0" clipRule="evenodd" />
    </svg>
  );
}

// Lakeflow Connect icon (rotated 90deg)
export function LakeflowConnectIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" style={{ transform: "rotate(90deg)" }} {...props}>
      <path fill="currentColor" d="M2.5 1a.75.75 0 0 0-.75.75v3c0 .414.336.75.75.75H6V4H3.25V2.5h9.5V4H10v1.5h3.5a.75.75 0 0 0 .75-.75v-3A.75.75 0 0 0 13.5 1z" />
      <path fill="currentColor" fillRule="evenodd" d="M0 12.25c0-1.26.848-2.322 2.004-2.648A2.75 2.75 0 0 1 4.75 7h2.5V4h1.5v3h2.5a2.75 2.75 0 0 1 2.746 2.602 2.751 2.751 0 1 1-3.371 3.47 2.751 2.751 0 0 1-5.25 0A2.751 2.751 0 0 1 0 12.25M2.75 11a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5m2.625.428a2.76 2.76 0 0 0-1.867-1.822A1.25 1.25 0 0 1 4.75 8.5h2.5v1.104c-.892.252-1.6.942-1.875 1.824M8.75 9.604V8.5h2.5c.642 0 1.17.483 1.242 1.106a2.76 2.76 0 0 0-1.867 1.822A2.76 2.76 0 0 0 8.75 9.604M12 12.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0m-5.25 0a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0" clipRule="evenodd" />
    </svg>
  );
}

// SQL Warehouse icon
export function SQLWarehouseIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M13 13.75C13 14.5784 11.6569 15.25 10 15.25C8.34315 15.25 7 14.5784 7 13.75" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M3.39373 5.58639C3.91293 3.52534 5.77786 2 8 2C10.5504 2 12.6314 4.01005 12.7451 6.5324C14.1591 6.7189 15.3247 7.69323 15.7866 9H14.1211C13.7175 8.39701 13.0301 8 12.25 8H12C11.5858 8 11.25 7.66421 11.25 7.25V6.75C11.25 4.95507 9.79493 3.5 8 3.5C6.34131 3.5 4.97186 4.74324 4.7745 6.34833C4.73041 6.70685 4.43704 6.98301 4.07651 7.00536C2.63892 7.09448 1.5 8.28952 1.5 9.75C1.5 11.1845 2.59873 12.3629 4 12.4888V14C3.93845 14 3.87864 13.9926 3.8214 13.9786C1.67511 13.7633 0 11.9526 0 9.75C0 7.69604 1.45669 5.98279 3.39373 5.58639Z" fill="currentColor" />
      <path d="M7 11.5V13.7769" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M13 11.5V13.7769" stroke="currentColor" strokeWidth="1" fill="none" />
      <ellipse cx="10" cy="11.5" rx="3" ry="1.5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

// Genie icon
export function GenieIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M0 2.75A.75.75 0 0 1 .75 2H8v1.5H1.5v9h13V10H16v3.25a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1-.75-.75zm12.987-.14a.75.75 0 0 0-1.474 0l-.137.728a1.93 1.93 0 0 1-1.538 1.538l-.727.137a.75.75 0 0 0 0 1.474l.727.137c.78.147 1.39.758 1.538 1.538l.137.727a.75.75 0 0 0 1.474 0l.137-.727c.147-.78.758-1.39 1.538-1.538l.727-.137a.75.75 0 0 0 0-1.474l-.727-.137a1.93 1.93 0 0 1-1.538-1.538z" clipRule="evenodd" />
    </svg>
  );
}

// Jobs/Pipelines icon
export function JobsPipelinesIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M3.75 4a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5m2.646-.5a2.751 2.751 0 1 1 0-1.5h5.229a3.375 3.375 0 0 1 .118 6.748L8.436 11.11a.75.75 0 0 1-.872 0l-3.3-2.357a1.875 1.875 0 0 0 .111 3.747h5.229a2.751 2.751 0 1 1 0 1.5H4.375a3.375 3.375 0 0 1-.118-6.748L7.564 4.89a.75.75 0 0 1 .872 0l3.3 2.357a1.875 1.875 0 0 0-.111-3.747zm7.104 9.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0M8 6.422 5.79 8 8 9.578 10.21 8z" clipRule="evenodd" />
    </svg>
  );
}

// Notebooks icon
export function NotebooksIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="#EF5B3F" fillRule="evenodd" d="M3 1.75A.75.75 0 0 1 3.75 1h10.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75V12.5H1V11h2V8.75H1v-1.5h2V5H1V3.5h2zm1.5.75v11H6v-11zm3 0v11h6v-11z" clipRule="evenodd" />
    </svg>
  );
}

// SDP Pipeline icon
export function SDPPipelineIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M10.75 6.75A5.75 5.75 0 0 0 5 1H1.75a.75.75 0 0 0-.75.75V6c0 .414.336.75.75.75H5a.25.25 0 0 1 .25.25v2.25A5.75 5.75 0 0 0 11 15h3.25a.75.75 0 0 0 .75-.75V10a.75.75 0 0 0-.75-.75H11a.25.25 0 0 1-.25-.25zM5.5 2.53a4.25 4.25 0 0 1 3.75 4.22V9a1.75 1.75 0 0 0 1.25 1.678v2.793A4.25 4.25 0 0 1 6.75 9.25V7A1.75 1.75 0 0 0 5.5 5.322zM4 2.5v2.75H2.5V2.5zm9.5 8.25H12v2.75h1.5z" clipRule="evenodd" />
    </svg>
  );
}

// Unity Catalog icon
export function UnityCatalogIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M8.646.368a.75.75 0 0 0-1.292 0l-3.25 5.5A.75.75 0 0 0 4.75 7h6.5a.75.75 0 0 0 .646-1.132zM8 2.224 9.936 5.5H6.064zM8.5 9.25a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1-.75-.75zM10 10v3.5h3.5V10zM1 11.75a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0M4.25 10a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5" clipRule="evenodd" />
    </svg>
  );
}

// Unstructured Data icon - stacked documents/papers
export function UnstructuredDataIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* Back paper with folded corner - closed shape */}
      <path d="M5 3V1h5.5l2.5 2.5v9.5a1 1 0 0 1-1 1H10" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M10.5 1v2.5H13" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Front paper with folded corner */}
      <path d="M2 3h6l2 2v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" fill="none" />
      <path d="M8 3v2h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Text lines */}
      <path d="M4 9h4M4 12h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// Delta Lake icon (from Databricks CDN)
export function DeltaLakeIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path fill="currentColor" d="M8 1L2 5.5v5L8 15l6-4.5v-5L8 1zm0 1.5l4.5 3.375L8 9.25 3.5 5.875 8 2.5zM3 6.75l4.5 3.375v4.125L3 10.875V6.75zm5.5 7.5V10.125L13 6.75v4.125l-4.5 3.375z"/>
    </svg>
  );
}

// Data icon - database cylinder with 3 stacks
export function DataIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* Top ellipse */}
      <ellipse cx="8" cy="3" rx="5.5" ry="2" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Left side */}
      <path d="M2.5 3v10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Middle ring 1 */}
      <path d="M2.5 6.5c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Middle ring 2 */}
      <path d="M2.5 10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

// Catalog / Schema / Table — nested database cylinders. Same cylinder family,
// distinguished by nesting depth (Catalog 3 rings → Schema 2 → Table 1) so the
// hierarchy reads at a glance. Red/orange (the unified accent) by default; the
// right-menu "Icon color" override can recolor them.
const DB_ORANGE = "#FF5F46";
const CYL_SW = 0.85; // thin, delicate cylinder lines (1.5 default read too heavy)
// Catalog — cylinder with 3 rings (deepest nesting).
export function DbCatalogIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props} style={{ color: DB_ORANGE, ...props.style }}>
      <ellipse cx="8" cy="3" rx="5.5" ry="2" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
      <path d="M2.5 3v10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
      <path d="M2.5 6.5c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
      <path d="M2.5 10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
    </svg>
  );
}
// Schema — cylinder with 2 rings.
export function DbSchemaIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props} style={{ color: DB_ORANGE, ...props.style }}>
      <ellipse cx="8" cy="4" rx="5.5" ry="2" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
      <path d="M2.5 4v8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V4" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
      <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
    </svg>
  );
}
// Table — a single plain cylinder (no inner rings).
export function DbTableIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props} style={{ color: DB_ORANGE, ...props.style }}>
      <ellipse cx="8" cy="4.5" rx="5.5" ry="2" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
      <path d="M2.5 4.5v7c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-7" stroke="currentColor" strokeWidth={CYL_SW} fill="none" />
    </svg>
  );
}

// Delta Table icon (database with delta symbol)
export function DeltaTableIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* Top ellipse */}
      <ellipse cx="8" cy="3" rx="5.5" ry="2" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Left side */}
      <path d="M2.5 3v10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Middle ring */}
      <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Delta symbol inside */}
      <path d="M8 6l-2 4h4l-2-4z" fill="currentColor" />
    </svg>
  );
}

// Business User icon
export function BusinessUserIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="8" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M3 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Input Data / External Source icon
export function InputDataIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="1.5" y="2.5" width="10" height="11" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Table grid - horizontal lines */}
      <path d="M1.5 6h10M1.5 9h10" stroke="currentColor" strokeWidth="1" />
      {/* Table grid - vertical line */}
      <path d="M5 6v7" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

// Knowledge Assistant icon
// Knowledge Assistant — the Databricks "agent" glyph. The base fills the frame,
// so the agent is scaled into the LEFT ~70% and a document sits in the cleared
// right column (KA reads documents to ground its answers).
export function KnowledgeAssistantIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* agent base (exact paths), scaled+shifted left to free the right column */}
      <g transform="translate(-0.75 1.5) scale(0.65)">
        <path fill="currentColor" d="M8 1c.664 0 1.282.2 1.797.542l-.014.072-.062.357-.357.062c-.402.07-.765.245-1.06.493a1.75 1.75 0 1 0 0 3.447c.295.25.658.424 1.06.494l.357.062.062.357.014.072A3.25 3.25 0 1 1 8 1" />
        <path fill="currentColor" d="M9.59 4.983A.75.75 0 0 1 9.62 3.51l.877-.152a.75.75 0 0 0 .61-.61l.153-.878a.75.75 0 0 1 1.478 0l.152.877a.75.75 0 0 0 .61.61l.878.153a.75.75 0 0 1 0 1.478l-.877.152a.75.75 0 0 0-.61.61l-.153.878a.75.75 0 0 1-1.478 0l-.152-.877a.75.75 0 0 0-.61-.61l-.878-.153z" />
        <path fill="currentColor" fillRule="evenodd" d="M1.164 12.287A8.74 8.74 0 0 1 8 9a8.74 8.74 0 0 1 6.836 3.287.75.75 0 0 1 .164.469v1.494a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-1.494a.75.75 0 0 1 .164-.469m1.336.74v.473h11v-.474A7.23 7.23 0 0 0 8 10.5c-2.2 0-4.17.978-5.5 2.526" clipRule="evenodd" />
      </g>
      {/* document at the right — outlined page with a folded corner + text lines */}
      <path d="M10.4 6.2h2.9l1.7 1.7v5.4a.7.7 0 0 1-.7.7h-3.9a.7.7 0 0 1-.7-.7V6.9a.7.7 0 0 1 .7-.7Z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
      <path d="M13.2 6.3v1.7h1.7" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
      <path d="M10.9 10h3M10.9 11.5h3M10.9 13h1.9" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

// Multi-Agent Supervisor — the "agent" glyph (kept full-size) with small
// connection dots in the empty corners BESIDE the head, linked to it: the
// supervisor orchestrating satellite agents.
export function MultiAgentSupervisorIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* links from the head to the satellite dots (drawn first, behind dots) */}
      <path d="M5 3 2.7 2.2M11 3l2.3-.8M4.6 5.4 2.2 6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.55" />
      {/* satellite agent dots, in the clear corners beside the head */}
      <circle cx="2.3" cy="2" r="1.05" fill="currentColor" />
      <circle cx="13.7" cy="2" r="1.05" fill="currentColor" />
      <circle cx="1.9" cy="6.1" r="1.05" fill="currentColor" />
      {/* agent base (exact) */}
      <path fill="currentColor" d="M8 1c.664 0 1.282.2 1.797.542l-.014.072-.062.357-.357.062c-.402.07-.765.245-1.06.493a1.75 1.75 0 1 0 0 3.447c.295.25.658.424 1.06.494l.357.062.062.357.014.072A3.25 3.25 0 1 1 8 1" />
      <path fill="currentColor" d="M9.59 4.983A.75.75 0 0 1 9.62 3.51l.877-.152a.75.75 0 0 0 .61-.61l.153-.878a.75.75 0 0 1 1.478 0l.152.877a.75.75 0 0 0 .61.61l.878.153a.75.75 0 0 1 0 1.478l-.877.152a.75.75 0 0 0-.61.61l-.153.878a.75.75 0 0 1-1.478 0l-.152-.877a.75.75 0 0 0-.61-.61l-.878-.153z" />
      <path fill="currentColor" fillRule="evenodd" d="M1.164 12.287A8.74 8.74 0 0 1 8 9a8.74 8.74 0 0 1 6.836 3.287.75.75 0 0 1 .164.469v1.494a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-1.494a.75.75 0 0 1 .164-.469m1.336.74v.473h11v-.474A7.23 7.23 0 0 0 8 10.5c-2.2 0-4.17.978-5.5 2.526" clipRule="evenodd" />
    </svg>
  );
}

// Vector Search icon — magnifying glass with nodes
export function VectorSearchIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <circle cx="5.5" cy="5.5" r="0.75" fill="currentColor" />
      <circle cx="7.5" cy="5" r="0.75" fill="currentColor" />
      <circle cx="6" cy="7.5" r="0.75" fill="currentColor" />
      <path d="M5.5 5.5L7.5 5M5.5 5.5L6 7.5M7.5 5L6 7.5" stroke="currentColor" strokeWidth="0.5" />
    </svg>
  );
}

// Lakebase icon — PostgreSQL-style database with connection
export function LakebaseIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <ellipse cx="8" cy="3.5" rx="5" ry="1.75" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M3 3.5v9c0 .97 2.24 1.75 5 1.75s5-.78 5-1.75v-9" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M3 7.5c0 .97 2.24 1.75 5 1.75s5-.78 5-1.75" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M13 10.5c0 .97-2.24 1.75-5 1.75S3 11.47 3 10.5" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" fill="none" />
    </svg>
  );
}

// Databricks Apps icon — browser window with Databricks diamond
export function DatabricksAppsIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M1 5.5h14" stroke="currentColor" strokeWidth="1" />
      <circle cx="3" cy="3.75" r="0.5" fill="currentColor" />
      <circle cx="4.75" cy="3.75" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="3.75" r="0.5" fill="currentColor" />
      <path d="M8 7.5l-2.5 2.5 2.5 2.5 2.5-2.5L8 7.5z" fill="currentColor" />
    </svg>
  );
}

// Databricks Metastore icon — a triangle over a linked square + circle (UC glyph)
export function DatabricksMetastoreIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props} style={{ color: "#FF5F46", ...props.style }}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8.646.368a.75.75 0 0 0-1.292 0l-3.25 5.5A.75.75 0 0 0 4.75 7h6.5a.75.75 0 0 0 .646-1.132zM8 2.224 9.936 5.5H6.064zM8.5 9.25a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1-.75-.75zM10 10v3.5h3.5V10zM1 11.75a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0M4.25 10a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Streaming icon — real-time data flow with lightning bolt
export function StreamingIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M2 4h3l2-2h3l2 2h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M2 4v8l3-1.5L7 12l2-1.5L11 12l3-1.5V4" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" fill="none" />
      <path d="M8.5 6L7 9h2l-1.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Metric Views icon — chart with checkmark (governed metrics)
export function MetricViewsIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M2 13V7l3-2 3 3 3-5 3 2v8H2z" stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" fill="none" />
      <path d="M2 13h12" stroke="currentColor" strokeWidth="0.7" />
      <path d="M10.5 9l1.5 1.5 3-3" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// AI Functions icon — function symbol with sparkle
export function AIFunctionsIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <text x="2" y="12" fontFamily="serif" fontStyle="italic" fontSize="12" fontWeight="bold" fill="currentColor">f</text>
      <path d="M10.5 2l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5.5-1z" fill="currentColor" />
      <path d="M13 5.5l.35.7.7.35-.7.35-.35.7-.35-.7-.7-.35.7-.35.35-.7z" fill="currentColor" />
    </svg>
  );
}

// Delta Sharing icon — delta with sharing arrows
export function DeltaSharingIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M4 12l4-8 4 8H4z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" fill="none" />
      <path d="M12 5l2.5-1M12 8l2.5 0M12 11l2.5 1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

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
export function MLModelBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M118.592 66.9658C114.888 66.9658 111.889 69.6116 111.272 73.1392H89.0477V75.785H111.184C111.801 79.3126 114.888 81.9584 118.504 81.9584C122.649 81.9584 126 78.6071 126 74.4621C126 70.3171 122.737 66.9658 118.592 66.9658ZM118.592 79.2245C115.946 79.2245 113.741 77.0197 113.741 74.3739C113.741 71.7282 115.946 69.5234 118.592 69.5234C121.238 69.5234 123.442 71.7282 123.442 74.3739C123.442 77.0197 121.238 79.2245 118.592 79.2245Z" fill="#FF5F46"/>
      <path d="M34.8982 74.4621C34.8982 78.6071 38.2495 81.9584 42.3945 81.9584C46.0985 81.9584 49.097 79.3126 49.7144 75.785H54.6531V73.1392H49.7144C49.097 69.6116 46.0103 66.9658 42.3945 66.9658C38.2495 66.9658 34.8982 70.3171 34.8982 74.4621ZM47.245 74.4621C47.245 77.1079 45.0402 79.3126 42.3945 79.3126C39.7487 79.3126 37.5439 77.1079 37.5439 74.4621C37.5439 71.8164 39.7487 69.6116 42.3945 69.6116C45.0402 69.6116 47.245 71.7282 47.245 74.4621Z" fill="#FF5F46"/>
      <path d="M70.0861 51.1807L68.8514 48.7995C67.1758 49.6814 65.3238 50.1224 63.3835 50.1224C57.7393 50.1224 52.8887 46.1537 51.7423 40.5977L49.1847 41.1268C50.5958 47.8294 56.5928 52.7681 63.4717 52.7681C65.6765 52.7681 67.9695 52.239 70.0861 51.1807Z" fill="#FF5F46"/>
      <path d="M58.974 56.8236C57.6512 58.2346 56.0637 59.2048 54.2999 59.9103C52.3597 58.3228 49.9785 57 47.5091 56.2944L46.8036 58.852C51.7423 60.2631 55.7991 63.9671 57.563 68.7295L60.0323 67.7593C59.2386 65.5546 58.0039 63.6143 56.4165 61.8505C58.0921 61.0568 59.5914 59.9985 60.9143 58.5874L58.974 56.8236Z" fill="#FF5F46"/>
      <path d="M91.693 114.325C90.7229 114.325 89.841 114.501 89.0472 114.854L83.5794 105.947L81.2864 107.358L86.7543 116.265C85.1668 117.676 84.1967 119.616 84.1967 121.909C84.1967 126.054 87.548 129.406 91.693 129.406C95.838 129.406 99.1893 126.054 99.1893 121.909C99.1893 117.764 95.838 114.325 91.693 114.325ZM91.693 126.584C89.0472 126.584 86.8424 124.379 86.8424 121.733C86.8424 119.087 89.0472 116.883 91.693 116.883C94.3387 116.883 96.5435 119.087 96.5435 121.733C96.5435 124.379 94.3387 126.584 91.693 126.584Z" fill="#FF5F46"/>
      <path d="M74.4077 96.5991C74.4077 103.302 68.9398 108.681 62.3254 108.681C61.3553 108.681 60.4734 108.593 59.5915 108.329L58.9741 110.886C60.0324 111.151 61.1789 111.239 62.3254 111.239C67.3523 111.239 71.7619 108.77 74.4077 104.889V114.414C74.4077 121.116 68.9398 126.496 62.3254 126.496C55.6229 126.496 50.2432 121.028 50.2432 114.414C50.2432 111.063 51.566 107.976 54.0354 105.683L52.1834 103.743C49.9786 105.859 48.4793 108.505 47.9502 111.415C39.3074 111.415 31.1938 102.861 31.1938 93.777C31.1938 91.5722 31.6347 89.3674 32.5166 87.339L32.7812 86.9862C28.7244 84.0759 26.4314 79.4017 26.4314 74.463C26.4314 66.3494 32.5166 59.4704 40.6303 58.5885L40.2775 55.3254C36.838 51.6214 35.6915 45.8889 37.1026 40.5092C38.1609 36.5406 40.7185 33.2775 44.4225 31.2491C47.862 29.3089 51.8306 28.6915 55.3583 29.6616C60.5616 31.0727 64.1774 35.9233 64.7066 41.9203L67.6169 41.6557C67.176 36.276 64.5302 31.6901 60.5616 28.9561C60.8262 25.3403 63.8247 22.4299 67.5287 22.4299C71.4092 22.4299 74.4959 25.6048 74.4959 29.3971V70.4062H77.1416V29.3971C77.1416 24.1056 72.8202 19.7842 67.5287 19.7842C62.8546 19.7842 58.9741 23.1355 58.0922 27.545C57.4749 27.2805 56.7693 27.0159 56.0638 26.8395C51.8306 25.693 47.0683 26.3986 42.9233 28.6915C38.6019 31.1609 35.5152 35.0413 34.2805 39.6273C32.693 45.4479 33.7513 51.5332 37.0144 55.9428C28.9008 58.3239 23.1683 65.732 23.1683 74.463C23.1683 79.5781 25.1967 84.4287 28.7244 87.9563C28.1071 89.8965 27.7543 91.8367 27.7543 93.8652C27.7543 104.713 37.1908 114.59 47.5092 114.767C47.6856 122.792 54.2118 129.23 62.2372 129.23C70.3509 129.23 76.9652 122.616 76.9652 114.502V78.4316H74.3195V96.5991H74.4077Z" fill="#FF5F46"/>
      <path d="M105.275 50.5613C106.509 51.4432 107.92 51.8842 109.508 51.8842C113.653 51.8842 117.004 48.5329 117.004 44.3879C117.004 40.2429 113.653 36.8916 109.508 36.8916C105.363 36.8916 102.012 40.2429 102.012 44.3879C102.012 45.9753 102.541 47.4746 103.334 48.6211L92.2223 59.9096H80.8456V62.5554H93.3688L105.275 50.5613ZM109.596 39.5374C112.242 39.5374 114.447 41.7421 114.447 44.3879C114.447 47.0336 112.242 49.2384 109.596 49.2384C106.95 49.2384 104.746 47.0336 104.746 44.3879C104.746 41.7421 106.862 39.5374 109.596 39.5374Z" fill="#FF5F46"/>
      <path d="M86.4014 73.1387H81.1099V75.7844H86.4014V73.1387Z" fill="#FF5F46"/>
      <path d="M78.4645 73.1387H73.173V75.7844H78.4645V73.1387Z" fill="#FF5F46"/>
      <path d="M70.5275 73.1387H65.236V75.7844H70.5275V73.1387Z" fill="#FF5F46"/>
      <path d="M62.5897 73.1387H57.2982V75.7844H62.5897V73.1387Z" fill="#FF5F46"/>
      <path d="M83.5794 42.9776L88.959 34.2466C89.841 34.5994 90.7229 34.7758 91.693 34.7758C95.838 34.7758 99.1893 31.4245 99.1893 27.2795C99.1893 23.1345 95.838 19.7832 91.693 19.7832C87.548 19.7832 84.1967 23.1345 84.1967 27.2795C84.1967 29.4843 85.1668 31.5127 86.6661 32.8356L81.2864 41.5665L83.5794 42.9776ZM91.693 22.429C94.3387 22.429 96.5435 24.6337 96.5435 27.2795C96.5435 29.9252 94.3387 32.13 91.693 32.13C89.0472 32.13 86.8424 29.9252 86.8424 27.2795C86.8424 24.6337 89.0472 22.429 91.693 22.429Z" fill="#FF5F46"/>
      <path d="M109.596 97.0384C108.009 97.0384 106.509 97.5675 105.363 98.3612L93.2806 86.3672H80.8456V89.0129H92.2223L103.423 100.213C102.541 101.448 102.1 102.859 102.1 104.446C102.1 108.591 105.451 111.943 109.596 111.943C113.741 111.943 117.092 108.591 117.092 104.446C117.092 100.301 113.653 97.0384 109.596 97.0384ZM109.596 109.297C106.95 109.297 104.746 107.092 104.746 104.446C104.746 101.801 106.95 99.5959 109.596 99.5959C112.242 99.5959 114.447 101.801 114.447 104.446C114.447 107.092 112.242 109.297 109.596 109.297Z" fill="#FF5F46"/>
      <path d="M62.3251 96.1575C62.4133 95.6284 62.5015 95.1874 62.5015 94.6583C62.5015 90.9542 59.8557 87.9557 56.328 87.3383C57.9155 85.5745 59.2384 83.4579 60.1203 81.0767L57.6509 80.1948C56.4162 83.6343 54.0351 86.4564 51.0365 88.3966C50.9484 88.4848 50.8602 88.4848 50.8602 88.4848C48.3026 90.0723 45.3923 90.9542 42.3056 90.9542C41.7764 90.9542 41.1591 90.9542 40.6299 90.866L40.3654 93.5118C40.9827 93.6 41.6882 93.6 42.3056 93.6C46.0096 93.6 49.5373 92.5417 52.4476 90.6014C53.2413 90.1605 54.0351 89.8959 55.0052 89.8959C57.6509 89.8959 59.8557 92.1007 59.8557 94.7464C59.8557 95.0992 59.8557 95.3638 59.7675 95.7166L62.3251 96.1575Z" fill="#FF5F46"/>
    </svg>
  );
}

export function MLOpsBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M130.1 46.06L127.45 47.46C131.95 56 134.24 65.27 134.24 75C134.24 107.67 107.66 134.24 75 134.24C42.34 134.24 15.77 107.66 15.77 75C15.77 42.34 42.34 15.77 75 15.77C88.63 15.77 101.69 20.43 112.21 28.93H103.95V31.93H117.77V18.11H114.77V27.13C103.61 17.84 89.62 12.76 75.01 12.76C40.7 12.76 12.78 40.68 12.78 74.99C12.78 109.31 40.7 137.23 75.01 137.23C109.33 137.23 137.25 109.31 137.25 74.99C137.23 64.77 134.83 55.03 130.1 46.06Z" fill="#FF5F46"/>
      <path d="M110.18 45.25L77.35 45.26L70.28 52.8C68.73 51.61 66.79 50.89 64.69 50.89C60.14 50.89 56.36 54.22 55.64 58.58L35.18 58.57C41.63 42.98 56.92 32.37 73.85 31.94H74.32C74.43 31.94 74.54 31.93 74.65 31.93L91.26 31.94V28.94H77.65H75.77C75.24 28.92 74.67 28.92 74.26 28.94H73.81C54.9 29.42 37.93 41.73 31.58 59.57L30.87 61.57L55.64 61.5801C56.36 65.93 60.14 69.27 64.69 69.27C69.75 69.27 73.87 65.1501 73.87 60.08C73.87 58.2001 73.3 56.46 72.33 55L78.65 48.27L108.75 48.26C112.15 52.54 114.66 57.33 116.23 62.53L89.62 62.57L74.52 77.6601H56.64C55.92 73.3101 52.14 69.9801 47.59 69.9801C43.04 69.9801 39.26 73.3101 38.54 77.6601H28.98L29.13 79.3001C31.34 103.11 51.05 121.07 74.99 121.07C97.04 121.07 116.06 105.38 120.21 83.77L120.55 81.99H108.27C107.55 77.64 103.77 74.3001 99.22 74.3001C94.16 74.3001 90.04 78.42 90.04 83.49C90.04 85.48 90.68 87.3201 91.77 88.8301L82.59 98H76.59C75.87 93.65 72.09 90.32 67.54 90.32C62.48 90.32 58.36 94.44 58.36 99.5C58.36 104.56 62.48 108.69 67.54 108.69C72.09 108.69 75.87 105.36 76.59 101H83.83L93.9 90.9401C95.41 92.0201 97.25 92.6601 99.24 92.6601C103.79 92.6601 107.57 89.3301 108.29 84.9801H116.9C112.34 104.26 95.01 118.06 75 118.06C53.17 118.06 35.1 102.09 32.31 80.6501H38.55C39.27 85 43.05 88.34 47.6 88.34C52.15 88.34 55.93 85.0101 56.65 80.6501H75.77L90.87 65.56L120.13 65.52L119.66 63.6501C117.99 57.0601 114.95 51.06 110.64 45.8L110.18 45.25ZM64.69 66.2601C61.28 66.2601 58.5 63.49 58.5 60.07C58.5 56.66 61.27 53.89 64.69 53.89C68.1 53.89 70.87 56.66 70.87 60.07C70.88 63.48 68.1 66.2601 64.69 66.2601ZM67.53 105.69C64.12 105.69 61.35 102.92 61.35 99.5C61.35 96.09 64.12 93.32 67.53 93.32C70.94 93.32 73.72 96.09 73.72 99.5C73.72 102.92 70.94 105.69 67.53 105.69ZM99.23 89.6601C95.82 89.6601 93.05 86.8901 93.05 83.4801C93.05 80.0701 95.82 77.2901 99.23 77.2901C102.64 77.2901 105.42 80.0601 105.42 83.4801C105.42 86.8901 102.64 89.6601 99.23 89.6601ZM47.59 85.34C44.18 85.34 41.41 82.5701 41.41 79.1601C41.41 75.7501 44.18 72.9701 47.59 72.9701C51 72.9701 53.78 75.7401 53.78 79.1601C53.78 82.5701 51 85.34 47.59 85.34Z" fill="#FF5F46"/>
    </svg>
  );
}

export function ModelRegistryBrandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <g clipPath="url(#mrClip)">
        <path d="M75 85.2999C78.993 85.2999 82.23 82.0629 82.23 78.0698C82.23 74.0768 78.993 70.8398 75 70.8398C71.007 70.8398 67.77 74.0768 67.77 78.0698C67.77 82.0629 71.007 85.2999 75 85.2999Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M22.1 93.1802C26.093 93.1802 29.33 89.9432 29.33 85.9502C29.33 81.9572 26.093 78.7202 22.1 78.7202C18.107 78.7202 14.87 81.9572 14.87 85.9502C14.87 89.9432 18.107 93.1802 22.1 93.1802Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M94.63 35.5498C98.623 35.5498 101.86 32.3129 101.86 28.3198C101.86 24.3268 98.623 21.0898 94.63 21.0898C90.637 21.0898 87.4 24.3268 87.4 28.3198C87.4 32.3129 90.637 35.5498 94.63 35.5498Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M108.28 127.17C112.273 127.17 115.51 123.933 115.51 119.94C115.51 115.947 112.273 112.71 108.28 112.71C104.287 112.71 101.05 115.947 101.05 119.94C101.05 123.933 104.287 127.17 108.28 127.17Z" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M91.97 35.04L77.65 71.35" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M79.5 83.73L103.78 114.29" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M67.85 79.1401L29.25 84.8901" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M21.52 78.7201C21.52 78.5001 21.52 78.2901 21.52 78.0701C21.52 48.5301 45.47 24.5801 75.01 24.5801" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M102.33 124.06C94.3301 128.82 84.9901 131.56 75.0001 131.56C55.2101 131.56 37.9201 120.81 28.6801 104.83" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M101.16 31.4102C117.47 40.5702 128.48 58.0302 128.48 78.0702C128.48 87.8102 125.88 96.9502 121.32 104.81" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M65.04 32.0701L76.12 24.5901L65.04 17.1001" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M119.82 92.4502L120.76 105.79L132.78 99.9302" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
        <path d="M40.1401 109.69L28.1101 103.84L27.1801 117.18" stroke="#FF5F46" strokeWidth="3" strokeMiterlimit="3" strokeLinecap="square"/>
      </g>
      <defs>
        <clipPath id="mrClip"><rect width="150" height="150" fill="white"/></clipPath>
      </defs>
    </svg>
  );
}

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
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} style={{ color: "#FF5F46", ...(props.style || {}) }}>
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
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} style={{ color: "#FF5F46", ...(props.style || {}) }}>
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
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" {...props} style={{ color: "#FF5F46", ...(props.style || {}) }}>
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
export function McpIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 22v-5" />
      <rect x="8" y="9" width="8" height="8" rx="1.5" />
      <path d="M10 9V5a2 2 0 1 1 4 0v4" />
      <path d="M3 12h2M19 12h2M5 12a7 7 0 0 0 14 0" />
    </svg>
  );
}

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
  "dbCatalog",
  "dbSchema",
  "dbTable",
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

/** Built-in icon keys that are THIRD-PARTY trademarked brand marks — gated
 *  behind `enableTrademarkLogos` (otherwise rendered as a neutral text badge).
 *  Databricks/Delta/Iceberg/cloud marks are NOT here (always allowed). */
export const TRADEMARK_ICONS = new Set<DatabricksIconName>([
  "shopifyLogo",
  "zendeskLogo",
  "sapLogo",
]);
