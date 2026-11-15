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
  validateArchitecture,
  type ArchitectureIssue,
  type ArchitectureTheme,
  type PlatformSchema,
} from "@/lib/platform-architecture";
import { saveProjectFile, getArchitectureStandaloneTemplate, type DeployedResourceLink } from "@/lib/custom-api";
import { useArchDoc } from "./platform-diagram/collab/use-arch-doc";
import { PresenceBar } from "./platform-diagram/collab/collab-cursors";
import { Check, ChevronDown, Download, Loader2, X, AlertTriangle, Wand2, Presentation, Wrench } from "lucide-react";
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
import { ArchitectureHistoryPanel } from "./platform-diagram/history-panel";

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
  /** Fired on every in-app diagram save (a user edit changed the diagram). The
   *  project page uses this to mark the architecture snapshot dirty, so it
   *  re-captures architecture.png on the next chat focus. Not fired in the
   *  standalone (onSave) path. */
  onDirty?: () => void;
  /** Deep-link: the diagram tab to open on mount, BY NAME. Ignored if no tab
   *  matches (falls back to the first tab). */
  initialArchTab?: string;
  /** Fired when the active diagram tab changes, with its NAME — the project page
   *  persists it to the URL (?archTab=) so refresh/share reopens the same tab. */
  onArchTabChange?: (name: string) => void;
  /** Initial state of the vendor-LOGO toggle for a diagram that hasn't set it
   *  itself. Public default false; internal Databricks deploys pass true (from
   *  the ENABLE_LOGO_BY_DEFAULT env via /api/config/status). An explicit
   *  per-diagram toggle still wins. Defaults false. */
  defaultLogosOn?: boolean;
  /** Enable live multi-user collaboration (WS room: cursors, presence, live
   *  edits, agent-takeover). Opt-in from the workspace when the project is
   *  shared + editable. Never in the standalone (onSave) path or read-only
   *  previews. Defaults false. */
  enableCollab?: boolean;
  /** Opens the Share dialog from the canvas "Share live with others" button.
   *  Absent in standalone / read-only. */
  onShareLive?: () => void;
  /** Ask the chat agent to fix the diagram's validation issues (broken id /
   *  edge / handle references). The route wires this to a chat message built
   *  from the issue list. Absent in standalone / read-only → the issues badge
   *  still shows the problems, just without the "Ask agent to fix" action. */
  onRequestArchitectureFix?: (issues: ArchitectureIssue[]) => void;
}

// "unsaved" = a durability WARNING: an edit hasn't been confirmed-persisted (the
// writer didn't save it and our fallback save is failing / the socket is down).
// Surfaced as a loud banner so the user never edits blind.
type SaveStatus = "idle" | "saving" | "saved" | "error" | "unsaved";

