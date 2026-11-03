// UX lane A (shell.md row 2): the toast and the notice bar belong to the window, so they draw on every screen,
// not only inside the Terminals block of the content column.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import content from "./Content.tsx?raw";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));

import Notices from "./Notices";

const html = (p: { toast: string | null; notice: string | null; keymapNotice?: string | null }) =>
  renderToString(createElement(Notices, { keymapNotice: null, onDismiss: () => {}, ...p }));

test("the toast and the notice both draw, with a labelled Dismiss", () => {
  const out = html({ toast: "Copied", notice: "Could not save" });
  expect(out).toContain('class="toast"');
  expect(out).toContain("Copied");
  expect(out).toContain('class="notice"');
  expect(out).toContain('aria-label="Dismiss"');
  expect(html({ toast: null, notice: null })).toBe("");
});

test("the shortcuts notice offers the Shortcuts settings button", () => {
  expect(html({ toast: null, notice: "bad key", keymapNotice: "bad key" })).toContain("Shortcuts settings");
  expect(html({ toast: null, notice: "other", keymapNotice: "bad key" })).not.toContain("Shortcuts settings");
});

test("Content mounts the bar once, outside the Terminals block, and draws no toast of its own", () => {
  expect(content.match(/<Notices\b/g)).toHaveLength(1);
  expect(content).not.toContain('className="toast"');
  expect(content).not.toContain('className="notice"');
  // the mount sits before the first `{terminals &&` block, so it is not gated on the screen
  expect(content.indexOf("<Notices")).toBeLessThan(content.indexOf("{terminals &&"));
});
