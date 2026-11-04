import { describe, expect, it } from "vitest";
import { deletePlan, descendants, fileManagerName, groupMenu, projectMenu, rowMenu, type MenuFor } from "./menu";

const base: MenuFor = { count: 1, isMain: false, asleep: false, deleting: false, platform: "Win32", alt: false, statuses: [{ id: "todo", label: "To do" }], editors: [{ label: "VS Code", command: "code" }] };
const ids = (o: Partial<MenuFor>) => rowMenu({ ...base, ...o }).map((i) => i.id);
const W = (path: string, parent?: string) => ({ path, parent });

describe("PROJ-065 workspace context menu", () => {
  it("lists Delete, Sleep, Move to status, Set parent, Details and Open in for one row", () => {
    expect(ids({})).toEqual(["delete", "sleep", "status", "parent", "details", "open-in", "hide"]);
    expect(rowMenu(base).find((i) => i.id === "status")?.children?.map((c) => c.id)).toEqual(["status:todo", "statuses:edit"]);
  });
  it("a sleeping workspace offers Wake; the main checkout is never deleted or slept", () => {
    expect(ids({ asleep: true })).toContain("wake");
    // T-749 (DT-C185): the main row also offers New workspace, as its project header does; a selection does not.
    expect(ids({ isMain: true })).toEqual(["proj:new", "status", "details", "open-in", "proj:remove"]);
    expect(ids({ isMain: true, count: 3 })).not.toContain("proj:new");
  });
  it("the file manager is named for the platform and Open in has the editors and a terminal", () => {
    expect(fileManagerName("MacIntel")).toBe("Finder");
    expect(fileManagerName("Win32")).toBe("Explorer");
    expect(fileManagerName("Linux x86_64")).toBe("Files");
    expect(rowMenu(base).find((i) => i.id === "open-in")?.children?.map((c) => c.label)).toEqual(["Explorer", "VS Code", "Terminal"]);
  });
  it("Open in is disabled while the workspace is being deleted", () => {
    expect(rowMenu({ ...base, deleting: true }).find((i) => i.id === "open-in")?.disabled).toBe(true);
  });
  it("the developer submenu needs Alt and a single row", () => {
    expect(ids({})).not.toContain("developer");
    expect(ids({ alt: true })).toContain("developer");
    expect(ids({ alt: true, count: 3 })).not.toContain("developer");
  });
  it("several rows get Delete N and no per-row items", () => {
    expect(rowMenu({ ...base, count: 3 }).map((i) => i.label)).toEqual(["Delete 3 workspaces", "Sleep", "Move to status"]);
  });
});

describe("T-640 every row has a way out", () => {
  const last = (items: { id: string; danger?: boolean; sep?: boolean }[]) => items[items.length - 1];
  it("a project header lists New workspace, Project settings and a red Remove project last, below a divider", () => {
    expect(projectMenu().map((i) => i.id)).toEqual(["proj:new", "proj:settings", "proj:remove"]);
    expect(last(projectMenu())).toMatchObject({ id: "proj:remove", danger: true, sep: true });
  });
  it("the main checkout cannot be deleted, slept or hidden, so its way out is Remove project", () => {
    expect(ids({ isMain: true })).not.toContain("delete");
    expect(ids({ isMain: true })).not.toContain("hide");
    expect(last(rowMenu({ ...base, isMain: true }))).toMatchObject({ id: "proj:remove", danger: true, sep: true });
  });
  it("a workspace can be hidden from its menu, and several rows get no hide or remove-project item", () => {
    expect(ids({})).toContain("hide");
    expect(ids({ count: 3 })).not.toContain("hide");
    expect(ids({ count: 3, isMain: true })).not.toContain("proj:remove");
  });
  it("a group row lists Group settings and a red Delete group last, below a divider", () => {
    expect(groupMenu().map((i) => i.id)).toEqual(["grp:settings", "grp:delete"]);
    expect(last(groupMenu())).toMatchObject({ id: "grp:delete", danger: true, sep: true });
  });
});

describe("T-055 deleting a workspace with children", () => {
  const all = [W("C:/ws/a"), W("C:/ws/b", "C:/ws/a"), W("C:/ws/c", "C:/ws/b"), W("C:/ws/d")];
  it("finds children at every depth", () => {
    expect(descendants("C:/ws/a", all)).toEqual(["C:/ws/b", "C:/ws/c"]);
    expect(descendants("C:/WS/A/", all)).toEqual(["C:/ws/b", "C:/ws/c"]);
  });
  it("deletes children first and the parent last, and always asks", () => {
    const p = deletePlan(["C:/ws/a"], all, false);
    expect(p.order).toEqual(["C:/ws/c", "C:/ws/b", "C:/ws/a"]);
    expect(p.withChildren).toBe(true);
    expect(p.mustAsk).toBe(true);
  });
  it("a lone childless workspace follows the question setting; a batch always asks", () => {
    expect(deletePlan(["C:/ws/d"], all, false)).toEqual({ order: ["C:/ws/d"], withChildren: false, mustAsk: false });
    expect(deletePlan(["C:/ws/d"], all, true).mustAsk).toBe(true);
    expect(deletePlan(["C:/ws/d", "C:/ws/c"], all, false).mustAsk).toBe(true);
  });
  it("a loop in the records does not hang", () => {
    expect(deletePlan(["x"], [W("x", "y"), W("y", "x")], false).order.sort()).toEqual(["x", "y"]);
  });
});
