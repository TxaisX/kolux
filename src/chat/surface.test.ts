// The chat surface's design contract (2026-11-20): the pane is a page, not a terminal. These rules are
// what keep it that way. They read the stylesheet rather than a rendered DOM, the way the glass tests do,
// because the surface is a set of layout and type decisions, not behaviour.
import { expect, test } from "vitest";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const raw = nodeFs.readFileSync(new URL("./chat.css", import.meta.url), "utf8");
/** Only the surface section: everything after its marker comment. */
const surface = raw.slice(raw.indexOf("The chat surface"));
const rules: string[] = surface
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("}")
  .map((r) => r.trim())
  .filter(Boolean);
/** What a rule sets one property to (its last declaration of it, as CSS reads it). */
const decl = (rule: string, prop: string) => [...rule.slice(rule.indexOf("{") + 1).matchAll(new RegExp(`(?:^|;)\\s*${prop}:([^;]+)`, "g"))].pop()?.[1].replace(/\s+/g, " ").trim();
/** The rule that sets this exact selector (a comma list counts for every selector in it). */
const ruleFor = (selector: string) =>
  rules.find((r) => r.slice(0, r.indexOf("{")).split(",").map((s) => s.trim()).includes(selector));
const rule = (selector: string) => {
  const r = ruleFor(selector);
  expect(r, `no rule for ${selector}`).toBeTruthy();
  return r!;
};

test("a chat pane is the page: no inner card and no bar of its own", () => {
  expect(decl(rule(".chat.chat-surface"), "margin")).toBe("0");
  expect(decl(rule(".chat.chat-surface"), "border")).toBe("0");
  expect(decl(rule(".chat.chat-surface"), "border-radius")).toBe("0");
  expect(decl(rule(".chat.chat-surface"), "background")).toBe("transparent");
  expect(decl(rule(".chat-pane > .pane-head"), "border-bottom"), "the pane bar has no rule under it").toBe("0");
});

test("the transcript keeps a readable 720 px measure and consumer type sizes", () => {
  const list = rule(".chat.chat-surface .chat-list");
  expect(decl(list, "padding"), "the column is centred with max(), never stretched").toContain("720px");
  expect(decl(list, "padding")).toContain("max(");
  const msg = rule(".chat.chat-surface .chat-msg");
  expect(decl(msg, "font-size")).toBe("15.5px");
  expect(decl(msg, "line-height")).toBe("1.62");
  expect(decl(rule(".chat-welcome-title"), "font-size")).toBe("22px");
});

test("the composer is one floating card with a borderless field inside it", () => {
  const box = rule(".chat.chat-surface .chat-composer");
  expect(decl(box, "border-radius")).toBe("26px");
  expect(decl(box, "background")).toBe("var(--surface)");
  expect(decl(rule(".chat.chat-surface .chat-box"), "border")).toBe("0");
  expect(decl(rule(".chat.chat-surface .chat-box"), "background")).toBe("transparent");
  expect(decl(rule(".chat.chat-surface .chat-send"), "border-radius")).toBe("999px");
});

test("only the user's turn is a bubble; Claude's reply is the page", () => {
  expect(decl(rule(".chat.chat-surface .chat-msg.user .chat-text"), "border-radius")).toBe("18px");
  expect(ruleFor(".chat.chat-surface .chat-msg.assistant .chat-text"), "the assistant has no bubble").toBeUndefined();
});

test("the welcome offers three plain starters", () => {
  expect(decl(rule(".chat-welcome"), "text-align")).toBe("center");
  expect(decl(rule(".chat-starters button"), "border-radius")).toBe("999px");
});

test("the surface is painted from theme tokens, never a raw colour", () => {
  const lit = surface.replace(/\/\*[\s\S]*?\*\//g, "").replace(/rgb\([^)]*\)/g, "");
  expect(lit.match(/#[0-9a-f]{3,8}\b/gi) ?? [], "a hex colour would ignore every theme").toEqual([]);
});
