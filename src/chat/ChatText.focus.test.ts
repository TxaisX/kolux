import { expect, test } from "vitest";
import chatText from "./ChatText.tsx?raw";
import chatView from "./ChatView.tsx?raw";

// Vitest returns "" for a .css import, so the stylesheet is read from disk (same as railWidth.test.ts).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("./chat.css", import.meta.url), "utf8");

test("a link opened in the system browser puts focus back on the link; only an in-app pane keeps it", () => {
  // The choice is a src/ui menu: focus goes back to what had it (the link) unless the pick moved it into a pane; on a
  // real DOM in BrowserChoice.dom.test.tsx.
  expect(chatText).toContain("<ContextMenu at={at}");
  expect(chatView).toContain('const inApp = where === "kolux" && !!opener?.onOpenLink;');
  expect(chatView).toContain("return inApp;");
});

test("the zoom announcement stays in the accessibility tree while empty", () => {
  expect(chatView).not.toMatch(/className="chat-zoom"[^>]*hidden/);
  expect(css).toContain(".chat-zoom:empty");
});
