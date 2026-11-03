import { describe, expect, it } from "vitest";
import { chosenDefault, applyAssignees, applyCellEdit, assigneeChange, cellEditable, cellText, cloneAddress, cellKey, endSave, newBook, sendEdit, settleEdit, readBackStart, readBackFresh, readBackLost, isSaving, startSave, groupItems, labelChange, openingView, parseProjectRef, type Project, type ProjectField, projectHostRefused, type ProjectItem, pushRecent, refsFrom, scopeItems, sortItems, togglePin, viewLabel, viewSupport, viewUrl } from "./projects";

const status: ProjectField = { id: "F_s", name: "Status", kind: "single_select", options: [{ id: "o1", name: "Todo", start: "", days: 0 }, { id: "o2", name: "Done", start: "", days: 0 }] };
const points: ProjectField = { id: "F_p", name: "Points", kind: "number", options: [] };
const repo: ProjectField = { id: "F_r", name: "Repository", kind: "repository", options: [] };
const labels: ProjectField = { id: "F_l", name: "Labels", kind: "labels", options: [] };
const item = (id: string, over: Partial<ProjectItem> = {}): ProjectItem => ({ id, kind: "issue", title: id, number: 1, url: "", repo: "acme/app", state: "open", labels: [], assignees: [], issueType: "", values: {}, ...over });
const cell = (text: string, id = "") => ({ text, id, start: "", days: 0 });

