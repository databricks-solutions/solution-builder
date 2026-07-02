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
import { saveProjectFile, getArchitectureStandaloneTemplate, type DeployedResourceLink } from "@/lib/custom-api";
import { Check, ChevronDown, Download, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Canvas } from "./platform-diagram/canvas";
import { CustomLogosContext } from "./platform-diagram/shared";
import { exportDiagramImage } from "./platform-diagram/export-image";

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
  // --- Guard against the diagram's own auto-save echoing back and reverting
  //     the canvas to a stale version. -------------------------------------
  // The canvas auto-saves architecture.md (debounced). That write trips the
  // file-watcher, which makes the workspace RE-FETCH architecture.md and feed
  // it back as a new `content` prop. Two failure modes that caused the "it
  // jumped back to an older version" bug:
  //   (a) the refetch returns the exact md we just wrote → a needless re-parse
  //       + full canvas re-seed (also nukes undo history); and
  //   (b) a file_changed for ANOTHER file fires the refetch while our debounced
  //       save hasn't flushed yet → the refetch reads OLDER disk content and
  //       re-seeds the canvas back to it, clobbering the live (newer) edits.
  // Fix: remember (i) the md we last authored and (ii) whether a save is in
  // flight. Ignore any incoming `content` that equals what we authored (own
  // echo) or that arrives while our own newer edits are still un-persisted.
  const lastAuthoredMd = useRef<string | null>(null);
  const savePending = useRef(false);
  // The `content` we accept into the parser. Starts as the prop; only advances
  // to a NEW prop value when that value isn't our own echo / mid-save stale.
  const [acceptedContent, setAcceptedContent] = useState<string | null>(content);
  useEffect(() => {
    if (content == null) { setAcceptedContent(content); return; }
    // Our own save echo — the file we just wrote came back. Ignore it (the
    // live canvas already reflects it; re-seeding would only reset history).
    if (content === lastAuthoredMd.current) return;
    // A save is in flight → our un-persisted edits are newer than any disk
    // content the refetch could return. Don't let a stale refetch win.
    if (savePending.current) return;
    setAcceptedContent(content);
  }, [content]);

  // Parse the ACCEPTED flat architecture.md into the internal schema. The file
  // is the sole source of truth for what's shown (no capability-state seeding).
  const built = useMemo(
    () => parseArchitecture(acceptedContent ?? ""),
    [acceptedContent],
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
      lastAuthoredMd.current = md; // so the watcher echo of this write is ignored
      if (onSave) { onSave(md); return; } // standalone: host owns persistence
      setStatus("saving");
      savePending.current = true; // ignore any refetch until this lands on disk
      saveProjectFile(projectId, "architecture.md", md)
        .then(() => setStatus("saved"))
        .catch(() => setStatus("error"))
        .finally(() => { savePending.current = false; });
    },
    [projectId, onSave],
  );

  // Toggle the trademark-logo opt-in and persist (re-serializes with the flag).
  const onSetTrademark = useCallback((on: boolean) => {
    setTrademark(on);
    const next: PlatformSchema = { ...schemaRef.current, enableTrademarkLogos: on };
    const md = serializeArchitecture(next, next.layout);
    lastAuthoredMd.current = md; // ignore this write's own watcher echo
    if (onSave) { onSave(md); return; } // standalone: host owns persistence
    setStatus("saving");
    savePending.current = true;
    saveProjectFile(projectId, "architecture.md", md)
      .then(() => setStatus("saved"))
      .catch(() => setStatus("error"))
      .finally(() => { savePending.current = false; });
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
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <div className="text-sm font-medium text-foreground">{schema.name}</div>
          <div className="flex items-center gap-2">
            <SaveChip status={status} />
            {/* Download menu — PNG/SVG capture, or a self-contained standalone
                HTML (the architecture-skill editor template with THIS diagram
                baked into its inline JSON block). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11.5px] font-medium text-foreground hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" /> Download <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="cursor-pointer" onClick={() => void exportDiagramImage("png")}>Image (PNG)</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => void exportDiagramImage("svg")}>Image (SVG)</DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={async () => {
                    try {
                      const template = await getArchitectureStandaloneTemplate();
                      let json = (lastAuthoredMd.current ?? acceptedContent ?? "").trim();
                      const fence = json.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
                      if (fence) json = fence[1].trim();
                      try { json = JSON.stringify(JSON.parse(json), null, 2); } catch { /* keep as-is */ }
                      const replaced = template.replace(
                        /(<script[^>]*id="architecture"[^>]*>)([\s\S]*?)(<\/script>)/,
                        (_all, open, _body, close) => `${open}\n${json}\n${close}`,
                      );
                      const blob = new Blob([replaced], { type: "text/html" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = "architecture.html";
                      a.click();
                    } catch (e) {
                      console.error("standalone HTML export failed:", e);
                    }
                  }}
                >
                  Standalone HTML (editable page)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
