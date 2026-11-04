// EDIT-054 (T-237-b): a new markdown note is made at the worktree root as untitled.md (then untitled-2.md
// and onwards; files.rs md_new) and is named when it is first saved. These are the naming rules for that
// prompt: what counts as an untitled note, the name suggested, and whether a typed name may be used.

const UNTITLED = /^untitled(-\d+)?\.md$/i;
const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const lower = (p: string) => norm(p).toLowerCase();

/** The file name of a path. */
export const leaf = (p: string) => norm(p).split("/").pop() ?? "";

/** True for a note made by New markdown note and not named yet: untitled(-N).md directly in the worktree root. */
export function isUntitled(path: string, root: string | null): boolean {
  if (!root || !UNTITLED.test(leaf(path))) return false;
  return lower(path.slice(0, path.length - leaf(path).length)) === lower(root);
}

/** EDIT-054: whether a save must ask for the name first: an untitled note whose file is still the empty one Kolux made
 * (once it is saved with any text, even under the suggested name, it saves in place like any file). */
export const needsName = (path: string, root: string | null, disk: string | null): boolean => disk === "" && isUntitled(path, root);

/** The name the first-save prompt suggests: the current file name. */
export const suggestedName = (path: string) => leaf(path);

export type NameCheck = { ok: true; path: string; same: boolean } | { ok: false; error: string };

const BAD_CHARS = /[<>:"|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Whether the typed name may name the note. It is a path under the worktree root, folders allowed (they are
 * created on save); a name without an extension gets .md; the suggested name simply saves; a name that already
 * exists is refused so nothing is overwritten. `exists` answers for full paths. */
export function checkName(typed: string, path: string, root: string, exists: (full: string) => boolean): NameCheck {
  let name = typed.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!name || name.endsWith("/")) return { ok: false, error: "Type a file name." };
  if (/^[a-z]:/i.test(name) || name.startsWith("/")) return { ok: false, error: "Type a name inside the workspace, not a full path." };
  const parts = name.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return { ok: false, error: "A name cannot contain .. or empty folders." };
  if (parts.some((p) => BAD_CHARS.test(p) || RESERVED.test(p) || /[. ]$/.test(p))) return { ok: false, error: "That name has characters or words a file cannot have." };
  if (!/\.[^./]+$/.test(parts[parts.length - 1])) name += ".md";
  const full = `${norm(root)}/${name}`;
  if (lower(full) === lower(path)) return { ok: true, path: norm(path), same: true };
  if (exists(full)) return { ok: false, error: `${name} already exists; choose another name.` };
  return { ok: true, path: full, same: false };
}
