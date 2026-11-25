// The Open WebUI screen as a whole (2026-11-24): the pieces mount and draw the history column, the top model
// picker and the welcome; the chat pane puts them together on the one OpenCode engine; and the page's CSS
// keeps to the theme's tokens. Playwright is not installed here, so the render check is a server render of the
// real components plus a read of the pane's source and stylesheet.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import pane from "../live/ChatPane.tsx?raw";
import { DEFAULT_CHAT_MODEL, type ChatModel, type ChatSessionSummary } from "../opencode";
import { HistoryView } from "./HistoryColumn";
import { ModelPopover } from "./ModelPopover";
import { Suggestions, Welcome } from "./WelcomeView";

// A stylesheet is read from disk, as surface.test.ts does: a `?raw` import of CSS comes back empty under vitest.
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../chat.css", import.meta.url), "utf8");
const section = css.slice(css.indexOf("The Open WebUI screen"));

describe("the screen draws", () => {
  it("a history column, a top model picker and a welcome with chips", () => {
    // Drawn from fixed lists: the real engine answers over Tauri, which a node test has no window for.
    const models: ChatModel[] = [{ id: DEFAULT_CHAT_MODEL, label: "DeepSeek V4.1 Flash", provider: "deepseek", efforts: [] }];
    const sessions: ChatSessionSummary[] = [{ id: "s1", title: "Why does the build fail", updatedAt: Date.now() }];
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(HistoryView, { mode: "full", sessions, now: Date.now(), activeId: null, query: "", asking: null, onQuery() {}, onNew() {}, onOpen() {}, onAskDelete() {}, onCancelDelete() {}, onDelete() {}, onToggle() {} }),
        createElement(ModelPopover, { models, value: DEFAULT_CHAT_MODEL, onPick() {} }),
        createElement(Welcome, { label: "Claude Sonnet 5.5", provider: "anthropic", starting: false }),
        createElement(Suggestions, { onFill() {} }),
      ),
    );
    expect(html).toContain('aria-label="Chat history"');
    expect(html).toContain("New chat");
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain("chat-welcome-title");
    expect(html.match(/chat-starters/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*>(Explain this project|Find a bug|Suggest an improvement)</g)).toHaveLength(3);
  });

  it("the model picker is closed until it is asked, and names the model the chat is on", () => {
    const html = renderToStaticMarkup(createElement(ModelPopover, { models: [], value: "openrouter/anthropic/claude-opus-5.5", onPick() {} }));
    expect(html).toContain("claude-opus-5.5");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });
});

describe("the chat pane puts the screen together", () => {
  it("has the column, the picker on top, the welcome and the chips that fill the box", () => {
    for (const piece of ["<HistoryColumn", "<ModelPopover", "<Welcome", "<Suggestions", "<EffortPicker"]) expect(pane, piece).toContain(piece);
    expect(pane).toContain("composer.current?.fill(text)");
    expect(pane, "a chip no longer sends").not.toMatch(/Explain what this project does/);
  });
  it("keeps one Composer in one place, so a draft survives the first send", () => {
    expect(pane.match(/<Composer\b/g)).toHaveLength(1);
  });
  it("hands the model to the engine by the same restart it always used", () => {
    expect(pane).toMatch(/startChat\(chatId, cwd, next\.model, agent, sessionId\.current, next\.effort\)/);
  });
  it("opens a past chat by reading its history and resuming on its id", () => {
    expect(pane).toMatch(/chatHistory\(agent, cwd, id\)/);
    expect(pane).toMatch(/startChat\(chatId, cwd, choice\.current\.model, agent, id, choice\.current\.effort\)/);
  });
});

describe("the stylesheet", () => {
  it("has the pieces and uses only the theme's colours", () => {
    for (const cls of [".wui-screen", ".wui-history", ".wui-bar", ".wui-pop", ".wui-star", ".wui-effort", '.wui-chat[data-empty="true"]']) expect(section, cls).toContain(cls);
    expect(section, "no raw hex colours").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section, "no gradients").not.toMatch(/gradient\(/);
    expect(section, "no shadows added").not.toMatch(/box-shadow/);
  });
  it("hides the column below 640 px in code, not in a media query that could drift", () => {
    expect(section).not.toMatch(/@media[^{]*max-width/);
  });
});
