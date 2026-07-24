/**
 * collab-cursors — renders other members' live pointers over the canvas.
 *
 * Peers send their cursor in FLOW coordinates (zoom/pan-independent). We convert
 * each to THIS viewer's screen position with the live ReactFlow viewport
 * transform (screen = flow * zoom + pan), so a peer's cursor sits over the same
 * node for everyone regardless of how each person has panned/zoomed. Absolutely
 * positioned, pointer-events-none, so it never steals interaction.
 */

import { useStore } from "@xyflow/react";
import type { CollabMember } from "./use-collab";

/** A single labeled cursor. */
function Cursor({ member }: { member: CollabMember }) {
  // Subscribe to the live viewport transform [x, y, zoom]. useStore re-renders
  // this tiny component on pan/zoom so peer cursors track the canvas.
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const c = member.cursor;
  if (!c || c.x == null || c.y == null) return null;
  const left = c.x * zoom + tx;
  const top = c.y * zoom + ty;
  return (
    <div
      className="pointer-events-none absolute z-50 -translate-y-0.5 select-none"
      style={{ left, top, transition: "left 60ms linear, top 60ms linear" }}
    >
      {/* Arrow */}
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.25))" }}>
        <path d="M1 1 L1 13 L4.5 9.8 L7 15 L9.4 14 L6.9 8.9 L11.5 8.6 Z" fill={member.color} stroke="#fff" strokeWidth="1" />
      </svg>
      {/* Name pill */}
      <div
        className="ml-3 -mt-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
        style={{ backgroundColor: member.color }}
      >
        {member.name?.split("@")[0] || member.email?.split("@")[0] || "Guest"}
      </div>
    </div>
  );
}

export function CollabCursors({ members, meConnId }: { members: CollabMember[]; meConnId: number | null }) {
  return (
    <>
      {members
        .filter((m) => m.connId !== meConnId && m.cursor)
        .map((m) => (
          <Cursor key={m.connId} member={m} />
        ))}
    </>
  );
}

/** Stacked avatar pills for the toolbar — who's here right now. */
export function PresenceBar({ members, meConnId }: { members: CollabMember[]; meConnId: number | null }) {
  if (members.length <= 1) return null; // solo → nothing to show
  return (
    <div className="flex items-center -space-x-1.5">
      {members.map((m) => {
        const initial = (m.name || m.email || "?").trim().charAt(0).toUpperCase();
        const isMe = m.connId === meConnId;
        return (
          <div
            key={m.connId}
            title={`${m.name || m.email}${isMe ? " (you)" : ""}${m.role === "viewer" ? " · viewer" : ""}`}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white"
            style={{ backgroundColor: m.color }}
          >
            {initial}
          </div>
        );
      })}
    </div>
  );
}
