/**
 * INTERNAL — do NOT sync to the public repo. See .publicignore.
 *
 * A tiny self-contained autocomplete dropdown for picking an industry. No new
 * deps (no cmdk/popover): a text input that filters the option list as you
 * type, with click/keyboard select. "All industries" clears the filter.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, X } from "lucide-react";

const ALL = "__all__";

export function IndustryCombobox({
  industries,
  value,
  onChange,
}: {
  industries: string[];
  /** Selected industry, or null for "All". */
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const options = [ALL, ...industries];
  const filtered = options.filter((o) => {
    const label = o === ALL ? "All industries" : o;
    return label.toLowerCase().includes(query.trim().toLowerCase());
  });

  const select = (o: string) => {
    onChange(o === ALL ? null : o);
    setOpen(false);
    setQuery("");
  };

  const buttonLabel = value ?? "All industries";

  return (
    <div ref={rootRef} className="relative w-full sm:w-72">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-[13px] transition-colors hover:border-border",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {buttonLabel}
        </span>
        <span className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear industry filter"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-border/70 bg-popover shadow-lg">
          <div className="border-b border-border/60 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter industries…"
              className="w-full bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-2 text-[12.5px] text-muted-foreground">No match.</li>
            )}
            {filtered.map((o) => {
              const label = o === ALL ? "All industries" : o;
              const isSelected = o === ALL ? value === null : value === o;
              return (
                <li key={o}>
                  <button
                    type="button"
                    onClick={() => select(o)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted",
                      isSelected && "font-medium text-primary",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
