// PROJ-067: tabs and layout are saved and restored; damaged entries are dropped on their own and
// the active workspace and tab come back while they still exist.
import { expect, test } from "vitest";
import { sessionOrder } from "../sessions/restoreOrder";
import { layoutOf, marksOf, panesWantingListedSession, restoreAsks, restoreLayout, reviveSaved, stillThere, withHintedSession, withListedSession } from "./layout";

const shell = (key: number, cwd: string | null, extra: Record<string, unknown> = {}) => ({ key, cwd, branch: null, agent: "shell" as const, program: null, args: [], ...extra });

test("proj067: what is written down is each started tab, stripped to what a restart can rebuild", () => {
  const panes = [
    shell(1, null),
    { ...shell(2, "C:\\w\\a"), agent: "claude" as const, agentId: "claude", program: "claude", args: ["--prompt", "do the thing"], env: [["X", "1"]], typed: "do", task: "t", account: "acct-1", title: "Claude", group: 2 },
    shell(3, "C:\\w\\a", { seats: [{}] }), // a chooser never started
    shell(4, "C:\\w\\b", { kind: "editor", path: "C:\\w\\b\\README.md", group: 4 }),
    shell(5, "C:\\w\\b", { kind: "browser" }),
  ];
  const l = layoutOf(panes, { 1: 1, 2: 2, 4: 4, 9: 3 }, 2, "C:\\w\\a", { "C:\\w\\b": true });
  expect(l.panes.map((p) => p.key)).toEqual([1, 2, 3, 4, 5]);
  expect(l.panes[2]).toEqual({ key: 3, cwd: "C:\\w\\a", branch: null, agent: "shell", program: null, args: [], chooser: true }); // an unstarted chooser keeps its place as an empty chooser
  expect(l.panes[1]).toEqual({ key: 2, cwd: "C:\\w\\a", branch: null, agent: "claude", agentId: "claude", program: "claude", args: [], account: "acct-1", title: "Claude", group: 2 });
  expect(l.panes[3]).toEqual({ key: 4, cwd: "C:\\w\\b", branch: null, agent: "shell", program: null, args: [], group: 4, kind: "editor", path: "C:\\w\\b\\README.md" });
  expect(l.activeTab).toEqual({ 1: 1, 2: 2, 4: 4, 9: 3 });
  expect(l.focused).toBe(2);
  expect(l.activeDir).toBe("C:\\w\\a");
  expect(l.stacked).toEqual({ "C:\\w\\b": true });
  // The round trip is the identity.
  expect(restoreLayout(JSON.parse(JSON.stringify(l)))).toEqual(l);
});

test("proj067: a damaged entry is dropped and the other tabs still come back", () => {
  const saved = {
    panes: [
      shell(1, null),
      "garbage",
      { key: "two", cwd: null, branch: null, agent: "shell", program: null, args: [] }, // no key
      { ...shell(3, "C:\\w\\a"), agent: "gemini" }, // unknown agent
      { ...shell(4, "C:\\w\\a"), kind: "editor" }, // an editor tab without a path
      { ...shell(5, "C:\\w\\a"), args: [1, 2] },
      { ...shell(6, "C:\\w\\a"), kind: "diff", path: "x.ts", staged: true, group: 6, title: 7 },
      shell(6, "C:\\w\\c"), // a repeated key: the first one stands
    ],
    activeTab: { 1: 1, 6: 6, 7: 3, 8: "x" },
    focused: 3, // the dropped one
    activeDir: "C:\\w\\a",
    stacked: { "C:\\w\\a": true, "C:\\w\\b": "yes" },
  };
  const l = restoreLayout(saved)!;
  expect(l.panes.map((p) => p.key)).toEqual([1, 6]);
  expect(l.panes[1]).toEqual({ key: 6, cwd: "C:\\w\\a", branch: null, agent: "shell", program: null, args: [], group: 6, kind: "diff", path: "x.ts", staged: true });
  expect(l.activeTab).toEqual({ 1: 1, 6: 6 });
  expect(l.focused).toBe(6); // the first tab of the active workspace
  expect(l.stacked).toEqual({ "C:\\w\\a": true });
  expect(restoreLayout(null)).toBeNull();
  expect(restoreLayout("{}")).toBeNull();
  expect(restoreLayout({ panes: ["x", 1] })).toBeNull();
  expect(restoreLayout({ panes: [shell(1, null)], focused: "1", activeDir: 5 })).toEqual({ panes: [shell(1, null)], activeTab: {}, focused: 1, activeDir: null, stacked: {} });
});

