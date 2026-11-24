// Chords and the keymap (COMPAT.md 4.1 and 4.2, SET-011, SET-013). A chord is modifier names
// and one key joined by "+", such as "Mod+Shift+ArrowUp". The keymap is the built-in defaults
// for this platform, then the file's all-platforms section, then its section for this platform.
// A custom chord that collides with another binding in the same scope (or conflict group) is
// dropped and the default stays, so an edit can never silently steal a key.
import { actionById, actions, defaultsFor, sameAs, type Action, type Platform, type Scope } from "./actions";
import { answerCommand, commandOf } from "./runCommand";
import { currentLayout, layoutKeyLabel } from "../terminal/keyLayout";
import { doubleTapLabel, doubleTapSpelling, parseDoubleTap } from "./doubleTap";

export const MODIFIERS = ["Mod", "Ctrl", "Cmd", "Meta", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

export type Chord = { mod: boolean; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; key: string };

/** Parses "Mod+Shift+J" into its parts; a bad chord returns an error message instead. */
export function parseChord(text: string): Chord | { error: string } {
  const parts = text.split("+").map((p) => p.trim());
  // "Mod+Shift+Plus" ends in a key that is itself "+", which split() turns into two empty parts.
  if (parts.length >= 2 && parts[parts.length - 1] === "" && parts[parts.length - 2] === "") parts.splice(-2, 2, "Plus");
  if (parts.length === 0 || parts.some((p) => p === "")) return { error: `"${text}" is not a chord` };
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const chord: Chord = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: canonicalKey(key) };
  for (const m of mods) {
    const name = MODIFIERS.find((x) => x.toLowerCase() === m.toLowerCase());
    if (!name) return { error: `"${text}": "${m}" is not a modifier` };
    const flag = ({ Mod: "mod", Ctrl: "ctrl", Cmd: "meta", Meta: "meta", Alt: "alt", Shift: "shift" } as Record<Modifier, keyof Chord>)[name];
    if (chord[flag]) return { error: `"${text}" repeats ${name}` };
    (chord as unknown as Record<string, boolean>)[flag] = true;
  }
  if (chord.mod && (chord.ctrl || chord.meta)) return { error: `"${text}" mixes Mod with Ctrl or Cmd` };
  if ((MODIFIERS as readonly string[]).some((m) => m.toLowerCase() === key.toLowerCase())) return { error: `"${text}" has no key` };
  return chord;
}

/** Letters upper-case, named keys in their W3C spelling, so "ctrl+shift+j" equals "Ctrl+Shift+J". */
function canonicalKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const named = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Enter", "Tab", "Escape", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Space", "Comma", "Period", "Equal", "Minus", "Plus", "Slash", "Backslash", "Backquote", "Quote", "Semicolon", "BracketLeft", "BracketRight", "NumpadAdd", "NumpadSubtract"];
  return named.find((n) => n.toLowerCase() === key.toLowerCase()) ?? key;
}

export function chordToString(c: Chord): string {
  const parts: string[] = [];
  if (c.mod) parts.push("Mod");
  if (c.ctrl) parts.push("Ctrl");
  if (c.meta) parts.push("Cmd");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  parts.push(c.key);
  return parts.join("+");
}

/** The digit-index actions take a chord ending in 1 and cover 1 to 9; any digit, 0 included, is rewritten to 1. */
export function normaliseIndexChord(chord: string): string {
  return chord.replace(/\+[0-9]$/, "+1");
}

