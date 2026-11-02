// T-648 (DT-C87): a theme as one small .json file. Reading is strict: a file with a key this version does
// not know, a colour that is not #rrggbb, or the wrong shape is refused whole with a plain reason, so an
// imported file can only ever hold what the editor itself could have made. (The saved list is read the
// forgiving way by tidyThemes: a bad entry there is dropped, never thrown on.)
import { classic, THEMES } from "../theme";
import { HEX, NAME_MAX, TERMINAL_KEYS, type CustomTheme } from "./customTheme";

export const FORMAT = "kolux-theme";
export const VERSION = 1;
/** Bigger than any real theme (about 2 KB), small enough to read at once. */
export const MAX_BYTES = 16 * 1024;
const TOKENS: readonly string[] = Object.keys(classic);

/** The file text for a theme: indented, ending in a newline. */
export const exportTheme = (t: CustomTheme): string => JSON.stringify({ format: FORMAT, version: VERSION, name: t.name, base: t.base, overrides: t.overrides, terminal: t.terminal }, null, 2) + "\n";

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function colours(v: unknown, known: readonly string[], what: string): Record<string, string> {
  if (!isMap(v)) throw new Error(`"${what}" must be a list of colours.`);
  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(v)) {
    if (!known.includes(k)) throw new Error(`"${k}" is not a colour this version of Kolux knows (in "${what}").`);
    if (typeof c !== "string" || !HEX.test(c)) throw new Error(`"${k}" must be a colour written like #1a2b3c, six digits after the #.`);
    out[k] = c.toLowerCase();
  }
  return out;
}

/** The theme in a file's text. Throws an Error whose message says what is wrong in plain words. */
export function parseThemeFile(text: string): CustomTheme {
  if (text.length > MAX_BYTES) throw new Error("That file is too big to be a Kolux theme.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not a theme: it is not valid JSON.");
  }
  if (!isMap(raw) || raw.format !== FORMAT) throw new Error("That file is not a Kolux theme file.");
  if (raw.version !== VERSION) throw new Error("That theme file is from a different version of Kolux.");
  for (const k of Object.keys(raw)) if (!["format", "version", "name", "base", "overrides", "terminal"].includes(k)) throw new Error(`"${k}" is not something a theme file can hold.`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > NAME_MAX || /[\u0000-\u001f]/.test(name)) throw new Error(`The theme needs a name of 1 to ${NAME_MAX} characters.`);
  if (typeof raw.base !== "string" || !(THEMES as readonly string[]).includes(raw.base)) throw new Error(`"base" must be one of: ${THEMES.join(", ")}.`);
  return { name, base: raw.base, overrides: colours(raw.overrides ?? {}, TOKENS, "overrides"), terminal: colours(raw.terminal ?? {}, TERMINAL_KEYS, "terminal") };
}