test("proj067: the active workspace and tab come back when they still exist, else the tabs in a gone folder go", () => {
  const l = restoreLayout({ panes: [shell(1, null), shell(2, "C:\\w\\a"), shell(3, "C:\\w\\b"), shell(4, "C:\\w\\b")], activeTab: { 1: 1, 2: 2, 3: 4 }, focused: 4, activeDir: "C:\\w\\b", stacked: {} })!;
  const same = stillThere(l, () => true);
  expect(same).toEqual(l);
  expect(same.activeDir).toBe("C:\\w\\b");
  expect(same.focused).toBe(4);
  const gone = stillThere(l, (d) => d !== "C:\\w\\b");
  expect(gone.panes.map((p) => p.key)).toEqual([1, 2]);
  expect(gone.activeDir).toBeNull();
  expect(gone.focused).toBe(1); // the home tab, since the active workspace is gone
  expect(gone.activeTab).toEqual({ 1: 1, 2: 2 });
});

test("acct063: two saved tabs holding one session resume it once (the newest keeps it); a fork is not resumed as its source", () => {
  const agent = (key: number, extra: Record<string, unknown>) => ({ key, cwd: "C:\\w\\a", branch: "main", agent: "claude" as const, agentId: "claude", program: "claude", args: [], ...extra });
  const saved = { panes: [agent(2, { session: "s-1" }), agent(5, { session: "s-1" }), agent(6, { forkOf: "s-1" }), agent(7, { session: "s-1", forkOf: "s-1" })], activeTab: {}, focused: 2, activeDir: null, stacked: {} };
  const back = restoreLayout(saved)!;
  // key 2 and key 5 held the same session; key 7 is a fork that wrongly carries its source's id
  expect(back.panes.map((p) => [p.key, p.session, p.forkOf])).toEqual([[2, undefined, undefined], [5, "s-1", undefined], [6, undefined, "s-1"], [7, undefined, "s-1"]]);
  // the fork record is written down with the tab
  expect(layoutOf([agent(6, { forkOf: "s-1", session: "s-9" })], {}, 6, null, {}).panes[0]).toMatchObject({ forkOf: "s-1", session: "s-9" });
});

test("sess030: an agent tab with a known session comes back resumed, one without comes back at its prompt, never in a picker", () => {
  const claude = { key: 2, cwd: "C:\\w\\a", branch: "main", agent: "claude" as const, agentId: "claude", program: "claude", args: ["--dangerously-skip-permissions", "fix the build"], session: "11111111-aaaa" };
  const codex = { key: 3, cwd: "C:\\w\\a", branch: "main", agent: "codex" as const, agentId: "codex", program: null, args: ["--full-auto"], session: "thr_22" };
  const fresh = { key: 4, cwd: "C:\\w\\a", branch: "main", agent: "claude" as const, agentId: "claude", program: "claude", args: ["hello"] };
  const l = layoutOf([shell(1, null), claude, codex, fresh], { 1: 1, 2: 4 }, 4, "C:\\w\\a", {});
  // The session id is written down; the one-off opening arguments are not.
  expect(l.panes.map((p) => [p.key, p.args, p.session])).toEqual([[1, [], undefined], [2, [], "11111111-aaaa"], [3, [], "thr_22"], [4, [], undefined]]);
  const back = restoreLayout(JSON.parse(JSON.stringify(l)))!;
  // The resume form itself is added by the Rust start line at restore (main.tsx), never here.
  expect(back.panes.map((p) => [p.key, p.args])).toEqual([[1, []], [2, []], [3, []], [4, []]]);
  expect(back.panes[1].session).toBe("11111111-aaaa");
  // A damaged session id is no session: the tab comes back at its prompt, not in the pick-a-session screen.
  const odd = restoreLayout({ panes: [{ ...l.panes[1], session: 7 }], activeTab: {}, focused: 2, activeDir: null, stacked: {} })!;
  expect(odd.panes[0].args).toEqual([]);
  expect(odd.panes[0].session).toBeUndefined();
});

test("T-066-c: the restore loop asks for an agent line only for an agent tab, never a plain shell", () => {
  const ask = (agent: "shell" | "claude" | "codex", agentId: string | undefined, program: string | null, kind?: "editor") => restoreAsks({ agent, agentId, program, kind });
  expect(ask("shell", undefined, null)).toBe(false); // a plain shell
  expect(ask("shell", undefined, "pwsh")).toBe(false); // a shell with its own program, no agent
  expect(ask("shell", "gemini", "gemini")).toBe(true); // a catalogue agent marked as a shell
  expect(ask("claude", "claude", "claude")).toBe(true);
  expect(ask("codex", "codex", null)).toBe(true);
  expect(ask("shell", "gemini", null)).toBe(false); // an unstarted chooser
  expect(ask("claude", "claude", "claude", "editor")).toBe(false); // not a terminal tab
});

