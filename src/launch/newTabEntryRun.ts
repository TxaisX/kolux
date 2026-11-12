// TERM-042: what the new tab entry box does with a chosen row, and the entries it remembers.
// The row model is terminal/newTabEntry.ts; this is the glue the plus menu needs.
import { invoke } from "@tauri-apps/api/core";
import { looksLikePath, rememberEntry, webAddress, type Row } from "../terminal/newTabEntry";

/** `kind: "web"` is a web address that opens in the system browser. */
export type EntryTarget = { kind: "web"; url: string } | { kind: "file"; path: string } | { kind: "tab"; key: number };

/** Open a web address in the system browser. */
export const openWebAddress = (url: string): Promise<unknown> => invoke("open_external", { url });

/** What running a row opens, or null when a remembered entry is no longer a web address or a path. */
export function entryTarget(row: Row): EntryTarget | null {
  if (row.kind === "url") return { kind: "web", url: row.url };
  if (row.kind === "file") return { kind: "file", path: row.path };
  if (row.kind === "tab") return { kind: "tab", key: row.key };
  const url = webAddress(row.value);
  if (url) return { kind: "web", url };
  return looksLikePath(row.value) ? { kind: "file", path: row.value } : null;
}

/** The text a run leaves in the remembered list; switching to an open tab remembers nothing. */
export const entryMemory = (row: Row): string | null => (row.kind === "url" ? row.url : row.kind === "file" ? row.path : row.kind === "tab" ? null : row.value);

const KEY = "kolux.newTabEntries";

/** Entries typed here before, newest first; an unreadable store is an empty list. */
export function loadEntries(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Remember one run and keep it for next time; returns the new list even when the store refuses it. */
export function remember(recents: string[], row: Row): string[] {
  const mem = entryMemory(row);
  const next = mem ? rememberEntry(recents, mem) : recents;
  if (next !== recents) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // a private window or a full store: the list lives for this session only
    }
  }
  return next;
}
