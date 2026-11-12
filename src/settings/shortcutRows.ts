// SET-008 / SET-010: the Shortcuts page's rows. Each command with its chords as drawn, its area,
// its badges (Modified, Unassigned, Disabled, Conflicts) and, for a clash, a hint on fixing it;
// then the filters and the search. Pure, so it is tested without a browser.
import { defaultsFor, type Platform, type Scope } from "../keys/actions";
import { labelParts, parseChord, type Keymap } from "../keys/keymap";
import type { NativeChord } from "../chrome/chromeItems";
import { systemCapturedChord, systemCaptureWarning } from "../keys/systemCapture";

// Goal 0: the "browser" area went with the web pane, and its scope went with it (c3-terminal), so this is
// exactly the scopes the keymap still knows. A scope with no commands draws no area on the page.
export const AREAS: Record<Scope, string> = { global: "General", tabs: "Tabs", terminal: "Terminal", editor: "Editor", explorer: "File explorer", settings: "Settings" };
export type Badge = "Modified" | "Unassigned" | "Disabled" | "Conflicts";
export type Filter = "all" | "modified" | "unassigned" | "conflicting";
export const FILTERS: Array<[Filter, string]> = [["all", "All"], ["modified", "Modified"], ["unassigned", "Unassigned"], ["conflicting", "Conflicting"]];
/** A longer search is cut to this, so an enormous paste cannot freeze the list. */
export const MAX_QUERY = 100;

export type Row = { id: string; title: string; area: string; chords: string[]; defaults: string[]; labels: string[]; custom: boolean; modified: boolean; badges: Badge[]; hint?: string; warning?: string; find: string[] };

const compact = (s: string) => s.toLowerCase().replace(/[\s+]/g, "");
const names = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function clashHint(clash: { chord: string; ids: string[] } | undefined, menu: NativeChord[], self: string, title: (id: string) => string, label: (c: string) => string): string {
  const others = [...(clash ? clash.ids.filter((x) => x !== self).map(title) : []), ...menu.map((m) => m.name + " in the menu")];
  return `${label(clash?.chord ?? menu[0].chord)} is also used by ${names(others)} here. Give one of them other keys.`;
}

/** SET-010: the native menu's chords this command is bound to. Only global commands compete with the
 *  system menu, which sees every key before a smaller scope does. */
function nativeHits(chords: string[], native: readonly NativeChord[]): NativeChord[] {
  if (native.length === 0) return [];
  // Only macOS reports native chords, and there Mod is Cmd, so Mod+Q and Cmd+Q are the same key.
  const same = (a: string, b: string) => {
    const x = parseChord(a);
    const y = parseChord(b);
    return !("error" in x) && !("error" in y) && (x.mod || x.meta) === (y.mod || y.meta) && x.ctrl === y.ctrl && x.alt === y.alt && x.shift === y.shift && x.key === y.key;
  };
  return native.filter((n) => chords.some((c) => same(c, n.chord)));
}

/** Commands in the keymap with no handler anywhere yet: none since T-611 (Hard Reload runs as Reload, keys/actions.ts
 *  sameAs). Grab Page Element is routed by the browser pane (T-240). */
const NOT_ROUTED = new Set<string>([]);

/** `native`: the chords the system menu owns (menu_sync reports them; none outside macOS). */
export function shortcutRows(map: Keymap, native: readonly NativeChord[] = []): Row[] {
  const p = map.platform;
  const title = (id: string) => map.bindings.get(id)?.action.title ?? id;
  // T-239 (BROW-019): Reopen closed tab is offered again now that the window reopens closed browser tabs (T-543-b had hidden it).
  // T-164-b: a command nothing runs yet is not offered; drop an id from NOT_ROUTED when its handler lands.
  return [...map.bindings.values()].filter(({ action }) => !NOT_ROUTED.has(action.id)).map(({ action, chords, custom, dropped }) => {
    const defaults = defaultsFor(action, p);
    const modified = custom && chords.join() !== defaults.join();
    const clash = map.clashes.find((c) => c.ids.includes(action.id));
    const menu = action.scope === "global" ? nativeHits(chords, native) : [];
    const badges: Badge[] = [];
    if (chords.length === 0) badges.push("Unassigned");
    else if (modified) badges.push("Modified");
    if (clash || menu.length > 0) badges.push("Conflicts");
    const label = (c: string, on: Platform = p) => labelParts(c, on).join("+");
    // Only a chord the user chose: the shipped Ctrl+1 for Select Tab is not nagged about.
    const taken = modified ? chords.find((c) => !defaults.includes(c) && systemCapturedChord(c, p)) : undefined;
    const every = [...chords, ...action.win32, ...(action.darwin ?? [])];
    const find = [action.title, AREAS[action.scope], action.id, ...(action.keywords ?? [])].map((s) => s.toLowerCase());
    const keys = every.flatMap((c) => [c, label(c, "win32"), label(c, "darwin")]).map(compact);
    return {
      id: action.id,
      title: action.title,
      area: AREAS[action.scope],
      chords,
      defaults,
      custom: custom || !!dropped,
      labels: chords.map((c) => label(c)),
      modified,
      badges,
      hint: clash || menu.length > 0 ? clashHint(clash, menu, action.id, title, label) : undefined,
      warning: taken ? systemCaptureWarning(label(taken)) : undefined,
      find: [...find, ...keys.map((k) => "\u0000" + k)],
    };
  });
}

/** The rows a filter and a search leave, in table order. Text matches titles, areas, ids and
 *  keywords; a chord matches as written in the file or as drawn, on any platform. */
export function filterRows(rows: Row[], filter: Filter, query: string): Row[] {
  const q = query.slice(0, MAX_QUERY).trim().toLowerCase();
  const k = "\u0000" + compact(q);
  const pass = (r: Row) => (filter === "all" ? true : filter === "modified" ? r.modified : filter === "unassigned" ? r.chords.length === 0 : r.badges.includes("Conflicts"));
  return rows.filter((r) => pass(r) && (!q || r.find.some((f) => (f.startsWith("\u0000") ? f.includes(k.slice(1)) && k.length > 1 : f.includes(q)))));
}
