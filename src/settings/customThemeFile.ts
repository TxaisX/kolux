// T-648 (DT-C87): a theme as one small .json file. Reading is strict: a file with a key this version does
// not know, a colour that is not #rrggbb, or the wrong shape is refused whole with a plain reason, so an
// imported file can only ever hold what the editor itself could have made. (The saved list is read the
// forgiving way by tidyThemes: a bad entry there is dropped, never thrown on.)
import { SPAN, THEMES, TOKEN_KEYS } from "../theme";
import { HEX, NAME_MAX, TERMINAL_KEYS, ownLook, type CustomTheme } from "./customTheme";

export const FORMAT = "kolux-theme";
export const VERSION = 1;
/** Bigger than any real theme (about 2 KB), small enough to read at once. Counted in bytes, not characters. */
export const MAX_BYTES = 16 * 1024;
const TOKENS = TOKEN_KEYS;
/** The size of a file's text in bytes (UTF-8), the way a disk counts it. */
export const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** The file text for a theme: indented, ending in a newline. */
export const exportTheme = (t: CustomTheme): string => JSON.stringify({ format: FORMAT, version: VERSION, name: t.name, base: t.base, ...ownLook(t), overrides: t.overrides, terminal: t.terminal }, null, 2) + "\n";

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
  if (byteLength(text) > MAX_BYTES) throw new Error("That file is too big to be a Kolux theme.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not a theme: it is not valid JSON.");
  }
  if (!isMap(raw) || raw.format !== FORMAT) throw new Error("That file is not a Kolux theme file.");
  if (raw.version !== VERSION) throw new Error("That theme file is from a different version of Kolux.");
  for (const k of Object.keys(raw)) if (!["format", "version", "name", "base", "tint", "saturation", "depth", "overrides", "terminal"].includes(k)) throw new Error(`"${k}" is not something a theme file can hold.`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > NAME_MAX || /[\u0000-\u001f]/.test(name)) throw new Error(`The theme needs a name of 1 to ${NAME_MAX} characters.`);
  if (typeof raw.base !== "string" || !(THEMES as readonly string[]).includes(raw.base)) throw new Error(`"base" must be one of: ${THEMES.join(", ")}.`);
  // tint, saturation and depth are optional (a file made before they were saved has none): neutral then.
  const own: Partial<Record<"tint" | "saturation" | "depth", number>> = {};
  for (const k of ["tint", "saturation", "depth"] as const) {
    if (raw[k] === undefined) continue;
    const [lo, hi] = SPAN[k];
    if (typeof raw[k] !== "number" || !Number.isFinite(raw[k]) || (raw[k] as number) < lo || (raw[k] as number) > hi) throw new Error(`"${k}" must be a number from ${lo} to ${hi}.`);
    own[k] = raw[k] as number;
  }
  return { name, base: raw.base, ...ownLook(own), overrides: colours(raw.overrides ?? {}, TOKENS, "overrides"), terminal: colours(raw.terminal ?? {}, TERMINAL_KEYS, "terminal") };
}
