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
  parseArchitectureTabs,
  resolveDeepLink,
  serializeArchitecture,
  serializeArchitectureTabs,
  type PlatformSchema,
} from "@/lib/platform-architecture";
import { saveProjectFile, getArchitectureStandaloneTemplate, type DeployedResourceLink } from "@/lib/custom-api";
import { Check, ChevronDown, Download, Loader2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Canvas } from "./platform-diagram/canvas";
import { CustomLogosContext } from "./platform-diagram/shared";
import { exportDiagramImage } from "./platform-diagram/export-image";
import { TabBar } from "./platform-diagram/tab-bar";

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
  /** Skip the built-in in-app save-status + Download in the floating toolbar.
   *  The standalone passes this (it injects its OWN controls via toolbarExtras). */
  hideChrome?: boolean;
  /** Caller-supplied controls for the RIGHT end of the canvas floating toolbar.
   *  When provided, these are used INSTEAD of the built-in in-app save+Download
   *  (the standalone passes its file-linking Save + Download here). */
  toolbarExtras?: React.ReactNode;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function PlatformDiagram({ content, deployedResources, projectId, defaultEditMode = true, readOnly, onSave, hideChrome, toolbarExtras: toolbarExtrasProp }: PlatformDiagramProps) {
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

  // --- Multi-tab: the file is an ARRAY of architectures (one per tab). ------
  // `tabBodies` is the live source of truth for every tab's single-architecture
  // JSON body; `tabNames` the labels. Re-derived whenever accepted content
  // changes (a genuine external load — own echoes are already filtered above).
  // The ACTIVE tab's body feeds the existing single-architecture pipeline
  // unchanged; a save splices that tab's new body back into the array.
  const [tabBodies, setTabBodies] = useState<string[]>(() =>
    parseArchitectureTabs(acceptedContent ?? "").map((t) => t.body),
  );
  const [tabNames, setTabNames] = useState<string[]>(() =>
    parseArchitectureTabs(acceptedContent ?? "").map((t) => t.name),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const tabs = parseArchitectureTabs(acceptedContent ?? "");
    setTabBodies(tabs.map((t) => t.body));
    setTabNames(tabs.map((t) => t.name));
    setActiveIndex((i) => Math.min(i, Math.max(0, tabs.length - 1)));
  }, [acceptedContent]);

  const activeBody = tabBodies[activeIndex] ?? "";

  // Parse the ACTIVE tab's body into the internal schema. The file is the sole
  // source of truth for what's shown (no capability-state seeding).
  const built = useMemo(
    () => parseArchitecture(activeBody),
    [activeBody],
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
  // Refs so the save helpers read the CURRENT tab set without being re-created
  // on every tab edit (keeps onPersist/onSetTrademark stable for the Canvas).
  const tabBodiesRef = useRef(tabBodies);
  tabBodiesRef.current = tabBodies;
  const tabNamesRef = useRef(tabNames);
  tabNamesRef.current = tabNames;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Write the whole multi-tab file (array of every tab's body). Sets the echo
  // guard to the full-array string so the watcher re-fetch of our own write is
  // ignored. Standalone (onSave) vs in-app (saveProjectFile) split preserved.
  const writeTabs = useCallback((bodies: string[]) => {
    const md = serializeArchitectureTabs(bodies);
    lastAuthoredMd.current = md;
    if (onSave) { onSave(md); return; }
    setStatus("saving");
    savePending.current = true;
    saveProjectFile(projectId, "architecture.md", md)
      .then(() => setStatus("saved"))
      .catch(() => setStatus("error"))
      .finally(() => { savePending.current = false; });
  }, [projectId, onSave]);

  // Splice a new body for the ACTIVE tab into the array + write. Keeps the tab's
  // display name in sync with the body's `name` (in case a rename rode along).
  const persistActive = useCallback((body: string) => {
    const bodies = tabBodiesRef.current.slice();
    bodies[activeIndexRef.current] = body;
    setTabBodies(bodies);
    writeTabs(bodies);
  }, [writeTabs]);

  const onPersist = useCallback(
    (layout: PlatformSchema["layout"]) => {
      persistActive(serializeArchitecture(schemaRef.current, layout));
    },
    [persistActive],
  );

  // Toggle the trademark-logo opt-in and persist (re-serializes with the flag).
  const onSetTrademark = useCallback((on: boolean) => {
    setTrademark(on);
    const next: PlatformSchema = { ...schemaRef.current, enableTrademarkLogos: on };
    persistActive(serializeArchitecture(next, next.layout));
  }, [persistActive]);

  // --- Tab operations -------------------------------------------------------
  const onSelectTab = useCallback((i: number) => setActiveIndex(i), []);

  const onAddTab = useCallback(() => {
    // Next free "Architecture N" name, then a blank body carrying it.
    const names = tabNamesRef.current;
    let n = names.length + 1;
    const used = new Set(names);
    while (used.has(`Architecture ${n}`)) n++;
    const name = `Architecture ${n}`;
    const body = "```json\n" + JSON.stringify({ name, nodes: [], edges: [] }, null, 2) + "\n```\n";
    const bodies = [...tabBodiesRef.current, body];
    setTabBodies(bodies);
    setTabNames([...names, name]);
    setActiveIndex(bodies.length - 1);
    writeTabs(bodies);
  }, [writeTabs]);

  const onRenameTab = useCallback((i: number, name: string) => {
    // Rewrite that tab's body with the new `name`, preserving everything else.
    const bodies = tabBodiesRef.current.slice();
    const fence = (bodies[i] ?? "").match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(fence ? fence[1] : "{}"); } catch { parsed = {}; }
    parsed.name = name;
    bodies[i] = "```json\n" + JSON.stringify(parsed, null, 2) + "\n```\n";
    setTabBodies(bodies);
    setTabNames((names) => names.map((nm, j) => (j === i ? name : nm)));
    writeTabs(bodies);
  }, [writeTabs]);

  const onDeleteTab = useCallback((i: number) => {
    const bodies = tabBodiesRef.current.filter((_, j) => j !== i);
    if (bodies.length === 0) return; // never delete the last tab
    setTabBodies(bodies);
    setTabNames((names) => names.filter((_, j) => j !== i));
    setActiveIndex((cur) => (cur > i ? cur - 1 : cur === i ? Math.min(i, bodies.length - 1) : cur));
    writeTabs(bodies);
  }, [writeTabs]);

  // Reset "saved" → "idle" after a moment so the chip doesn't linger.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(t);
  }, [status]);

  // Save status + Download menu — rendered INTO the canvas's floating action bar
  // (Canvas places it at the right end). No separate header row; the diagram
  // name isn't shown. A caller-supplied `toolbarExtras` (the standalone's own
  // Save/Download) takes precedence; otherwise `hideChrome` omits the built-in
  // in-app controls entirely.
  // The save-status icon is rendered SEPARATELY at the LEFT of the bar (see
  // `toolbarStatus` on Canvas) so it doesn't leave a gap on the right.
  const builtInExtras = hideChrome ? undefined : (
    <div className="flex items-center gap-2">
      {/* Download menu — PNG/SVG capture, or a self-contained standalone HTML
          (the architecture-skill editor template with THIS diagram baked into
          its inline JSON block). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-foreground hover:bg-muted"
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
  );

  // The tab strip — hidden in hard read-only (the standalone viewer shows only
  // the active diagram). Keyed by nothing; it's controlled by PlatformDiagram.
  const tabBar = readOnly ? undefined : (
    <TabBar
      names={tabNames}
      activeIndex={activeIndex}
      onSelect={onSelectTab}
      onAdd={onAddTab}
      onRename={onRenameTab}
      onDelete={onDeleteTab}
    />
  );

  return (
    <div className="flex h-full w-full flex-col">
      <CustomLogosContext.Provider value={schema.customLogos ?? {}}>
        <ReactFlowProvider>
          <Canvas
            key={activeIndex}
            schema={schema}
            deepLinks={deepLinks}
            onPersist={onPersist}
            onSetTrademark={onSetTrademark}
            defaultEditMode={defaultEditMode}
            readOnly={readOnly}
            toolbarExtras={toolbarExtrasProp ?? builtInExtras}
            toolbarStatus={hideChrome ? undefined : <SaveChip status={status} />}
            tabBar={tabBar}
          />
        </ReactFlowProvider>
      </CustomLogosContext.Provider>
    </div>
  );
}

const SaveChip = memo(function SaveChip({ status }: { status: SaveStatus }) {
  // Icon-only, and the slot is ALWAYS rendered (fixed size) so the toolbar
  // never resizes as the status flips — idle just shows an empty box. `title`
  // still carries the word for hover/accessibility.
  const icon =
    status === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    : status === "saved" ? <Check className="h-3.5 w-3.5 text-emerald-600" />
    : status === "error" ? <X className="h-3.5 w-3.5 text-destructive" />
    : null;
  const label = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : "";
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center" title={label} aria-label={label}>
      {icon}
    </span>
  );
});

export default memo(PlatformDiagram);
