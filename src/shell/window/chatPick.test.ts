import { expect, test } from "vitest";
import type { Pane } from "../../App";
import { layoutOf } from "../../terminal/layout";
import { withChatPick } from "./chatPick";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const src = (p: string) => nodeFs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const chat = (key: number, extra: Partial<Pane> = {}): Pane => ({ key, cwd: "C:\w\a", branch: null, agent: "claude", program: "claude", args: [], chat: true, ...extra });

test("a model or effort picked in a chat lands on that pane, and the saved layout carries it", () => {
  const ps = [chat(1), chat(2)];
  const next = withChatPick(withChatPick(ps, 1, { model: "some/model" }), 1, { effort: "high" });
  expect(next[0]).toMatchObject({ chatModel: "some/model", chatEffort: "high" });
  expect(next[1]).toBe(ps[1]);
  const saved = layoutOf(next as never, {}, 1, "C:\w\a", {});
  expect(saved.panes[0]).toMatchObject({ chat: true, chatModel: "some/model", chatEffort: "high" });
});

test("the default model clears the pane's model, and an unchanged pick returns the same pane", () => {
  const ps = [chat(1, { chatModel: "m", chatEffort: "low" })];
  expect(withChatPick(ps, 1, { model: null })[0].chatModel).toBeUndefined();
  expect(withChatPick(ps, 1, { effort: "low" })[0]).toBe(ps[0]);
});

test("the window wires the model and effort handlers to the pane, not only to the kept record", () => {
  const pane = src("./Pane.tsx");
  expect(pane).toMatch(/chatModel: \(model: string \| null\) => \{[\s\S]{0,300}?withChatPick\(ps, p\.key, \{ model \}\)/);
  expect(pane).toMatch(/chatEffort: \(effort: string \| null\) => \{[\s\S]{0,300}?withChatPick\(ps, p\.key, \{ effort \}\)/);
});

test("ChatPane: a gone conversation is forgotten, a re-run during the history read gives the start back, and a pick restarts without a separate end", () => {
  const code = src("../../chat/live/ChatPane.tsx");
  // 1. the failed history read clears the pane's own id, and a restart only ever resumes that id
  // (setSession writes sessionId.current; this assertion was stale at 72e680ac, which also called setSession here)
  expect(code).toMatch(/else \{[^}]*setSession\(null\);[^}]*pick = null;/);
  expect(code).not.toMatch(/sessionId\.current \?\? resume/);
  expect(code).toMatch(/startChat\(chatId, cwd, next\.model, agent, sessionId\.current, next\.effort\)/);
  // 3. a stale run after the history read releases `started` and asks for another run
  expect(code).toMatch(/if \(!live\) \{[^}]*started\.current = false;[^}]*setAgain\(/);
  // 4. Engines::start closes the old process, so applyChoice does not end it first
  const choice = code.slice(code.indexOf("const applyChoice"), code.indexOf("const send ="));
  expect(choice).not.toContain("endChat(");
  expect(src("../../../src-tauri/src/chat_engine/mod.rs")).toMatch(/pub fn start\([\s\S]*?self\.close\(chat_id\);/);
});
