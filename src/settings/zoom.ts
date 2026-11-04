// SET-019: zooming the whole interface. A step is half a level and a whole level is a factor of
// 1.2, held between -3 levels (about 58 %) and +5 levels (about 249 %). The level is saved as
// `uiZoom` and put back before the first frame (main.tsx). Browser panes are placed in window
// pixels, so they scale their spot by `zoomFactor()`.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export const ZOOM_FIELD = "uiZoom";
export const MIN_LEVEL = -3;
export const MAX_LEVEL = 5;
const STEP = 0.5;

const clamp = (l: number) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, l));
/** The saved level, on a half step and inside the range; anything else is 0 (100 %). */
export const readZoom = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v / STEP) * STEP) : 0);
export const factorOf = (level: number) => 1.2 ** level;
export const percentOf = (level: number) => Math.round(factorOf(level) * 100);
export type ZoomStep = "in" | "out" | "reset";
export const nextLevel = (level: number, how: ZoomStep) => (how === "reset" ? 0 : clamp(level + (how === "in" ? STEP : -STEP)));

let level = 0;
const watchers = new Set<(level: number) => void>();
export const zoomLevel = () => level;
export const zoomFactor = () => factorOf(level);

/** Puts a level on the window without saving it (start-up, and every change). */
export function applyZoom(l: unknown) {
  level = readZoom(l);
  void getCurrentWebview()
    .setZoom(factorOf(level))
    .catch(() => {});
  watchers.forEach((w) => w(level));
}

/** Told the level each time it changes (the zoom control in Appearance). */
export function onZoom(w: (level: number) => void): () => void {
  watchers.add(w);
  return () => void watchers.delete(w);
}

/** A zoom key, the View menu or the zoom control: applied at once, then saved. A failed save is told to
 * `onFail` (T-723, DT-C159): the window keeps the new size, but it would be lost at the next start. */
export function stepZoom(how: ZoomStep, onFail: (text: string) => void) {
  applyZoom(nextLevel(level, how));
  invoke("settings_patch", { set: { [ZOOM_FIELD]: level }, remove: [] }).catch((e) => onFail(`Zoom not saved: ${e}`));
}
