// T-315-b (GIT-058): a GitHub link pasted into the worktree switcher opens the workspace linked to
// it, else the item; Alt and a digit pick the numbered row. Pure helpers first, then the real
// switcher on the small DOM in src/tasks/fakeDom.ts with the commands mocked.
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, fire, installDom, mount, settle, typeInto, until } from "../tasks/fakeDom";
import type { Project, Worktree } from "./model";
import { chordRow, pastedItems } from "./WorktreePalette";

const h = vi.hoisted(() => ({ lists: {} as Record<string, unknown[]> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => Promise.resolve(cmd === "workspace_list" ? (h.lists[String(args.projectId)] ?? []) : null),
}));

const w = (path: string, branch: string): Worktree => ({ path, branch, head: "abc1234", isMain: false, hidden: false, number: null, comment: "" }) as unknown as Worktree;
const fix = w("C:/w/fix", "fix-login");
const link = "https://github.com/acme/app/pull/7";

describe("T-315-b pastedItems", () => {
  const find1 = (d: string) => (d === "C:/w/fix" ? fix : undefined);
  it("offers the linked workspace first, else the item itself", () => {
    const go = vi.fn();
    const open = vi.fn();
    const own = pastedItems(` ${link}?x=1#c `, { "C:/w/fix": link }, ["github.com"], find1, open, go);
    expect(own.map((r) => [r.section, r.label])).toEqual([["Workspaces", "Open the workspace for acme/app#7"]]);
    own[0].run();
    expect(go).toHaveBeenCalledWith(fix);
    const bare = pastedItems("https://github.com/acme/app/issues/9", { "C:/w/fix": link }, ["github.com"], find1, open, go);
    expect(bare.map((r) => r.label)).toEqual(["Open issue acme/app#9"]);
    bare[0].run();
    expect(open).toHaveBeenCalledWith("https://github.com/acme/app/issues/9");
  });
  it("a linked folder that is not a known worktree falls back to the item; other text and hosts offer nothing", () => {
    const open = vi.fn();
    expect(pastedItems(link, { "C:/gone": link }, ["github.com"], () => undefined, open, vi.fn()).map((r) => r.label)).toEqual(["Open pull request acme/app#7"]);
    expect(pastedItems("fix login", {}, ["github.com"], find1, open, vi.fn())).toEqual([]);
    expect(pastedItems("https://evil.test/acme/app/pull/7", {}, ["github.com"], find1, open, vi.fn())).toEqual([]);
    expect(pastedItems("https://ghe.corp/acme/app/pull/7", {}, ["github.com", "ghe.corp"], find1, open, vi.fn()).length).toBe(1);
  });
});

describe("T-315-b chordRow", () => {
  const k = (code: string, extra: Record<string, boolean> = {}) => ({ altKey: true, ctrlKey: false, metaKey: false, code, ...extra });
  it("Alt and 1-9 pick row 0-8; nothing else does", () => {
    expect(chordRow(k("Digit1"))).toBe(0);
    expect(chordRow(k("Digit9"))).toBe(8);
    expect(chordRow(k("Digit0"))).toBeNull();
    expect(chordRow(k("KeyA"))).toBeNull();
    expect(chordRow(k("Digit2", { altKey: false }))).toBeNull();
    expect(chordRow(k("Digit2", { ctrlKey: true }))).toBeNull();
    expect(chordRow(k("Digit2", { metaKey: true }))).toBeNull();
    expect(chordRow(k("Digit2", { shiftKey: true }))).toBeNull();
  });
});

describe("T-315-b the switcher", () => {
  let doc: FakeDocument;
  let unmount: () => Promise<void> = async () => {};
  const project = { id: "p1", name: "app", path: "C:/w/app" } as unknown as Project;
  beforeEach(() => {
    ({ doc } = installDom());
    h.lists = { p1: [w("C:/w/app", "main"), fix] };
  });
  afterEach(async () => {
    await unmount();
    unmount = async () => {};
  });
  async function open(extra: Record<string, unknown>) {
    const { default: WorktreePalette } = await import("./WorktreePalette");
    const picked: string[] = [];
    const m = await mount(createElement(WorktreePalette, { projects: [project], items: [], prOf: () => null, recent: [], scope: [], hasWorktree: true, onWorktree: (x: Worktree) => picked.push(x.path), onCreate: (n: string) => picked.push(`create ${n}`), onClose: () => picked.push("close"), ...extra }), doc);
    unmount = m.unmount;
    const c = m.container as FakeNode;
    await settle();
    return { c, picked, box: find(c, (n) => n.localName === "input" && n.attrs.class === "picker-input")[0] };
  }
  const rowText = (c: FakeNode) => find(c, (n) => n.attrs.role === "option").map((n) => n.textContent);

  it("a pasted link of a linked workspace opens it on Enter, before the create row", async () => {
    const { c, picked, box } = await open({ linked: { "C:/w/fix": link }, onItem: vi.fn() });
    await typeInto(c, box, link);
    await until(() => rowText(c).some((t) => t.includes("Open the workspace for acme/app#7")), "the workspace row");
    expect(rowText(c)[0]).toContain("Open the workspace for acme/app#7");
    await fire(c, "keydown", box, { key: "Enter" });
    expect(picked).toEqual(["close", "C:/w/fix"]);
  });

  it("a pasted link with no workspace opens the item", async () => {
    const onItem = vi.fn();
    const { c, box } = await open({ linked: {}, onItem });
    await typeInto(c, box, "https://github.com/acme/app/pull/12");
    await until(() => rowText(c).some((t) => t.includes("Open pull request acme/app#12")), "the item row");
    await fire(c, "keydown", box, { key: "Enter" });
    expect(onItem).toHaveBeenCalledWith("https://github.com/acme/app/pull/12");
  });

  it("Alt+2 picks the second numbered row, and rows show their numbers", async () => {
    const { c, picked, box } = await open({});
    await until(() => rowText(c).length >= 2, "the rows");
    expect(find(c, (n) => n.attrs.class === "palette-num").map((n) => n.textContent).slice(0, 2)).toEqual(["1", "2"]);
    await fire(c, "keydown", box, { key: "2", code: "Digit2", altKey: true, ctrlKey: false, metaKey: false });
    expect(picked.length).toBe(2);
    expect(picked[0]).toBe("close");
  });

  it("without the open-item seam a pasted link is searched like any text", async () => {
    const { c, box } = await open({});
    await typeInto(c, box, link);
    await settle();
    expect(rowText(c).some((t) => t.startsWith("Open the workspace"))).toBe(false);
  });
});
