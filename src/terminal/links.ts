// TERM-092 / TERM-093: web links and file paths printed in a terminal are clickable (Ctrl+click, Cmd+click on
// macOS; a plain click still selects). Pure text work lives here so it can be tested without xterm: what a row
// holds, where each link starts and ends, what a path resolves to against the pane's folder, and how a link
// that wraps over several rows is read as one. Nothing here touches the disk: a path is a link because it
// looks like one, never because it was probed (a network share is never stat-ed).
// ponytail: one regex pass per row; a provider cache keyed on row text if a 10k-column buffer ever shows lag.

import { linesOf, type BufRow, type Cell, type Line } from "./find";
import { handlesIn } from "./tabs";

export type Found = { start: number; end: number; kind: "url" | "file"; target: string; line?: number; column?: number };

/** Punctuation that ends a sentence, not a link: "see https://x.y/z." or "(C:\a\b.txt)" keeps the link clean. */
const TRAIL = /[.,;:!?'"`]+$/;
const SUFFIX = "(?::(\\d+)(?::(\\d+))?|\\((\\d+)(?:,(\\d+))?\\))?";
/** Each alternative is one shape: web link, file link, Windows drive or UNC path, a path with a separator
 *  (absolute POSIX, ./relative, ~/home or plain src/a/b.ts), or a bare name.ext:line (compiler output).
 *  TERM-095: the path and name shapes start only where their character run starts (the lookbehinds): a greedy
 *  run that is then backtracked for a separator costs one pass per run, not one per character, so a long
 *  separator-free span (base64, a wall of dots or hyphens) scans in linear time; measured 16 KiB of "x" at
 *  194 ms without them and under 2 ms with. What matches is unchanged: a start inside a run never matched
 *  anything its run's start did not. */
const RE = new RegExp(
  [
    "\\bhttps?://[^\\s<>\"'`]+",
    "\\bfile://[^\\s<>\"'`]+",
    "(?:[A-Za-z]:[\\\\/]|\\\\\\\\[^\\s\\\\/]+\\\\)[^\\s:*?\"<>|()]*" + SUFFIX,
    "(?<![\\w.@~-])(?:\\.{1,2}[\\\\/]|~/|/)?[\\w.@~-]+(?:[\\\\/][\\w.@~-]+)+(?<![\\\\/.])" + SUFFIX,
    // the name shape may start after leading hyphens ("-foo.ts:3" finds foo.ts:3, as \b alone did)
    "\\b(?<=(?:^|[^\\w-])-*)[\\w-]+\\.[A-Za-z]{1,6}" + SUFFIX,
  ].join("|"),
  "g",
);
const DRIVE_OR_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|~\/)/;

/** Every link in one row (or one joined span of wrapped rows), left to right, with trailing punctuation left out. */
export function findLinks(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(RE)) {
    let raw = m[0];
    const isUrl = /^(https?|file):\/\//i.test(raw);
    // the bare name.ext shape is a link only with a :line after it (otherwise "node.js" would be one)
    if (!isUrl && !/[\\/]/.test(raw) && !/[:(]\d/.test(raw)) continue;
    // a plain relative shape needs a letter somewhere: "16/10" and "3/4" are numbers, not files
    if (!isUrl && !DRIVE_OR_ROOT.test(raw) && !/[A-Za-z]/.test(raw)) continue;
    // an unmatched ")" at the end belongs to the sentence, a matched one to the link (Wikipedia-style)
    raw = raw.replace(TRAIL, "");
    while (raw.endsWith(")") && (raw.match(/\(/g)?.length ?? 0) < (raw.match(/\)/g)?.length ?? 0)) raw = raw.slice(0, -1).replace(TRAIL, "");
    if (raw.length === 0) continue;
    const start = m.index!;
    const end = start + raw.length;
    if (isUrl && !/^file:/i.test(raw)) {
      out.push({ start, end, kind: "url", target: raw });
      continue;
    }
    const at = raw.match(/(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))$/);
    const target = at ? raw.slice(0, raw.length - at[0].length) : raw;
    const line = at ? Number(at[1] ?? at[3]) : undefined;
    const column = at && (at[2] ?? at[4]) ? Number(at[2] ?? at[4]) : undefined;
    // A decoded name with a control character is no link: Windows stops reading at a NUL, so
    // "run.bat%00.txt" would look like a text file here and run as run.bat when opened.
    const file = fromFileUrl(target);
    if (file === null || CONTROL.test(file)) continue;
    out.push({ start, end, kind: "file", target: file, ...(line !== undefined ? { line } : {}), ...(column !== undefined ? { column } : {}) });
  }
  return out;
}

const CONTROL = /[\x00-\x1f\x7f]/;

