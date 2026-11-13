// TERM-099 / TERM-100 (T-307): the glue between the back end's folder reader (term_import.rs) and the
// importers in importSchemes.ts. The page (TerminalImport.tsx) shows what comes back before anything is saved.
import { invoke } from "@tauri-apps/api/core";
import type { CustomScheme } from "../terminal/schemes";
import { FIELD } from "../theme";
import { ghosttyThemeNames, importGhostty, MAX_CUSTOM, planImport, scanWarp, type GhosttyFileIn, type GhosttyImport, type ImportPlan, type WarpFileIn, type WarpScan } from "./importSchemes";

/** The Ghostty configuration on this computer, mapped; null when there is none. */
export async function readGhostty(): Promise<GhosttyImport | null> {
  const files = await invoke<GhosttyFileIn[]>("term_import_ghostty");
  if (files.length === 0) return null;
  const themes = new Map<string, string | null>();
  for (const name of ghosttyThemeNames(files)) themes.set(name, await invoke<string | null>("term_import_ghostty_theme", { name }));
  return importGhostty(files, (n) => themes.get(n) ?? null);
}

/** The Warp themes in Warp's theme folders on this computer. */
export async function readWarp(): Promise<WarpScan> {
  return scanWarp(await invoke<WarpFileIn[]>("term_import_warp"));
}

/** What saving a Ghostty import writes: its settings, and its schemes joined to the saved ones (a name
 *  already there is replaced) with the dark one chosen for the terminal and the light one for light mode.
 *  A scheme that did not fit under the cap is not chosen. */
export function ghosttyPatch(saved: CustomScheme[], r: GhosttyImport): { patch: Record<string, unknown>; plan: ImportPlan } {
  const plan = planImport(saved, r.schemes);
  const patch: Record<string, unknown> = { ...r.settings };
  if (plan.added.length || plan.replaced.length) {
    patch[FIELD.custom] = plan.custom;
    const chosen = (n: string | null) => (n && !plan.refused.includes(n) ? "custom:" + n : null);
    const dark = chosen(r.darkScheme);
    const light = chosen(r.lightScheme);
    if (dark) patch[FIELD.terminal] = dark;
    if (light) patch[FIELD.lightScheme] = light;
  }
  return { patch, plan };
}

/** True when there is something in the import to save. */
const list = (names: string[]) => names.join(" and ");

/** The lines the Ghostty preview shows. They come from the same plan that Bring in saves, so a scheme
 *  the cap refuses is never promised as "Will add". */
export function previewLines(plan: ImportPlan, cap = MAX_CUSTOM): string[] {
  const s = (names: string[]) => (names.length > 1 ? "s" : "");
  return [
    plan.added.length > 0 && `Will add the colour scheme${s(plan.added)} ${list(plan.added)}.`,
    plan.replaced.length > 0 && `Will replace your colour scheme${s(plan.replaced)} ${list(plan.replaced)}.`,
    plan.refused.length > 0 && `Will not add ${list(plan.refused)}, because you already have ${cap} custom schemes. Remove one first.`,
  ].filter((l): l is string => !!l);
}

/** Equal as JSON, whatever order an object's keys are in (the settings file sorts them). */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** Saves a patch, then reads the settings back: true only when the save settled and every key of the
 *  patch is on disk as written. The page's own `save` records its failure in the page and settles
 *  anyway, so the read-back is what tells a failed save from a good one. */
export async function saveChecked(save: (patch: Record<string, unknown>) => Promise<unknown>, patch: Record<string, unknown>, readBack: () => Promise<Record<string, unknown>>): Promise<boolean> {
  try {
    await save(patch);
    const disk = await readBack();
    return Object.entries(patch).every(([k, v]) => sameJson(disk[k], v));
  } catch {
    return false;
  }
}

/** The settings as saved on disk. */
export const readSavedSettings = () => invoke<Record<string, unknown>>("get_settings");

export type WarpRow = { key: string; file: string; scheme: CustomScheme; left: string[] };
/** The Warp themes as rows. The key is the row's place plus its file name: Warp keeps themes in more
 *  than one folder, so the same file name can appear twice and must not tick together. */
export function warpRows(scan: WarpScan): WarpRow[] {
  return scan.themes.map((t, i) => ({ key: `${i}:${t.file}`, ...t }));
}
/** The schemes of the ticked rows. */
export function pickedSchemes(rows: WarpRow[], ticked: ReadonlySet<string>): CustomScheme[] {
  return rows.filter((r) => ticked.has(r.key)).map((r) => r.scheme);
}
