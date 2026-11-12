// EDIT-025 (T-317): an HTML file opens rendered in the user's own browser. The back end still serves the file's
// folder on a loopback address (browser_preview, src-tauri/src/browser_preview.rs); the address goes to the system
// browser (src/open/openExternal.ts) since Kolux no longer draws web pages (Goal 0, Txais 2026-11-12). Offered on
// edit tabs, and on diffs only while the file still exists on disk.
import { invoke } from "@tauri-apps/api/core";
import { openExternal } from "../open/openExternal";

export const isHtml = (path: string) => /\.html?$/i.test(path);

/** Whether the preview button shows: an HTML file, and (on a diff) one that is still on disk. */
export const offersPreview = (path: string, onDisk: boolean | null = true) => isHtml(path) && onDisk !== false;

export const fileOnDisk = (path: string) => invoke<(unknown | null)[]>("file_stamps", { paths: [path] }).then((r) => (r?.[0] ?? null) !== null, () => false);

/** Opens the preview in the system browser; resolves with an error sentence to show, or null. */
export async function previewHtml(path: string, ask: (p: string) => Promise<{ url: string }> = (p) => invoke("browser_preview", { path: p }), open: (url: string) => void | Promise<void> = openExternal): Promise<string | null> {
  try {
    void open((await ask(path)).url);
    return null;
  } catch (e) {
    return `The preview did not open: ${String(e)}`;
  }
}
