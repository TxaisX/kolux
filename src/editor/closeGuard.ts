// EDIT-031 (T-236-b): closing tabs never drops unsaved edits. Every way of closing (one tab, the others,
// all, to the right or left, Mod+W, the x, Mod+Alt+W) comes here first with the keys it would close. If any
// of them holds unsaved text, nothing closes until the user chose Save, Don't save or Cancel; Save closes
// only the tabs that did get saved. These are the rules; CloseDialog.tsx is the dialog.

export type GuardPane = { key: number; kind?: string; path?: string; cwd?: string | null };
export type Unsaved = { key: number; path: string; root: string | null };

/** The tabs among `keys` that hold unsaved text, in the order of `keys`, once each. Only file tabs count. */
export function unsavedTabs(keys: number[], panes: GuardPane[], dirty: Record<number, boolean>): Unsaved[] {
  const out: Unsaved[] = [];
  const seen = new Set<number>();
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const p = panes.find((x) => x.key === k);
    if (p && p.path && (p.kind === "editor" || p.kind === "diff") && dirty[k]) out.push({ key: k, path: p.path, root: p.cwd ?? null });
  }
  return out;
}

export type Choice = "save" | "discard" | "cancel";

/** The keys that may close after the choice. Cancel closes nothing; Don't save closes everything asked for; Save
 * closes everything except the unsaved tabs that did not get saved (a failed save, a refused name, a file that
 * changed on disk), so those stay open with their text. */
export function closable(choice: Choice, keys: number[], unsaved: Unsaved[], saved: ReadonlySet<number>): number[] {
  if (choice === "cancel") return [];
  if (choice === "discard") return keys;
  const open = new Set(unsaved.filter((u) => !saved.has(u.key)).map((u) => u.key));
  return keys.filter((k) => !open.has(k));
}

/** EDIT-031 for a whole workspace: the removal may go on only on an explicit choice, and Save only when
 *  every unsaved file was saved. Cancel stops it; Don't save drops the text on purpose. */
export function mayRemove(choice: Choice, unsaved: Unsaved[], saved: ReadonlySet<number>): boolean {
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return unsaved.every((u) => saved.has(u.key));
}

export type SaveIo = {
  /** Whether the file's buffer still holds unsaved text (a twin tab's save may have cleaned it). */
  dirty(path: string): boolean;
  /** Whether this tab is an untitled note that asks for its name first. */
  needsName(t: Unsaved): boolean;
  /** Saves in place; false when it did not work (the reason is the caller's to show). */
  write(t: Unsaved): Promise<boolean>;
  /** Asks for the name and saves under it; false when the user cancelled or it failed. */
  name(t: Unsaved): Promise<boolean>;
};

/** Saves the unsaved tabs one after another and returns the keys that are saved now. A tab whose file a twin
 * tab already saved counts as saved without another write. */
export async function saveAll(tabs: Unsaved[], io: SaveIo): Promise<Set<number>> {
  const saved = new Set<number>();
  for (const t of tabs) {
    let ok: boolean;
    try {
      ok = !io.dirty(t.path) ? true : io.needsName(t) ? await io.name(t) : await io.write(t);
    } catch {
      ok = false;
    }
    if (ok) saved.add(t.key);
  }
  return saved;
}

/** Wording for the dialog: one sentence naming up to three files. */
export function askText(names: string[]): string {
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  return `${names.length === 1 ? "This file has" : `These ${names.length} files have`} unsaved changes: ${shown}.`;
}

/** EDIT-031: new notes that were never typed in, among the tabs about to close. Such a note is still the empty
 * file Kolux made (empty on disk and in the editor), is directly in a worktree Kolux knows (`cwd` is set), and no
 * tab that stays open shows it. A note made from a template holds text, so it is kept. */
export function unusedNotes(
  closing: GuardPane[],
  staying: GuardPane[],
  isNote: (path: string, root: string | null) => boolean,
  read: (path: string) => { text: string | null; disk: string | null },
): string[] {
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const open = new Set(staying.filter((p) => p.path).map((p) => norm(p.path as string)));
  const out: string[] = [];
  for (const p of closing) {
    if (p.kind !== "editor" || !p.path || !p.cwd || open.has(norm(p.path)) || out.some((o) => norm(o) === norm(p.path as string))) continue;
    const r = read(p.path);
    if (isNote(p.path, p.cwd) && r.disk === "" && (r.text ?? "") === "") out.push(p.path);
  }
  return out;
}
