import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AgentsPanel from "./AgentsPanel";
import { asListing, MAX_NOTICES, NO_REPORT, notices } from "./notices";
import { remember } from "./refresh";
import { sameShown } from "./redraw";

const row = (over: Record<string, unknown> = {}) => ({ agent: "claude", id: "s1", title: "Fix login", modifiedMs: Date.now() - 120000, bytes: 10, turns: 3, dir: "C:/w", ...over });
const report = (over: Record<string, unknown> = {}) => ({ ...NO_REPORT, ...over });

test("VIEW-090: one unreadable transcript among readable ones gives a skipped count and no error", () => {
  const n = notices(report({ skipped: 1 }), 2);
  expect(n.map((x) => x.text)).toEqual(["1 transcript was unreadable and skipped."]);
  expect(notices(report({ skipped: 3 }), 2)[0].text).toBe("3 transcripts were unreadable and skipped.");
});

test("VIEW-090: skipped transcripts alone never explain an empty list as a missing folder or an error", () => {
  const n = notices(report({ skipped: 2 }), 0);
  expect(n.map((x) => x.id)).toEqual(["skipped"]);
});

test("VIEW-090: an empty list says why when there is no session folder, a cut-short scan and an unreadable source are named", () => {
  expect(notices(report({ noSources: true }), 0).map((x) => x.id)).toEqual(["none"]);
  expect(notices(report({ noSources: true }), 4)).toEqual([]);
  expect(notices(report({ cutShort: true }), 5)[0].text).toContain("cut short");
  expect(notices(report({ unreadable: ["the Codex title index"] }), 5)[0].text).toBe("Could not read the Codex title index.");
});

test("VIEW-090: notices are de-duplicated and capped", () => {
  const many = report({ skipped: 1, cutShort: true, unreadable: ["a", "a", "b", "c"], noSources: true });
  const n = notices(many, 0);
  expect(n.length).toBe(MAX_NOTICES);
  expect(new Set(n.map((x) => x.text)).size).toBe(n.length);
  expect(notices(report({ unreadable: ["a", "a"] }), 1).length).toBe(1);
});

test("VIEW-090: the back end's answer is read in either shape and bad values read as nothing", () => {
  expect(asListing([row()]).sessions.length).toBe(1);
  expect(asListing([row()]).report).toEqual(NO_REPORT);
  expect(asListing({ sessions: [row()], report: { skipped: 2, cutShort: true, unreadable: ["x", 4], noSources: false } }).report).toEqual({ skipped: 2, cutShort: true, unreadable: ["x"], noSources: false });
  expect(asListing(null)).toEqual({ sessions: [], report: NO_REPORT });
  expect(asListing({ sessions: "no", report: { skipped: -3 } }).report.skipped).toBe(0);
});

test("VIEW-090: the Agents tab lists the readable sessions and shows the skipped count", () => {
  const props = { settings: {}, onSave: () => {}, activeDir: "C:/w", projectDirs: [], rescanKey: 0, visible: true, shell: null, onResume: () => {} };
  remember(JSON.stringify([false, ["C:/w"], 200]), { sessions: [row(), row({ id: "s2", title: "Second" })], report: report({ skipped: 1 }) });
  const html = renderToString(createElement(AgentsPanel, props));
  expect(html).toContain("Fix login");
  expect(html).toContain("Second");
  expect(html).toContain("1 transcript was unreadable and skipped.");
  expect(html).not.toContain("could not be read");
});

const shown = { settings: { theme: "dark", sessionListView: { sort: "recent" } } as Record<string, unknown>, activeDir: "C:/w", projectDirs: ["C:/w"], projects: [{ path: "C:/w" }], rescanKey: 1, visible: true, shell: "pwsh" };

test("VIEW-115: an unrelated setting or a new but equal array does not redraw the list", () => {
  expect(sameShown(shown, { ...shown, settings: { ...shown.settings, theme: "light", fontSize: 14 }, projectDirs: ["C:/w"], projects: [{ path: "C:/w" }] })).toBe(true);
});

test("VIEW-115: the list's own settings, folders, shell, visibility and rescan key do redraw it", () => {
  expect(sameShown(shown, { ...shown, settings: { ...shown.settings, sessionListView: { sort: "oldest" } } })).toBe(false);
  expect(sameShown(shown, { ...shown, settings: { ...shown.settings, sessionListScope: { scope: "all" } } })).toBe(false);
  expect(sameShown(shown, { ...shown, activeDir: "C:/x" })).toBe(false);
  expect(sameShown(shown, { ...shown, projectDirs: ["C:/w", "C:/w2"] })).toBe(false);
  expect(sameShown(shown, { ...shown, projects: [{ path: "C:/other" }] })).toBe(false);
  expect(sameShown(shown, { ...shown, shell: "cmd" })).toBe(false);
  expect(sameShown(shown, { ...shown, visible: false })).toBe(false);
  expect(sameShown(shown, { ...shown, rescanKey: 2 })).toBe(false);
});

test("C28-R5-01: the memo redraws when a session becomes (or stops being) open in a pane", () => {
  const open: [string, string][] = [["claude", "s-1"]];
  expect(sameShown({ ...shown, openPanes: open }, { ...shown, openPanes: [["claude", "s-1"]] })).toBe(true); // an equal list is not a redraw
  expect(sameShown({ ...shown, openPanes: [] }, { ...shown, openPanes: open })).toBe(false); // a row's warning can now show
  expect(sameShown({ ...shown, openPanes: open }, { ...shown, openPanes: [] })).toBe(false); // and it goes when the pane does
  expect(sameShown({ ...shown, openPanes: open }, { ...shown })).toBe(false);
});