/** How a chord reads on screen, as parts: "Mod+Shift+J" is ["Ctrl", "Shift", "J"] on Windows. */
export function labelParts(chord: string, platform: Platform): string[] {
  const tap = parseDoubleTap(chord);
  if (tap) return [doubleTapLabel(tap, platform)]; // one cap: "Shift Shift"
  const c = parseChord(chord);
  if ("error" in c) return [chord];
  const parts: string[] = [];
  const mac = platform === "darwin";
  if (c.ctrl || (c.mod && !mac)) parts.push("Ctrl");
  if (c.alt) parts.push(mac ? "Option" : "Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta || (c.mod && mac)) parts.push("Cmd");
  parts.push(keyLabel(c.key));
  return parts;
}

const keyLabels: Record<string, string> = { Comma: ",", Period: ".", Equal: "=", Minus: "-", Plus: "+", Slash: "/", Backslash: "\\", Backquote: "`", Quote: "'", Semicolon: ";", BracketLeft: "[", BracketRight: "]", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", NumpadAdd: "Numpad +", NumpadSubtract: "Numpad -", Escape: "Esc", PageUp: "PgUp", PageDown: "PgDn", Backspace: "Backspace", Delete: "Del", Insert: "Ins" };
// VIEW-109 (T-253): a punctuation key reads as the layout in use prints it at that position (German Ctrl+/ reads Ctrl+-).
export const keyLabel = (key: string): string => layoutKeyLabel(key, currentLayout(), keyLabels[key] ?? key);

/** `dropped`: the file overrides this command but the override clashed and was dropped (SET-010). */
export type Binding = { action: Action; chords: string[]; custom: boolean; dropped?: boolean };
export type Keymap = {
  platform: Platform;
  bindings: Map<string, Binding>;
  errors: string[];
  warnings: string[];
  /** SET-010: each chord a custom shortcut tried to share inside one scope or conflict group, with
   *  every command involved (in table order). The override was ignored; its default stays. */
  clashes: Clash[];
};
export type Clash = { chord: string; ids: string[] };

const PLATFORMS: Platform[] = ["win32", "linux", "darwin"];
const RESERVED = new Set(["$schema", "version", "keybindings", "platforms"]);

/** Builds the keymap from the file's JSON (null means "no file, defaults only"). `ignore`: commands
 *  that never count in a clash (the new-tab commands of agents switched off, SET-010). */
export function resolve(file: unknown, platform: Platform, ignore: readonly string[] = []): Keymap {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bindings = new Map<string, Binding>(actions.map((x) => [x.id, { action: x, chords: defaultsFor(x, platform), custom: false }]));
  if (file !== null && file !== undefined) {
    if (!isObject(file)) {
      errors.push("The shortcuts file is not a JSON object; the default shortcuts are in use.");
    } else {
      // The all-platforms section: `keybindings` when present, else the older form with ids at the top level.
      let shared: Record<string, unknown>;
      if ("keybindings" in file) {
        if (isObject(file.keybindings)) shared = file.keybindings;
        else {
          shared = {};
          errors.push('"keybindings" must be an object of command ids; it was ignored.');
        }
      } else {
        shared = Object.fromEntries(Object.entries(file).filter(([k]) => !RESERVED.has(k)));
      }
      applySection(shared, bindings, errors, warnings, "all platforms");
      if ("platforms" in file) {
        if (!isObject(file.platforms)) errors.push('"platforms" must be an object with darwin, linux and win32 sections; it was ignored.');
        else {
          for (const name of Object.keys(file.platforms)) {
            if (!PLATFORMS.includes(name as Platform)) warnings.push(`"${name}" is not a platform (darwin, linux or win32); its section was ignored.`);
          }
          const own = file.platforms[platform];
          if (own !== undefined) {
            if (isObject(own)) applySection(own, bindings, errors, warnings, platform);
            else errors.push(`The ${platform} section must be an object of command ids; it was ignored.`);
          }
        }
      }
    }
  }
  const clashes: Clash[] = [];
  dropConflicts(bindings, errors, platform, new Set(ignore), clashes);
  yieldToUser(bindings, new Set(ignore), warnings, clashes);
  return { platform, bindings, errors, warnings, clashes };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function applySection(section: Record<string, unknown>, bindings: Map<string, Binding>, errors: string[], warnings: string[], where: string) {
  for (const [id, raw] of Object.entries(section)) {
    const binding = bindings.get(id);
    if (!binding) {
      warnings.push(`"${id}" (${where}) is not a command Kolux knows; it was ignored.`);
      continue;
    }
    let chords: string[];
    if (raw === null || raw === false) chords = [];
    else if (typeof raw === "string") chords = [raw];
    else if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) chords = raw as string[];
    else {
      errors.push(`"${id}" (${where}) must be a chord, a list of chords, null or false; its default stays.`);
      continue;
    }
    const parsed: string[] = [];
    let bad: string | null = null;
    for (const text of chords) {
      // SET-009: a modifier tapped twice ("Double+Shift") is a shortcut of its own kind; it is kept in the file's spelling.
      const tap = parseDoubleTap(text);
      if (tap) {
        parsed.push(doubleTapSpelling(tap));
        continue;
      }
      const c = parseChord(text);
      if ("error" in c) {
        bad = c.error;
        break;
      }
      parsed.push(binding.action.index ? normaliseIndexChord(chordToString(c)) : chordToString(c));
    }
    if (bad) {
      errors.push(`"${id}" (${where}): ${bad}; its default stays.`);
      continue;
    }
    bindings.set(id, { action: binding.action, chords: parsed, custom: true });
  }
}

/** The same bucket is the same scope, or the same conflict group. */
function buckets(action: Action): string[] {
  return action.group ? [`scope:${action.scope}`, `group:${action.group}`] : [`scope:${action.scope}`];
}

function dropConflicts(bindings: Map<string, Binding>, errors: string[], platform: Platform, ignore: Set<string>, clashes: Clash[]) {
  for (let round = 0; round < 8; round++) {
    const seen = new Map<string, Binding[]>();
    for (const b of bindings.values()) {
      if (ignore.has(b.action.id)) continue;
      // T7-F01: a chord listed twice inside one command's own list is still one binding, so it must
      // count once here; otherwise the binding clashes with itself and is dropped.
      for (const chord of new Set(b.chords)) for (const bucket of buckets(b.action)) {
        const key = `${bucket}|${chord}`;
        seen.set(key, [...(seen.get(key) ?? []), b]);
      }
    }
    const dropped = new Set<Binding>();
    for (const [key, group] of seen) {
      // A lone custom chord beats the defaults on it (yieldToUser); only user against user drops.
      if (group.filter((b) => b.custom).length < 2) continue;
      for (const b of group) if (b.custom) dropped.add(b);
      const chord = key.slice(key.indexOf("|") + 1);
      const ids = group.map((b) => b.action.id);
      if (!clashes.some((c) => c.chord === chord && c.ids.join() === ids.join())) clashes.push({ chord, ids });
    }
    if (dropped.size === 0) return;
    const names = [...dropped].map((b) => b.action.title).sort();
    errors.push(`These custom shortcuts clash with another in the same place and were dropped, their defaults stay: ${names.join(", ")}.`);
    for (const b of dropped) bindings.set(b.action.id, { action: b.action, chords: defaultsFor(b.action, platform), custom: false, dropped: true });
  }
}

/** A chord the user bound takes it from the built-in defaults that held it in the same place: the
 *  default loses that chord, a warning says so, and a clash lists both so the rows show Conflicts (DT-C48). */
function yieldToUser(bindings: Map<string, Binding>, ignore: Set<string>, warnings: string[], clashes: Clash[]) {
  const owner = new Map<string, Binding>();
  for (const b of bindings.values()) {
    if (!b.custom || ignore.has(b.action.id)) continue;
    for (const chord of b.chords) for (const bucket of buckets(b.action)) owner.set(`${bucket}|${chord}`, b);
  }
  if (owner.size === 0) return;
  for (const b of [...bindings.values()]) {
    if (b.custom || ignore.has(b.action.id)) continue;
    const lost = b.chords.filter((chord) => buckets(b.action).some((bucket) => owner.has(`${bucket}|${chord}`)));
    if (lost.length === 0) continue;
    bindings.set(b.action.id, { ...b, chords: b.chords.filter((c) => !lost.includes(c)) });
    for (const chord of lost) {
      const user = buckets(b.action).map((bucket) => owner.get(`${bucket}|${chord}`)).find((x) => x);
      warnings.push(`"${user?.action.title}" uses ${chord} from your shortcuts file, so "${b.action.title}" no longer has it.`);
      if (!user) continue;
      const shared = clashes.find((c) => c.chord === chord && c.ids[0] === user.action.id);
      if (shared) shared.ids.push(b.action.id);
      else clashes.push({ chord, ids: [user.action.id, b.action.id] });
    }
  }
}

export type KeyLike = { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; getModifierState?: (key: string) => boolean };
export type Match = { id: string; index?: number };

/** Does this chord fire for this key event? Returns the digit for index actions. */
export function chordMatches(chord: string, e: KeyLike, platform: Platform, index = false): { index?: number } | null {
  const c = parseChord(chord);
  if ("error" in c) return null;
  const mac = platform === "darwin";
  const wantCtrl = c.ctrl || (c.mod && !mac);
  const wantMeta = c.meta || (c.mod && mac);
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== c.alt || e.shiftKey !== c.shift) return null;
  if (typesCharacter(c, e, platform, index)) return null;
  if (index && c.key === "1") {
    const d = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
    return d ? { index: Number(d) } : null;
  }
  return keyMatches(c.key, e) ? {} : null;
}

/** What a chord's own key types on a plain US-style layout, shifted forms included; null = not a typing key. */
function ownChars(key: string): string | null {
  if (/^[A-Z]$/.test(key)) return key.toLowerCase() + key;
  if (/^[0-9]$/.test(key)) return key;
  const numpad = /^Numpad([0-9])$/.exec(key);
  if (numpad) return numpad[1];
  const named: Record<string, string> = {
    Equal: "=+", Minus: "-_", Plus: "+", Space: " ", BracketLeft: "[{", BracketRight: "]}", Comma: ",<", Period: ".>", Slash: "/?",
    Backslash: "\\|", Semicolon: ";:", Quote: "'\"", Backquote: "`~", NumpadAdd: "+", NumpadSubtract: "-", NumpadMultiply: "*", NumpadDivide: "/", NumpadDecimal: ".",
  };
  return named[key] ?? null;
}

/**
 * AltGr guard (FIX-1). On Windows and Linux the right-hand Alt key (AltGr) reaches the page as Ctrl+Alt,
 * so AltGr+0 (a closing brace on a German keyboard) would look like the chord Ctrl+Alt+0 and its
 * character would be lost. A Ctrl+Alt press that types one character other than the chord's own key is a
 * typed symbol, never a command; so is anything the browser flags as AltGraph. macOS Option is a real
 * modifier and is left alone before anything else is read (FIX-2: not even AltGraph is consulted there).
 * A non-Latin letter in key is a layout without an AltGr layer, so it counts only with the AltGraph flag.
 * Limit: on an AltGr layout (German, Polish) the zoom chords that need AltGr to type can not be pressed;
 * rebind the interface zoom keys. Shift chords are checked by the AltGraph flag only (their typed character
 * depends on the layout).
 */
function typesCharacter(c: Chord, e: KeyLike, platform: Platform, index: boolean): boolean {
  if (platform === "darwin") return false;
  if (e.getModifierState?.("AltGraph")) return true;
  if (!e.ctrlKey || !e.altKey || e.shiftKey) return false;
  if ([...e.key].length !== 1) return false;
  // Layouts without an AltGr layer (Russian, Greek, Hebrew, Arabic) report their own letter in key while
  // the physical key still decides the chord, so a non-Latin letter is not typed text unless AltGraph is set.
  if (/\p{L}/u.test(e.key) && !/\p{Script=Latin}/u.test(e.key)) return false;
  const own = index && c.key === "1" ? "123456789" : ownChars(c.key);
  return own !== null && !own.includes(e.key);
}

function keyMatches(key: string, e: KeyLike): boolean {
  if (/^[A-Z]$/.test(key)) return e.code === `Key${key}` || e.key.toUpperCase() === key;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.key === key;
  if (key === "Plus") return e.key === "+" || e.code === "NumpadAdd";
  if (key === "Space") return e.code === "Space" || e.key === " ";
  return e.code === key || e.key === key;
}

/** The first action in the wanted scopes whose chord fires for this event. */
export function matchEvent(map: Keymap, e: KeyLike, scopes: Scope[]): Match | null {
  // T-611: a command picked in the palette answers its stand-in key event wherever its scope is live.
  const picked = commandOf(e);
  if (picked) {
    if (!scopes.includes(actionById.get(picked.id)?.scope as Scope)) return null;
    answerCommand(picked);
    return matchOf(picked.id, picked.index);
  }
  for (const b of map.bindings.values()) {
    if (!scopes.includes(b.action.scope)) continue;
    for (const chord of b.chords) {
      const hit = chordMatches(chord, e, map.platform, b.action.index);
      if (hit) return matchOf(b.action.id, hit.index);
    }
  }
  return null;
}

/** T-611: the match for a command, an old id answering as the command it stands for (actions.ts sameAs). */
export const matchOf = (id: string, index?: number): Match => (index === undefined ? { id: sameAs[id] ?? id } : { id: sameAs[id] ?? id, index });

/** The chords of one action, or [] when it is unassigned. */
export function chordsOf(map: Keymap, id: string): string[] {
  return map.bindings.get(id)?.chords ?? [];
}

/** Label parts for the first chord of an action; [] when it has none. */
export function labelOf(map: Keymap, id: string): string[] {
  const chord = chordsOf(map, id)[0];
  return chord ? labelParts(chord, map.platform) : [];
}

export const defaultsOnly = (platform: Platform): Keymap => resolve(null, platform);

export function detectPlatform(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): Platform {
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Linux/.test(ua) && !/Android/.test(ua)) return "linux";
  return "win32";
}

export { actionById };
