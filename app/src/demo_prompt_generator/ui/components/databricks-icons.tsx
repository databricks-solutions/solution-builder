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
export function KnowledgeAssistantIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* Book shape */}
      <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Spine */}
      <path d="M5.5 1v14" stroke="currentColor" strokeWidth="1.5" />
      {/* Sparkle */}
      <path d="M10 5l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5.5-1z" fill="currentColor" />
    </svg>
  );
}

// Multi-Agent Supervisor icon
export function MultiAgentSupervisorIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" {...props}>
      {/* Central hub */}
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Agent nodes */}
      <circle cx="8" cy="2.5" r="1.5" fill="currentColor" />
      <circle cx="2.5" cy="8" r="1.5" fill="currentColor" />
      <circle cx="13.5" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="13.5" r="1.5" fill="currentColor" />
      {/* Connecting lines */}
      <path d="M8 4v2M8 10v2M6 8H4M10 8h2" stroke="currentColor" strokeWidth="1" />
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
} as const;

export type DatabricksIconName = keyof typeof DATABRICKS_ICONS;
