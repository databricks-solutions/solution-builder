/**
 * standalone.tsx — the entry for the self-contained architecture HTML.
 *
 * ONE engine, reused: this is thin glue around the SAME <PlatformDiagram>
 * (canvas + composites + lib/platform-architecture) the in-app Architecture tab
 * uses. No TanStack router, no react-query, no backend.
 *
 * The architecture data lives in an inline
 *   <script type="application/json" id="architecture">{ ... }</script>
 * block near the top of the HTML. We read it on load, render it, and:
 *   • viewer mode  → read-only; sets window.__ARCH_READY__ + body[data-arch-ready]
 *                     once laid out (the headless render script waits on this).
 *   • editor mode  → editable; a top bar to Load a file + Download PNG/SVG/HTML.
 *
 * Build flags (Vite `define`):
 *   __ARCH_MODE__        = "viewer" | "editor"
 *   __ARCH_STANDALONE__  = true   (makes file-icons inline as data-URIs)
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import PlatformDiagram from "@/components/project/platform-diagram";
import { exportDiagramImage } from "@/components/project/platform-diagram/export-image";

declare const __ARCH_MODE__: string | undefined;
const MODE: "viewer" | "editor" = (typeof __ARCH_MODE__ !== "undefined" && __ARCH_MODE__ === "editor") ? "editor" : "viewer";

const JSON_BLOCK_ID = "architecture";

/** Read the inline architecture JSON block; returns the raw JSON string ("" if
 *  empty/missing). The bundle passes this straight to PlatformDiagram, which
 *  parses it. */
function readInlineArchitecture(): string {
  const el = document.getElementById(JSON_BLOCK_ID);
  const raw = (el?.textContent ?? "").trim();
  if (!raw || raw === "{}") return "";
  return raw;
}

function download(name: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

/** Strip an optional ```json fence and pretty-print when parseable. */
function prettyJson(raw: string): string {
  let t = raw.trim();
  const m = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (m) t = m[1].trim();
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; }
}

/** Rebuild THIS html with the inline JSON block replaced by `md` (fence
 *  stripped, pretty-printed when valid). Shared by Download HTML + the
 *  File System Access auto-save. */
function buildHtml(md: string): string {
  let json = md.trim();
  const m = json.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (m) json = m[1].trim();
  try { json = JSON.stringify(JSON.parse(json), null, 2); } catch { /* keep as-is */ }
  const html = document.documentElement.outerHTML;
  const replaced = html.replace(
    /(<script[^>]*id="architecture"[^>]*>)([\s\S]*?)(<\/script>)/,
    (_all, open, _body, close) => `${open}\n${json}\n${close}`,
  );
  return "<!doctype html>\n" + replaced;
}

// --- Persistence for a file:// page (which cannot silently overwrite itself) --
// 1. localStorage snapshot keyed by this file's URL: every edit is stashed, and
//    reopening the SAME file auto-restores unsaved edits (all browsers).
// 2. File System Access API (Chromium): "Save" asks ONCE for the html file
//    itself; we keep the handle and every subsequent edit auto-writes to disk.
const LS_KEY = `arch-autosave:${location.href}`;

