// @vitest-environment happy-dom
// USAGE-019 / usage-status.md:9 on a real DOM: the share dialog is a src/ui Dialog that draws the card, offers Copy
// image, the one shared Share on X button and Close, takes focus, keeps Tab inside, and closes on Escape from anywhere
// with focus handed back to the Share button that opened it.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import ShareCard from "./ShareCard";
import type { Row } from "./tokens";
import { byLabel, byText, click, find, fire, installDom, mount, settle, until, type FakeNode } from "../tasks/realDom";

const row = (day: string, p: Partial<Row> = {}): Row => ({ day, session: "s1", model: "claude-opus-4-8", cwd: "", band: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 0, ...p });
const today = new Date(2026, 9, 19, 12);

// happy-dom has no 2D canvas: a stand-in context records the text the card draws.
const drawn: string[] = [];
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k === "fillText" ? (s: string) => void drawn.push(s) : k === "measureText" ? () => ({ width: 10 }) : k in t ? t[k] : () => ({ addColorStop: () => {} })),
  set: (t, k, v) => ((t[k] = v), true),
});
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  installDom();
  drawn.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    (ctx as { canvas?: HTMLCanvasElement }).canvas = this;
    return ctx as unknown as CanvasRenderingContext2D;
  });
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  vi.restoreAllMocks();
});

test("USAGE-019 / usage-status.md:9: the dialog draws the card, has its four buttons, keeps focus in, and Escape hands focus back to Share", async () => {
  const closed = vi.fn();
  function Page() {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      null,
      createElement("button", { id: "share", onClick: () => setOpen(true) }, "Share"),
      open && createElement(ShareCard, { provider: "claude", rows: [row("2026-10-19", { input: 1000 })], range: "30", today, onClose: () => (closed(), setOpen(false)) }),
    );
  }
  const m = await mount(createElement(Page));
  unmount = m.unmount;
  const c = m.container;
  const share = find(c, (n) => n.id === "share")[0] as HTMLButtonElement;
  share.focus();
  await click(c, share);
  await until(() => byLabel(c, "div", "Share Claude usage").length === 1, "the share dialog");
  const box: FakeNode = byLabel(c, "div", "Share Claude usage")[0];
  expect(box.getAttribute("role")).toBe("dialog");
  expect(box.getAttribute("aria-modal")).toBe("true");
  expect(find(box, (n) => n.localName === "canvas")).toHaveLength(1);
  await until(() => drawn.length > 0, "the card drawn on its canvas");
  expect(drawn.join(" ")).toContain("Claude");
  for (const label of ["Copy image", "Share on X", "Close"]) expect(byText(box, "button", label), label).toHaveLength(1);

  // Focus is inside; Base UI's focus guards sit around it, so Tab cannot leave.
  expect(box.contains(document.activeElement)).toBe(true);
  expect(find(c, (n) => n.hasAttribute("data-base-ui-focus-guard")).length).toBeGreaterThanOrEqual(2);

  // Escape from anywhere closes it and focus goes back to Share.
  await fire(c, "keydown", document.body, { key: "Escape" });
  await settle();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(byLabel(c, "div", "Share Claude usage")).toHaveLength(0);
  expect(document.activeElement).toBe(share);
});
