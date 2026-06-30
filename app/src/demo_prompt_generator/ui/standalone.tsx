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
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toPng, toSvg } from "html-to-image";
import "@/styles/globals.css";
import PlatformDiagram from "@/components/project/platform-diagram";

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

/** The fit-to-content element html-to-image / the headless screenshot capture:
 *  the ReactFlow viewport (the transformed layer holding the nodes). Falls back
 *  to the pane. */
function captureTarget(): HTMLElement | null {
  return (
    document.querySelector(".react-flow__viewport") as HTMLElement | null
  ) ?? (document.querySelector(".react-flow") as HTMLElement | null);
}

function download(name: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

function App() {
  // The live architecture.md string — seeded from the inline block, updated by
  // the diagram's onSave (so Download HTML reflects edits). Used only in editor.
  const initial = readInlineArchitecture();
  const [content, setContent] = useState<string>(initial);
  const liveMd = useRef<string>(initial);

  const onSave = useCallback((md: string) => { liveMd.current = md; }, []);

  // ---- editor toolbar actions -------------------------------------------
  const onLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let text = String(r.result ?? "");
      // accept a fenced ```json block (architecture.md) OR raw json
      const m = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (m) text = m[1];
      const t = text.trim();
      liveMd.current = t;
      setContent(t);
    };
    r.readAsText(f);
  }, []);

  const exportImage = useCallback(async (kind: "png" | "svg") => {
    const el = captureTarget();
    if (!el) return;
    const opts = { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true };
    const dataUrl = kind === "png" ? await toPng(el, opts) : await toSvg(el, opts);
    download(`architecture.${kind}`, dataUrl);
  }, []);

  // Download a fresh copy of THIS html with the inline JSON block replaced by
  // the current (edited) architecture. Re-reads the live md (strips any fence).
  const downloadHtml = useCallback(() => {
    let json = liveMd.current.trim();
    const m = json.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (m) json = m[1].trim();
    // Pretty-print if valid.
    try { json = JSON.stringify(JSON.parse(json), null, 2); } catch { /* keep as-is */ }
    const html = document.documentElement.outerHTML;
    const replaced = html.replace(
      /(<script[^>]*id="architecture"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_all, open, _body, close) => `${open}\n${json}\n${close}`,
    );
    const blob = new Blob(["<!doctype html>\n" + replaced], { type: "text/html" });
    download("architecture.html", URL.createObjectURL(blob));
  }, []);

  const Btn = (p: { onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={p.onClick}
      className="cursor-pointer rounded-md border border-border bg-background px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
    >
      {p.children}
    </button>
  );

  return (
    <div className="flex h-screen w-screen flex-col">
      {MODE === "editor" && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <span className="mr-1 text-[12px] font-semibold text-foreground">Architecture editor</span>
          <label className="cursor-pointer rounded-md border border-border bg-background px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted">
            Load…
            <input type="file" accept=".json,.md,.txt,application/json" className="hidden" onChange={onLoad} />
          </label>
          <Btn onClick={() => exportImage("png")}>Download PNG</Btn>
          <Btn onClick={() => exportImage("svg")}>Download SVG</Btn>
          <Btn onClick={downloadHtml}>Download HTML</Btn>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <PlatformDiagram
          content={content || null}
          capabilities={null}
          projectId=""
          defaultEditMode={MODE === "editor"}
          readOnly={MODE === "viewer"}
          onSave={onSave}
          hideChrome
        />
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
