// SET-017: the interface language. System (the default) follows the operating system's language
// when it is one of the six; anything else, Traditional Chinese included, is English, and so is an
// unknown saved value read as System. The saved choice applies as soon as settings load (main.tsx),
// and dates, weekday names, relative times and sorted lists follow it through `locale()`.
// Kolux's own words are read through `src/i18n/lookup.ts` (T-210-b), which uses this locale and
// shows English for any text the language's pack lacks; no packs ship yet (DT-C30, T-210-c).

export const LANGUAGE_FIELD = "language";

/** The choices, each named in its own language so it can be found whatever language is showing. */
export const LANGUAGES = [
  { id: "system", name: "System" },
  { id: "en", name: "English" },
  { id: "zh-CN", name: "简体中文" },
  { id: "ko", name: "한국어" },
  { id: "ja", name: "日本語" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
] as const;
export type LanguageChoice = (typeof LANGUAGES)[number]["id"];
export type Language = Exclude<LanguageChoice, "system">;

/** The saved choice, with anything unknown read as System. */
export function savedLanguage(v: unknown): LanguageChoice {
  return LANGUAGES.some((l) => l.id === v) ? (v as LanguageChoice) : "system";
}

/** The operating system's language when it is one of the six, otherwise English. */
export function systemLanguage(tags: readonly string[]): Language {
  const tag = (tags[0] ?? "").toLowerCase();
  const [base] = tag.split("-");
  if (base === "zh") return /-(tw|hk|mo|hant)\b/.test(tag) ? "en" : "zh-CN";
  return (["en", "ko", "ja", "es", "fr"] as const).find((l) => l === base) ?? "en";
}

const osTags = (): readonly string[] => globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? "en"];
let current: Language = systemLanguage(osTags());

/** The language the interface uses right now (a BCP 47 tag for Intl and toLocale* calls). */
export const locale = (): Language => current;

const listeners = new Set<(lang: Language) => void>();

/** Called after the language in force changes, so what a language owns (its pack) can be fetched at once. */
export function onLanguageChange(f: (lang: Language) => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Puts the saved choice in force: the document language and every later `locale()` call. */
export function applyLanguage(saved: unknown, os: readonly string[] = osTags()): Language {
  const choice = savedLanguage(saved);
  const before = current;
  current = choice === "system" ? systemLanguage(os) : choice;
  if (typeof document !== "undefined") document.documentElement.lang = current;
  if (current !== before) listeners.forEach((f) => f(current));
  return current;
}
