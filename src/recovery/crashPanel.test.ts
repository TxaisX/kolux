// UX: the crash report's Copy Details and Open on GitHub wait for the details to load.
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// The panel is a src/ui Dialog, drawn only on a real DOM; what it shows is read here through a stand-in.
vi.mock("../ui/Dialog", async () => (await import("../tasks/dialogStandIn")).dialogModule);
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

it("is the shared src/ui Dialog: Tab stays inside, focus starts on Not now and goes back on close", () => {
  expect(source).toMatch(/<Dialog\s+onClose=\{\(\) => onClose\(\)\}\s+label="Report a crash"\s+viewport="scrim"\s+initialFocus=\{notNow\}/);
  // autoFocus would run before the Dialog moves focus in, so the hand-back would remember the dialog's own button.
  expect(source).not.toMatch(/\bautoFocus\b/);
  expect(source, "Escape is the Dialog's, not a listener of its own").not.toContain("watchEscape");
});
