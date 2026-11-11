// EDIT-014 (T-234-b): what a link in a note means. Pure rules, no screen: the preview and the rich
// view hand a clicked href to `resolveLink` and act on the answer; `[[note]]` text goes through
// `wikiLinks` / `wikiTarget`. Slugs follow GitHub's heading anchors.
import { keyOf } from "./buffers";
import { outline, outlineAt } from "./toc";
import { fromFileUrl, resolvePath } from "../terminal/links";

/** A line anchor as the card allows: #L10, #L10C5 or :10:5 (a trailing :10 is a line too). */
export type Anchor = { path: string; line?: number; col?: number; heading?: string };

/** Splits a link target into the file part and its anchor. A Windows drive letter (C:\x, C:/x) is
 *  never read as a line number, and a trailing colon-number belongs to a path only after a name. */
export function splitAnchor(raw: string): Anchor {
  const hash = raw.indexOf("#");
  let path = hash < 0 ? raw : raw.slice(0, hash);
  const frag = hash < 0 ? "" : raw.slice(hash + 1);
  const m = frag.match(/^L(\d+)(?:C(\d+))?$/i);
  if (m) return { path, line: Number(m[1]), ...(m[2] ? { col: Number(m[2]) } : {}) };
  const colon = path.match(/^(.*?[^:\\/]):(\d+)(?::(\d+))?$/);
  // "C:10" has nothing before the colon but a drive letter: it stays a path
  if (colon && !/^[A-Za-z]$/.test(colon[1])) {
    path = colon[1];
    return { path, line: Number(colon[2]), ...(colon[3] ? { col: Number(colon[3]) } : {}), ...(frag ? { heading: frag } : {}) };
  }
  return { path, ...(frag ? { heading: frag } : {}) };
}

/** GitHub's heading anchor: lower case, marks other than letters, digits, spaces, hyphens and underscores
 *  dropped, spaces to hyphens. */
export const slugOf = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");

/** An anchor as the heading slug it names: percent escapes decoded, lower case. An escape that is not UTF-8 (#%E0%A4)
 *  is kept as written, so it names no heading instead of throwing in the click handler. */
export function anchorText(slug: string): string {
  const s = slug.replace(/%(?![0-9a-f]{2})/gi, "%25");
  try {
    return decodeURIComponent(s).toLowerCase();
  } catch {
    return slug.toLowerCase();
  }
}

/** The anchors of a note's headings in order; a repeated heading gets -1, -2 ... like GitHub. */
export function headingSlugs(md: string): string[] {
  const seen = new Map<string, number>();
  return outline(md).map((e) => {
    const base = slugOf(e.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
}

/** The 1-based line a heading anchor points at, or null. Row 122: every heading the outline sees,
 *  underlined (setext) ones too, numbered the same way as headingSlugs. */
export function headingLine(md: string, slug: string): number | null {
  const want = anchorText(slug);
  const all = outlineAt(md);
  const i = headingSlugs(md).indexOf(want);
  return i < 0 ? null : all[i].line;
}

/** What a click on a link does. `web` goes to a browser; `here` moves within the open note; `file` opens
 *  a path (`preview` for a markdown note inside the worktree reached without a line, else an `editor` tab). */
export type Action =
  | { kind: "web"; url: string }
  | { kind: "here"; line?: number; heading?: string }
  | { kind: "file"; path: string; line?: number; col?: number; heading?: string; how: "preview" | "editor" }
  | { kind: "none" };

const isMarkdown = (p: string) => /\.(md|markdown|mdx)$/i.test(p);
const within = (root: string, path: string) => {
  const r = keyOf(root.replace(/[\\/]+$/, "")).toLowerCase();
  const p = keyOf(path).toLowerCase();
  return p === r || p.startsWith(r + "/") || p.startsWith(r + "\\");
};

/** Resolves a clicked href. `note` is the open note's path, `root` the worktree folder (null for none).
 *  Backslashes and slashes mean the same; file:// links (localhost counts as local, a server keeps its
 *  name) become paths; anything with another scheme does nothing. */
export function resolveLink(href: string, note: string, root: string | null): Action {
  const raw = href.trim();
  if (/^https?:\/\//i.test(raw)) return { kind: "web", url: raw };
  if (/^[A-Za-z][A-Za-z0-9+.-]+:(?!\d+(?::\d+)?$)(?![\\/])/.test(raw) && !/^file:/i.test(raw)) return { kind: "none" };
  if (raw.startsWith("#")) {
    const a = splitAnchor(raw);
    return { kind: "here", ...(a.line ? { line: a.line } : {}), ...(a.heading ? { heading: a.heading } : {}) };
  }
  const a = splitAnchor(raw);
  let target: string | null = a.path;
  if (/^file:/i.test(target)) target = fromFileUrl(target);
  if (target === null || target === "") return { kind: "none" };
  const dir = note.replace(/[\\/][^\\/]*$/, "") || null;
  const path = resolvePath(target, dir);
  if (path === null) return { kind: "none" };
  const { line, col, heading } = a;
  if (keyOf(path) === keyOf(note)) return { kind: "here", ...(line ? { line } : {}), ...(heading ? { heading } : {}) };
  const inside = root !== null && within(root, path);
  const how = isMarkdown(path) && inside && line === undefined ? "preview" : "editor";
  return { kind: "file", path, ...(line ? { line } : {}), ...(col ? { col } : {}), ...(heading ? { heading } : {}), how };
}

/** Every [[note]] in a text with its offsets; a link never spans a line break. */
export function wikiLinks(text: string): { from: number; to: number; name: string }[] {
  return [...text.matchAll(/\[\[([^[\]\n|]+?)(?:\|[^[\]\n]*)?\]\]/g)].map((m) => ({ from: m.index!, to: m.index! + m[0].length, name: m[1].trim() }));
}

/** [[note#heading]] split into the name and the heading. */
export function wikiTarget(name: string): { note: string; heading?: string } {
  const i = name.indexOf("#");
  return i < 0 ? { note: name.trim() } : { note: name.slice(0, i).trim(), heading: name.slice(i + 1).trim() };
}

/** The notes (worktree-relative paths) a [[name]] can mean: by file name without the extension, or by the
 *  end of the path when the name has folders. More than one is flagged, never guessed. */
export function wikiMatches(files: string[], note: string): { matches: string[]; ambiguous: boolean } {
  const want = note.replace(/\\/g, "/").replace(/\.(md|markdown)$/i, "").toLowerCase();
  const matches = files.filter((f) => isMarkdown(f)).filter((f) => {
    const p = f.replace(/\\/g, "/").replace(/\.(md|markdown|mdx)$/i, "").toLowerCase();
    return p === want || p.endsWith("/" + want);
  });
  return { matches, ambiguous: matches.length > 1 };
}

/** The list a `[[` shows: notes whose name starts with, then contains, what was typed so far. */
export function wikiSuggest(files: string[], typed: string, limit = 20): string[] {
  const q = typed.toLowerCase();
  const notes = files.filter(isMarkdown);
  const name = (f: string) => (f.split(/[\\/]/).pop() ?? f).replace(/\.(md|markdown|mdx)$/i, "").toLowerCase();
  const starts = notes.filter((f) => name(f).startsWith(q));
  const has = notes.filter((f) => !name(f).startsWith(q) && f.toLowerCase().includes(q));
  return [...starts, ...has].slice(0, limit);
}