describe("T-314-c GitHub Projects", () => {
  it("reads a pasted project URL or an owner and number, and nothing else", () => {
    expect(parseProjectRef("https://github.com/orgs/acme/projects/3/views/2", "x")).toEqual({ host: "github.com", owner: "acme", number: 3, view: 2 });
    expect(parseProjectRef("https://GHE.example.com/users/ana-b/projects/12", "ghe.example.com")).toEqual({ host: "ghe.example.com", owner: "ana-b", number: 12, view: null });
    for (const t of ["acme 3", "acme/3", "acme#3", "@acme 3"]) expect(parseProjectRef(t, "github.com")).toEqual({ host: "github.com", owner: "acme", number: 3, view: null });
    for (const t of ["", "acme", "acme 0", "-acme 3", "ac--me 3", "a\"b 3", "https://github.com/acme/app/issues/3", "http://github.com/orgs/acme/projects/3"]) expect(parseProjectRef(t, "github.com")).toBeNull();
  });

  it("the picker label and the view agree: tables, roadmaps as a timeline, boards not supported", () => {
    expect(["table", "board", "roadmap"].map(viewSupport)).toEqual(["table", "unsupported", "timeline"]);
    expect(viewLabel({ number: 2, name: "Plan", layout: "roadmap" })).toBe("Plan (timeline)");
    expect(viewLabel({ number: 3, name: "Kanban", layout: "board" })).toBe("Kanban (board, not supported)");
    expect(viewLabel({ number: 1, name: "All", layout: "table" })).toBe("All");
  });

  it("opens the remembered view, else the first table view", () => {
    const views = [{ number: 1, name: "B", layout: "board" }, { number: 4, name: "T", layout: "table" }];
    expect(openingView({ views }, 1)).toBe(1);
    expect(openingView({ views }, 9)).toBe(4);
    expect(openingView({ views: [views[0]] }, null)).toBe(1);
    expect(openingView({ views: [] }, null)).toBeNull();
  });

  it("remembers recent projects newest first and once each, and pins toggle", () => {
    const r = (n: number) => ({ host: "github.com", owner: "Acme", number: n, title: "" });
    let recent = [1, 2, 3, 4, 5, 6, 7, 8].map(r);
    recent = pushRecent(recent, { ...r(3), owner: "acme" });
    expect(recent.map((x) => x.number)).toEqual([3, 1, 2, 4, 5, 6, 7, 8]);
    expect(pushRecent(recent, r(9)).map((x) => x.number)).toEqual([9, 3, 1, 2, 4, 5, 6, 7]);
    expect(togglePin(togglePin([], r(1)), r(1))).toEqual([]);
    expect(refsFrom([r(1), { host: "github.com", owner: "a b", number: 1 }, { owner: "x" }, null, "x"])).toEqual([r(1)]);
    expect(refsFrom("nope")).toEqual([]);
  });

  it("sorts numbers by value and single-select by option order, empty cells last both ways", () => {
    const a = item("a", { values: { F_p: cell("10"), F_s: cell("Done", "o2") } });
    const b = item("b", { values: { F_p: cell("9"), F_s: cell("Todo", "o1") } });
    const c = item("c");
    const r = item("r", { kind: "restricted", values: {} });
    expect(sortItems([a, c, b, r], points, 1).map((x) => x.id)).toEqual(["b", "a", "c", "r"]);
    expect(sortItems([a, c, b, r], points, -1).map((x) => x.id)).toEqual(["a", "b", "c", "r"]);
    expect(sortItems([a, b], status, 1).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("groups in the field's option order with the empty group last", () => {
    const a = item("a", { values: { F_s: cell("Done", "o2") } });
    const b = item("b", { values: { F_s: cell("Todo", "o1") } });
    const c = item("c");
    expect(groupItems([a, c, b], status).map((g) => [g.label, g.items.map((x) => x.id)])).toEqual([["Todo", ["b"]], ["Done", ["a"]], ["No status", ["c"]]]);
    expect(groupItems([item("x", { repo: "z/z" }), item("y", { repo: "a/a" })], repo).map((g) => g.label)).toEqual(["a/a", "z/z"]);
  });

  it("limits rows to repositories open in Kolux or chosen ones, leaving out drafts and restricted items", () => {
    const rows = [item("a", { repo: "Acme/App" }), item("b", { repo: "acme/other" }), item("d", { kind: "draft", repo: "" }), item("r", { kind: "restricted", repo: "" })];
    expect(scopeItems(rows, { mode: "all" }, []).length).toBe(4);
    expect(scopeItems(rows, { mode: "kolux" }, ["acme/app"]).map((x) => x.id)).toEqual(["a"]);
    expect(scopeItems(rows, { mode: "chosen", repos: ["acme/other"] }, ["acme/app"]).map((x) => x.id)).toEqual(["b"]);
  });

  it("restricted items and drafts' labels are not editable; labels change as add and remove lists", () => {
    expect(cellEditable(item("r", { kind: "restricted" }), status)).toBe(false);
    expect(cellEditable(item("a"), status)).toBe(true);
    expect(cellEditable(item("a"), labels)).toBe(true);
    expect(cellEditable(item("d", { kind: "draft", repo: "", number: null }), labels)).toBe(false);
    expect(cellEditable(item("a"), repo)).toBe(false);
    expect(labelChange(["bug", "docs"], "Bug, ui, ui,")).toEqual({ add: ["ui"], remove: ["docs"] });
  });

  it("opens a view on GitHub only from an https project address", () => {
    expect(viewUrl({ url: "https://github.com/orgs/acme/projects/3" }, 2)).toBe("https://github.com/orgs/acme/projects/3/views/2");
    expect(viewUrl({ url: "javascript:alert(1)" }, 2)).toBeNull();
  });
});

describe("FIX-1 (council review of 674122c)", () => {
  it("opens a pasted project address only on github.com or this workspace's own host", () => {
    expect(parseProjectRef("https://evil.example/orgs/x/projects/1", "github.com")).toBeNull();
    expect(projectHostRefused("https://evil.example/orgs/x/projects/1", "github.com")).toBe("evil.example");
    expect(parseProjectRef("https://ghe.corp/orgs/x/projects/1", "github.com")).toBeNull();
    expect(parseProjectRef("https://github.com/orgs/x/projects/1", "ghe.corp")).toEqual({ host: "github.com", owner: "x", number: 1, view: null });
    expect(parseProjectRef("https://GHE.corp/orgs/x/projects/1", "ghe.corp")?.host).toBe("ghe.corp");
    expect(projectHostRefused("https://github.com/orgs/x/projects/1", "ghe.corp")).toBeNull();
    expect(projectHostRefused("acme 3", "github.com")).toBeNull();
  });

  it("a saved cell lands on the row as it is now, so two edits on one row both stay", () => {
    const due: ProjectField = { id: "F_d", name: "Due", kind: "date", options: [] };
    const start: Project = { id: "P", owner: "acme", number: 1, title: "", url: "", closed: false, views: [], fields: [status, points, due], more: false, items: [item("a", { values: { F_d: { text: "2026-10-01", id: "", start: "2026-10-01", days: 0 } } }), item("b")] };
    // Both edits were started from `start`; their answers arrive one after the other.
    const afterStatus = applyCellEdit(start, "a", status, "o2");
    const afterBoth = applyCellEdit(afterStatus, "a", points, "5");
    expect(afterBoth.items[0].values).toEqual({ F_s: { text: "Done", id: "o2", start: "", days: 0 }, F_p: cell("5"), F_d: { text: "2026-10-01", id: "", start: "2026-10-01", days: 0 } });
    const cleared = applyCellEdit(afterBoth, "a", due, " ");
    expect(Object.keys(cleared.items[0].values).sort()).toEqual(["F_p", "F_s"]);
    expect(cleared.items[1]).toBe(start.items[1]);
    expect(start.items[0].values.F_s).toBeUndefined();
  });
});

describe("FIX-2 AFTER 3: one saving mark per edit", () => {
  it("two edits to one cell keep the mark until both are back", () => {
    const cell = cellKey("a", "F_status");
    let s = startSave([], 1, cell);
    s = startSave(s, 2, cell);
    s = startSave(s, 3, cellKey("a", "labels"));
    s = endSave(s, 1);
    expect(isSaving(s, cell)).toBe(true);
    s = endSave(s, 2);
    expect(isSaving(s, cell)).toBe(false);
    expect(isSaving(s, cellKey("a", "labels"))).toBe(true);
  });
});

describe("FIX-4 AFTER 6: a burst of edits to one cell is re-read", () => {
  // GitHub is not promised to apply a burst in the order it was sent, so after two or more
  // successful edits to one cell settle together, the page reads the item back instead of
  // trusting the highest id.
  const settle = (steps: [number, boolean][]) => {
    const b = newBook();
    const c = cellKey("a", "F_status");
    steps.forEach(([id]) => sendEdit(b, c, id));
    return steps.map(([id, ok]) => settleEdit(b, c, id, ok, () => {}));
  };
  it("asks for a re-read only when the last edit settles and two or more went through", () => {
    expect(settle([[1, true], [2, true], [3, true]])).toEqual([false, false, true]);
    expect(settle([[1, true], [2, true]])).toEqual([false, true]);
  });
  it("a single success, or successes mixed with failures down to one, need none", () => {
    expect(settle([[1, true]])).toEqual([false]);
    expect(settle([[1, true], [2, false]])).toEqual([false, false]);
    expect(settle([[1, false], [2, false]])).toEqual([false, false]);
  });
  it("the next burst starts counting from zero", () => {
    const b = newBook();
    const c = cellKey("a", "F_status");
    [1, 2].forEach((id) => sendEdit(b, c, id));
    [1, 2].forEach((id) => settleEdit(b, c, id, true, () => {}));
    sendEdit(b, c, 3);
    expect(settleEdit(b, c, 3, true, () => {})).toBe(false);
  });
});

describe("FIX-5 AFTER 4: the burst re-read never overwrites a newer edit", () => {
  const burst = (b: ReturnType<typeof newBook>, cell: string, ids: number[]) => {
    ids.forEach((id) => sendEdit(b, cell, id));
    return ids.map((id) => settleEdit(b, cell, id, true, () => {}));
  };
  it("is skipped while an edit to another cell is still out, then sent once when that edit settles (FIX-6)", () => {
    const b = newBook();
    const other = cellKey("b", "F_points");
    sendEdit(b, other, 9);
    // The burst's own settle asks for no read yet: another edit is out.
    expect(burst(b, cellKey("a", "F_status"), [1, 2])[1]).toBe(false);
    expect(readBackStart(b)).toBeNull();
    // The last pending edit settles as a single edit: exactly one read is now due.
    expect(settleEdit(b, other, 9, true, () => {})).toBe(true);
    expect(readBackStart(b)).not.toBeNull();
    // ...and only one: a later single edit asks for none.
    sendEdit(b, other, 10);
    expect(settleEdit(b, other, 10, true, () => {})).toBe(false);
  });
  it("a burst with nothing else out asks for its read at once", () => {
    const b = newBook();
    expect(burst(b, cellKey("a", "F_status"), [1, 2])).toEqual([false, true]);
  });
  it("is dropped when an edit was sent after the read, even if it has settled by the time the read comes back, and is sent again (FIX-6)", () => {
    const b = newBook();
    burst(b, cellKey("a", "F_status"), [1, 2]);
    const token = readBackStart(b);
    expect(token).not.toBeNull();
    expect(readBackFresh(b, token!)).toBe(true);
    // A quick edit to another cell: sent after the read, settled before its answer.
    const other = cellKey("b", "F_points");
    sendEdit(b, other, 3);
    expect(readBackFresh(b, token!)).toBe(false);
    settleEdit(b, other, 3, true, () => {});
    expect(readBackFresh(b, token!)).toBe(false);
    // The dropped answer asks for a fresh read, because nothing is out to settle later.
    expect(readBackLost(b)).toBe(true);
    const again = readBackStart(b);
    expect(again).not.toBeNull();
    expect(readBackFresh(b, again!)).toBe(true);
  });
  it("a dropped answer while a later edit is still out waits for that edit to settle (FIX-6)", () => {
    const b = newBook();
    burst(b, cellKey("a", "F_status"), [1, 2]);
    const token = readBackStart(b)!;
    const other = cellKey("b", "F_points");
    sendEdit(b, other, 3);
    expect(readBackFresh(b, token)).toBe(false);
    expect(readBackLost(b)).toBe(false);
    expect(settleEdit(b, other, 3, true, () => {})).toBe(true);
  });
  it("is dropped while a later edit is still out", () => {
    const b = newBook();
    burst(b, cellKey("a", "F_status"), [1, 2]);
    const token = readBackStart(b)!;
    sendEdit(b, cellKey("b", "F_points"), 3);
    expect(readBackFresh(b, token)).toBe(false);
  });
});

describe("FIX-3 FIX-SOON 4: a cell shows the last edit that succeeded", () => {
  const run = (steps: [number, boolean][]) => {
    const b = newBook();
    const shown: number[] = [];
    const c = cellKey("a", "F_status");
    steps.forEach(([id]) => sendEdit(b, c, id));
    steps.forEach(([id, ok]) => settleEdit(b, c, id, ok, () => shown.push(id)));
    return shown;
  };
  it("the newest edit failing leaves the older success on screen", () => {
    expect(run([[1, true], [2, false]])).toEqual([1]);
  });
  it("the newest failing first and the older one coming back later still shows the older one", () => {
    expect(run([[2, false], [1, true]])).toEqual([1]);
  });
  it("two successes show the newest once, whatever order they come back in", () => {
    expect(run([[2, true], [1, true]])).toEqual([2]);
    expect(run([[1, true], [2, true]])).toEqual([2]);
  });
  it("a single edit shows at once, and all failing shows nothing", () => {
    expect(run([[1, true]])).toEqual([1]);
    expect(run([[1, false], [2, false]])).toEqual([]);
  });
  it("a later edit to the same cell starts clean", () => {
    const b = newBook();
    const c = cellKey("a", "F_status");
    const shown: number[] = [];
    sendEdit(b, c, 1);
    settleEdit(b, c, 1, true, () => shown.push(1));
    sendEdit(b, c, 2);
    settleEdit(b, c, 2, false, () => shown.push(2));
    expect(shown).toEqual([1]);
  });
});

describe("T-314-d the issue's own fields", () => {
  const assignees: ProjectField = { id: "F_a", name: "Assignees", kind: "assignees", options: [] };
  const type: ProjectField = { id: "F_t", name: "Type", kind: "issue_type", options: [] };
  it("assignees and issue type are editable on an issue; a pull request has no type; drafts and restricted rows have neither", () => {
    expect([item("a"), item("b", { kind: "pr" }), item("c", { kind: "draft", repo: "", number: null }), item("d", { kind: "restricted" })].map((i) => [cellEditable(i, assignees), cellEditable(i, type)])).toEqual([
      [true, true],
      [true, false],
      [false, false],
      [false, false],
    ]);
    expect(cellText(item("a", { issueType: "Bug", assignees: ["ana", "bo"] }), type)).toBe("Bug");
    expect(cellText(item("a", { assignees: ["ana", "bo"] }), assignees)).toBe("@ana, @bo");
  });

  it("an assignee edit is GitHub's add and remove lists: case-blind, @ optional, each login once; a bad login is named", () => {
    expect(assigneeChange(["ana", "bo"], "@ANA, cy, cy")).toEqual({ add: ["cy"], remove: ["bo"], bad: [] });
    expect(assigneeChange(["ana"], "")).toEqual({ add: [], remove: ["ana"], bad: [] });
    expect(assigneeChange(["ana"], "ana").add).toEqual([]);
    expect(assigneeChange([], "ana, -x, a b").bad).toEqual(["-x", "a b"]);
    expect(applyAssignees(["ana", "bo"], { add: ["cy", "ANA"], remove: ["bo"] })).toEqual(["ana", "cy"]);
  });

  it("a repository is copied from an https address on a plain host, never from an odd name", () => {
    expect(cloneAddress("github.com", "acme/app")).toBe("https://github.com/acme/app.git");
    expect(cloneAddress("git.corp.example:8443", "corp/lib.js")).toBe("https://git.corp.example:8443/corp/lib.js.git");
    for (const [h, r] of [["github.com", "acme"], ["github.com", "a/b/c"], ["github.com", "../x"], ["github.com", "a/.."], ["github.com", "a b/c"], ["evil.com/x@", "a/b"], ["", "a/b"]]) expect(cloneAddress(h, r)).toBeNull();
  });
});

describe("UX audit: Chosen repositories does not start empty", () => {
  it("ticks the project's repositories that are open in Kolux", () => {
    expect(chosenDefault(["acme/api", "acme/web", "acme/docs"], ["acme/web", "other/x"])).toEqual(["acme/web"]);
    expect(chosenDefault(["Acme/Web"], ["acme/web"])).toEqual(["Acme/Web"]);
  });
  it("ticks them all when none is open in Kolux, so the table is not empty", () => {
    expect(chosenDefault(["acme/api", "acme/web"], [])).toEqual(["acme/api", "acme/web"]);
    expect(chosenDefault([], ["acme/web"])).toEqual([]);
  });
});
