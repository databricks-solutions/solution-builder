/** The slice of the collab session the Canvas needs — kept as a tiny interface
 *  so canvas.tsx doesn't depend on the WS hook directly (PlatformDiagram owns
 *  the hook and passes this down). */
import type { CollabMember } from "./use-collab";

export interface CanvasCollab {
  /** Peers (excluding me) render as live cursors; the roster drives presence. */
  members: CollabMember[];
  /** My connId (to exclude my own cursor). Null when solo/offline. */
  meConnId: number | null;
  /** Send my cursor position in FLOW coordinates (throttled inside the hook). */
  sendCursor: (x: number, y: number, sel?: string | null) => void;
}
