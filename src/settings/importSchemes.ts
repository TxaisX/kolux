// SET-024 (T-323): bring terminal schemes in from a Warp theme file (YAML) or a Ghostty
// configuration (COMPAT: both stay sources). Each file becomes Windows Terminal-shaped keys that the
// SET-023 tidy step checks, so a scheme brought in here is held to the same rules as a pasted one.
// Formats from the public docs: Warp's custom themes page and Ghostty's configuration reference.
import type { ITheme } from "@xterm/xterm";
import { importScheme, type CustomScheme } from "../terminal/schemes";
import { CURSORS, FIELDS, SCROLLBACK, SIZE } from "../terminal/text";
import { FIELD, SPAN } from "../theme";

/** How many custom schemes a profile keeps. Replacing one already there is allowed at the cap. */
export const MAX_CUSTOM = 40;

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const bright = (c: string) => "bright" + c[0].toUpperCase() + c.slice(1);
const hex = (v: string) => {
  const t = v.trim().replace(/^['"]|['"]$/g, "");
  return /^[0-9a-f]{6}$/i.test(t) ? "#" + t : t;
};
/** The file name without folder or extension, as a scheme name when the file names none. */
export const stem = (file: string) => file.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "").replace(/[_-]+/g, " ").trim();

/** TERM-100: a Warp file is read within a time budget and a line cap, so a bad one cannot hang the app. */
export type Budget = { ms: number; now: () => number };
const MAX_YAML_LINES = 2000;
class TooSlow extends Error {}

/** A small YAML reader for the shape Warp themes use: nested `key: value` maps, two-space indents. */
function yamlMap(text: string, budget?: Budget): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [{ indent: -1, map: root }];
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_YAML_LINES) throw new TooSlow("This theme file is too long to read, so it was skipped.");
  const b = budget ?? { ms: 250, now: () => Date.now() };
  const began = b.now();
  for (const raw of lines) {
    if (b.now() - began > b.ms) throw new TooSlow("Reading this theme took too long, so it was skipped.");
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#") || line.trim() === "---") continue;
    const m = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) throw new Error("bad line");
    const indent = m[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].map;
    if (m[3] === "") {
      const child: Record<string, unknown> = {};
      parent[m[2]] = child;
      stack.push({ indent, map: child });
    } else parent[m[2]] = m[3].trim().replace(/^['"]|['"]$/g, "");
  }
  return root;
}

const NOT_WARP = "That is not a Warp theme: it needs background, foreground and terminal_colors with normal and bright colours.";

/** TERM-100: a colour field that is a plain colour, or a gradient (a map or `{ top: .., bottom: .. }`)
 *  of which only the first colour is kept. */
function paintOf(v: unknown): { colour: string; gradient: boolean } | null {
  if (typeof v === "string") {
    if (!v.trim().startsWith("{")) return { colour: hex(v), gradient: false };
    const m = /#?[0-9a-f]{6}\b/i.exec(v);
    return m ? { colour: hex(m[0]), gradient: true } : null;
  }
  if (v && typeof v === "object") {
    const first = Object.values(v as Record<string, unknown>).find((x): x is string => typeof x === "string");
    return first ? { colour: hex(first), gradient: true } : null;
  }
  return null;
}

/** TERM-100: a Warp theme and what was left out of it (a background image, gradients). */
export type WarpTheme = { scheme: CustomScheme; left: string[] };

/** A Warp theme file, read within a time budget. Throws with a reason the user can read. */
export function parseWarpTheme(text: string, file = "Warp theme", budget?: Budget): WarpTheme {
  let y: Record<string, unknown>;
  try {
    y = yamlMap(text, budget);
  } catch (e) {
    throw e instanceof TooSlow ? e : new Error(NOT_WARP);
  }
  const colours = y.terminal_colors as Record<string, Record<string, string>> | undefined;
  const bg = paintOf(y.background);
  const fg = paintOf(y.foreground);
  const accent = paintOf(y.accent);
  if (!bg || !fg || !colours?.normal || !colours?.bright) throw new Error(NOT_WARP);
  const out: Record<string, string> = { name: typeof y.name === "string" && y.name.trim() ? y.name : stem(file), background: bg.colour, foreground: fg.colour };
  if (accent) out.cursor = accent.colour;
  for (const c of ANSI) {
    if (typeof colours.normal[c] === "string") out[c] = hex(colours.normal[c]);
    if (typeof colours.bright[c] === "string") out[bright(c)] = hex(colours.bright[c]);
  }
  const left = [y.background_image !== undefined && "background image", bg.gradient && "background gradient", fg.gradient && "foreground gradient", accent?.gradient && "accent gradient"].filter((x): x is string => typeof x === "string");
  return { scheme: importScheme(JSON.stringify(out)), left };
}

