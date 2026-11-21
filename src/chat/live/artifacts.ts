// Artifacts beside a chat (T-965). The folder is the index: `<chat folder>/artifacts`, read again on
// every scan, so a deleted file leaves and a rewritten one arrives with a new stamp. Rust decides what
// is safe to show (`artifacts.rs`); this module only names the shapes, keeps the stamps that tell a
// changed file from an unchanged one, and builds the blob URLs the strip draws. Nothing here reads a
// file by a path the scan did not just return.
import { invoke } from "@tauri-apps/api/core";

/** What WebView2 can draw: a page opens in the system browser, an image is previewed, a video plays. */
export type ArtifactKind = "page" | "image" | "video";

/** One file in the folder, as Rust read it (`artifacts::Row`). `mtime` and `size` together are the
 *  stamp: compared across scans to know a file changed without reading it again every few seconds. */
export type ArtifactRow = { path: string; name: string; kind: ArtifactKind; size: number; mtime: number };

/** One look at the folder: the files that are there now, and one plain sentence per limit that left
 *  files out. An empty `skipped` means nothing was held back. */
export type ArtifactScan = { rows: ArtifactRow[]; skipped: string[] };

/** How many artifacts the strip shows under the last finished turn (the plan's four). */
export const STRIP_LIMIT = 4;
/** A thumbnail is read whole; two megabytes is far more than a screenshot and small enough that four
 *  of them never stall the window. Opening a file asks for the full preview limit instead. */
export const THUMB_CAP = 2 * 1024 * 1024;
/** Rust cuts any request to its own 10 MB ceiling; this is the same number said once on this side. */
export const PREVIEW_CAP = 10 * 1024 * 1024;
/** How often the folder is read again while the pane is on screen. */
export const POLL_MS = 3_000;

/** The files in `<cwd>/artifacts` right now. A folder that is not there is an empty scan, never an
 *  error: a chat with no artifacts is the normal case, not a failure to explain. */
export async function scanArtifacts(cwd: string): Promise<ArtifactScan> {
  return await invoke<ArtifactScan>("artifacts_scan", { cwd });
}

/** One file's bytes as base64, for a blob URL. Rust checks the path again on this call; the answer
 *  is refused rather than cut when the file is bigger than the cap. */
export async function readArtifact(cwd: string, path: string, cap: number = THUMB_CAP): Promise<string> {
  return await invoke<string>("artifact_read", { cwd, path, cap });
}

/** The strip's four: newest first, each file once. A tie in time (two files written in one second)
 *  keeps a stable order by name, so the strip never shuffles under the pointer. */
export function newest(rows: readonly ArtifactRow[], limit: number = STRIP_LIMIT): ArtifactRow[] {
  return [...rows].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name)).slice(0, limit);
}

/** A file's stamp: what changes when it is rewritten. Compared as text, so two scans of an unchanged
 *  file never look different. */
export const stampOf = (row: ArtifactRow): string => `${row.mtime}:${row.size}`;

/** The files this scan changed or added since `seen` was filled, so only those are read again. */
export function changed(seen: ReadonlyMap<string, string>, rows: readonly ArtifactRow[]): ArtifactRow[] {
  return rows.filter((r) => seen.get(r.path) !== stampOf(r));
}

/** The MIME type a blob needs to render. Only the kinds Rust returns reach this, and an unknown name
 *  falls back to the kind's own type rather than to nothing. */
export function mimeOf(row: Pick<ArtifactRow, "name" | "kind">): string {
  const ext = row.name.slice(row.name.lastIndexOf(".") + 1).toLowerCase();
  const known: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
  };
  return known[ext] ?? (row.kind === "video" ? "video/mp4" : row.kind === "page" ? "text/html" : "application/octet-stream");
}

/** A blob URL for one artifact's base64. The caller owns it and must revoke it (`URL.revokeObjectURL`)
 *  when the file changes or the pane goes away, or the bytes stay in memory for the window's life. */
export function toBlobUrl(base64: string, mime: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** How long ago a file changed, said the way a person would. */
export function ago(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** A size as a short label: "812 B", "44 KB", "2.3 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(kb / 1024 < 10 ? 1 : 0)} MB`;
}

/** Where the strip goes in the drawn row list: under the last finished turn, above a turn that is
 *  still running. With no finished-turn marker it sits before the working line, and with no turn at
 *  all (an empty or restored conversation) it is the last thing in the list. */
export function stripIndex(views: readonly { row: string }[]): number {
  for (let i = views.length - 1; i >= 0; i -= 1) {
    if (views[i].row === "worked" || views[i].row === "files") return i + 1;
  }
  for (let i = 0; i < views.length; i += 1) {
    if (views[i].row === "working" || views[i].row === "responding") return i;
  }
  return views.length;
}
