/**
 * PlatformDiagram — the architecture tab's interactive canvas.
 * ============================================================
 *
 * A Lucidchart-style editor for the demo's Databricks architecture, built on
 * ReactFlow (@xyflow/react):
 *
 *   • Brand-icon component nodes, draggable; positions persist to architecture.md.
 *   • A component LIBRARY palette (left) — drag a component onto the canvas to
 *     add it, delete a node to remove it.
 *   • Editable, animated edges — connect nodes by dragging from their dots,
 *     toggle the "data flowing" red-dot animation, reposition, persist.
 *   • Click a node → a detail panel with its description + live deep-link.
 *   • Special nodes: source tiles (vendor logos), a vertical "Lakeflow Connect"
 *     rail, and an SDP node that shows bronze/silver/gold as little tables.
 *
 * Persistence: on any layout change we debounce-save the whole architecture.md
 * (semantic bands preserved, `layout` block rewritten) via saveProjectFile.
 *
 * Schema/layout resolution lives in `lib/platform-architecture`; this file is
 * the canvas + interactions.
 */

import { memo, useMemo, useState, useEffect, useRef, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  parseArchitecture,
  resolveDeepLink,
  serializeArchitecture,
  type PlatformSchema,
} from "@/lib/platform-architecture";
import { saveProjectFile, type DeployedResourceLink } from "@/lib/custom-api";
import { Check, Loader2 } from "lucide-react";
import { Canvas } from "./platform-diagram/canvas";
import { CustomLogosContext } from "./platform-diagram/shared";

// ---------------------------------------------------------------------------
// Top-level component — owns parse, deep-link resolution, save
// ---------------------------------------------------------------------------

interface PlatformDiagramProps {
  content: string | null;
  capabilities: { buildable: string[]; talking_track: string[] } | null;
  deployedResources?: DeployedResourceLink[];
  projectId: string;
  /** Initial edit-mode (default true). The standalone viewer passes false. */
  defaultEditMode?: boolean;
  /** Hard read-only: hide the canvas action bar entirely (no View/Edit toggle,
   *  undo/redo, logos toggle). The standalone VIEWER passes this. */
  readOnly?: boolean;
  /** Standalone override: when set, persistence is handled by the host (e.g. the
   *  standalone keeps the serialized markdown in memory for "Download HTML")
   *  instead of saving to the backend. Receives the full architecture.md string. */
  onSave?: (md: string) => void;
  /** Hide the top save-status bar (the standalone has its own chrome). */
  hideChrome?: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function PlatformDiagram({ content, deployedResources, projectId, defaultEditMode = true, readOnly, onSave, hideChrome }: PlatformDiagramProps) {
  // Parse the flat architecture.md into the internal schema. The file is the
  // sole source of truth for what's shown (no capability-state seeding).
  const built = useMemo(
    () => parseArchitecture(content ?? ""),
    [content],
  );
  // Trademark-logo opt-in is editable on the canvas; keep it as local state
  // seeded from the file, and fold it back onto the schema so both render and
  // save see it. (null until the user toggles → use the file's value.)
  const [trademark, setTrademark] = useState<boolean | null>(null);
  useEffect(() => { setTrademark(null); }, [built]); // re-seed on file reload
  const schema = useMemo<PlatformSchema>(
    () => (trademark === null ? built : { ...built, enableTrademarkLogos: trademark }),
    [built, trademark],
  );

  const deepLinks = useMemo(() => {
    const map: Record<string, string | null> = {};
    schema.bands.forEach((b) =>
      b.components.forEach((c) => (map[c.id] = resolveDeepLink(c, deployedResources))),
    );
    return map;
  }, [schema, deployedResources]);

  const [status, setStatus] = useState<SaveStatus>("idle");
  // Serialize from the live SCHEMA (always complete: bands + descriptions),
  // never from the parsed override — so a save can't strip the file.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const onPersist = useCallback(
    (layout: PlatformSchema["layout"]) => {
      const md = serializeArchitecture(schemaRef.current, layout);
      if (onSave) { onSave(md); return; } // standalone: host owns persistence
      setStatus("saving");
      saveProjectFile(projectId, "architecture.md", md)
        .then(() => setStatus("saved"))
        .catch(() => setStatus("error"));
    },
    [projectId, onSave],
  );

  // Toggle the trademark-logo opt-in and persist (re-serializes with the flag).
  const onSetTrademark = useCallback((on: boolean) => {
    setTrademark(on);
    const next: PlatformSchema = { ...schemaRef.current, enableTrademarkLogos: on };
    const md = serializeArchitecture(next, next.layout);
    if (onSave) { onSave(md); return; } // standalone: host owns persistence
    setStatus("saving");
    saveProjectFile(projectId, "architecture.md", md)
      .then(() => setStatus("saved"))
      .catch(() => setStatus("error"));
  }, [projectId, onSave]);

  // Reset "saved" → "idle" after a moment so the chip doesn't linger.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <div className="flex h-full w-full flex-col">
      {!hideChrome && (
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
          <div className="text-sm font-medium text-foreground">{schema.name}</div>
          <SaveChip status={status} />
        </div>
      )}
      <CustomLogosContext.Provider value={schema.customLogos ?? {}}>
        <ReactFlowProvider>
          <Canvas schema={schema} deepLinks={deepLinks} onPersist={onPersist} onSetTrademark={onSetTrademark} defaultEditMode={defaultEditMode} readOnly={readOnly} />
        </ReactFlowProvider>
      </CustomLogosContext.Provider>
    </div>
  );
}

const SaveChip = memo(function SaveChip({ status }: { status: SaveStatus }) {
  if (status === "idle") return <span className="text-[11px] text-muted-foreground">Drag to arrange · auto-saves</span>;
  if (status === "saving")
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  if (status === "saved")
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-emerald-600">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  return <span className="text-[11px] text-destructive">Save failed</span>;
});

export default memo(PlatformDiagram);