/** file:///C:/a/b.txt → C:/a/b.txt; file:///home/x → /home/x; file://server/share/x → \\server\share\x.
 *  Null for a malformed % escape, and for a decoded name Windows would rewrite or read as a stream: an empty, "."
 *  or ".." step, a step ending in a dot or a space ("LICENSE%2E" is LICENSE), or a ":" after the drive letter
 *  ("notes.txt%3Arun.vbs" is a stream inside notes.txt). */
export function fromFileUrl(s: string): string | null {
  const m = s.match(/^file:\/\/([^/]*)(\/.*)?$/i);
  if (!m) return s;
  const host = m[1];
  let path: string;
  try {
    path = decodeURIComponent(m[2] ?? "/");
  } catch {
    return null;
  }
  const local = !host || host === "localhost";
  if (local && /^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  const rest = local ? path.replace(/^[A-Za-z]:/, "") : path;
  if (rest.includes(":") || rest.split(/[\\/]/).slice(1).some((t) => t === "" || t === "." || t === ".." || /[. ]$/.test(t))) return null;
  if (!local) return `\\\\${host}${path.replace(/\//g, "\\")}`;
  return path;
}

const isAbsolute = (p: string) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p);

/** `segs` laid onto `parts` in place: "." and empty steps dropped, ".." steps back but never past the first part. */
function fold(parts: string[], segs: string[]): string[] {
  for (const seg of segs) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts;
}

/** A relative path resolved against the pane's folder; "." and ".." segments folded; an absolute path kept, except
 *  that a drive path's "." and ".." steps are folded too (review A2: Windows folds them as text, so the path handed
 *  to the back end is the one Windows will open). A share and a POSIX path keep theirs (POSIX ".." follows links). */
