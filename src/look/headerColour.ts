// PROJ-017 (T-266): a project or group header carries a coloured badge picked from a fixed palette.
// Saved as one setting, `headerColours`, a map of "p:<project id>" / "g:<group id>" to a palette id.
// Only palette ids are saved; anything else (or nothing) reads as grey, which is also what every new
// project starts with, so grey is never written.
export const HEADER_COLOURS_SETTING = "headerColours";

export type HeaderColour = { id: string; label: string; hex: string };
export const PALETTE: readonly HeaderColour[] = [
  { id: "grey", label: "Grey", hex: "#8b8f98" },
  { id: "blue", label: "Blue", hex: "#4f8cff" },
  { id: "teal", label: "Teal", hex: "#2bb5a4" },
  { id: "green", label: "Green", hex: "#4caf6a" },
  { id: "amber", label: "Amber", hex: "#e0a030" },
  { id: "red", label: "Red", hex: "#e5534b" },
  { id: "pink", label: "Pink", hex: "#d96aa7" },
  { id: "purple", label: "Purple", hex: "#9b72e8" },
];
const GREY = PALETTE[0];

export type HeaderKind = "p" | "g";
const keyOf = (kind: HeaderKind, id: string) => `${kind}:${id}`;

/** The saved map, keeping only entries whose colour is in the palette (and is not the grey default). */
export function readHeaderColours(settings: Record<string, unknown>): Record<string, string> {
  const raw = settings[HEADER_COLOURS_SETTING];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v !== "grey" && PALETTE.some((c) => c.id === v))) as Record<string, string>;
}

export const headerColourOf = (settings: Record<string, unknown>, kind: HeaderKind, id: string): HeaderColour =>
  PALETTE.find((c) => c.id === readHeaderColours(settings)[keyOf(kind, id)]) ?? GREY;

/** The new value of the `headerColours` setting after picking `colour` (an id that is not in the palette changes nothing). */
export function pickHeaderColour(settings: Record<string, unknown>, kind: HeaderKind, id: string, colour: string): Record<string, string> {
  const now = readHeaderColours(settings);
  if (!PALETTE.some((c) => c.id === colour)) return now;
  const { [keyOf(kind, id)]: _gone, ...rest } = now;
  return colour === "grey" ? rest : { ...rest, [keyOf(kind, id)]: colour };
}

/** The `headerColours` setting without the entries of deleted projects or groups (FIX-1: the map no
 *  longer only grows). Returns the same map object's content when nothing was there to drop. */
export function forgetHeaderColours(settings: Record<string, unknown>, gone: ReadonlyArray<{ kind: HeaderKind; id: string }>): Record<string, string> {
  const drop = new Set(gone.map((g) => keyOf(g.kind, g.id)));
  return Object.fromEntries(Object.entries(readHeaderColours(settings)).filter(([k]) => !drop.has(k)));
}

/** The headers that disappear with a deleted group: the group's own, plus (when its projects are removed
 *  too, `remove`) each project that was in it. `members` maps project id to group id and must be the
 *  map from BEFORE the delete: the answer to the delete no longer lists them. */
export function headersGoneWithGroup(members: Readonly<Record<string, string>>, groupId: string, remove: boolean): Array<{ kind: HeaderKind; id: string }> {
  const projects = remove ? Object.entries(members).filter(([, gid]) => gid === groupId).map(([pid]) => ({ kind: "p" as const, id: pid })) : [];
  return [{ kind: "g", id: groupId }, ...projects];
}

/** The new `headerColours` value after those headers are gone, or null when none of them had a colour (so
 *  the caller saves nothing). Give it the settings as they are when the delete finishes, not from before. */
export function colourSaveAfterDelete(settings: Record<string, unknown>, gone: ReadonlyArray<{ kind: HeaderKind; id: string }>): Record<string, string> | null {
  const had = readHeaderColours(settings);
  return gone.some((g) => keyOf(g.kind, g.id) in had) ? forgetHeaderColours(settings, gone) : null;
}

/** Roving focus for a swatch row: the id Arrow keys move to from `value` (wrapping), or null for other keys. */
export function swatchStep(key: string, ids: readonly string[], value: string): string | null {
  if (ids.length === 0) return null;
  const at = Math.max(0, ids.indexOf(value));
  if (key === "ArrowRight" || key === "ArrowDown") return ids[(at + 1) % ids.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return ids[(at + ids.length - 1) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}

/** Only the picked swatch (the first, when none is) is a Tab stop. */
export const swatchTabIndex = (id: string, ids: readonly string[], value: string): 0 | -1 => (id === (ids.includes(value) ? value : ids[0]) ? 0 : -1);
