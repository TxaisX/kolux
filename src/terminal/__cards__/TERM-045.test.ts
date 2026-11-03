// TERM-045 acceptance (window half): what the close question does with the backend's busy answers. The backend half
// (a shell running a program reads busy, an idle shell does not) is src-tauri/tests/cards_03.rs term045_box1_*.
import { expect, test } from "vitest";
import { asksBeforeClose, busyCheck, closeQuestion } from "../closing";
import { cellKeys } from "../tabSplit";

// MIRROR App.tsx closeTab: ids = the keys' sessions; { busy, failed } = asksBeforeClose ? busyCheck(ids, terminal_busy) : none;
// busy === 0 closes at once, otherwise one question built from closeQuestion(name, busy, keys.length, failed).
const decide = async (settings: Record<string, unknown>, ids: number[], name: string, check: (ids: number[]) => Promise<boolean[]>) => {
  const { busy, failed } = asksBeforeClose(settings) ? await busyCheck(ids, check) : { busy: 0, failed: false };
  return busy === 0 ? "close" : closeQuestion(name, busy, ids.length, failed);
};
const backend = (live: Set<number>) => async (ids: number[]) => ids.map((i) => live.has(i)); // terminal_busy: one bool per id

test("box 1: a tab with a running program asks, naming the tab; an idle shell closes with no question", async () => {
  const live = new Set([7]); // session 7 runs the dev server, session 8 is an idle shell
  expect(await decide({}, [7], "dev server", backend(live))).toEqual({ title: "Close “dev server”?", body: "A program is still running in it. Closing the tab stops it." });
  expect(await decide({}, [8], "scratch", backend(live))).toBe("close");
  // the setting off closes without asking; a failed check asks too, worded as unsure (UX audit terminal F3: never kill a program unseen)
  expect(await decide({ confirmCloseRunning: false }, [7], "dev server", backend(live))).toBe("close");
  expect(await decide({}, [7], "dev server", () => Promise.reject(new Error("check failed")))).toEqual({ title: "Close “dev server”?", body: "Kolux could not check whether a program is still running in it. Closing the tab may stop one." });
});

test("box 2: a split tab with two busy panes is one check and one question, not two", async () => {
  const panes = [{ key: 1, group: 1, cwd: "C:/w" }, { key: 2, group: 1, cwd: "C:/w" }, { key: 3, group: 3, cwd: "C:/w" }];
  const keys = cellKeys(panes, 2); // closing the split tab closes its whole cell as one set
  expect(keys).toEqual([1, 2]);
  const ptys: Record<number, number> = { 1: 11, 2: 12, 3: 13 };
  const ids = keys.map((k) => ptys[k]);
  const checks: number[][] = [];
  const check = async (asked: number[]) => (checks.push(asked), asked.map(() => true));
  const answer = await decide({}, ids, "build + watch", check);
  expect(checks).toEqual([[11, 12]]); // one check for both panes
  expect(answer).toEqual({ title: "Close “build + watch”?", body: "A program is still running in 2 of its 2 panes. Closing the tab stops them." });
});
