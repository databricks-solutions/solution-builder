/**
 * use-arch-doc — the Yjs-backed source of truth for the multi-tab architecture,
 * isolating ALL the CRDT wiring behind the same small surface the parent already
 * used with the legacy op transport. When the Yjs flag is on + collab enabled,
 * PlatformDiagram consumes THIS instead of its hand-rolled tabBodies/persistTab/
 * applyRemoteOp machinery.
 *
 * Owns:
 *   • the shared `Y.Doc` (memoized per project),
 *   • the sync hook (useCollabYjs) — WS transport + awareness + writer election,
 *   • observe(doc) → { tabBodies, tabNames } for the existing Canvas pipeline,
 *   • the write API (persistTab / addTab / removeTab / renameTab) → doc mutations
 *     (per-object deltas, so concurrent peer edits merge), and
 *   • the WRITER's debounced snapshot doc → architecture.md via the parent's
 *     doSave (keeps the echo-guard, history snapshot, and save-status intact).
 *
 * Persistence stays client-side + writer-gated exactly like before; the doc is
 * the live merge layer, architecture.md is still the durable source of truth.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as Y from "yjs";
import { useCollabYjs, type CollabMember } from "./use-collab-yjs";
import {
  hydrateDocFromMd,
  docToMd,
  docToTabBodies,
  applyTabBodyToDoc,
  addTabToDoc,
  removeTabFromDoc,
  renameTabInDoc,
  tabOrder,
  HYDRATE_ORIGIN,
} from "./ydoc-model";

export interface ArchDocApi {
  /** Stable tab ids in order — the parent maps activeIndex→tabId to target ops. */
  tabIds: string[];
  connected: boolean;
  synced: boolean;
  members: CollabMember[];
  meConnId: number | null;
  isWriter: boolean;
  sendCursor: (x: number, y: number, sel?: string | null) => void;
  /** Write a whole single-tab body into the doc at index (per-object diff). */
  persistTab: (index: number, body: string) => void;
  addTab: (name: string, body: string) => void;
  removeTab: (index: number) => void;
  renameTab: (index: number, name: string) => void;
  /** Replace the ENTIRE doc from an architecture.md (agent takeover / restore). */
  rehydrate: (md: string) => void;
  /** Apply any remote change deferred during a local drag/resize (call on drop). */
  flushPendingRefresh: () => void;
}

