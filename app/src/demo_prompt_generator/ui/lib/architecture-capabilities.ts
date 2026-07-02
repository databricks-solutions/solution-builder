/**
 * architecture-capabilities — extract buildable capability slugs from a
 * project's architecture.md so the "Build the solution for this architecture"
 * dialog can pre-select them.
 *
 * SOLUTION-BUILDER ONLY. This file must NEVER be imported by
 * `components/project/platform-diagram/*` or `standalone.tsx` — it is specific
 * to the solution builder's project-creation flow, and the packaged standalone
 * architecture skill must not ship it.
 *
 * Mapping model: catalog component ids ARE capability slugs by design (see
 * platform-architecture.ts CATALOG), so extraction is mostly identity. Only
 * the composite blocks (which bundle several capabilities) and a couple of
 * special cases need an explicit map.
 */
import { parseArchitectureFile, baseId } from "./platform-architecture";
import { CAPABILITY_META } from "./capabilities";
import { SIMPLE_BASELINE, APP_BUNDLE } from "@/components/capabilities-panel";

/** Node types that are free-form annotations / visuals, never capabilities. */
const NON_CAPABILITY_TYPES = new Set(["text", "box", "logo", "image", "source"]);

/** Composite blocks → the capability slugs they bundle. `agent-bricks` is
 *  handled separately (its mapping depends on whether the diagram feeds it
 *  documents). */
const COMPOSITE_MAP: Record<string, string[]> = {
  "lakeflow-block": ["sdp", "lakeflow-connect"],
  "lakeflow-genie-block": ["sdp", "lakeflow-connect", "genie-code"],
  "governance-block": ["unity-catalog"],
  "db-platform": [],
  "genie-code": ["genie-code"],
};

export interface ExtractedArchitecture {
  /** Deduped capability slugs found in the diagram (all keys of CAPABILITY_META). */
  capabilities: string[];
  /** Diagram includes the app/lakebase pair → pre-toggle the app bundle. */
  hasApp: boolean;
  /** Every capability fits the Simple tab (baseline + app bundle; sdp counts
   *  as simple because the lakeflow composite is in virtually every diagram
   *  and the simple flow builds the pipeline anyway). */
  isSimple: boolean;
  /** Human-readable names of the diagram's data sources (source tiles), fed
   *  to the story-suggestion endpoint so ideas anchor in the exact systems
   *  the user drew. Deduped, capped at 10. */
  datasources: string[];
  name?: string;
  story?: string;
}

const SIMPLE_ENVELOPE = new Set<string>([
  ...SIMPLE_BASELINE,
  ...APP_BUNDLE,
  "sdp",
  "synthetic-data-gen",
]);

/** Any node that looks like a document source (PDF / docs on a Volume) —
 *  drives the agent-bricks → knowledge-assistant mapping. */
function hasDocSource(nodes: { id?: string; icon?: string }[]): boolean {
  return nodes.some((n) => {
    const hay = `${n.id ?? ""} ${n.icon ?? ""}`.toLowerCase();
    return hay.includes("pdf") || hay.includes("document") || hay.includes("volume");
  });
}

/** Human name for a source tile: its label override when set, else the id
 *  prettified ("src-sap-erp" → "Sap Erp"). */
function sourceName(n: { id?: string; label?: string }): string {
  if (n.label?.trim()) return n.label.trim();
  const slug = baseId(n.id ?? "").replace(/^src-/, "");
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

/** Parse architecture.md and extract the capability slugs it implies.
 *  Returns null when the content isn't a parseable architecture file. */
export function extractArchitectureCapabilities(
  content: string | null,
): ExtractedArchitecture | null {
  const file = content ? parseArchitectureFile(content) : null;
  if (!file) return null;
  const nodes = file.nodes ?? [];
  const docSource = hasDocSource(nodes);

  const out = new Set<string>();
  for (const n of nodes) {
    if (!n?.type || NON_CAPABILITY_TYPES.has(n.type)) continue;
    const t = baseId(n.type);
    if (t === "agent-bricks") {
      // PDF/doc source feeding Agent Bricks → it's a Knowledge Assistant
      // story; otherwise the composite's core is the Supervisor Agent.
      out.add(docSource ? "knowledge-assistant" : "supervisor-agent");
      continue;
    }
    const mapped = COMPOSITE_MAP[t];
    if (mapped) {
      for (const c of mapped) out.add(c);
      continue;
    }
    if (t in CAPABILITY_META) out.add(t);
    // Anything else (sources, personas, unknown ids) is ignored — we stay
    // with what maps cleanly.
  }

  const capabilities = Array.from(out);
  const hasApp = capabilities.includes("databricks-apps") || capabilities.includes("lakebase");
  const isSimple = capabilities.every((c) => SIMPLE_ENVELOPE.has(c));
  // Source tiles → human-readable datasource names for the story suggester.
  const datasources = Array.from(
    new Set(
      nodes
        .filter((n) => n?.type === "source")
        .map(sourceName)
        .filter(Boolean),
    ),
  ).slice(0, 10);
  return {
    capabilities,
    hasApp,
    isSimple,
    datasources,
    name: file.name,
    story: file.story,
  };
}
