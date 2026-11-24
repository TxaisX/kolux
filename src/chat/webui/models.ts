// The model picker's rules (2026-11-24): search, the starred "Your models" list, the order of rows on the
// screen (which the arrow keys follow), and which effort levels a model offers. Pure, so each is tested alone.
import { DEFAULT_CHAT_MODEL, type ChatModel } from "../opencode";
import { readKey, writeKey, type Store } from "./storage";

/** Where the starred model ids are kept (the chat has no other settings store for this). */
export const STARRED_KEY = "kolux.chat.starredModels";

/** The maker's name. OpenCode may name the route (`openrouter`) as the provider; the maker is then the second part of the id. */
export function providerOf(m: ChatModel): string {
  if (m.provider !== "openrouter") return m.provider;
  const parts = m.id.split("/");
  return parts.length >= 3 ? parts[1] : m.provider;
}

/** The maker read off an id alone (`openrouter/anthropic/claude-opus-5.5` is anthropic), for before the model list has loaded. */
export function providerFromId(id: string): string {
  const parts = id.split("/");
  return parts.length >= 3 && parts[0] === "openrouter" ? parts[1] : parts[0];
}

/** A saved or passed-in model is only usable if it is an OpenCode id (`route/maker/model`, or `maker/model`): an older Claude-era name like "opus" is not. */
export const usableModel = (id: string | null | undefined): string | null => (id && id.includes("/") ? id : null);

/** The models whose name, id or maker holds every word typed (any case). */
export function filterModels(models: readonly ChatModel[], query: string): ChatModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...models];
  return models.filter((m) => {
    const hay = `${m.label} ${m.id} ${providerOf(m)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type Sections = { starred: ChatModel[]; groups: { provider: string; models: ChatModel[] }[] };

/** "Your models" first, then every model under its maker (makers A to Z, models in the engine's order). */
export function buildSections(models: readonly ChatModel[], starred: readonly string[], query: string): Sections {
  const hits = filterModels(models, query);
  const mine = new Set(starred);
  const by = new Map<string, ChatModel[]>();
  for (const m of hits) by.set(providerOf(m), [...(by.get(providerOf(m)) ?? []), m]);
  return {
    starred: hits.filter((m) => mine.has(m.id)),
    groups: [...by.keys()].sort((a, b) => a.localeCompare(b)).map((provider) => ({ provider, models: by.get(provider)! })),
  };
}

export type Row = { section: string; model: ChatModel };

/** Every row in the order it is drawn, so the arrow keys and the screen agree. */
export function flatRows(sections: Sections): Row[] {
  return [...sections.starred.map((model) => ({ section: "starred", model })), ...sections.groups.flatMap((g) => g.models.map((model) => ({ section: g.provider, model })))];
}

export const effortsOf = (models: readonly ChatModel[], id: string | null): string[] => models.find((m) => m.id === id)?.efforts ?? [];

/** What an id is called when the model list has not loaded or does not hold it: its last part. */
export const nameOfId = (id: string): string => id.split("/").pop() || id;

// --- Your models ---

const SEED_MAKERS = ["anthropic", "openai", "google", "x-ai", "deepseek"];

/** A model's version as numbers ("claude-opus-5.5" is [5, 5]), for choosing the current one of a maker. */
function versionOf(m: ChatModel): number[] {
  const hit = nameOfId(m.id).match(/\d+(?:\.\d+)*/);
  return hit ? hit[0].split(".").map(Number) : [];
}
const newer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
};

/** The first list: the default model, then the highest-numbered model of each main maker that the engine offers (a tie keeps the one listed first). */
export function seedStarred(models: readonly ChatModel[]): string[] {
  const out = [DEFAULT_CHAT_MODEL];
  for (const maker of SEED_MAKERS) {
    let best: ChatModel | null = null;
    for (const m of models) if (providerOf(m) === maker && (best === null || newer(versionOf(m), versionOf(best)))) best = m;
    if (best && !out.includes(best.id)) out.push(best.id);
  }
  return out;
}

/** The saved list, or null when none was ever saved (the first run, which seeds). */
export function loadStarred(store?: Store): string[] | null {
  const raw = readKey(STARRED_KEY, store);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export const saveStarred = (ids: readonly string[], store?: Store): void => writeKey(STARRED_KEY, JSON.stringify(ids), store);

export const toggleStar = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

// --- The keyboard inside the open list ---

export type PopAction = "pick" | "star" | "close" | null;

/** One key in the open list: where the highlight goes and what, if anything, to do. Arrows wrap; Enter picks; Shift+Enter stars; Escape closes. */
export function popKey(active: number, count: number, key: string, shift = false): { active: number; then: PopAction } {
  if (key === "Escape") return { active, then: "close" };
  if (count === 0) return { active: 0, then: null };
  switch (key) {
    case "ArrowDown":
      return { active: (active + 1) % count, then: null };
    case "ArrowUp":
      return { active: (active - 1 + count) % count, then: null };
    case "Home":
      return { active: 0, then: null };
    case "End":
      return { active: count - 1, then: null };
    case "Enter":
      return { active, then: shift ? "star" : "pick" };
    default:
      return { active, then: null };
  }
}
