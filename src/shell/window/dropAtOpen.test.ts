// Job 68 item 8 (job 63): the updater the ask at open uses to close its own form (Content.tsx) drops a form the ask
// opened and leaves a form opened by hand, run on real values instead of matched in the source.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
import { dropAtOpen } from "./Content";
import type { StartSheet } from "../../launch/startForm";

const form = (atOpen?: boolean) => ({ key: 1, cwd: "C:\w", branch: null, agent: "shell", program: null, args: [], seats: [], ...(atOpen === undefined ? {} : { atOpen }) }) as unknown as StartSheet;

test("job 68: the ask's close drops the Start form it opened at app open", () => {
  expect(dropAtOpen(form(true))).toBeNull();
});

test("job 68: the ask's close leaves a Start form opened by hand, and no form stays no form", () => {
  const byHand = form();
  expect(dropAtOpen(byHand)).toBe(byHand);
  const marked = form(false);
  expect(dropAtOpen(marked)).toBe(marked);
  expect(dropAtOpen(null)).toBeNull();
});
