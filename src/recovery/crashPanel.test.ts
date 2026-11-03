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
