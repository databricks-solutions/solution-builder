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
      <path d="M13 13.75C13 14.5784 11.6569 15.25 10 15.25C8.34315 15.25 7 14.5784 7 13.75" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3.39373 5.58639C3.91293 3.52534 5.77786 2 8 2C10.5504 2 12.6314 4.01005 12.7451 6.5324C14.1591 6.7189 15.3247 7.69323 15.7866 9H14.1211C13.7175 8.39701 13.0301 8 12.25 8H12C11.5858 8 11.25 7.66421 11.25 7.25V6.75C11.25 4.95507 9.79493 3.5 8 3.5C6.34131 3.5 4.97186 4.74324 4.7745 6.34833C4.73041 6.70685 4.43704 6.98301 4.07651 7.00536C2.63892 7.09448 1.5 8.28952 1.5 9.75C1.5 11.1845 2.59873 12.3629 4 12.4888V14C3.93845 14 3.87864 13.9926 3.8214 13.9786C1.67511 13.7633 0 11.9526 0 9.75C0 7.69604 1.45669 5.98279 3.39373 5.58639Z" fill="currentColor" />
      <path d="M7 11.5V13.7769" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M13 11.5V13.7769" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <ellipse cx="10" cy="11.5" rx="3" ry="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
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
      <path fill="currentColor" fillRule="evenodd" d="M3 1.75A.75.75 0 0 1 3.75 1h10.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75V12.5H1V11h2V8.75H1v-1.5h2V5H1V3.5h2zm1.5.75v11H6v-11zm3 0v11h6v-11z" clipRule="evenodd" />
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
      <path d="M5 3V1h5.5l2.5 2.5v9.5a1 1 0 0 1-1 1H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M10.5 1v2.5H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Front paper with folded corner */}
      <path d="M2 3h6l2 2v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M8 3v2h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Text lines */}
      <path d="M4 9h4M4 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <ellipse cx="8" cy="3" rx="5.5" ry="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Left side */}
      <path d="M2.5 3v10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Middle ring 1 */}
      <path d="M2.5 6.5c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Middle ring 2 */}
      <path d="M2.5 10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// Delta Table icon (database with delta symbol)
export function DeltaTableIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* Top ellipse */}
      <ellipse cx="8" cy="3" rx="5.5" ry="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Left side */}
      <path d="M2.5 3v10c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Middle ring */}
      <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Delta symbol inside */}
      <path d="M8 6l-2 4h4l-2-4z" fill="currentColor" />
    </svg>
  );
}

// Business User icon
export function BusinessUserIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="8" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Input Data / External Source icon
export function InputDataIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="1.5" y="2.5" width="10" height="11" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
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
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <ellipse cx="8" cy="3.5" rx="5" ry="1.75" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3 3.5v9c0 .97 2.24 1.75 5 1.75s5-.78 5-1.75v-9" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3 7.5c0 .97 2.24 1.75 5 1.75s5-.78 5-1.75" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M13 10.5c0 .97-2.24 1.75-5 1.75S3 11.47 3 10.5" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" fill="none" />
    </svg>
  );
}

// Databricks Apps icon — browser window with Databricks diamond
export function DatabricksAppsIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M1 5.5h14" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="3" cy="3.75" r="0.5" fill="currentColor" />
      <circle cx="4.75" cy="3.75" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="3.75" r="0.5" fill="currentColor" />
      <path d="M8 7.5l-2.5 2.5 2.5 2.5 2.5-2.5L8 7.5z" fill="currentColor" />
    </svg>
  );
}

// Streaming icon — real-time data flow with lightning bolt
export function StreamingIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M2 4h3l2-2h3l2 2h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M2 4v8l3-1.5L7 12l2-1.5L11 12l3-1.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M8.5 6L7 9h2l-1.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Metric Views icon — chart with checkmark (governed metrics)
export function MetricViewsIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M2 13V7l3-2 3 3 3-5 3 2v8H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 9l1.5 1.5 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
      <path d="M4 12l4-8 4 8H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M12 5l2.5-1M12 8l2.5 0M12 11l2.5 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <ellipse cx="12" cy="5.5" rx="7" ry="2.6" fill="#7C3AED" />
      <path
        fill="#8B5CF6"
        d="M5 5.5v13c0 1.44 3.13 2.6 7 2.6s7-1.16 7-2.6v-13c0 1.44-3.13 2.6-7 2.6s-7-1.16-7-2.6z"
      />
      <ellipse cx="12" cy="5.5" rx="7" ry="2.6" fill="#A78BFA" />
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
  streaming: StreamingIcon,
  metricViews: MetricViewsIcon,
  aiFunctions: AIFunctionsIcon,
  deltaSharing: DeltaSharingIcon,
  // Official brand product icons (multi-color, self-colored — do not recolor).
  genieBrand: GenieBrandIcon,
  aibiBrand: AIBIBrandIcon,
  unityCatalogBrand: UnityCatalogBrandIcon,
  lakehouseBrand: LakehouseBrandIcon,
  lakebaseBrand: LakebaseBrandIcon,
  aiGatewayBrand: AIGatewayBrandIcon,
  genieCodeBrand: GenieCodeBrandIcon,
  lakeflowConnectBrand: LakeflowConnectBrandIcon,
  lakeflowJobsBrand: LakeflowJobsBrandIcon,
  sdpBrand: SDPBrandIcon,
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
