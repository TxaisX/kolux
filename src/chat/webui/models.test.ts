// The model picker at the top of a chat (2026-11-24, the Open WebUI screen): search, starred "Your models"
// kept in the browser, keyboard steps, and the effort picker that only shows when the model has levels.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_MODEL, type ChatModel } from "../opencode";
import { STARRED_KEY, buildSections, effortsOf, filterModels, flatRows, loadStarred, popKey, providerOf, saveStarred, seedStarred, toggleStar } from "./models";
import { ModelList } from "./ModelPopover";
import { EffortPicker } from "./EffortPicker";

const m = (id: string, provider: string, efforts: string[] = [], label = id.split("/").pop()!): ChatModel => ({ id, label, provider, efforts });
const MODELS: ChatModel[] = [
  m("openrouter/anthropic/claude-opus-5.5", "anthropic", ["low", "high"], "Claude Opus 5.5"),
  m("openrouter/anthropic/claude-sonnet-5.5", "anthropic", ["low", "high"], "Claude Sonnet 5.5"),
  m("openrouter/anthropic/claude-opus-4.1", "anthropic", [], "Claude Opus 4.1"),
  m("openrouter/openai/gpt-5.5", "openai", ["low"], "GPT-5.5"),
  m("openrouter/google/gemini-3-pro", "google", [], "Gemini 3 Pro"),
  m("openrouter/x-ai/grok-5", "x-ai", [], "Grok 5"),
  m("openrouter/deepseek/deepseek-v4.1", "deepseek", [], "DeepSeek V4.1"),
  m("openrouter/meta-llama/llama-4", "meta-llama", [], "Llama 4"),
];

const fake = () => {
  const mem = new Map<string, string>();
  return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), mem };
};

describe("search", () => {
  it("matches the name, the id or the maker, every word, in any case", () => {
    expect(filterModels(MODELS, "OPUS").map((x) => x.label)).toEqual(["Claude Opus 5.5", "Claude Opus 4.1"]);
    expect(filterModels(MODELS, "opus 5").map((x) => x.label)).toEqual(["Claude Opus 5.5"]);
    expect(filterModels(MODELS, "x-ai").map((x) => x.label)).toEqual(["Grok 5"]);
    expect(filterModels(MODELS, "").length).toBe(MODELS.length);
    expect(filterModels(MODELS, "nothing like this")).toEqual([]);
  });
});

describe("sections", () => {
  it("lists the starred models first, then every model under its maker", () => {
    const sec = buildSections(MODELS, [MODELS[3].id, MODELS[0].id], "");
    expect(sec.starred.map((x) => x.label)).toEqual(["Claude Opus 5.5", "GPT-5.5"]);
    expect(sec.groups.map((g) => g.provider)).toEqual(["anthropic", "deepseek", "google", "meta-llama", "openai", "x-ai"]);
    expect(sec.groups[0].models.length).toBe(3);
  });
  it("search narrows both sections", () => {
    const sec = buildSections(MODELS, [MODELS[3].id, MODELS[0].id], "gpt");
    expect(sec.starred.map((x) => x.label)).toEqual(["GPT-5.5"]);
    expect(sec.groups.map((g) => g.provider)).toEqual(["openai"]);
  });
  it("flat rows follow the screen top to bottom, for the keyboard", () => {
    const sec = buildSections(MODELS, [MODELS[3].id], "");
    const rows = flatRows(sec);
    expect(rows[0]).toMatchObject({ section: "starred", model: { label: "GPT-5.5" } });
    expect(rows[1].section).toBe("anthropic");
    expect(rows.length).toBe(1 + MODELS.length);
  });
  it("reads the maker from an OpenRouter id when the provider says openrouter", () => {
    expect(providerOf(m("openrouter/x-ai/grok-5", "openrouter"))).toBe("x-ai");
    expect(providerOf(m("openrouter/x-ai/grok-5", "x-ai"))).toBe("x-ai");
  });
});

