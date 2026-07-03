/**
 * platform-diagram/tab-bar — the multi-architecture tab strip.
 *
 * The architecture file is an ARRAY of architectures (one per tab). This bar
 * sits at the TOP-LEFT of the canvas (the floating action bar is top-right; the
 * component-library palette is a separate flex column further left, so they
 * don't overlap). It offers:
 *   • a pill per tab (active one highlighted), click to switch;
 *   • double-click a tab → rename inline (Enter/blur commits, Esc cancels);
 *   • `×` on a tab → a confirm modal before deleting (disabled when only one);
 *   • `+` → add a new blank tab.
 *
 * All state lives in PlatformDiagram; this is a controlled component.
 */
import { memo, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

export const TabBar = memo(function TabBar({
  names,
  activeIndex,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  names: string[];
  activeIndex: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onRename: (i: number, name: string) => void;
  onDelete: (i: number) => void;
}) {
  // Inline-rename state: which tab is being edited + its draft text.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Pending delete (index) → confirm modal.
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => {
    if (editing !== null) inputRef.current?.select();
  }, [editing]);

  const startRename = (i: number) => { setEditing(i); setDraft(names[i] ?? ""); };
  const commitRename = () => {
    if (editing === null) return;
    const v = draft.trim();
    if (v && v !== names[editing]) onRename(editing, v);
    setEditing(null);
  };

  const single = names.length <= 1;

  return (
    <>
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-13rem)] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
        {names.map((name, i) => {
          const active = i === activeIndex;
          return (
            <div
              key={i}
              className={`group flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium ${
                active ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {editing === i ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                    else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                  }}
                  className="w-28 rounded border border-border bg-background px-1 py-0.5 text-[12px] text-foreground outline-none focus:border-primary"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  onDoubleClick={() => startRename(i)}
                  className="cursor-pointer whitespace-nowrap"
                  title={active ? "Double-click to rename" : name}
                >
                  {name}
                </button>
              )}
              {!single && editing !== i && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(i); }}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-background hover:text-destructive"
                  title="Delete this architecture"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAdd}
          className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="New architecture"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Delete-confirm modal — mirrors the trademark permission modal style. */}
      {confirmDelete !== null && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-background/60"
          onClick={() => setConfirmDelete(null)}
        >
          <div className="w-[min(400px,92vw)] rounded-xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-[14px] font-semibold text-foreground">Delete this architecture?</div>
            <p className="mb-3 text-[12px] leading-snug text-muted-foreground">
              “{names[confirmDelete]}” and everything on it will be removed. This can’t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }}
                className="rounded-md bg-destructive px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
