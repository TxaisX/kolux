// Settings > Usage draws its frame at once: the first open of a session shows the cards' frames while the figures are
// read, and going back to the page draws the last figures straight away while they are read again.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { installDom, mount, settle, type FakeDocument } from "../tasks/fakeDom";

const io = vi.hoisted(() => ({ answer: false }));
const COUNTS = { since: 1, agentsStarted: 3, workingMs: 600_000, prsCreated: 1 };
const USAGE = { tracking: { claude: true, codex: false }, claude: { scannedAt: 1, rows: [], error: null }, codex: null };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (!io.answer) return new Promise(() => {}); // the read has not answered yet
    if (cmd === "activity_counts") return Promise.resolve(COUNTS);
    if (cmd === "token_usage") return Promise.resolve(USAGE);
    if (cmd === "token_usage_scan") return Promise.resolve(USAGE.claude);
    if (cmd === "project_list") return Promise.resolve([]);
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "/w" });
    return Promise.resolve(null);
  },
}));

let doc: FakeDocument;
beforeEach(() => {
  io.answer = false;
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
});

test("the first open draws both cards' frames before the backend answers, not an empty page", async () => {
  const { default: Activity } = await import("./Activity");
  const { default: TokenAnalytics } = await import("./TokenAnalytics");
  expect(renderToString(createElement(Activity))).toContain('data-activity="loading"');
  expect(renderToString(createElement(TokenAnalytics))).toContain('data-ta="loading"');
});

test("going back to the page draws the figures read last time at once, before the new read answers", async () => {
  const { default: Activity } = await import("./Activity");
  const { default: TokenAnalytics } = await import("./TokenAnalytics");
  io.answer = true;
  const a = await mount(createElement(Activity), doc);
  const t = await mount(createElement(TokenAnalytics), doc);
  await settle(80);
  await a.unmount();
  await t.unmount();
  io.answer = false; // the next read is slow
  expect(renderToString(createElement(Activity))).toContain("Agents started");
  const html = renderToString(createElement(TokenAnalytics));
  expect(html).not.toContain('data-ta="loading"');
  expect(html).toContain("Claude");
});