test("after723: a layout saved with a pane split in before an older one comes back in the same order, so a relaunch writes the same layout", () => {
  // Split Right of pane 1 puts the new, higher key 3 between 1 and 2: the key order is not the screen order.
  const panes = [shell(1, "C:/w/a"), shell(3, "C:/w/a"), shell(2, "C:/w/a")];
  const l = layoutOf(panes, {}, 3, "C:/w/a", {});
  expect(l.panes.map((p) => p.key)).toEqual([1, 3, 2]);
  const back = restoreLayout(JSON.parse(JSON.stringify(l)))!;
  expect(back.panes.map((p) => p.key)).toEqual([1, 3, 2]);
  expect(JSON.stringify(back)).toBe(JSON.stringify(l));
  // View-107 (T-069-c): the start lines are asked in the order the tabs were opened; main.tsx walks sessionOrder for that.
  expect(sessionOrder(back.panes).map((p) => p.key)).toEqual([1, 2, 3]);
});

test("after100: pinned tabs and tab colours are saved with the layout and come back after a restart", () => {
  const panes = [shell(1, "C:/w/a"), shell(2, "C:/w/a"), shell(3, "C:/w/a")];
  const l = layoutOf(panes, {}, 1, "C:/w/a", {}, { pinned: new Set([2, 99]), colors: { 2: "red", 3: "teal", 1: "no-such-colour", 99: "blue" } });
  expect(l.panes.map((p) => [p.key, p.pinned, p.color])).toEqual([[1, undefined, undefined], [2, true, "red"], [3, undefined, "teal"]]);
  const back = restoreLayout(JSON.parse(JSON.stringify(l)))!;
  expect(back).toEqual(l);
  const marks = marksOf(back.panes);
  expect([...marks.pinned]).toEqual([2]);
  expect(marks.colors).toEqual({ 2: "red", 3: "teal" });
  // A saved layout from before has neither, and a colour that is no longer in the palette is dropped on its own.
  expect(layoutOf(panes, {}, 1, "C:/w/a", {}).panes[0]).not.toHaveProperty("pinned");
  const old = restoreLayout({ panes: [shell(1, "C:/w/a", { color: "mauve", pinned: "yes" }), shell(2, "C:/w/a", { pinned: false, color: 4 })] })!;
  expect(old.panes.map((p) => [p.pinned, p.color])).toEqual([[undefined, undefined], [undefined, undefined]]);
});