/** A Warp theme file. Throws with a reason the user can read. */
export function parseWarp(text: string, file = "Warp theme"): CustomScheme {
  return parseWarpTheme(text, file).scheme;
}

const GHOSTTY: Record<string, string> = { background: "background", foreground: "foreground", "cursor-color": "cursor", "cursor-text": "cursorAccent", "selection-background": "selectionBackground" };
const isColourKey = (k: string) => Object.prototype.hasOwnProperty.call(GHOSTTY, k);

/** The colours in a Ghostty configuration (`key = value` lines, `palette = N=#rrggbb`). */
export function parseGhostty(text: string, name = "Ghostty"): CustomScheme {
  const out: Record<string, string> = { name };
  let theme = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-z-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "theme") theme = value.trim();
    else if (GHOSTTY[key]) out[GHOSTTY[key]] = hex(value);
    else if (key === "palette") {
      const p = /^(\d+)\s*=\s*(.+)$/.exec(value.trim());
      const n = p ? Number(p[1]) : -1;
      if (n >= 0 && n < 16) out[n < 8 ? ANSI[n] : bright(ANSI[n - 8])] = hex(p![2]);
    }
  }
  if (!out.background && !out.foreground && theme) throw new Error(`This configuration uses Ghostty's built-in theme "${theme}" and sets no colours of its own, so there is nothing to bring in.`);
  try {
    return importScheme(JSON.stringify(out));
  } catch {
    throw new Error("That is not a Ghostty configuration with colours: it needs background and foreground lines.");
  }
}

/** A file name without its folder, and a reason with any folder path cut down to its last part, so a
 *  list of skipped files never shows where the user's folders are (TERM-100). */