describe("Your models are kept", () => {
  it("seeds the default plus the newest model of each main maker, once", () => {
    const seeded = seedStarred(MODELS);
    expect(seeded[0]).toBe(DEFAULT_CHAT_MODEL);
    // The default is the engine's own (deepseek flash, not in this list); anthropic's newest tie goes to the first listed.
    expect(seeded).toEqual(expect.arrayContaining(["openrouter/anthropic/claude-opus-5.5", "openrouter/openai/gpt-5.5", "openrouter/google/gemini-3-pro", "openrouter/x-ai/grok-5", "openrouter/deepseek/deepseek-v4.1"]));
    expect(seeded).not.toContain("openrouter/meta-llama/llama-4");
    expect(seeded).not.toContain("openrouter/anthropic/claude-opus-4.1");
    expect(seeded.length).toBe(new Set(seeded).size);
  });
  it("seeds only the default when no model list has loaded", () => {
    expect(seedStarred([])).toEqual([DEFAULT_CHAT_MODEL]);
  });
  it("stars and unstars, and the list is written under kolux.chat.starredModels", () => {
    expect(STARRED_KEY).toBe("kolux.chat.starredModels");
    const st = fake();
    expect(loadStarred(st)).toBeNull();
    const one = toggleStar([], "a");
    saveStarred(one, st);
    expect(JSON.parse(st.mem.get(STARRED_KEY)!)).toEqual(["a"]);
    saveStarred(toggleStar(loadStarred(st)!, "b"), st);
    expect(loadStarred(st)).toEqual(["a", "b"]);
    saveStarred(toggleStar(loadStarred(st)!, "a"), st);
    expect(loadStarred(st)).toEqual(["b"]);
  });
  it("an emptied list stays empty and is not seeded again", () => {
    const st = fake();
    saveStarred([], st);
    expect(loadStarred(st)).toEqual([]);
  });
  it("ignores garbage and a storage that throws", () => {
    const st = fake();
    st.setItem(STARRED_KEY, "{not json");
    expect(loadStarred(st)).toBeNull();
    st.setItem(STARRED_KEY, JSON.stringify([1, "ok", null]));
    expect(loadStarred(st)).toEqual(["ok"]);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadStarred(broken)).toBeNull();
    expect(() => saveStarred(["a"], broken)).not.toThrow();
  });
});

describe("keyboard", () => {
  it("arrows step and wrap, Home and End jump", () => {
    expect(popKey(0, 5, "ArrowDown")).toEqual({ active: 1, then: null });
    expect(popKey(4, 5, "ArrowDown")).toEqual({ active: 0, then: null });
    expect(popKey(0, 5, "ArrowUp")).toEqual({ active: 4, then: null });
    expect(popKey(2, 5, "Home").active).toBe(0);
    expect(popKey(2, 5, "End").active).toBe(4);
  });
  it("Enter picks, Shift+Enter stars, Escape closes", () => {
    expect(popKey(2, 5, "Enter")).toEqual({ active: 2, then: "pick" });
    expect(popKey(2, 5, "Enter", true)).toEqual({ active: 2, then: "star" });
    expect(popKey(2, 5, "Escape")).toEqual({ active: 2, then: "close" });
  });
  it("does nothing on an empty list and ignores other keys", () => {
    expect(popKey(0, 0, "Enter")).toEqual({ active: 0, then: null });
    expect(popKey(0, 0, "ArrowDown")).toEqual({ active: 0, then: null });
    expect(popKey(1, 5, "a")).toEqual({ active: 1, then: null });
  });
});

describe("the open list", () => {
  const html = (over: Partial<Parameters<typeof ModelList>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ModelList, { models: MODELS, starred: [MODELS[0].id], query: "", active: 0, value: MODELS[0].id, listId: "t", onPick: () => {}, onStar: () => {}, onQuery: () => {}, onHover: () => {}, ...over }),
    );
  it("has a search box, Your models, and a group per maker, with names for every control", () => {
    const out = html();
    expect(out).toContain('aria-label="Search models"');
    expect(out).toContain("Your models");
    expect(out).toContain(">anthropic<");
    expect(out).toContain('role="listbox"');
    expect(out).toContain('aria-label="Remove Claude Opus 5.5 from your models"');
    expect(out).toContain('aria-label="Add GPT-5.5 to your models"');
    expect(out).toContain('aria-selected="true"');
  });
  it("says so when nothing matches", () => {
    expect(html({ query: "zzz" })).toContain("No models match");
  });
});

describe("effort", () => {
  it("reads the levels of the chosen model", () => {
    expect(effortsOf(MODELS, MODELS[0].id)).toEqual(["low", "high"]);
    expect(effortsOf(MODELS, MODELS[2].id)).toEqual([]);
    expect(effortsOf(MODELS, "not a model")).toEqual([]);
  });
  it("is not drawn for a model with no levels, and is for one with levels", () => {
    expect(EffortPicker({ efforts: [], value: null, disabled: false, onPick: () => {} })).toBeNull();
    const out = renderToStaticMarkup(createElement(EffortPicker, { efforts: ["low", "high"], value: "high", disabled: false, onPick: () => {} }));
    expect(out).toContain('aria-label="Effort"');
    expect(out).toContain("high");
  });
});