test("ux-fix-1: nine panes, four running shells and five empty choosers, come back as nine after a relaunch", () => {
  const panes = [
    ...[1, 2, 3, 4].map((k) => shell(k, "C:\w\a")),
    ...[5, 6, 7, 8].map((k) => shell(k, "C:\w\a", { seats: [{ agent: null, model: null }] })),
    shell(9, "C:\w\a", { agentId: "codex", seats: [{ agent: "codex", model: null }] }),
  ];
  const saved = layoutOf(panes, {}, 1, "C:\w\a", {});
  expect(saved.panes.map((p) => p.key)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const back = restoreLayout(JSON.parse(JSON.stringify(saved)))!;
  expect(back).toEqual(saved); // the next save writes the same layout
  expect(back.panes.map((p) => reviveSaved(p).seats !== undefined)).toEqual([false, false, false, false, true, true, true, true, true]);
  expect(reviveSaved(back.panes[4]).seats).toEqual([{ agent: null, model: null }]);
  expect(reviveSaved(back.panes[8]).seats).toEqual([{ agent: "codex", model: null }]);
  expect(restoreAsks(back.panes[8])).toBe(false); // a chooser asks for no start line
});

test("T-066-e: the panes whose session the agent's own sessions list is asked for: started id-only agent tabs with no id, never a hook-fed or a settled one; `taken` holds every id the other panes hold", () => {
  const cursor = { ...shell(2, "C:\\w\\a"), agentId: "cursor", program: "cursor" };
  const cursorKnown = { ...shell(3, "C:\\w\\a"), agentId: "cursor", program: "cursor", session: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b" };
  const claude = { ...shell(4, "C:\\w\\a"), agent: "claude" as const, agentId: "claude", program: "claude" }; // its hooks report the id
  const codexKnown = { ...shell(5, "C:\\w\\a"), agent: "codex" as const, agentId: "codex", program: null, session: "thr_22" };
  const goose = { ...shell(6, "C:\\w\\b"), agentId: "goose", program: "goose" };
  const gooseFork = { ...shell(7, "C:\\w\\b"), agentId: "goose", program: "goose", forkOf: "20261013_080000_b2" };
  const chooser = shell(8, "C:\\w\\a", { seats: [{ agent: "cursor", model: null }], agentId: "cursor" }); // pre-picked, never started
  const editor = shell(9, "C:\\w\\a", { kind: "editor", path: "C:\\w\\a\\x.md", agentId: "cursor" });
  const nowhere = { ...shell(10, null), agentId: "cursor", program: "cursor" };
  const plain = shell(11, "C:\\w\\a");
  const kiro = { ...shell(12, "C:\\w\\a"), agentId: "kiro", program: "kiro-cli" }; // no sessions command: nothing to ask
  const want = panesWantingListedSession([shell(1, null), cursor, cursorKnown, claude, codexKnown, goose, gooseFork, chooser, editor, nowhere, plain, kiro]);
  expect(want.asks).toEqual([
    { key: 2, agent: "cursor", folder: "C:\\w\\a" },
    { key: 6, agent: "goose", folder: "C:\\w\\b" },
    { key: 7, agent: "goose", folder: "C:\\w\\b" },
  ]);
  // Every id a pane holds, and the session a fork came from (a fork is never resumed as its source).
  expect(want.taken).toEqual(["3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b", "thr_22", "20261013_080000_b2"]);
  expect(panesWantingListedSession([claude, codexKnown, plain])).toEqual({ asks: [], taken: ["thr_22"] });
});

test("T-066-e (review): a listed id is a guess until the agent names its own: the pane is asked again with its guess left out, a newer listed id replaces it, the agent's exit hint wins over it, and a hook's or hint's id is never replaced", () => {
  const S1 = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
  const S2 = "7d1e4a90-2b3c-4d5e-9f01-a2b3c4d5e6f7";
  const S3 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const fresh: (Omit<ReturnType<typeof shell>, "program"> & { agentId: string; program: string; session?: string; sessionListed?: boolean })[] = [{ ...shell(2, "C:\\w\\a"), agentId: "cursor", program: "cursor" }, { ...shell(3, "C:\\w\\a"), agentId: "cursor", program: "cursor" }];
  // The folder's newest older session is put on the pane as a guess (the agent made none yet).
  const guessed = withListedSession(fresh, 2, S1);
  expect(guessed[0]).toMatchObject({ session: S1, sessionListed: true });
  expect(guessed[1].session).toBeUndefined();
  // Never written down: a restored tab really runs that id, so it is a hook-grade id then.
  expect(layoutOf(guessed, {}, 2, "C:\\w\\a", {}).panes[0]).not.toHaveProperty("sessionListed");
  // Asked again: its own guess is left out of its ask (so the same or a newer id can come back) but stays in `taken` for the others.
  expect(panesWantingListedSession(guessed)).toEqual({ asks: [{ key: 2, agent: "cursor", folder: "C:\\w\\a", own: S1 }, { key: 3, agent: "cursor", folder: "C:\\w\\a" }], taken: [S1] });
  // A newer listed id (the one the agent created meanwhile) replaces the guess; the same id again changes nothing.
  expect(withListedSession(guessed, 2, S2)[0]).toMatchObject({ session: S2, sessionListed: true });
  expect(withListedSession(guessed, 2, S1)[0]).toEqual(guessed[0]);
  // The agent's own exit hint wins over the guess and settles the pane: not asked again, not replaced by a list.
  const hinted = withHintedSession(guessed, 2, S3);
  expect(hinted[0].session).toBe(S3);
  expect(hinted[0].sessionListed).toBeFalsy();
  expect(panesWantingListedSession(hinted).asks).toEqual([{ key: 3, agent: "cursor", folder: "C:\\w\\a" }]);
  expect(withListedSession(hinted, 2, S2)[0].session).toBe(S3);
  // A hint lands on a pane with no id too, and never over a settled id (a hook's, or an earlier hint).
  expect(withHintedSession(fresh, 3, S2)[1].session).toBe(S2);
  expect(withHintedSession(hinted, 2, S1)[0].session).toBe(S3);
  // Another pane is never touched.
  expect(withHintedSession(guessed, 3, S3)[0]).toEqual(guessed[0]);
});