export function resolvePath(target: string, cwd: string | null): string | null {
  let p = target.replace(/^~\//, "");
  if (!isAbsolute(p)) {
    if (!cwd) return null;
    const sep = /\\/.test(cwd) || /^[A-Za-z]:/.test(cwd) ? "\\" : "/";
    p = fold(cwd.replace(/[\\/]+$/, "").split(/[\\/]/), p.split(/[\\/]/)).join(sep);
  } else if (/^[A-Za-z]:[\\/]/.test(p) && /[\\/]\.\.?(?:[\\/]|$)/.test(p)) {
    const parts = fold([p.slice(0, 2)], p.slice(3).split(/[\\/]/));
    p = parts.length === 1 ? `${parts[0]}\\` : parts.join("\\");
  }
  return p;
}

/** One buffer row as the link scan reads it (find.ts's shape): its cells, a plain string standing for one cell per
 *  character, and whether it continues the row above. */
export type Row = BufRow;

/** TERM-095: the longest logical line (in cells) that is scanned for links; longer ones get none. */
export const LINK_SCAN_CAP = 16 * 1024;

/** A logical line as the scan joined it: its first row, its text, and for each index of the text the cell it starts
 *  in and the cell after it, counted from the first row (T-586: a wide character takes two cells but one index, an
 *  emoji sequence several indices but its two cells, so an index is not a column). */
export type Span = Line & { first: number };
const NONE: Line = { text: "", at: [], to: [] };

/** The rows that make up the logical line holding row `y`: back to the first unwrapped row, forward while the next
 *  row says it is wrapped. A row given as a string has every row but the last padded to `cols`, as on screen. */
export function spanOf(row: (y: number) => Row | undefined, y: number, cols: number, cap = LINK_SCAN_CAP): Span {
  // TERM-095: a logical line past the cap gets no link scan; the walk stops at the cap too, so a hover over a 1 MB line
  // costs a few hundred row lookups, never a join of the whole line and a regex pass over it.
  const maxRows = Math.max(1, Math.floor(cap / Math.max(1, cols)));
  let first = y;
  while (first > 0 && row(first)?.wrapped) {
    if (y - first >= maxRows) return { first: y, ...NONE };
    first--;
  }
  let last = y;
  while (row(last + 1)?.wrapped) {
    if (last - first + 1 >= maxRows) return { first, ...NONE };
    last++;
  }
  const rows: Row[] = [];
  for (let i = first; i <= last; i++) {
    const cells = row(i)?.cells ?? "";
    rows.push({ wrapped: i > first, cells: typeof cells === "string" && i < last ? cells.padEnd(cols) : cells });
  }
  return { first, ...(linesOf(rows, cols)[0] ?? NONE) };
}

/** xterm's 1-based inclusive cell range for a [start, end) index span of a joined line, through its cells. */
export function rangeOf(span: Span, start: number, end: number, cols: number) {
  const cell = (i: number) => ({ x: (i % cols) + 1, y: span.first + Math.floor(i / cols) + 1 });
  return { start: cell(span.at[start]), end: cell(span.to[end - 1] - 1) };
}

/** The terminal's buffer as the link scans read it: xterm's IBuffer and IBufferLine, as far as they need. */
export type Buf = { getLine(y: number): BufLine | undefined };
export type BufLine = { isWrapped: boolean; translateToString(trimRight?: boolean): string; getCell(x: number): { getChars(): string; getWidth(): number } | undefined };
/** xterm's 1-based inclusive cell range of a link. */
export type Range = { start: { x: number; y: number }; end: { x: number; y: number } };

/** One buffer row as cells: a full row of plain ASCII as its string (one cell per character), any other row cell by
 *  cell, so a wide character keeps its two cells and an emoji sequence its one cell group. */
export function rowOf(l: BufLine, cols: number): Row["cells"] {
  const s = l.translateToString(false);
  if (s.length === cols && /^[ -~]*$/.test(s)) return s;
  const cells: Cell[] = [];
  for (let x = 0; x < cols; x++) {
    const c = l.getCell(x);
    cells.push({ chars: c?.getChars() ?? "", width: c?.getWidth() ?? 1 });
  }
  return cells;
}

/** The logical line holding buffer row `y` (0-based), read from the buffer's cells. */
const spanAt = (buf: Buf, y: number, cols: number) =>
  spanOf(
    (i) => {
      const l = buf.getLine(i);
      return l ? { wrapped: l.isWrapped, cells: rowOf(l, cols) } : undefined;
    },
    y,
    cols,
  );

/** TERM-092 / TERM-093: the web and file links of the logical line holding buffer row `y` (0-based), each with the
 *  cells it covers. */
export function linksIn(buf: Buf, y: number, cols: number): { f: Found; range: Range }[] {
  const span = spanAt(buf, y, cols);
  return findLinks(span.text).map((f) => ({ f, range: rangeOf(span, f.start, f.end, cols) }));
}

/** TERM-096: the printed handles of open terminals (term-N) in the logical line holding buffer row `y` (0-based), each
 *  with the cells it covers. */
export function handlesOn(buf: Buf, y: number, cols: number): { handle: string; range: Range }[] {
  const span = spanAt(buf, y, cols);
  return handlesIn(span.text).map(({ start, end, handle }) => ({ handle, range: rangeOf(span, start, end, cols) }));
}

/** Where a plain modifier-click goes, said in the hover hint. */
export type Where = "browser" | "kolux" | "editor" | "app";
const WHERE: Record<Where, string> = { browser: "in your browser", kolux: "in Kolux", editor: "in the editor", app: "with its app" };

/** The hover hint under the pointer: the modifier, the target, the line, and where it will open; with the link menu
 *  on (TERM-094) it also names the menu gesture, and with it off the hint does not mention it. */
export const hintFor = (f: Found, mac: boolean, where: Where, menu = false) => {
  const mod = mac ? "Cmd" : "Ctrl";
  return `${mod}+click to open ${f.target}${f.line !== undefined ? ` at line ${f.line}` : ""} ${WHERE[where]}${menu ? ` · ${mod}+right-click for more` : ""}`;
};

/** Which door a click goes through: the system browser (always with Shift, or when Open-in-Kolux is off), Kolux's own
 *  viewer, or the file opener. Alt with the link modifier inverts the web destination (Kolux when the setting says the
 *  browser, the browser when it says Kolux); Shift beats Alt. `kolux` is whether a Kolux viewer is wired at all; without
 *  one every web link goes to the system browser. Returns null for a click without the modifier (a plain click selects). */
export function clickTarget(f: Found, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey?: boolean }, mac: boolean, openInKolux: boolean, kolux = openInKolux): "system" | "kolux" | "file" | null {
  if (!(mac ? e.metaKey : e.ctrlKey)) return null;
  if (f.kind === "file") return "file";
  if (e.shiftKey || !kolux) return "system";
  return openInKolux !== !!e.altKey ? "kolux" : "system";
}

/** An OSC 8 link's own target as a Found, or null when it is not a web or file link (other schemes stay text). */
export const linkFor = (uri: string): Found | null => findLinks(uri).find((f) => f.start === 0) ?? null;

/** ACCT-061: the last check before a link is opened. A web link opens only as http, https or file (the Rust side
 *  refuses anything else too); a file target must be a plain path with no control character. Everything else is
 *  ignored: nothing opens, nothing is said. */
export function allowed(f: Found): boolean {
  if (f.target.length === 0 || /[\u0000-\u001f\u007f]/.test(f.target)) return false;
  if (f.kind === "url") return /^(https?|file):\/\//i.test(f.target);
  return true;
}

/** ACCT-061: a link scan that trips over unusual output (a regex that blows the stack, a buffer row that is gone)
 *  is contained: that row has no links and the pane keeps working. `note` hears the error once, for the log. */
export function safeLinks<T>(scan: () => T[], note?: (e: unknown) => void): T[] {
  try {
    return scan();
  } catch (e) {
    note?.(e);
    return [];
  }
}
