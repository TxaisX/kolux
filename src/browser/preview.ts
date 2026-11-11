// T-242 (BROW-067): the Preview button's knowledge. Terminals feed the addresses they print
// (notePrinted, from TerminalPane's output path); the app asks `browser_dev_ports` which of them
// listen and rank them; a server already open in this workspace is focused instead of opened twice.
import { findLinks } from "../terminal/links";
import type { PageInfo } from "./pages";
import { resolveAddress } from "./address";

/** A dev server the button may open, as `browser_dev_ports` ranks them. */
export type Candidate = { host: string; port: number; url: string; printed: boolean; web: boolean };

const PRINTED_MAX = 20;
const printed = new Map<string, string[]>();
const decoder = new TextDecoder();

/** Same folder in either spelling of the separators and case of the drive letter. */
export const dirKey = (dir: string): string => dir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Whether the address is a local web address a dev server would print. */
export function isLocalWeb(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.replace(/^\[|\]$/g, "");
    return ["localhost", "127.0.0.1", "0.0.0.0", "::", "::1"].includes(h) || h.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** Whether the bytes hold "://" (58, 47, 47). */
function hasScheme(b: Uint8Array): boolean {
  for (let i = b.indexOf(58); i >= 0 && i + 2 < b.length; i = b.indexOf(58, i + 1)) if (b[i + 1] === 47 && b[i + 2] === 47) return true;
  return false;
}

/** A terminal in `cwd` printed `chunk`: its local web addresses are remembered, newest last.
 *  ponytail: an address split across two output chunks is missed; join chunks if that bites. */
export function notePrinted(cwd: string | null | undefined, chunk: Uint8Array | string): void {
  if (!cwd) return;
  // Most output holds a ":" but no address: the bytes are searched for "://" (ASCII, so never inside a multi-byte
  // character) and only a chunk that has one is decoded. Called for every output chunk of every pane.
  const text = typeof chunk === "string" ? chunk : chunk.length < 7 || !hasScheme(chunk) ? "" : decoder.decode(chunk);
  if (!text.includes("://")) return;
  for (const f of findLinks(text)) {
    if (f.kind !== "url" || !isLocalWeb(f.target)) continue;
    const key = dirKey(cwd);
    const list = (printed.get(key) ?? []).filter((u) => u !== f.target);
    list.push(f.target);
    printed.set(key, list.slice(-PRINTED_MAX));
  }
}

/** The addresses the workspace's terminals printed, newest last. */
export function printedFor(dir: string | null | undefined): string[] {
  return dir ? [...(printed.get(dirKey(dir)) ?? [])] : [];
}

export function forgetPrinted(dir: string): void {
  printed.delete(dirKey(dir));
}

/** The tab's name: "Preview host:port". */
export function previewTitle(url: string): string {
  try {
    return `Preview ${new URL(url).host}`;
  } catch {
    return `Preview ${url}`;
  }
}

/** BROW-067: a browser page of this workspace already showing the server (same origin), if any. */
export function sameOriginPage(url: string, dir: string | null, pages: [number, PageInfo][]): number | null {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  for (const [id, p] of pages) {
    if (!p.cwd || !dir || dirKey(p.cwd) !== dirKey(dir)) continue;
    try {
      if (new URL(p.url).origin === origin) return id;
    } catch {
      // not an address yet
    }
  }
  return null;
}

/** The button's hover text: the server it would open, or why it is greyed. */
export function previewHint(list: readonly Candidate[]): string {
  if (!list.length) return "Preview: no dev server found for this workspace (start one; its printed address is picked up)";
  if (list.length === 1) return `Preview ${list[0].host}:${list[0].port} in a browser tab`;
  return `Preview ${list[0].host}:${list[0].port} (${list.length} servers: open the menu for the others)`;
}

/** T-319-b (BROW-041): Enter in a document preview's chip. A web address turns the same tab into
 *  that page (Back returns to the preview); another document's path swaps the preview; the same
 *  document, or nothing typed, does nothing; anything unusable is said and the chip stays open. */
export type ChipCommit = { kind: "same" } | { kind: "document"; path: string } | { kind: "web"; url: string } | { kind: "error"; error: string };
export function chipCommit(text: string, current: string): ChipCommit {
  const t = text.trim().replace(/^"(.*)"$/, "$1");
  if (!t || dirKey(t) === dirKey(current)) return { kind: "same" };
  if (/^([a-z]:[\\/]|\\\\|\/)/i.test(t)) return { kind: "document", path: t };
  const r = resolveAddress(t);
  return "error" in r ? { kind: "error", error: r.error } : { kind: "web", url: r.url };
}
