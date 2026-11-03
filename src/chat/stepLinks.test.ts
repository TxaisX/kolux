// UX: a link in tool output goes the way a link in a reply goes (the Open links in Kolux setting, the browser choice).
import { expect, it, vi } from "vitest";
import type { MouseEvent } from "react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
import { invoke } from "@tauri-apps/api/core";
import { openLink } from "./StepRows";
import type { LinkHost } from "./ChatText";

const click = (href: string, ctrlKey = false): MouseEvent =>
  ({ target: { closest: () => ({ getAttribute: () => href }) }, preventDefault() {}, ctrlKey, metaKey: false, shiftKey: false, clientX: 4, clientY: 5 }) as unknown as MouseEvent;
const host = (extra: Partial<LinkHost> = {}): LinkHost => ({ cwd: null, printed: new Set(), mac: false, inKolux: false, say() {}, chooseBrowser() {}, ...extra });

it("a plain click asks which browser, like a link in a reply", () => {
  const asked: string[] = [];
  openLink(click("https://example.com/a"), host({ onOpenLink() {}, chooseBrowser: (u) => void asked.push(u) }));
  expect(asked).toEqual(["https://example.com/a"]);
});

it("opens in Kolux's viewer on the link modifier when the setting says so", () => {
  const opened: string[] = [];
  openLink(click("https://example.com/a", true), host({ inKolux: true, onOpenLink: (u) => void opened.push(u) }));
  expect(opened).toEqual(["https://example.com/a"]);
});

it("says why in the box when the system browser could not be opened", async () => {
  const said: string[] = [];
  vi.mocked(invoke).mockRejectedValueOnce("no browser");
  openLink(click("https://example.com/b"), host({ say: (n) => void said.push(n) }));
  await new Promise((r) => setTimeout(r, 0));
  expect(said).toEqual(["no browser"]);
});

it("ignores a link that is not a web address", () => {
  const opened: string[] = [];
  openLink(click("file:///etc/x"), host({ onOpenLink: (u) => void opened.push(u), inKolux: true }));
  expect(opened).toEqual([]);
});
