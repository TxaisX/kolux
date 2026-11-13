// SET-017 (T-210-b): the text lookup. Every one of Kolux's own words is read by key: the pack for
// the language in force when it has that text, English otherwise. A pack is loaded only when its
// language is first needed, and until it arrives (or when it lacks a text) English shows. Product
// and provider names are passed as values, never translated. DT-C30: the lookup and the English
// fallback are built now; no packs ship yet (no source of translations), so every language reads
// English until one is registered.
// ponytail: the packs themselves, the screens moving onto `t()` beyond the glossary and the
// system menus switching language are T-210-c (the menus wait on T-248).
import { locale, type Language } from "../language";
import { jargon } from "../glossary";
import { EN, type TextKey } from "./en";

export type Pack = Partial<Record<TextKey, string>>;

const loaders = new Map<Language, () => Promise<Pack>>();
const packs = new Map<Language, Pack>();
const pending = new Map<Language, Promise<Pack>>();
const listeners = new Set<(lang: Language) => void>();

/** Makes a language pack available; it is loaded the first time that language is needed. */
export function registerPack(lang: Language, load: () => Promise<Pack>): void {
  loaders.set(lang, load);
  packs.delete(lang);
  pending.delete(lang);
}

/** Loads the pack for `lang` once (English needs none). A pack that fails to load leaves English showing. */
export function loadPack(lang: Language = locale()): Promise<Pack> {
  const have = packs.get(lang);
  if (have) return Promise.resolve(have);
  const load = lang === "en" ? undefined : loaders.get(lang);
  if (!load) return Promise.resolve({});
  let p = pending.get(lang);
  if (!p) {
    p = load().then(
      (pack) => {
        pending.delete(lang);
        packs.set(lang, pack);
        listeners.forEach((f) => f(lang));
        return pack;
      },
      () => {
        pending.delete(lang);
        return {};
      },
    );
    pending.set(lang, p);
  }
  return p;
}

/** Fetches the pack for `lang` now rather than at its first `t()`: a pack that arrives after the first paint leaves that paint in English until something else re-renders. */
export function preload(lang: Language = locale()): Promise<Pack> {
  return loadPack(lang);
}

/** Whether `lang`'s pack is here already (English, which needs none, always is). */
export function packReady(lang: Language = locale()): boolean {
  return lang === "en" || packs.has(lang);
}

/** Called when a pack has arrived, so a screen showing the English stand-in can draw again. */
export function onPackLoaded(f: (lang: Language) => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** The text for `key` in the language in force, or in English when its pack is not here or lacks it. `{name}` takes `values.name`. */
export function t(key: TextKey, values?: Record<string, string | number>, lang: Language = locale()): string {
  const pack = packs.get(lang);
  if (!pack && lang !== "en" && loaders.has(lang)) void loadPack(lang);
  // A pack is plain data from a file: only real text counts; a gap, null or a number reads in English.
  const p: unknown = pack?.[key];
  const text = typeof p === "string" ? p : ((EN as Record<string, string>)[key] ?? "");
  return values ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? String(values[name]) : all)) : text;
}

/** The keys a loaded pack lacks (shown in English). */
export function missing(lang: Language): TextKey[] {
  const pack: Record<string, unknown> = packs.get(lang) ?? {};
  return (Object.keys(EN) as TextKey[]).filter((k) => typeof pack[k] !== "string");
}

/** ONB-036 in every language: the banned technical words found in a pack's on-screen texts (hover texts may carry them). */
export function packJargon(pack: Pack): string[] {
  return (Object.entries(pack) as [TextKey, string][])
    .filter(([k]) => !k.endsWith(".hover"))
    .flatMap(([k, text]) => jargon(text).map((w) => `${k}: "${w}"`));
}
