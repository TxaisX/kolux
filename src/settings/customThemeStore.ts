// T-648 (DT-C87): saving, renaming, duplicating, deleting and resetting custom themes. They are plain
// functions from one Appearance to the next; the Appearance page writes the result through its usual
// save, so custom themes live in the settings file beside the rest of the look (fields `customThemes`
// and `customThemeActive`) and there is no second store.
import type { Appearance } from "../theme";
import { MAX_THEMES, NAME_MAX, type CustomTheme } from "./customTheme";

/** A name not used yet (any case): `Mine`, then `Mine 2`, `Mine 3`... */
export function freeName(taken: readonly string[], want: string): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const stem = want.trim().slice(0, NAME_MAX - 4) || "My theme";
  let name = stem, i = 2;
  while (used.has(name.toLowerCase())) name = `${stem} ${i++}`;
  return name;
}

/** A plain-words reason a name cannot be used, or "" when it can. `own` is the theme being renamed. */
export function nameProblem(look: Appearance, want: string, own = ""): string {
  const n = want.trim();
  if (!n) return "Give the theme a name.";
  if (n.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters or fewer.`;
  if (look.userThemes.some((t) => t.name !== own && t.name.toLowerCase() === n.toLowerCase())) return `You already have a theme called ${n}.`;
  return "";
}

/** A new theme that looks like the window does now: the built-in theme in use, or a copy of the custom one in use. */
export const newTheme = (look: Appearance): CustomTheme => {
  const from = look.userThemes.find((t) => t.name === look.userTheme);
  return { name: freeName(look.userThemes.map((t) => t.name), "My theme"), base: from?.base ?? look.theme, overrides: { ...from?.overrides }, terminal: { ...from?.terminal } };
};

/** The theme with this name, or none. */
export const findTheme = (look: Appearance, name: string) => look.userThemes.find((t) => t.name === name);

/** Adds `theme`, or replaces the one called `replacing` (a rename keeps its place and stays in use if it was). */
export function saveTheme(look: Appearance, theme: CustomTheme, replacing?: string): Appearance {
  const at = replacing === undefined ? -1 : look.userThemes.findIndex((t) => t.name === replacing);
  if (at < 0 && look.userThemes.length >= MAX_THEMES) throw new Error(`You can keep up to ${MAX_THEMES} themes. Delete one first.`);
  const problem = nameProblem(look, theme.name, replacing ?? "");
  if (problem) throw new Error(problem);
  const list = at < 0 ? [...look.userThemes, theme] : look.userThemes.map((t, i) => (i === at ? theme : t));
  return { ...look, userThemes: list, userTheme: replacing !== undefined && look.userTheme === replacing ? theme.name : look.userTheme };
}

/** Makes a copy under a free name ("Mine copy") and puts it in use. */
export function duplicateTheme(look: Appearance, name: string): Appearance {
  const from = findTheme(look, name);
  if (!from) return look;
  const copy: CustomTheme = { ...from, name: freeName(look.userThemes.map((t) => t.name), `${from.name} copy`), overrides: { ...from.overrides }, terminal: { ...from.terminal } };
  return { ...saveTheme(look, copy), userTheme: copy.name };
}

/** Removes a theme; if it was in use the window goes back to the built-in theme under it. */
export const deleteTheme = (look: Appearance, name: string): Appearance => ({ ...look, userThemes: look.userThemes.filter((t) => t.name !== name), userTheme: look.userTheme === name ? "" : look.userTheme });

/** Puts a saved theme in use ("" for the built-in one). */
export const activateTheme = (look: Appearance, name: string): Appearance => ({ ...look, userTheme: findTheme(look, name) ? name : "" });

/** Back to Kolux's own default: Classic, no tint, saturation or depth, and no custom theme in use. The saved themes stay in the list. */
export const resetToDefault = (look: Appearance): Appearance => ({ ...look, theme: "classic", tint: 0, saturation: 100, depth: 0, userTheme: "" });
