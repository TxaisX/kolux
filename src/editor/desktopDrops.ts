// EDIT-039 (T-236-b): files dragged in from the operating system land where they are dropped. The
// terminal, the explorer and a kit input each take their own drops; this decides the two that were
// left: a folder on the project list becomes a project, and anywhere else a file opens in the
// editor. Only the webview's own file-drop events reach this code, so dragged text, web links and
// moves inside Kolux's explorer are never a desktop drop.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { keyOf } from "./buffers";

/** A drop of more files than this is refused (DECISIONS default; the card gives no number). */
export const MAX_DROP_FILES = 50;
/** A drop of more bytes than this is refused; sizes are only known where a caller can read them. */
export const MAX_DROP_BYTES = 1024 * 1024 * 1024;

/** The dropped paths without blanks or repeats, compared as buffers.ts keys them (audit N-11): Windows
 *  paths without letter case or slash kind, and one WSL file under either share name. Each path is kept
 *  as it was dropped. */
export function cleanPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((p) => {
    const trimmed = p.trim();
    const key = trimmed ? keyOf(trimmed) : "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Why a drop is refused, or null when it may go ahead. `bytes` is the total when it is known. */
export function refuseDrop(paths: string[], bytes: number | null = null): string | null {
  const n = cleanPaths(paths).length;
  if (n > MAX_DROP_FILES) return `${n} files were dropped; at most ${MAX_DROP_FILES} are taken at once, so nothing was done.`;
  if (bytes !== null && bytes > MAX_DROP_BYTES) return `That drop is ${Math.round(bytes / 1048576)} MB; at most ${MAX_DROP_BYTES / 1048576} MB are taken at once, so nothing was done.`;
  return null;
}

export type Zone = "projects" | "editor" | "own";

/** The part of the window a drop landed on. "own" is a place with a drop handler of its own (a
 * terminal or chat pane, the explorer, a kit input, a dialog), so it is left to that handler. */
export function zoneOf(under: { closest(selector: string): unknown } | null): Zone {
  if (!under) return "editor";
  const has = (s: string) => under.closest(s) !== null;
  if (has("[data-kit-input], [role='dialog'], [role='alertdialog'], .modal")) return "own";
  if (has(".explorer")) return "own";
  if (has(".sidebar")) return "projects";
  if (has(".pane.editor, .pane.preview, [data-kind='editor'], [data-kind='diff'], [data-kind='preview'], [data-kind='changes']")) return "editor";
  if (has(".pane")) return "own";
  return "editor";
}

export type Dropped = { path: string; dir: boolean };
export type DropPlan = { action: "projects" | "editor" | "none" | "refused"; paths: string[]; say: string | null };

/** What a drop does: folders become projects on the project list, files open in the editor
 * anywhere else; a drop with nothing usable says so. */
export function planDrop(zone: Zone, dropped: Dropped[], bytes: number | null = null): DropPlan {
  const clean = cleanPaths(dropped.map((d) => d.path));
  const why = refuseDrop(clean, bytes);
  if (why) return { action: "refused", paths: [], say: why };
  if (zone === "own") return { action: "none", paths: [], say: null };
  const want = zone === "projects";
  const kinds = new Map(dropped.map((d) => [d.path, d.dir]));
  const paths = clean.filter((p) => kinds.get(p) === want || (kinds.get(p) === undefined && !want));
  if (paths.length === 0) return { action: "none", paths: [], say: want ? "Drop a folder here to add it as a project." : "Folders cannot be opened in the editor; drop files, or a folder on the project list." };
  return { action: want ? "projects" : "editor", paths, say: null };
}

/** The project list's own handler for dropped folders (set by the sidebar while it is mounted). */
export const projectDrop: { add: ((paths: string[]) => void) | null } = { add: null };

/** Mounts the window-wide drop listener; `open` opens one file, `say` shows a brief message. */
export function useDesktopDrops(open: (path: string) => void, say: (text: string) => void) {
  const live = useRef({ open, say });
  live.current = { open, say };
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload: p }) => {
        if (p.type !== "drop") return;
        const ratio = window.devicePixelRatio || 1;
        const zone = zoneOf(document.elementFromPoint(p.position.x / ratio, p.position.y / ratio));
        if (zone === "own") return;
        const paths = cleanPaths(p.paths);
        const why = refuseDrop(paths);
        if (why) return live.current.say(why);
        // ACCT-055: a dropped path is not granted to the window, so path_kind answers "outside" for a
        // desktop file or folder. On the project list that is a folder to try (project_add checks it); a
        // file in the editor area outside every project is refused, since the fence would not let it be read.
        Promise.all(paths.map((path) => invoke<string>("path_kind", { path }).then((k) => ({ path, k }), () => ({ path, k: "missing" }))))
          .then((ks) => {
            const shut = zone === "editor" ? ks.filter((x) => x.k === "outside" || x.k === "remote").length : 0;
            const usable = ks.filter((x) => zone === "projects" || (x.k !== "outside" && x.k !== "remote"));
            const plan = planDrop(zone, usable.map(({ path, k }) => ({ path, dir: k === "dir" || (zone === "projects" && k === "outside") })));
            if (shut) live.current.say(`${shut === 1 ? "That file is" : `${shut} of those files are`} outside your projects, so Kolux will not open ${shut === 1 ? "it" : "them"}; copy ${shut === 1 ? "it" : "them"} into a project from the Explorer first.`);
            else if (plan.say) live.current.say(plan.say);
            if (plan.action === "projects") projectDrop.add?.(plan.paths);
            else if (plan.action === "editor") plan.paths.forEach((x) => live.current.open(x));
          })
          .catch(() => {});
      })
      .then((u) => (gone ? u() : (off = u)), () => {});
    return () => {
      gone = true;
      off?.();
    };
  }, []);
}
