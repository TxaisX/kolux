// Terminal output bookkeeping: the local web addresses a folder's terminals printed (a dev server's
// "Local: http://localhost:5173/"), kept newest last. TerminalPane feeds every output chunk to
// notePrinted. Moved here from the retired browser pane's preview helpers.
import { findLinks } from "./links";

const PRINTED_MAX = 20;
const printed = new Map<string, string[]>();
const decoder = new TextDecoder();

/** Same folder in either spelling of the separators and case of the drive letter. */
const dirKey = (dir: string): string => dir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

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

/** The addresses the folder's terminals printed, newest last. */
export function printedFor(dir: string | null | undefined): string[] {
  return dir ? [...(printed.get(dirKey(dir)) ?? [])] : [];
}

export function forgetPrinted(dir: string): void {
  printed.delete(dirKey(dir));
}