export function plainSkip(file: string, reason: string): { file: string; reason: string } {
  const last = (p: string) => p.split(/[\\/]/).pop() || p;
  return { file: last(file), reason: reason.replace(/(?:[A-Za-z]:)?(?:[\\/][^\\/\s:"']+){2,}/g, last) };
}

export type WarpFileIn = { name: string; text?: string; skipped?: string };
export type WarpScan = { themes: Array<{ file: string; scheme: CustomScheme; left: string[] }>; skipped: Array<{ file: string; reason: string }> };

/** TERM-100: the theme files the back end found in Warp's theme folders, each read within its own time
 *  budget; the ones that cannot be used are listed by file name with a reason. */
export function scanWarp(files: WarpFileIn[], budget?: () => Budget): WarpScan {
  const out: WarpScan = { themes: [], skipped: [] };
  for (const f of files) {
    const name = f.name.split(/[\\/]/).pop() || f.name;
    if (f.skipped !== undefined || f.text === undefined) {
      out.skipped.push(plainSkip(f.name, f.skipped ?? "could not be read"));
      continue;
    }
    try {
      const t = parseWarpTheme(f.text, name, budget?.());
      out.themes.push({ file: name, ...t });
    } catch (e) {
      out.skipped.push(plainSkip(name, e instanceof Error ? e.message : NOT_WARP));
    }
  }
  return out;
}

// TERM-099 (T-307): a Ghostty configuration read setting by setting. The back end reads the config file
// (and the files it includes) and the theme files; this only maps them.

/** A config file larger than this is skipped (a real one is a few KB). */
export const MAX_CONFIG_CHARS = 262_144;
/** Ghostty's scrollback is a size in bytes; Kolux counts rows. About this many bytes make a row. */
const BYTES_PER_ROW = 1000;

export type GhosttyFileIn = { label: string; text?: string; skipped?: string };
export type GhosttyImport = {
  settings: Record<string, string | number | boolean>;
  schemes: CustomScheme[];
  darkScheme: string | null;
  lightScheme: string | null;
  /** Ghostty keys that were read but Kolux has no setting for (yet). */
  unsupported: string[];
  invalid: Array<{ key: string; value: string; reason: string }>;
  skipped: Array<{ file: string; reason: string }>;
  notes: string[];
  /** Plain names of what will be set, for the preview. */
  applied: string[];
};

/** Known Ghostty keys with no Kolux setting yet; a zero or false on the first group means off. */
const OFF_OK = new Set(["window-padding-x", "window-padding-y", "macos-option-as-alt", "mouse-hide-while-typing", "focus-follows-mouse", "background-blur", "background-blur-radius"]);
const NO_SETTING = new Set([...OFF_OK, "bold-color", "selection-word-chars", "selection-foreground"]);

const COLOUR_WORD = "not a colour like #rrggbb";
const colourOf = (v: string): string | null => {
  const t = hex(v);
  return /^#[0-9a-f]{6}$/i.test(t) ? t.toLowerCase() : null;
};
const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");

/** The `key = value` lines of a Ghostty file; a line that is neither a comment nor `key = value` comes back as `bad`. */
function ghosttyLines(text: string): Array<{ key: string; value: string } | { bad: string }> {
  const out: Array<{ key: string; value: string } | { bad: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) out.push({ bad: line });
    else if (m[2].trim()) out.push({ key: m[1], value: unquote(m[2]) });
  }
  return out;
}

/** Puts one colour line into `into`. Returns a reason when the value is wrong, "far" for a palette
 *  entry past the sixteen Kolux keeps, null when it was taken. */
function ghosttyColour(key: string, value: string, into: Record<string, string>): string | "far" | null {
  if (key === "palette") {
    const p = /^(\d+)\s*=\s*(.+)$/.exec(value);
    if (!p) return "palette needs a number and a colour, like 1=#rrggbb";
    const n = Number(p[1]);
    const c = colourOf(p[2]);
    if (!c) return COLOUR_WORD;
    if (n > 15) return "far";
    into[n < 8 ? ANSI[n] : bright(ANSI[n - 8])] = c;
    return null;
  }
  const c = colourOf(value);
  if (!c) return COLOUR_WORD;
  into[GHOSTTY[key]] = c;
  return null;
}

/** Reads a Ghostty theme file: its colour lines only. */
function themeColours(text: string): Record<string, string> {
  const into: Record<string, string> = {};
  for (const l of ghosttyLines(text)) if ("key" in l && (isColourKey(l.key) || l.key === "palette")) ghosttyColour(l.key, l.value, into);
  return into;
}

/** `theme = Name`, or `light:A,dark:B` in either order. */
function themePair(v: string): { dark: string | null; light: string | null } {
  if (!/(^|,)\s*(light|dark)\s*:/i.test(v)) return { dark: v, light: null };
  const out = { dark: null as string | null, light: null as string | null };
  for (const part of v.split(",")) {
    const m = /^\s*(light|dark)\s*:\s*(.+?)\s*$/i.exec(part);
    if (m) out[m[1].toLowerCase() as "dark" | "light"] = m[2];
  }
  return out;
}

/** The theme names the configuration asks for (the last `theme` line wins), at most a dark and a light one,
 *  so the page can ask the back end for exactly those theme files. */
export function ghosttyThemeNames(files: GhosttyFileIn[]): string[] {
  let last = "";
  for (const f of files) {
    if (f.text === undefined || f.text.length > MAX_CONFIG_CHARS) continue;
    for (const l of ghosttyLines(f.text)) if ("key" in l && l.key === "theme") last = l.value;
  }
  const p = themePair(last);
  return [p.dark, p.light].filter((n): n is string => !!n);
}

export function importGhostty(files: GhosttyFileIn[], readTheme: (name: string) => string | null): GhosttyImport {
  const r: GhosttyImport = { settings: {}, schemes: [], darkScheme: null, lightScheme: null, unsupported: [], invalid: [], skipped: [], notes: [], applied: [] };
  const colours: Record<string, string> = {};
  let theme: string | null = null;
  const bad = (key: string, value: string, reason: string) => r.invalid.push({ key, value, reason });
  const set = (key: string, value: string | number | boolean, label: string) => {
    r.settings[key] = value;
    if (!r.applied.includes(label)) r.applied.push(label);
  };
  const unsupported = (key: string) => {
    if (!r.unsupported.includes(key)) r.unsupported.push(key);
  };
  const bool = (v: string) => (/^(true|yes|on)$/i.test(v) ? true : /^(false|no|off)$/i.test(v) ? false : null);

  for (const f of files) {
    if (f.skipped !== undefined || f.text === undefined) {
      r.skipped.push(plainSkip(f.label, f.skipped ?? "could not be read"));
      continue;
    }
    if (f.text.length > MAX_CONFIG_CHARS) {
      r.skipped.push(plainSkip(f.label, `is too large to read (over ${MAX_CONFIG_CHARS / 1024} KB)`));
      continue;
    }
    for (const l of ghosttyLines(f.text)) {
      if ("bad" in l) {
        bad(l.bad.length > 60 ? l.bad.slice(0, 60) + "…" : l.bad, "", "not a key = value line");
        continue;
      }
      const { key, value } = l;
      const num = Number(value);
      switch (key) {
        case "font-family":
          set(FIELDS.family, value, "font");
          break;
        case "font-size":
          if (!Number.isFinite(num)) bad(key, value, "not a number");
          else if (num < SIZE.min || num > SIZE.max) bad(key, value, `Kolux's terminal text size is ${SIZE.min} to ${SIZE.max}`);
          else set(FIELDS.size, Math.round(num), "font size");
          break;
        case "cursor-style":
          if ((CURSORS as readonly string[]).includes(value)) set(FIELDS.cursor, value, "cursor shape");
          else bad(key, value, `Kolux has the cursor shapes ${CURSORS.join(", ")}`);
          break;
        case "cursor-style-blink": {
          const b = bool(value);
          if (b === null) bad(key, value, "needs true or false");
          else set(FIELDS.blink, b, "cursor blink");
          break;
        }
        case "scrollback-limit":
          if (!Number.isFinite(num) || num < 0) bad(key, value, "needs a size in bytes, zero or more");
          else {
            const rows = Math.min(SCROLLBACK.max, Math.round(num / BYTES_PER_ROW));
            set(FIELDS.scrollback, rows, "scrollback");
            const note = `Ghostty's scrollback is a size in bytes; about ${BYTES_PER_ROW} bytes were counted as one row.`;
            if (!r.notes.includes(note)) r.notes.push(note);
          }
          break;
        case "split-divider-color": {
          const c = colourOf(value);
          if (!c) bad(key, value, COLOUR_WORD);
          else {
            set(FIELD.dividerDark, c, "pane divider colour");
            set(FIELD.dividerLight, c, "pane divider colour");
          }
          break;
        }
        case "unfocused-split-opacity":
          if (!Number.isFinite(num) || num < 0.15 || num > 1) bad(key, value, "needs a number from 0.15 to 1");
          else {
            const pct = Math.max(SPAN.paneDim[0], Math.round(num * 100));
            set(FIELD.paneDim, pct, "dim for unfocused panes");
          }
          break;
        case "copy-on-select": {
          const b = bool(value) ?? (value === "clipboard" ? true : null);
          if (b === null) bad(key, value, "needs true, false or clipboard");
          else set(FIELDS.copyOnSelect, b, "copy on select");
          break;
        }
        case "theme":
          theme = value;
          break;
        case "config-file":
          break; // included files are read by the back end
        default:
          if (isColourKey(key) || key === "palette") {
            const why = ghosttyColour(key, value, colours);
            if (why === "far") unsupported("palette (colours 16 to 255)");
            else if (why) bad(key, value, why);
          } else if (NO_SETTING.has(key)) {
            if (!(OFF_OK.has(key) && (num === 0 || bool(value) === false))) unsupported(key);
          } else unsupported(key);
      }
    }
  }

  // Colours: the theme (or the light and dark pair) underneath, the file's own colour lines on top.
  const base = (name: string): Record<string, string> | null => {
    if (/\.\.|[\\/]/.test(name)) {
      bad("theme", name, "a theme name cannot name a folder; use a name from Ghostty's theme folders");
      return null;
    }
    const text = readTheme(name);
    if (text === null || text.length > MAX_CONFIG_CHARS) {
      bad("theme", name, "not found in Ghostty's theme folders");
      return null;
    }
    return themeColours(text);
  };
  const own = Object.keys(colours).length > 0;
  const build = (name: string, under: Record<string, string>) => {
    try {
      r.schemes.push(importScheme(JSON.stringify({ name, ...under, ...colours })));
      return name;
    } catch {
      if (own) bad("colours", "", "needs both a background and a foreground colour to make a scheme");
      return null;
    }
  };
  if (theme) {
    const pair = themePair(theme);
    const tag = (n: string) => (own ? `${n} (Ghostty)` : n);
    for (const [slot, name] of [["darkScheme", pair.dark], ["lightScheme", pair.light]] as const) {
      const under = name ? base(name) : null;
      if (name && under) r[slot] = build(tag(name), under);
    }
    if (!r.schemes.length && own && !r.invalid.some((i) => i.key === "colours")) r.darkScheme = build("Ghostty", {});
  } else if (own) r.darkScheme = build("Ghostty", {});
  // dark first
  r.schemes.sort((a, b) => Number(b.name === r.darkScheme) - Number(a.name === r.darkScheme));
  return r;
}

/** Picks one parser by what the file looks like: Warp files are YAML maps, Ghostty uses `=`. */
export function parseSchemeFile(file: string, text: string): CustomScheme {
  if (/\.ya?ml$/i.test(file) || /^\s*[A-Za-z_]+:/m.test(text)) return parseWarp(text, file);
  return parseGhostty(text, stem(file) && !/^config$/i.test(stem(file)) ? stem(file) : "Ghostty");
}

/** True when every colour the scheme sets is already what the terminal draws. */
export function sameColours(s: CustomScheme, now: ITheme): boolean {
  return Object.entries(s).every(([k, v]) => k === "name" || (now as Record<string, unknown>)[k]?.toString().toLowerCase() === v);
}

export type ImportPlan = { custom: CustomScheme[]; added: string[]; replaced: string[]; refused: string[] };

/** The ticked schemes merged into the saved list: a name already there is replaced in place (even
 *  at the cap), a new one is added while there is room, the rest are refused by name. */
export function planImport(saved: CustomScheme[], ticked: CustomScheme[], cap = MAX_CUSTOM): ImportPlan {
  const custom = [...saved];
  const plan: ImportPlan = { custom, added: [], replaced: [], refused: [] };
  for (const s of ticked) {
    const at = custom.findIndex((c) => c.name.toLowerCase() === s.name.toLowerCase());
    if (at >= 0) {
      custom[at] = s;
      plan.replaced.push(s.name);
    } else if (custom.length < cap) {
      custom.push(s);
      plan.added.push(s.name);
    } else plan.refused.push(s.name);
  }
  return plan;
}

/** T-757: the one wording for the import cards' button: Bring in, or Bring in 2 schemes once some are ticked. */
export const bringIn = (n: number) => (n ? `Bring in ${n} scheme${n === 1 ? "" : "s"}` : "Bring in");

/** What the result line says after applying. */

export function planSummary(p: ImportPlan, cap = MAX_CUSTOM): string {
  const parts = [p.added.length && `Added ${p.added.join(", ")}.`, p.replaced.length && `Replaced ${p.replaced.join(", ")}.`, p.refused.length && `Not added: ${p.refused.join(", ")}, because you already have ${cap} custom schemes. Remove one first.`];
  return parts.filter(Boolean).join(" ") || "Nothing was ticked, so nothing changed.";
}
