/**
 * The Deck tab's own toolbar for the html-it deck (the kit's local patch
 * .claude/skills/databricks-solution-builder/references/html-it-kit-patches/host_toolbar.py).
 *
 * The deck keeps its toolbar. The Deck tab's bar shows the same buttons, because people did
 * not find the deck's (Solution Builder team review, 2026-11-06). A button posts
 * {type:'htmlit:host-cmd', cmd} to the framed deck, the deck presses its own matching button,
 * and it reports {type:'htmlit:host-state'} back on load and on every change.
 *
 * Builds: on by default, so each click reveals the next part of a slide, html-it's own stepping
 * (Morgan, 2026-11-06: "we think it is a valuable capability but want to empower folks to change
 * it"). Turning builds off shows every slide whole, so one click moves to the next slide. It is a
 * viewer preference, remembered in this browser, and never changes the deck file or the story.
 */

export const DECK_COMMANDS = ["theme", "notes", "edit", "present", "pdf", "slides", "builds", "state"] as const;
export type DeckCommand = (typeof DECK_COMMANDS)[number];

export interface DeckHostState {
  theme: "warm" | "dark";
  notes: boolean;
  edit: boolean;
  present: boolean;
  builds: boolean;
  /** The presenter's address relative to the deck, with the deck's link token; null for a deck that sends none. */
  presenter: string | null;
}

/** The deck's state report, or null for any other message. A deck built before the patch never
 *  sends one, so the bar's deck buttons stay disabled for it. */
export function parseHostState(data: unknown): DeckHostState | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== "htmlit:host-state" || d.version !== 1) return null;
  return {
    theme: d.theme === "dark" ? "dark" : "warm",
    notes: d.notes === true,
    edit: d.edit === true,
    present: d.present === true,
    builds: d.builds !== false,
    presenter: typeof d.presenter === "string" ? d.presenter : null,
  };
}

export function hostCommand(cmd: DeckCommand, value?: boolean): { type: "htmlit:host-cmd"; version: 1; cmd: DeckCommand; value?: boolean } {
  return value === undefined ? { type: "htmlit:host-cmd", version: 1, cmd } : { type: "htmlit:host-cmd", version: 1, cmd, value };
}

export const BUILDS_PREF_KEY = "sb:deck-builds";

/** Builds are on unless this browser turned them off. */
export function readBuildsPref(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(BUILDS_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeBuildsPref(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, on: boolean): void {
  try {
    if (on) storage?.removeItem(BUILDS_PREF_KEY);
    else storage?.setItem(BUILDS_PREF_KEY, "off");
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

/** The deck's address with the viewer's builds choice, for Open in new tab. */
export function deckUrlWithBuilds(url: string, buildsOn: boolean): string {
  if (buildsOn) return url;
  return url + (url.includes("?") ? "&" : "?") + "builds=off";
}

/** The frame name the Deck tab gives the deck, so a presenter the Deck tab opens can find it (presenter_link.py). */
export const DECK_FRAME_NAME = "htmlit-deck";

/** The Deck tab's window name for this project, which the presenter's "deck: linked" uses to come back here. */
export function hostWindowName(projectId: string): string {
  return "sb-deck-" + projectId.replace(/[^\w-]/g, "");
}

/**
 * The presenter address the Deck tab opens from its own click, or null when the deck reported none or an unsafe one.
 * A browser opens a pop-up only from a click in the same frame, so the bar's Present cannot ask the deck to open it.
 * The deck is agent-written, so its address must stay an .html file beside the deck, on this page's origin.
 */
export function presenterUrl(deckSrc: string, presenter: string | null, pageUrl: string, backName: string): string | null {
  if (!presenter) return null;
  try {
    const deck = new URL(deckSrc, pageUrl);
    const url = new URL(presenter, deck);
    const dir = deck.pathname.slice(0, deck.pathname.lastIndexOf("/") + 1);
    const name = url.pathname.slice(dir.length);
    if (url.origin !== new URL(pageUrl).origin || !url.pathname.startsWith(dir) || !/^[\w.-]+\.html$/.test(name)) return null;
    if (!url.searchParams.get("htmlit")) return null;
    url.searchParams.set("deck", DECK_FRAME_NAME);
    url.searchParams.set("back", backName);
    return url.toString();
  } catch {
    return null;
  }
}

/** The deck asking its host page to take a title while it prints (kit patch export_names.py): the browser names a PDF
 *  after the top page's title, so a deck framed here would otherwise print as this app. */
export interface DeckPrint {
  phase: "before" | "after";
  title: string;
}

export function parseHostPrint(data: unknown): DeckPrint | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== "htmlit:host-print" || d.version !== 1 || (d.phase !== "before" && d.phase !== "after")) return null;
  const title = typeof d.title === "string" ? d.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return { phase: d.phase, title };
}
