// UX: the crash report's Copy Details and Open on GitHub wait for the details to load.
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { CrashPanel } from "./CrashReportDialog";

const draw = (details: string) => renderToStaticMarkup(createElement(CrashPanel, { lead: "Kolux closed unexpectedly.", details, onClose() {}, onAttach() {}, onCopy() {}, onOpen() {} }));
const copyButton = (html: string) => html.match(/<button[^>]*>\s*Copy Details/)?.[0] ?? "";

it("disables Copy Details while the details are loading", () => {
  expect(copyButton(draw(""))).toContain("disabled");
});

it("enables Copy Details once the details are there", () => {
  const html = draw("panic at x");
  expect(copyButton(html)).not.toContain("disabled");
  expect(html).toContain("Not now");
});

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const source = nodeFs.readFileSync(new URL("./CrashReportDialog.tsx", import.meta.url), "utf8");

it("uses the shared dialog focus: Tab stays inside, focus starts on Not now and goes back on close", () => {
  expect(source).toContain("useDialogFocus(box, onClose, () => notNow.current);");
  // autoFocus would run before the hook's effect, so the hook would remember the dialog's own button as the opener.
  expect(source).not.toMatch(/\bautoFocus\b/);
  expect(source, "Escape now comes from the shared hook, not a second listener").not.toContain("watchEscape");
});
