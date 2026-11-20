// PROJ-055 / VIEW-046: moving between workspaces by keyboard, and the back / forward history.
// PROJ-057 / VIEW-037: the worktree palette's word matching. Pure, so the rules are tested alone.
import { shortcodes, workItem } from "./model";

export type NavHow = { step: 1 | -1 } | { index: number };

/** Which row a keyboard move lands on, given `count` visible rows and the selected one (`at`, -1 for
 * none): next and previous wrap at either end, a number picks that position (1-based). */
export function navTarget(count: number, at: number, how: NavHow): number | null {
  if (count === 0) return null;
  if ("index" in how) return how.index >= 1 && how.index <= count ? how.index - 1 : null;
  if (at < 0) return how.step > 0 ? 0 : count - 1;
  return (at + how.step + count) % count;
}

/** A place the window has shown: a workspace folder. */
export type Place = { dir: string | null };
export type History = { list: Place[]; at: number };
export const EMPTY_HISTORY: History = { list: [], at: -1 };
const HISTORY_CAP = 50;

const samePlace = (a: Place, b: Place) => (a.dir ?? "").replace(/[\\/]+$/, "").toLowerCase() === (b.dir ?? "").replace(/[\\/]+$/, "").toLowerCase();

/** A visit: a place already in the history is kept once, at its newest visit; anything ahead of
 * the current point is dropped, as a browser does. */
export function visit(h: History, p: Place): History {
  if (h.at >= 0 && samePlace(h.list[h.at], p)) return h;
  const list = [...h.list.slice(0, h.at + 1).filter((x) => !samePlace(x, p)), p].slice(-HISTORY_CAP);
  return { list, at: list.length - 1 };
}

/** PROJ-056: back and forward belong to the terminal view and do nothing under the settings page. */
export const stepAllowed = (terminalView: boolean, settingsOpen: boolean) => terminalView && !settingsOpen;

/** Back (-1) or forward (+1) to the nearest place that still exists; null when there is none. */
export function travel(h: History, dir: 1 | -1, exists: (p: Place) => boolean): number | null {
  for (let i = h.at + dir; i >= 0 && i < h.list.length; i += dir) if (exists(h.list[i])) return i;
  return null;
}

/** The longest query the palette searches; a longer paste is refused. */
export const MAX_QUERY = 200;

/** VIEW-038: words that say where to go rather than what to find; dropped when others remain. */
const FILLER = new Set(["go", "goto", "open", "jump", "switch", "to"]);

/** Text folded character by character: accents dropped, full-width forms narrowed, lower case. A
 * character whose folding would change its length is kept as it is, so positions stay those of
 * the shown text. */
export function fold(text: string): string {
  let out = "";
  for (const c of text) {
    const f = c.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === c.length ? f : c;
  }
  return out;
}

/** The query's words, folded; `#` is dropped from a word with digits, filler words when others remain.
 * EDIT-047: an emoji shortcode becomes its emoji, and a pull request or issue link its number. */
export function queryWords(q: string): string[] {
  const all = fold(shortcodes(q))
    .split(/\s+/)
    .map((w) => String(workItem(w)?.number ?? (/\d/.test(w) ? w.replace(/^#+/, "") : w)))
    .filter(Boolean);
  const kept = all.filter((w) => !FILLER.has(w));
  return kept.length > 0 ? kept : all;
}

/** How well a row matched: `tier` 3 a whole word, 2 the start of a word, 1 inside a word or a
 * forgiven typo (the weakest word decides); `own` is false when some word landed only after
 * `ownEnd` (the row's parent project); `spans` are [start, end) ranges to highlight. */
export type Hit = { tier: number; own: boolean; spans: [number, number][] };

const TOKEN = /[\p{L}\p{N}]+/gu;

/** At most one letter added, dropped or changed between a and b. */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const [x, y] = [a.slice(i + 1), b.slice(i + 1)];
  return x === y || a.slice(i) === y || x === b.slice(i);
}

/** One word against the folded text's words that start before `end`. */
function wordHit(low: string, toks: { at: number; t: string }[], w: string, end: number): { tier: number; spans: [number, number][] } | null {
  const mine = toks.filter((k) => k.at < end);
  const exact = mine.filter((k) => k.t === w).map((k): [number, number] => [k.at, k.at + w.length]);
  if (exact.length > 0) return { tier: 3, spans: exact };
  if (/\d/.test(w)) return null; // PR and issue numbers match exactly, never partly
  const prefix = mine.filter((k) => k.t.startsWith(w)).map((k): [number, number] => [k.at, k.at + w.length]);
  if (prefix.length > 0) return { tier: 2, spans: prefix };
  if (/^[a-z]$/.test(w)) return null; // one Latin letter: the start of a word or a whole word only
  const inner: [number, number][] = [];
  for (let i = low.indexOf(w); i >= 0 && i + w.length <= end; i = low.indexOf(w, i + w.length)) inner.push([i, i + w.length]);
  if (inner.length > 0) return { tier: 1, spans: inner };
  if (!/^\p{L}{5,}$/u.test(w)) return null; // typos are forgiven only in long words of letters
  const near = mine.filter((k) => nearly(w, k.t) || nearly(w, k.t.slice(0, w.length))).map((k): [number, number] => [k.at, k.at + Math.min(k.t.length, w.length)]);
  return near.length > 0 ? { tier: 1, spans: near } : null;
}

/** VIEW-038: every word has to land on the text; null when one does not. */
export function scoreText(text: string, ownEnd: number, words: string[]): Hit | null {
  const low = fold(text);
  const toks = [...low.matchAll(TOKEN)].map((m) => ({ at: m.index ?? 0, t: m[0] }));
  const spans: [number, number][] = [];
  let tier = 3;
  let own = true;
  for (const w of words) {
    let h = wordHit(low, toks, w, ownEnd);
    if (!h) {
      h = wordHit(low, toks, w, low.length);
      own = false;
    }
    if (!h) return null;
    tier = Math.min(tier, h.tier);
    spans.push(...h.spans);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return { tier, own, spans: out };
}