function PlatformDiagram({ content, deployedResources, projectId, defaultEditMode = true, readOnly, onSave, hideChrome, toolbarExtras: toolbarExtrasProp, onDirty, initialArchTab, onArchTabChange, defaultLogosOn = false, enableCollab = false, onShareLive, onRequestArchitectureFix }: PlatformDiagramProps) {
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
  // Set during render (below) once collabEnabled is known; read by the
  // deep-link/tab effect (declared before collabEnabled) to decide whether the
  // shared doc owns the tab state. A ref assigned in render is current before any
  // effect runs.
  const collabEnabledRef = useRef(false);
  // The last architecture.md content the Yjs doc was hydrated from OR the writer
  // saved — so the takeover effect only rehydrates on a genuinely NEW external
  // write, never on the writer's own snapshot echo. Declared here (before the
  // arch-doc hook whose doSave writes it) so the closure captures a live ref.
  const lastHydratedContent = useRef<string | null>(null);
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
  // Apply the ?archTab= deep-link exactly ONCE, once tabs are known — after that
  // the user's own tab switches own the state (we don't keep forcing the URL tab).
  // CAPTURE the target at MOUNT: `initialArchTab` is a live ?archTab= binding, so
  // once we (or anyone) rewrite the URL it mutates. Reading the live prop inside
  // the effect would make the deep-link chase its own URL write — on refresh the
  // arch content isn't parsed yet, we'd report tab 0, that rewrites ?archTab= to
  // tab 0's name, and the "target" becomes tab 0. Freezing it here breaks that.
  const deepLinkTarget = useRef(initialArchTab);
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    const tabs = parseArchitectureTabs(acceptedContent ?? "");
    // When collaboration is on, the shared doc owns tabBodies/tabNames (via its
    // observe): the initial seed happens in the doc's onSynced, and a later
    // acceptedContent change (agent takeover / restore) rehydrates the doc (see the
    // rehydrate effect below), NOT by writing tabBodies here. We still run the
    // deep-link / activeIndex logic against the parsed tabs. (Standalone/read-only
    // has no doc → this effect owns the tab state.)
    if (!collabEnabledRef.current) {
      setTabBodies(tabs.map((t) => t.body));
      setTabNames(tabs.map((t) => t.name));
    }
    // Resolve the deep-link in the effect BODY — never mutate the ref inside the
    // setActiveIndex updater. React StrictMode double-invokes state updaters, so
    // a ref-mutating updater would set `deepLinkApplied` on the 1st call and then
    // read it as already-applied on the 2nd (returning the clamped old index 0),
    // committing tab 0 while burning the one-shot → the ?archTab= revert bug.
    // Only CONSUME the one-shot once the target tab actually resolves (content
    // can arrive incrementally: empty → partial → full), so we keep retrying.
    if (!deepLinkApplied.current && deepLinkTarget.current && tabs.length) {
      const j = tabs.findIndex((t) => t.name === deepLinkTarget.current);
      if (j >= 0) {
        deepLinkApplied.current = true;
        setActiveIndex(j);
        return;
      }
    }
    setActiveIndex((i) => Math.min(i, Math.max(0, tabs.length - 1)));
  }, [acceptedContent]);

  // Keep activeIndex in range whenever the tab count shrinks — covers a COLLAB
  // peer deleting a tab (which changes tabBodies via the doc's refresh, NOT via
  // acceptedContent, so the clamp in that effect wouldn't fire). Without this a
  // peer deleting the active tab leaves activeIndex past the end (blank canvas).
  useEffect(() => {
    setActiveIndex((i) => (i < tabBodies.length ? i : Math.max(0, tabBodies.length - 1)));
  }, [tabBodies.length]);

  const activeBody = tabBodies[activeIndex] ?? "";

  // The active-tab body WE just serialized on a persist (see persistActive).
  // When `tabBodies` updates to this exact string, it's our own echo — the
  // canvas already reflects it, so we must NOT re-parse (a new `built`/`schema`
  // identity re-seeds the canvas and DROPS the selection ~700ms after a paste).
  // Genuine external loads + tab switches produce a DIFFERENT body → re-parse.
  const selfAuthoredBody = useRef<string | null>(null);
  const builtRef = useRef<PlatformSchema | null>(null);
  // The exact body string `builtRef` was parsed from. Reuse the prior schema
  // identity ONLY when the current active body is BOTH our own echo AND the same
  // string we last built — otherwise (e.g. switching to a different tab whose
  // body happens to equal a stale selfAuthoredBody) we'd hand back another tab's
  // schema. Keying reuse on the built body makes tab switches always re-parse.
  const builtBody = useRef<string | null>(null);

  // Parse the ACTIVE tab's body into the internal schema. The file is the sole
  // source of truth for what's shown (no capability-state seeding). Skip the
  // re-parse (reuse the prior schema identity) when the body is our own save AND
  // it's the same body we already built (so the canvas isn't re-seeded on our
  // own echo, which would drop the live selection).
  const built = useMemo(() => {
    if (activeBody === selfAuthoredBody.current && activeBody === builtBody.current && builtRef.current) {
      return builtRef.current;
    }
    const parsed = parseArchitecture(activeBody, defaultLogosOn);
    builtRef.current = parsed;
    builtBody.current = activeBody;
    return parsed;
  }, [activeBody, defaultLogosOn]);
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
  // Architecture-history panel (in-app only). Restoring a snapshot re-seeds the
  // whole multi-tab file and persists it (see onRestoreHistory).
  const [historyOpen, setHistoryOpen] = useState(false);
  // Bumped whenever the persisted content changes → an OPEN history panel refetches
  // its list. Fires on our own confirmed save (status→"saved") and on any external
  // load (agent/collaborator write advances acceptedContent).
  const [historyRefreshSignal, setHistoryRefreshSignal] = useState(0);
  useEffect(() => {
    if (status === "saved") setHistoryRefreshSignal((n) => n + 1);
  }, [status]);
  useEffect(() => {
    setHistoryRefreshSignal((n) => n + 1);
  }, [acceptedContent]);
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

  // NOTE: the architecture PNG snapshot is captured by the PROJECT PAGE on chat
  // focus (only when the diagram changed), not here — so we don't POST a PNG on
  // every drag/render. See `captureArchitectureIfDirty` in project.$projectId.

  // --- Durability: never lose an edit, never edit blind. -------------------
  // Every edit is recorded as PENDING until a save is CONFIRMED (our own PUT
  // resolved 200). The happy path: if we're the writer (or solo), we save it now.
  // In a collab room a NON-writer relies on the writer to persist — BUT a
  // watchdog (below) guarantees durability regardless: if a pending edit isn't
  // confirmed within a grace window (writer dead/absent, socket zombie, PUT
  // failing), THIS client saves it directly as a fallback and, if even that
  // fails, flips status to "unsaved" (the loud banner). So persistence NEVER
  // depends on the writer election being correct.
  const pendingMd = useRef<string | null>(null);   // latest un-confirmed content
  const inFlightMd = useRef<string | null>(null);   // md of the PUT currently awaited
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist `md` to architecture.md, DURABLY. `md` becomes the pending target;
  // one PUT is ever in flight (savePending guard). On success we clear pending
  // ONLY if it's still exactly `md` (a newer edit that landed mid-flight stays
  // pending → saved next). On FAILURE we keep pending + RETRY with backoff (the
  // network/server hiccup shouldn't lose the edit — this is the durability
  // backstop now that persistence is writer-driven; there's no separate save
  // watchdog). Idempotent: an identical resave is a server-side no-op (history
  // debounce), so a retry of the same content can't clobber.
  const retryDelay = useRef(0);
  const doSaveRef = useRef<(md: string) => void>(() => {});
  const doSave = useCallback((md: string) => {
    pendingMd.current = md; // the newest content we owe the backend
    if (savePending.current) return; // a PUT is in flight; its finally() saves the latest pending
    setStatus("saving");
    savePending.current = true;
    inFlightMd.current = md;
    let permanent = false;
    saveProjectFile(projectId, "architecture.md", md)
      .then(() => {
        retryDelay.current = 0;
        if (pendingMd.current === md) { pendingMd.current = null; setStatus("saved"); }
        // else: a newer edit superseded this one → still pending, saved below.
      })
      .catch((err: unknown) => {
        // 401/403/404 won't heal by retrying (expired login, no access, project
        // gone): stop and surface "Save failed" instead of looping forever.
        const code = (err as { status?: number }).status;
        permanent = code === 401 || code === 403 || code === 404;
        setStatus(permanent ? "error" : "unsaved");  // keep pending → retried below
      })
      .finally(() => {
        savePending.current = false;
        inFlightMd.current = null;
        const still = pendingMd.current;
        if (!still || permanent) return;
        // Something still un-persisted: either a newer edit (save it immediately)
        // or a failed one (retry with capped backoff so a flapping backend doesn't
        // spin). setStatus stays "unsaved"/"saving" until a PUT confirms.
        const failed = status === "unsaved" || retryDelay.current > 0;
        if (!failed) { doSaveRef.current(still); return; }
        const delay = retryDelay.current = Math.min((retryDelay.current || 500) * 2, 15000);
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { retryTimer.current = null; doSaveRef.current(pendingMd.current ?? still); }, delay);
      });
  }, [projectId, status]);
  doSaveRef.current = doSave;
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  // Collaboration is live for a shared, EDITABLE project (never the standalone
  // `onSave` path or a read-only preview — those don't collaborate). The Yjs doc
  // is the live source of truth: it merges concurrent edits per-object and DRIVES
  // tabBodies/tabNames via the parent's setters; the writer snapshots it to
  // architecture.md. `collabEnabled` also gates whether persistence goes to the
  // backend at all vs. the host (standalone).
  const collabEnabled = enableCollab && !onSave && !readOnly;
  collabEnabledRef.current = collabEnabled;

  // Interaction gate — the Canvas sets this true while the LOCAL user is mid
  // drag/resize. Passed into the doc hook so a remote edit that merges into the
  // doc during a drag does NOT immediately re-derive tabBodies → reseed the graph
  // out from under the interaction (the "flash / buggy resize"). The doc still
  // MERGES the peer update live (CRDT); only the local canvas re-derive is
  // deferred until the interaction settles (onInteractionEnd flushes it).
  const interactingRef = useRef(false);

  // Splice a serialized body into a specific tab index. Standalone (onSave) keeps
  // the in-memory host-save path; otherwise the edit goes into the shared Yjs doc
  // as a per-object diff — the doc's observe re-derives tabBodies (driving the
  // parent's state), broadcasts the delta to peers, and the elected writer
  // debounce-snapshots doc→architecture.md. `selfAuthoredBody` marks our own edit
  // so the observe-driven tabBodies update isn't treated as an external reseed
  // (which would drop the live selection).
  const persistTab = useCallback((index: number, body: string, relayout = false) => {
    // A nested diagram whose save changed the layout (a node dropped into another
    // container, re-ordered, resized) must be RE-PARSED so everything snaps into place:
    // not marking it as our own echo makes the next render rebuild the canvas from it.
    selfAuthoredBody.current = relayout ? null : body;
    if (onSave) {
      // Standalone: no shared doc — keep the host-save path (whole multi-tab md).
      const bodies = tabBodiesRef.current.slice();
      if (index >= 0 && index < bodies.length) bodies[index] = body;
      setTabBodies(bodies);
      lastAuthoredMd.current = serializeArchitectureTabs(bodies);
      onSave(lastAuthoredMd.current);
      return;
    }
    onDirty?.(); // a user edit changed the diagram → mark the snapshot dirty
    archDocRef.current.persistTab(index, body);
  }, [onSave, onDirty]);

  const persistActive = useCallback(
    (body: string) => persistTab(activeIndexRef.current, body),
    [persistTab],
  );

  // The Canvas is REMOUNTED per tab (key={activeIndex}); bind its onPersist to
  // THIS tab's index so a save always targets the tab it was scheduled on, even
  // if a late debounce fires after a switch.
  const onPersist = useCallback(
    (layout: PlatformSchema["layout"]) => {
      const body = serializeArchitecture(schemaRef.current, layout);
      persistTab(activeIndex, body, schemaRef.current.tree ? layoutChanged(body, layout, defaultLogosOn) : false);
    },
    [persistTab, activeIndex, defaultLogosOn],
  );

  // Yjs-backed shared doc: merges concurrent edits per-object, DRIVES tabBodies/
  // tabNames (via the parent's setters), owns per-tab persistence, and provides
  // cursors/presence. Inert for the standalone / read-only path (enabled=false).
  const archDoc = useArchDoc({
    projectId,
    enabled: collabEnabled,
    initialContent: acceptedContent,
    interactingRef,
    // Writer's snapshot save → architecture.md. Record it as our own authored md
    // so the file-watcher re-fetch is recognized as an echo (acceptedContent
    // won't advance → no spurious rehydrate), and as the last-hydrated baseline so
    // the takeover effect doesn't reset the doc to its own save.
    doSave: (md: string) => { lastAuthoredMd.current = md; lastHydratedContent.current = md; doSave(md); },
    setTabBodies,
    setTabNames,
    onExternalWrite: () => onDirty?.(),
  });
  const archDocRef = useRef(archDoc);
  archDocRef.current = archDoc;

  // Agent-takeover / history-restore: when the doc is already seeded and a NEW
  // external acceptedContent arrives (the agent wrote architecture.md, or a
  // restore), rehydrate the doc from it — one authoritative reset that merges tabs
  // by NAME so open tabs keep their ids where possible. The FIRST acceptedContent
  // (the initial seed) is handled by the doc's onSynced, so skip it here.
  //
  // DEFERRED while mid drag/resize: a hard reset during an interaction would
  // orphan the in-flight edit (the node RF is tracking vanishes from the doc). We
  // stash the newest external content and apply it the instant the interaction
  // settles (applyPendingRehydrate, called from onInteractionEnd alongside the
  // doc's own pending-refresh flush).
  const [agentTookOver, setAgentTookOver] = useState(false);
  const pendingRehydrate = useRef<string | null>(null);
  const doRehydrate = useCallback((content: string) => {
    lastHydratedContent.current = content;
    archDocRef.current.rehydrate(content);
    setAgentTookOver(true);
    window.setTimeout(() => setAgentTookOver(false), 4000);
  }, []);
  const applyPendingRehydrate = useCallback(() => {
    const c = pendingRehydrate.current;
    if (c != null) { pendingRehydrate.current = null; doRehydrate(c); }
  }, [doRehydrate]);
  useEffect(() => {
    if (!collabEnabled || !archDoc.synced || acceptedContent == null) return;
    if (lastHydratedContent.current === null) { lastHydratedContent.current = acceptedContent; return; }
    if (acceptedContent === lastHydratedContent.current) return;
    if (interactingRef.current) { pendingRehydrate.current = acceptedContent; return; } // defer past the drag
    doRehydrate(acceptedContent);
  }, [collabEnabled, archDoc.synced, acceptedContent, doRehydrate]);

  // The slice Canvas needs (cursors + presence). Only when the room is live, so a
  // solo / offline canvas is byte-for-byte its old self (collab undefined).
  const canvasCollab = useMemo(
    () =>
      archDoc.connected
        ? { members: archDoc.members, meConnId: archDoc.meConnId, sendCursor: archDoc.sendCursor }
        : undefined,
    [archDoc.connected, archDoc.members, archDoc.meConnId, archDoc.sendCursor],
  );

  // Toggle the trademark-logo opt-in and persist (re-serializes with the flag).
  const onSetTrademark = useCallback((on: boolean) => {
    setTrademark(on);
    const next: PlatformSchema = { ...schemaRef.current, enableTrademarkLogos: on };
    persistActive(serializeArchitecture(next, next.layout));
  }, [persistActive]);

  // Switch the diagram's presentation theme (slide ⇄ technical) and persist.
  // Theme changes each tile's footprint (the slide preset floors sizes), so we
  // DON'T reuse the current pixel layout — serialize re-emits every unmoved
  // node's symbolic placement and `computeLayout` re-resolves sizes/positions
  // under the new theme on the next parse. Only user-dragged nodes keep a pinned
  // `at`. `serializeArchitecture` already omits `theme` when it's the default
  // ("slide"), so a technical→slide switch cleanly drops the field.
  const onSetTheme = useCallback((theme: ArchitectureTheme) => {
    const next: PlatformSchema = { ...schemaRef.current, theme };
    persistActive(serializeArchitecture(next, next.layout));
  }, [persistActive]);

  // Report the active diagram tab's NAME to the host (→ URL ?archTab=) whenever
  // it changes — covers select / add / delete / rename uniformly. Skipped until
  // tabs are known; dedup'd so we don't re-navigate to the same tab.
  const lastReportedTab = useRef<string | null>(null);
  useEffect(() => {
    // Don't report (→ rewrite ?archTab=) while a deep-link is still pending:
    // on mount activeIndex is 0, and reporting tab 0's name here would clobber
    // the incoming ?archTab= in the URL before the deep-link effect resolves it.
    if (deepLinkTarget.current && !deepLinkApplied.current) return;
    const name = tabNames[activeIndex];
    if (!name || name === lastReportedTab.current) return;
    lastReportedTab.current = name;
    onArchTabChange?.(name);
  }, [activeIndex, tabNames, onArchTabChange]);

  // --- Tab operations -------------------------------------------------------
  const onSelectTab = useCallback((i: number) => setActiveIndex(i), []);

  // Standalone (no shared doc) tab-array write: set state + host-save the whole
  // multi-tab md. Collab tab ops go through the doc (CRDT, id-keyed) instead.
  const hostSaveTabs = useCallback((bodies: string[], names: string[]) => {
    setTabBodies(bodies);
    setTabNames(names);
    const md = serializeArchitectureTabs(bodies);
    lastAuthoredMd.current = md;
    onSave?.(md);
  }, [onSave]);

  const onAddTab = useCallback(() => {
    // Next free "Architecture N" name, then a blank body carrying it.
    const names = tabNamesRef.current;
    let n = names.length + 1;
    const used = new Set(names);
    while (used.has(`Architecture ${n}`)) n++;
    const name = `Architecture ${n}`;
    const body = "```json\n" + JSON.stringify({ name, nodes: [], edges: [] }, null, 2) + "\n```\n";
    if (collabEnabled) {
      // CRDT tab add (concurrent adds coexist; no positional clobber). The doc
      // observe re-derives tabBodies/tabNames; switch to the new tab once it lands.
      archDocRef.current.addTab(name, body);
      setActiveIndex(tabBodiesRef.current.length); // new tab appends at the end
      return;
    }
    hostSaveTabs([...tabBodiesRef.current, body], [...names, name]);
    setActiveIndex(tabBodiesRef.current.length); // was length before add → new last
  }, [collabEnabled, hostSaveTabs]);

  const onRenameTab = useCallback((i: number, name: string) => {
    if (collabEnabled) { archDocRef.current.renameTab(i, name); return; } // CRDT: id-keyed
    // Rewrite that tab's body with the new `name`, preserving everything else.
    const bodies = tabBodiesRef.current.slice();
    const fence = (bodies[i] ?? "").match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(fence ? fence[1] : "{}"); } catch { parsed = {}; }
    parsed.name = name;
    bodies[i] = "```json\n" + JSON.stringify(parsed, null, 2) + "\n```\n";
    hostSaveTabs(bodies, tabNamesRef.current.map((nm, j) => (j === i ? name : nm)));
  }, [collabEnabled, hostSaveTabs]);

  const onDeleteTab = useCallback((i: number) => {
    if (tabBodiesRef.current.length <= 1) return; // never delete the last tab
    if (collabEnabled) {
      archDocRef.current.removeTab(i); // CRDT delete (id-keyed, concurrency-safe)
      setActiveIndex((cur) => (cur > i ? cur - 1 : cur === i ? Math.max(0, i - 1) : cur));
      return;
    }
    const bodies = tabBodiesRef.current.filter((_, j) => j !== i);
    hostSaveTabs(bodies, tabNamesRef.current.filter((_, j) => j !== i));
    setActiveIndex((cur) => (cur > i ? cur - 1 : cur === i ? Math.min(i, bodies.length - 1) : cur));
  }, [collabEnabled, hostSaveTabs]);

  // Restore a history snapshot. The BACKEND has already written architecture.md
  // + recorded the protected restore entry; `content` is that restored whole
  // multi-tab file. So we only RE-SEED the canvas here (no writeTabs — that would
  // double-save and create a spurious non-restore entry). Bypass the own-echo /
  // mid-save guards so the reseed definitely takes, exactly like applySnapshot.
  const onRestoreHistory = useCallback((content: string) => {
    // Bypass the own-echo / mid-save guards so the reseed definitely takes.
    lastAuthoredMd.current = null;
    savePending.current = false;
    setAcceptedContent(content);
    // Under collab the doc owns the canvas, so DIRECTLY rehydrate it (authoritative
    // reset) rather than relying on the acceptedContent→rehydrate effect — that
    // effect skips its FIRST acceptedContent (treats it as the initial baseline),
    // which would leave the canvas on stale content if a restore is the first
    // external content this session. Set lastHydratedContent so the effect then
    // sees this as already-applied (no double rehydrate). Standalone has no doc →
    // the deep-link/tab effect re-derives tabBodies from acceptedContent as before.
    if (collabEnabledRef.current) {
      lastHydratedContent.current = content;
      archDocRef.current.rehydrate(content);
    }
    onDirty?.(); // canvas changed → the chat-focus snapshot should recapture
  }, [onDirty]);

  // Reset "saved" → "idle" after a moment so the chip doesn't linger.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(t);
  }, [status]);

  // --- Diagram validation (integrity check) --------------------------------
  // Pure check over the WHOLE file (all tabs) for broken references — dangling
  // ids, unknown types, bad edges/handles. Surfaced by the issues badge; the
  // agent is the fixer (onRequestArchitectureFix). Recomputed on accepted
  // content (our own echoes are already filtered above, so it tracks the file).
  const issues = useMemo(
    () => (acceptedContent ? validateArchitecture(acceptedContent) : []),
    [acceptedContent],
  );
  // Jump-to: switch to the tab an issue is on (node-centering is out of scope —
  // the agent fixes, the user rarely hand-edits from here).
  const jumpToIssue = useCallback((issue: ArchitectureIssue) => {
    const j = tabNamesRef.current.findIndex((n) => n === issue.tab);
    if (j >= 0) setActiveIndex(j);
  }, []);

  // Save status + Download menu — rendered INTO the canvas's floating action bar
  // (Canvas places it at the right end). No separate header row; the diagram
  // name isn't shown. A caller-supplied `toolbarExtras` (the standalone's own
  // Save/Download) takes precedence; otherwise `hideChrome` omits the built-in
  // in-app controls entirely.
  // The save-status icon is rendered SEPARATELY at the LEFT of the bar (see
  // `toolbarStatus` on Canvas) so it doesn't leave a gap on the right.
  const builtInExtras = hideChrome ? undefined : (
    <div className="flex items-center gap-2">
      {/* Theme toggle — technical (dense, the default) ⇄ slide (deck-ready,
          bigger tiles). Hidden in read-only. Reflects the active tab's resolved
          theme. Styled to match the View/Edit segmented toggle in the same bar
          (bg-muted/60 track, bg-card active pill, text-[11px], no per-button
          hover) so the two toggles read as one control family. */}
      {!readOnly && (
        <div className="flex items-center rounded-md bg-muted/60 p-0.5" title="Diagram theme">
          <button
            type="button"
            onClick={() => onSetTheme("technical")}
            aria-pressed={schema.theme === "technical"}
            className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
              schema.theme === "technical" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" /> Technical
          </button>
          <button
            type="button"
            onClick={() => onSetTheme("slide")}
            aria-pressed={schema.theme === "slide"}
            className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
              schema.theme === "slide" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Presentation className="h-3.5 w-3.5" /> Slide
          </button>
        </div>
      )}
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
    <div className="relative flex h-full w-full flex-col">
      {/* Diagram-integrity badge — bottom-left, above the canvas. In-app only
          (not the standalone viewer / read-only): the standalone has no chat
          agent to fix. Shows nothing when the diagram is clean. */}
      {!readOnly && !onSave && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-20">
          <IssuesBadge issues={issues} onJump={jumpToIssue} onRequestFix={onRequestArchitectureFix} />
        </div>
      )}
      {/* Presence avatars (who else is here) — top-right, above the canvas. */}
      {canvasCollab && (
        <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2">
          <div className="pointer-events-auto rounded-full bg-background/80 px-2 py-1 shadow-sm ring-1 ring-border backdrop-blur">
            <PresenceBar members={canvasCollab.members} meConnId={canvasCollab.meConnId} />
          </div>
        </div>
      )}
      {/* AI-agent-took-over toast. */}
      {agentTookOver && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
          <div className="rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground shadow-md">
            🤖 The assistant updated the architecture
          </div>
        </div>
      )}
      {/* Durability WARNING banner — loud, top-center, above everything. Shown
          when an edit isn't confirmed-saved (writer down / socket zombie / PUT
          failing). Non-blocking: the user keeps editing (edits are buffered and
          the watchdog keeps retrying), but they're never left unaware. */}
      {!onSave && !readOnly && status === "unsaved" && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-lg bg-destructive px-3.5 py-2 text-[12.5px] font-semibold text-destructive-foreground shadow-lg ring-1 ring-destructive/50">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Changes may not be saved — retrying to reconnect…
          </div>
        </div>
      )}
      <CustomLogosContext.Provider value={schema.customLogos ?? {}}>
        {/* Key the PROVIDER (not just the Canvas) by tab so the whole ReactFlow
            store is recreated on a tab switch — reproducing the cold-mount path
            that a page refresh takes. That's what makes the built-in `fitView`
            prop's queued initial fit fire fresh (and correctly framed) for each
            tab; a persisted store only queued the fit once, at first mount. */}
        <ReactFlowProvider key={activeIndex}>
          <Canvas
            schema={schema}
            deepLinks={deepLinks}
            onPersist={onPersist}
            onSetTrademark={onSetTrademark}
            collab={canvasCollab}
            interactingRef={interactingRef}
            onInteractionEnd={() => { archDocRef.current.flushPendingRefresh(); applyPendingRehydrate(); }}
            onShareLive={!onSave && !readOnly ? onShareLive : undefined}
            onToggleHistory={!onSave && !readOnly && !hideChrome ? () => setHistoryOpen((v) => !v) : undefined}
            defaultEditMode={defaultEditMode}
            readOnly={readOnly}
            toolbarExtras={toolbarExtrasProp ?? builtInExtras}
            toolbarStatus={hideChrome ? undefined : <SaveChip status={status} />}
            tabBar={tabBar}
          />
        </ReactFlowProvider>
      </CustomLogosContext.Provider>
      {/* Architecture-history panel (in-app only) — right-side overlay. The
          `refreshSignal` bumps whenever the persisted content changes (our own
          confirmed save, an agent write, or a collaborator op) so an OPEN panel
          keeps its "latest change" row current without polling. */}
      {!onSave && !readOnly && (
        <ArchitectureHistoryPanel
          projectId={projectId}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onRestore={onRestoreHistory}
          refreshSignal={historyRefreshSignal}
        />
      )}
    </div>
  );
}

