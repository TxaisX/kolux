// T-748 (DT-C184): visual consistency. The status bar draws the shared terminal glyph, the warning
// yellow and the dim scrim come from tokens, and labels are in sentence case.
import { expect, test } from "vitest";
import statusBar from "./StatusBar.tsx?raw";
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
import terminalPage from "../settings/TerminalPage.tsx?raw";
import shortcutsPage from "../settings/ShortcutsPage.tsx?raw";
import { searchSettings } from "../settings/search";

test("T-748: the status bar's terminal count uses the shared Shell glyph, not typed text", () => {
  expect(statusBar).not.toContain("&gt;_");
  expect(statusBar).toContain("<Shell size={12} />");
});

test("T-748: the warning yellow and the scrim are tokens, so light themes can change them", () => {
  // CSS ?raw imports come through empty under the test config, so the sheets are read from disk.
  const [styles, chat] = ["../styles.css", "../chat/chat.css"].map((p) => nodeFs.readFileSync(new URL(p, import.meta.url), "utf8"));
  expect(styles.length).toBeGreaterThan(1000);
  expect(styles).not.toMatch(/#fdc030/i);
  expect(styles).toContain("--scrim:");
  for (const rule of [/\.scrim \{[^}]*\}/, /\.ask-backdrop \{[^}]*\}/]) expect(styles.match(rule)?.[0]).toContain("var(--scrim)");
  expect(chat.match(/\.chat-full \{[^}]*\}/)?.[0]).toContain("var(--scrim)");
});

test("T-748: settings labels are in sentence case, and search still finds the renamed switch", () => {
  expect(terminalPage).toContain('"Ask before closing running terminals"');
  expect(shortcutsPage).toMatch(/>\s*Reload from disk\s*</);
  expect(searchSettings("Ask before closing")!.pages.find((p) => p.page === "terminal")?.sections).toContain("closing");
});
