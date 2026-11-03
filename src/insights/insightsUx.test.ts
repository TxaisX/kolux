// @vitest-environment node
// UX audit findings/usage-status.md rows 6 and 20 on the Insights panel.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { MoreSessions, TrackingOff } from "./InsightsPanel";
import source from "./InsightsPanel.tsx?raw";
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("./insights.css", import.meta.url), "utf8");

test('usage-status.md:6: "Turn it on in Settings → Usage" is a button, wired to open the Usage page of Settings', () => {
  const html = renderToStaticMarkup(createElement(TrackingOff, { onOpen: () => {} }));
  expect(html).toMatch(/<button[^>]*type="button"[^>]*class="ins-link"[^>]*>Turn it on in Settings → Usage<\/button>/);
  expect(source).toContain('<TrackingOff onOpen={() => openSettings("usage")} />');
  expect(source).toContain('import { openSettings } from "../settings/pages";');
  expect(css).toContain(".ins-link");
});

test("usage-status.md:20: more sessions than the eight shown add a link to Usage, and nothing when all are shown", () => {
  const html = renderToStaticMarkup(createElement(MoreSessions, { total: 23, shown: 8, onOpen: () => {} }));
  expect(html).toContain("See all 23 sessions in Usage");
  expect(renderToStaticMarkup(createElement(MoreSessions, { total: 8, shown: 8, onOpen: () => {} }))).toBe("");
  expect(source).toContain('<MoreSessions total={all.length} shown={SESSION_ROWS} onOpen={() => openSettings("usage")} />');
});