export function useArchDoc({
  projectId,
  enabled,
  initialContent,
  interactingRef,
  doSave,
  setTabBodies,
  setTabNames,
  onExternalWrite,
}: {
  projectId: string;
  enabled: boolean;
  /** Content to seed a COLD doc (no peers yet) from, on first sync. */
  initialContent: string | null;
  /** True while the LOCAL user is mid drag/resize. A remote update still MERGES
   *  into the doc live (CRDT), but re-deriving tabBodies (→ canvas reseed) is
   *  DEFERRED until the interaction settles, so a peer edit can't reseed the graph
   *  out from under an in-progress drag (the "flash/jank"). Flushed on drop via
   *  `flushPendingRefresh`. */
  interactingRef?: MutableRefObject<boolean>;
  /** The parent's durable save (writer-gated persistence to architecture.md).
   *  Called with the doc→md snapshot, debounced. */
  doSave: (md: string) => void;
  /** The parent's existing tabBodies/tabNames setters — the doc DRIVES these so
   *  the whole downstream pipeline (activeBody/built/Canvas) is unchanged; only
   *  who WRITES the state (the doc, via observe) changes. */
  setTabBodies: (bodies: string[]) => void;
  setTabNames: (names: string[]) => void;
  /** Fired when the doc changed from a REMOTE update (peer edit / rehydrate) so
   *  the parent can mark the architecture snapshot dirty (agent PNG re-capture). */
  onExternalWrite?: () => void;
}): ArchDocApi {
  // One doc per project, for the life of the mount.
  const ydoc = useMemo(() => new Y.Doc(), [projectId]);

  const [tabIds, setTabIds] = useState<string[]>([]);
  const setBodiesRef = useRef(setTabBodies); setBodiesRef.current = setTabBodies;
  const setNamesRef = useRef(setTabNames); setNamesRef.current = setTabNames;

  const initialRef = useRef(initialContent);
  initialRef.current = initialContent;
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;
  const onExternalWriteRef = useRef(onExternalWrite);
  onExternalWriteRef.current = onExternalWrite;

  // Derive the tab arrays from the doc (called on every observed change) and push
  // them into the parent's existing state, so the downstream pipeline is unchanged.
  const refresh = useCallback(() => {
    const tabs = docToTabBodies(ydoc);
    setBodiesRef.current(tabs.map((t) => t.body));
    setNamesRef.current(tabs.map((t) => t.name));
    setTabIds(tabOrder(ydoc));
  }, [ydoc]);

  // Whether THIS client seeded the shared doc from architecture.md. We only seed
  // a COLD room (no peers → empty doc after sync). Tracks so that if the WS syncs
  // BEFORE the `content` prop has loaded (a real race on fast networks: doc would
  // seed from null → stay blank forever), we seed as soon as content arrives.
  const syncedEmpty = useRef(false);   // synced with an empty doc + no content yet
  const seededOrRemote = useRef(false); // doc has real content (we seeded, or a peer did)

  const seedIfPossible = useCallback((doc: Y.Doc) => {
    // A room with existing state (a peer already populated it, or replay applied)
    // needs no seed — just derive. A cold room seeds from the current content IFF
    // it's loaded; otherwise mark syncedEmpty so the content-arrival effect seeds.
    if (tabOrder(doc).length > 0) { seededOrRemote.current = true; refresh(); return; }
    if (initialRef.current) { hydrateDocFromMd(doc, initialRef.current); seededOrRemote.current = true; }
    else { syncedEmpty.current = true; }
    refresh();
  }, [refresh]);

  // First sync callback from the transport.
  const onSynced = useCallback((doc: Y.Doc) => { seedIfPossible(doc); }, [seedIfPossible]);

  const collab = useCollabYjs({ projectId, enabled, ydoc, onSynced });

  // Content-arrival seed: if we synced an EMPTY doc before the content prop loaded,
  // seed the doc the moment content arrives (once). Without this a fast WS sync
  // leaves the canvas blank and the real diagram never loads. Guarded by
  // seededOrRemote so a peer-populated doc is never clobbered.
  useEffect(() => {
    if (!enabled || !syncedEmpty.current || seededOrRemote.current) return;
    if (!initialContent) return;
    if (tabOrder(ydoc).length > 0) { seededOrRemote.current = true; return; }
    hydrateDocFromMd(ydoc, initialContent);
    seededOrRemote.current = true;
    syncedEmpty.current = false;
  }, [enabled, ydoc, initialContent]);
  const isWriterRef = useRef(collab.isWriter);
  isWriterRef.current = collab.isWriter;
  const interactingRefLocal = useRef(interactingRef);
  interactingRefLocal.current = interactingRef;
  // Set when a doc change arrived while the local user was interacting, so we
  // re-derive tabBodies once (from the LATEST doc state) when they settle.
  const pendingRefresh = useRef(false);
  // The last md this client actually PUT — so a writer save (debounced OR the
  // become-writer catch-up) skips re-saving byte-identical content (which would
  // spawn a spurious history version, e.g. on a writer handoff).
  const lastSavedMd = useRef<string | null>(null);
  // Whether the LOCAL user has actually edited the doc this session (a `tr.local`
  // transaction). The become-writer catch-up save MUST NOT fire without this —
  // otherwise merely opening/refreshing a project (which seeds the doc, then
  // elects this client writer) persists the just-seeded doc back to disk. When
  // the seed came from a STALE room replay log rather than fresh disk, that
  // silently CLOBBERS a newer on-disk file (e.g. an agent/external edit) with
  // zero user action — the "idle refresh reverts my changes" bug. A passive
  // join is never a reason to write; only a real local edit is.
  const localEdited = useRef(false);

  // Observe the doc for ANY change (local or remote) → re-derive the tab arrays,
  // and (writer only) debounce a snapshot save. `transaction.local` is false for
  // updates that arrived from the network. While the LOCAL user is mid drag/
  // resize we DEFER the re-derive (which would reseed the canvas out from under
  // the interaction — the "flash"); the peer update still merges into the doc
  // now, we just apply it to the canvas on drop (flushPendingRefresh). A LOCAL
  // transaction is our own edit — never deferred, and doesn't fire onExternalWrite
  // (the caller already dirtied the snapshot).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    // Yjs `afterTransaction` fires with (transaction, doc) — NOT (update, origin,
    // doc, transaction). Reading tr off the wrong arg gave `undefined.local` and
    // threw inside every update apply, killing sync entirely.
    const onAfter = (tr: Y.Transaction) => {
      const interacting = !!interactingRefLocal.current?.current;
      // A HYDRATE transaction is a programmatic full-doc reset (seed from disk /
      // agent rehydrate), NOT a user edit — it must never mark the doc as locally
      // edited nor trigger a writer save (that would persist the just-seeded doc
      // straight back to disk, clobbering newer on-disk content on a passive join).
      const isHydrate = tr.origin === HYDRATE_ORIGIN;
      // Defer ONLY remote changes during a local interaction. A local transaction
      // (our own drag frame) must re-derive immediately or the canvas desyncs.
      if (interacting && !tr.local) {
        pendingRefresh.current = true;
      } else {
        refresh();
      }
      if (tr.local && !isHydrate) localEdited.current = true; // a real local edit — safe to persist
      if (!tr.local) onExternalWriteRef.current?.(); // remote/rehydrate change
      // Writer persists the merged doc → md (debounced). Non-writers never save;
      // a hydrate reset never triggers a save (it's disk content already).
      if (isWriterRef.current && !isHydrate) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          if (!localEdited.current) return; // no real edit yet — don't persist a passive/seed state
          try {
            const md = docToMd(ydoc);
            if (md !== lastSavedMd.current) { lastSavedMd.current = md; doSaveRef.current(md); }
          } catch { /* noop */ }
        }, 700);
      }
    };
    ydoc.on("afterTransaction", onAfter);
    return () => { ydoc.off("afterTransaction", onAfter); if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [ydoc, enabled, refresh]);

  // Writer catch-up save. The writer-save above only fires on a doc CHANGE, but an
  // edit made in the window BETWEEN connect and the server confirming us as writer
  // (isWriter false then) scheduled NO save. So whenever we BECOME the writer,
  // snapshot the current doc once — but ONLY if the local user has actually edited
  // (`localEdited`). Without that guard, merely joining/refreshing a project seeds
  // the doc then elects this client writer, and this save persists the just-seeded
  // doc back to disk — CLOBBERING a newer on-disk file with a stale room replay,
  // no user action involved (the "idle refresh reverts my edit" bug). `lastSavedMd`
  // additionally dedups byte-identical re-saves (a writer HANDOFF of unchanged
  // content). Covers the real case: a solo user's first edits made before the
  // `writer` frame lands.
  useEffect(() => {
    if (!enabled || !collab.synced || !collab.isWriter) return;
    const t = setTimeout(() => {
      if (!localEdited.current) return; // passive join — never persist a non-edit
      try {
        const md = docToMd(ydoc);
        if (md !== lastSavedMd.current) { lastSavedMd.current = md; doSaveRef.current(md); }
      } catch { /* noop */ }
    }, 700);
    return () => clearTimeout(t);
  }, [enabled, collab.synced, collab.isWriter, ydoc]);

  // Called by the parent when a local drag/resize settles: apply any remote change
  // that merged into the doc during the interaction (deferred above).
  const flushPendingRefresh = useCallback(() => {
    if (pendingRefresh.current) { pendingRefresh.current = false; refresh(); }
  }, [refresh]);

  // --- write API (index → tabId, then doc mutation) ------------------------
  const idAt = useCallback((index: number): string | undefined => tabOrder(ydoc)[index], [ydoc]);

  const persistTab = useCallback((index: number, body: string) => {
    const tid = idAt(index);
    if (tid) applyTabBodyToDoc(ydoc, tid, body);
  }, [ydoc, idAt]);

  const addTab = useCallback((name: string, body: string) => { addTabToDoc(ydoc, name, body); }, [ydoc]);
  const removeTab = useCallback((index: number) => { const tid = idAt(index); if (tid) removeTabFromDoc(ydoc, tid); }, [ydoc, idAt]);
  const renameTab = useCallback((index: number, name: string) => { const tid = idAt(index); if (tid) renameTabInDoc(ydoc, tid, name); }, [ydoc, idAt]);

  const rehydrate = useCallback((md: string) => { hydrateDocFromMd(ydoc, md); }, [ydoc]);

  return {
    tabIds,
    connected: collab.connected,
    synced: collab.synced,
    members: collab.members,
    meConnId: collab.me?.connId ?? null,
    isWriter: collab.isWriter,
    sendCursor: collab.sendCursor,
    persistTab, addTab, removeTab, renameTab, rehydrate, flushPendingRefresh,
  };
}
