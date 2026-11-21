import { expect, test } from "vitest";
import { everydayAgents, everydayItems, everydaySessions, everydayUnkept, isEveryday, samePlace } from "./everyday";
import type { EverydayChat } from "./everydayChats";
import type { FolderSession } from "./folderSessions";

test("the same place ignores case, separators and a trailing slash", () => {
  expect(samePlace("C:\\Users\\X\\Kolux\\Everyday", "c:/users/x/kolux/everyday/")).toBe(true);
  expect(samePlace("C:\\Users\\X\\Kolux\\Everyday", "C:\\Users\\X\\Kolux\\Elsewhere")).toBe(false);
  expect(samePlace(null, "C:\\x")).toBe(false);
  expect(samePlace("C:\\x", undefined)).toBe(false);
});

test("only the Everyday path is the Everyday folder", () => {
  expect(isEveryday("C:\\Users\\X\\Kolux\\Everyday\\", "c:\\users\\x\\kolux\\everyday")).toBe(true);
  expect(isEveryday("C:\\Users\\X\\Kolux\\repo", "C:\\Users\\X\\Kolux\\Everyday")).toBe(false);
});

const session = (key: number, over: Partial<FolderSession> = {}): FolderSession => ({ key, agent: "claude", title: `chat ${key}`, cwd: null, running: false, ...over });

test("the everyday list is the panes opened there, in the window's own order", () => {
  const list = [
    session(1, { cwd: "C:\\Users\\X\\Kolux\\Everyday" }),
    session(2, { cwd: "C:\\Users\\X\\Kolux\\repo", view: "C:\\Users\\X\\Kolux\\Everyday" }),
    session(3, { cwd: "C:\\Users\\X\\Kolux\\repo" }),
    session(4, { cwd: "C:\\Users\\X\\Kolux\\Everyday", running: true }),
  ];
  expect(everydaySessions(list, "c:/users/x/kolux/everyday/").map((s) => s.key)).toEqual([1, 2, 4]);
  expect(everydaySessions(list, null)).toEqual([]);
});

const kept = (id: string, over: Partial<EverydayChat> = {}): EverydayChat => ({ id, agent: "claude", cwd: "C:\\E", at: 1, ...over });

test("a kept chat and its live tab are one row: the tab is found by the record it draws", () => {
  const list = [kept("a", { at: 20 }), kept("b", { at: 10 }), kept("c", { at: 5 })];
  const panes = [session(7, { record: "b", chat: true }), session(8, { record: "gone" })];
  const got = everydayItems(list, panes);
  expect(got.map((x) => x.chat.id)).toEqual(["a", "b", "c"]);
  expect(got.map((x) => x.pane?.key ?? null)).toEqual([null, 7, null]);
});

test("panes no kept chat owns still draw; panes whose record was deleted are the tab's own row", () => {
  const list = [kept("a")];
  const panes = [session(1, { record: "a" }), session(2, { chat: true }), session(3, { record: "gone" })];
  expect(everydayUnkept(panes, list).map((s) => s.key)).toEqual([2, 3]);
  expect(everydayUnkept(panes, [])).toBe(panes);
});

const ai = (id: string, name: string, installed = true) => ({ id, name, installed });
const models: Record<string, { id: string; label: string }[]> = {
  claude: [
    { id: "opus", label: "Claude Opus" },
    { id: "sonnet", label: "Claude Sonnet" },
    { id: "default", label: "Program default" },
  ],
  codex: [
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
    { id: "default", label: "Program default" },
  ],
  gemini: [{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }],
  aider: [],
};
const modelsOf = (id: string) => models[id] ?? [];

test("the New session menu offers every installed AI, the chat page's AIs first", () => {
  const list = [ai("codex", "Codex"), ai("claude", "Claude Code"), ai("openclaude", "OpenClaude"), ai("gemini", "Gemini CLI", false), ai("aider", "Aider"), ai("grok", "Grok")];
  const got = everydayAgents(list, modelsOf);
  expect(got.map((x) => x.agent)).toEqual(["claude", "openclaude", "codex", "aider", "grok"]);
  // Claude and OpenClaude draw the chat page; Codex opens its own screen.
  expect(got.map((x) => x.chat)).toEqual([true, true, false, false, false]);
  expect(got[0].models.map((m) => m.id)).toEqual(["opus", "sonnet", "default"]);
  expect(got[2].name).toBe("Codex");
});

test("an AI with no model list still starts, on its own default; one not installed is left out", () => {
  const got = everydayAgents([ai("aider", "Aider"), ai("gemini", "Gemini CLI", false)], modelsOf);
  expect(got.map((x) => x.agent)).toEqual(["aider"]);
  expect(got[0].models).toEqual([]);
  expect(everydayAgents([], modelsOf)).toEqual([]);
});

