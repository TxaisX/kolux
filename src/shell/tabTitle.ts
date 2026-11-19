// TERM-056 / STAT-035: what a terminal tab shows and what its hover says. Generated titles are a
// setting, off by default: on, a tab with no name of its own gets a short name drawn from the agent
// and the branch or folder it runs in.
// A name the user typed always wins; the full title is always the tooltip (the tab itself is clipped
// by CSS at 160 px). T-124-b owns the Settings switch; this is the title source it reads.
import { folderName } from "../projects/model";

export const GENERATED_TITLES_FIELD = "generatedTabTitles";
export const generatedOn = (settings: Record<string, unknown>): boolean => settings[GENERATED_TITLES_FIELD] === true;

/** The short generated name: "agent · branch-or-folder", clipped. */
export function generatedTitle(o: { word: string; branch: string | null; cwd: string | null }, max = 24): string {
  const raw = [o.word, o.branch ?? (o.cwd ? folderName(o.cwd) : "")].filter(Boolean).join(" · ");
  return raw.length > max ? `${raw.slice(0, max - 1).trimEnd()}…` : raw;
}

/** The text the tab shows: the user's own name, else (generated titles on) the generated name, else the full title. */
export function tabText(o: { full: string; own: string | null | undefined; generated: string; on: boolean }): string {
  if (o.own) return o.own;
  return o.on && o.generated ? o.generated : o.full;
}

/** The hover text: the full title, with the generated name after it when the tab shows something else. */
export const tabTip = (full: string, shown: string): string => (shown === full ? full : `${full} · shown as ${shown}`);