/** The diagram-integrity badge: shows a count of validation issues (broken id /
 *  edge / handle references) and, on click, a popover listing them grouped by
 *  tab. Clicking an issue jumps to its tab; "Ask the assistant to fix" hands the
 *  full list to the chat agent (the only fixer — no in-UI auto-repair). Renders
 *  nothing when the diagram is clean. */
const IssuesBadge = memo(function IssuesBadge({
  issues,
  onJump,
  onRequestFix,
}: {
  issues: ArchitectureIssue[];
  onJump: (issue: ArchitectureIssue) => void;
  onRequestFix?: (issues: ArchitectureIssue[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;
  const byTab = new Map<string, ArchitectureIssue[]>();
  for (const i of issues) {
    const arr = byTab.get(i.tab) ?? [];
    arr.push(i);
    byTab.set(i.tab, arr);
  }
  return (
    <div className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800 shadow-sm ring-1 ring-amber-300 hover:bg-amber-100"
        title="This diagram has broken references — click for details"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        {issues.length} {issues.length === 1 ? "issue" : "issues"}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 w-96 rounded-lg border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12px] font-semibold text-foreground">Diagram issues</div>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-0.5 text-muted-foreground hover:bg-muted" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mb-1 text-[11px] text-muted-foreground">
            Broken references — an id, edge, or handle points at something that isn't on the tab. These make the diagram render incorrectly.
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto py-1">
            {[...byTab.entries()].map(([tab, list]) => (
              <div key={tab}>
                <div className="px-0.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{tab}</div>
                {list.map((issue, k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { onJump(issue); setOpen(false); }}
                    className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] text-foreground hover:bg-muted"
                    title="Jump to this tab"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                    <span className="leading-snug">{issue.message}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          {onRequestFix && (
            <button
              type="button"
              onClick={() => { onRequestFix(issues); setOpen(false); }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Wand2 className="h-3.5 w-3.5" /> Ask the assistant to fix
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** True when a nested diagram's saved body lays out differently from what the canvas
 *  shows (a node changed container, order or size): the canvas must be rebuilt from it. */
function layoutChanged(body: string, live: PlatformSchema["layout"], defaultLogosOn: boolean): boolean {
  const next = parseArchitecture(body, defaultLogosOn).layout.nodes;
  for (const [id, p] of Object.entries(next)) {
    const q = live.nodes[id];
    if (!q) return true;
    if (Math.abs(q.x - p.x) > 1 || Math.abs(q.y - p.y) > 1) return true;
    if (p.w !== undefined && q.w !== undefined && (Math.abs(q.w - p.w) > 1 || Math.abs((q.h ?? 0) - (p.h ?? 0)) > 1)) return true;
  }
  return Object.keys(live.nodes).some((id) => !(id in next) && !id.startsWith("__"));
}

const SaveChip = memo(function SaveChip({ status }: { status: SaveStatus }) {
  // Icon-only, and the slot is ALWAYS rendered (fixed size) so the toolbar
  // never resizes as the status flips — idle just shows an empty box. `title`
  // still carries the word for hover/accessibility.
  const icon =
    status === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    : status === "saved" ? <Check className="h-3.5 w-3.5 text-emerald-600" />
    : status === "error" || status === "unsaved" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
    : null;
  const label = status === "saving" ? "Saving…" : status === "saved" ? "Saved"
    : status === "error" ? "Save failed" : status === "unsaved" ? "Changes not saved — retrying" : "";
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center" title={label} aria-label={label}>
      {icon}
    </span>
  );
});

export default memo(PlatformDiagram);
