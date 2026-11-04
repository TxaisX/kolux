// C24-R1-01: a tab that came back from the saved layout and could not take its terminal back keeps
// its place. Dropping it rewrote the layout without its key, and the next start pruned its saved
// transcript (main.tsx terminal_prune_history). The decision is one pure rule; the layout test pins
// the consequence with the real save/restore code, and the source pin keeps the pane on that rule.
import { expect, test } from "vitest";
import { withoutFailed } from "../launch/seats";
import { layoutOf, restoreLayout } from "./layout";
import { keepsTab } from "./restoreAsk";
import pane from "./TerminalPane.tsx?raw";

const timeout = { kind: "timeout" as const, waited: 3000, reason: "the terminal service did not answer within 3 s" };
const refused = { kind: "refused" as const, reason: "the terminal service speaks protocol 0; this window needs 1 or newer" };
const attached = { kind: "attached" as const, id: 7, service: { generation: 1, protocol: 1 } };

test("C24-R1-01: a restored tab whose reattach timed out or was refused keeps its tab; a fresh one still drops", () => {
  expect(keepsTab(timeout, true)).toBe(true);
  expect(keepsTab(refused, true)).toBe(true);
  expect(keepsTab(timeout, false)).toBe(false); // a fresh tab with no terminal to take back is SESS-024
  expect(keepsTab(refused, false)).toBe(false);
  expect(keepsTab(attached, true)).toBe(false); // it came back: nothing to keep it for
});

test("C24-R1-01: the layout keeps the key of a tab that could not reattach, so its saved output is not pruned", () => {
  const saved = restoreLayout({
    panes: [
      { key: 1, cwd: "C:\\w", branch: null, agent: "shell", program: null, args: [] },
      { key: 2, cwd: "C:\\w", branch: null, agent: "claude", agentId: "claude", program: "claude", args: [] },
      { key: 3, cwd: "C:\\w", branch: null, agent: "claude", agentId: "claude", program: "claude", args: [] },
    ],
    activeTab: { 1: 1 },
    focused: 1,
    activeDir: "C:\\w",
    stacked: {},
  })!;
  const failed = 3;
  // The window's panes after the answer: kept when the rule says so, dropped by SESS-024 otherwise.
  const kept = keepsTab(timeout, true) ? saved.panes : withoutFailed(saved.panes, failed).panes;
  const written = layoutOf(kept, saved.activeTab, saved.focused, saved.activeDir, saved.stacked);
  expect(written.panes.map((p) => p.key)).toEqual([1, 2, 3]); // today it is [1, 2], and 3's .log goes at the next start
  // The other answer is the defect, so the test says what it would have written.
  expect(layoutOf(withoutFailed(saved.panes, failed).panes, saved.activeTab, saved.focused, saved.activeDir, saved.stacked).panes.map((p) => p.key)).toEqual([1, 2]);
});

test("C24-R1-01: the pane branches on restored, keeps the tab with a reason and a Try again, and never fails it", () => {
  const at = pane.indexOf("if (!keepsTab(back, restored))");
  expect(at).toBeGreaterThan(-1);
  const branch = pane.slice(at, at + 700);
  expect(branch).toContain("setRestoreAsk(back.reason)");
  expect(branch).toContain("restoreFailed.current?.()");
  // The drop path is still there for a fresh tab, and only for it.
  expect(branch).toContain("fail(back.reason)");
  expect(branch.indexOf("keepsTab(back, restored)")).toBeLessThan(branch.indexOf("fail(back.reason)"));
  // The body notice offers the retry and the close, and the retry asks the service again.
  expect(pane).toContain("This tab's terminal did not come back");
  expect(pane).toContain("Try again");
  expect(pane).toContain("retryRestore.current = () =>");
});