/** Minimal ambient typing for the File System Access API (Chromium). */
interface FsaWritable { write(data: string): Promise<void>; close(): Promise<void> }
interface FsaHandle { createWritable(): Promise<FsaWritable> }
type FsaWindow = Window & {
  showSaveFilePicker?: (opts?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FsaHandle>;
};
const FSA_SUPPORTED = typeof (window as FsaWindow).showSaveFilePicker === "function";

function App() {
  // The live architecture.md string — seeded from the inline block (or a newer
  // localStorage snapshot of unsaved edits for this same file), updated by the
  // diagram's onSave (so Download/Save reflect edits).
  const inline = readInlineArchitecture();
  // EDITOR ONLY: the viewer must always render exactly its inline JSON — a
  // localStorage restore there would poison the headless render loop (the
  // agent rewrites the same file path; a stale snapshot for that href would
  // override the fresh content in the PNG it reads back).
  const stored = (() => {
    if (MODE !== "editor") return null;
    try { return localStorage.getItem(LS_KEY); } catch { return null; }
  })();
  const restoredFromStorage = !!(stored && stored.trim() && stored.trim() !== inline.trim());
  const initial = restoredFromStorage ? stored!.trim() : inline;
  const [content, setContent] = useState<string>(initial);
  const liveMd = useRef<string>(initial);
  const [showRestored, setShowRestored] = useState(restoredFromStorage);
  const discardRestored = useCallback(() => {
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    liveMd.current = inline;
    setContent(inline);
    setShowRestored(false);
  }, [inline]);

  // File System Access auto-save (Chromium): once the user links the file via
  // "Save", every edit re-writes it (debounced). `saveState` drives the chip.
  const fileHandle = useRef<FsaHandle | null>(null);
  const [saveState, setSaveState] = useState<"unlinked" | "saved" | "saving" | "error">("unlinked");
  const fsaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeToFile = useCallback(async () => {
    const h = fileHandle.current;
    if (!h) return;
    setSaveState("saving");
    try {
      const w = await h.createWritable();
      await w.write(buildHtml(liveMd.current));
      await w.close();
      setSaveState("saved");
      // The file now holds the edits — the localStorage snapshot is redundant.
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    } catch (e) {
      console.error("auto-save failed:", e);
      setSaveState("error");
    }
  }, []);
  const scheduleWrite = useCallback(() => {
    if (!fileHandle.current) return;
    if (fsaTimer.current) clearTimeout(fsaTimer.current);
    fsaTimer.current = setTimeout(() => { void writeToFile(); }, 1200);
  }, [writeToFile]);
  const linkAndSave = useCallback(async () => {
    try {
      const picker = (window as FsaWindow).showSaveFilePicker;
      if (!picker) return;
      fileHandle.current = await picker({
        suggestedName: "architecture.html",
        types: [{ description: "HTML", accept: { "text/html": [".html"] } }],
      });
      await writeToFile();
    } catch {
      /* user cancelled the picker */
    }
  }, [writeToFile]);

  // Stash every edit + feed the FSA auto-save. Called by the diagram's onSave
  // and by the JSON debug panel.
  const persistEdit = useCallback((md: string) => {
    // Editor only (see the restore note above) — viewer edits via the JSON
    // debug panel are deliberately ephemeral.
    if (MODE === "editor") {
      try { localStorage.setItem(LS_KEY, md); } catch { /* quota/file:// quirks */ }
    }
    scheduleWrite();
  }, [scheduleWrite]);

  // ---- hidden JSON debug panel -------------------------------------------
  // An almost-invisible `{ }` toggle bottom-left opens a live JSON view of the
  // architecture. Edits are debounce-parsed and applied to the canvas (invalid
  // JSON shows an error and is NOT applied); canvas edits sync back into the
  // textarea whenever it isn't focused. Pure debug aid.
  const [showJson, setShowJson] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const showJsonRef = useRef(false);
  showJsonRef.current = showJson;
  const draftFocusedRef = useRef(false);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSave = useCallback((md: string) => {
    liveMd.current = md;
    persistEdit(md);
    // Keep the debug panel in sync with canvas edits (only when not typing).
    if (showJsonRef.current && !draftFocusedRef.current) setJsonDraft(prettyJson(md));
  }, [persistEdit]);

  const toggleJson = useCallback(() => {
    setShowJson((open) => {
      if (!open) {
        setJsonDraft(prettyJson(liveMd.current || ""));
        setJsonErr(null);
      }
      return !open;
    });
  }, []);

  const onJsonDraftChange = useCallback((v: string) => {
    setJsonDraft(v);
    if (applyTimer.current) clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => {
      let t = v.trim();
      const m = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (m) t = m[1].trim();
      try {
        JSON.parse(t); // validate only — apply the raw text, diagram parses it
        setJsonErr(null);
        liveMd.current = t;
        setContent(t);
        persistEdit(t);
      } catch (e) {
        setJsonErr(e instanceof Error ? e.message : "Invalid JSON");
      }
    }, 400);
  }, [persistEdit]);

  // ---- editor toolbar actions -------------------------------------------
  // Download a fresh copy of THIS html with the inline JSON block replaced by
  // the current (edited) architecture. Used as the Save fallback where the
  // File System Access API doesn't exist (Firefox/Safari).
  const downloadHtml = useCallback(() => {
    const blob = new Blob([buildHtml(liveMd.current)], { type: "text/html" });
    download("architecture.html", URL.createObjectURL(blob));
  }, []);

  // ⌘S / Ctrl+S — write to the linked file (FSA), link it first if needed, or
  // fall back to Download HTML where the API doesn't exist (Firefox/Safari).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (fileHandle.current) void writeToFile();
      else if (FSA_SUPPORTED) void linkAndSave();
      else downloadHtml();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [writeToFile, linkAndSave, downloadHtml]);

  // Compact button styled to sit in the canvas floating toolbar (matches the
  // in-app Download trigger).
  const Btn = (p: { onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={p.onClick}
      className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11.5px] font-medium text-foreground hover:bg-muted"
    >
      {p.children}
    </button>
  );

  // Standalone EDITOR controls, injected into the canvas floating toolbar (no
  // separate header) — Save (file-linking on Chromium, else download), Download
  // image, auto-save status, and the "restored unsaved edits" chip. Viewer mode
  // renders no chrome at all (the floating bar is hidden by readOnly).
  const standaloneToolbar = MODE === "editor" ? (
    <div className="flex items-center gap-2">
      {/* Save (⌘S): Chromium links THIS html file once via the file picker,
          then every edit auto-writes back to it. Elsewhere → download (the
          downloaded html IS the save — this file is already standalone). */}
      {FSA_SUPPORTED ? (
        <Btn onClick={() => (fileHandle.current ? void writeToFile() : void linkAndSave())}>
          {saveState === "unlinked" ? "Save…" : "Save"}
        </Btn>
      ) : (
        <Btn onClick={downloadHtml}>Save (download)</Btn>
      )}
      {/* Download as image — one button, pick the format. The gap below the
          trigger is PADDING inside the hover element (not a margin) so moving
          the cursor down to the list never leaves the hover group. */}
      <div className="group relative">
        <Btn onClick={() => {}}>Download ▾</Btn>
        <div className="invisible absolute right-0 top-full z-50 pt-1 group-hover:visible">
          <div className="min-w-[140px] rounded-md border border-border bg-card py-1 shadow-lg">
            <button type="button" onClick={() => void exportDiagramImage("png")} className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-muted">Image (PNG)</button>
            <button type="button" onClick={() => void exportDiagramImage("svg")} className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-muted">Image (SVG)</button>
          </div>
        </div>
      </div>
      {/* Auto-save status once the file is linked. */}
      {saveState !== "unlinked" && (
        <span className={`text-[11px] ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Saved ✓"}
        </span>
      )}
      {/* Unsaved edits restored from this browser's snapshot of the file. */}
      {showRestored && (
        <span className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
          Restored edits
          <button type="button" onClick={discardRestored} className="cursor-pointer underline underline-offset-2 hover:text-amber-950">
            discard
          </button>
        </span>
      )}
    </div>
  ) : undefined;

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="relative min-h-0 flex-1">
        <PlatformDiagram
          content={content || null}
          capabilities={null}
          projectId=""
          defaultEditMode={MODE === "editor"}
          readOnly={MODE === "viewer"}
          onSave={onSave}
          hideChrome
          toolbarExtras={standaloneToolbar}
        />

        {/* Almost-hidden JSON debug toggle (bottom-right, clear of the zoom
            controls bottom-left). */}
        <button
          type="button"
          onClick={toggleJson}
          title="View / edit the architecture JSON (debug)"
          className={`absolute bottom-2 right-2 z-50 cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] transition-opacity ${showJson ? "bg-card text-foreground opacity-90 shadow-sm" : "text-muted-foreground opacity-20 hover:opacity-80"}`}
        >
          {"{ }"}
        </button>

        {/* Live JSON panel — edits apply to the canvas when valid. */}
        {showJson && (
          <div className="absolute bottom-8 right-2 z-50 flex h-[46vh] w-[520px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
              <span className="font-mono text-[11px] font-semibold text-foreground">architecture JSON</span>
              <span className={`truncate text-[10px] ${jsonErr ? "text-destructive" : "text-muted-foreground"}`}>
                {jsonErr ? jsonErr : "live — valid edits apply to the canvas"}
              </span>
              <button
                type="button"
                onClick={toggleJson}
                className="ml-auto cursor-pointer rounded px-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                ×
              </button>
            </div>
            <textarea
              value={jsonDraft}
              onChange={(e) => onJsonDraftChange(e.target.value)}
              onFocus={() => { draftFocusedRef.current = true; }}
              onBlur={() => { draftFocusedRef.current = false; }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Signal "ready" for the headless render script once the diagram has had a
// chance to lay out (ReactFlow mounts + fitView). A couple of rAFs + a short
// delay is enough; the render script also waits for a node to exist.
function signalReady() {
  (window as unknown as { __ARCH_READY__?: boolean }).__ARCH_READY__ = true;
  document.body.setAttribute("data-arch-ready", "1");
}
requestAnimationFrame(() =>
  requestAnimationFrame(() => setTimeout(signalReady, 400)),
);
