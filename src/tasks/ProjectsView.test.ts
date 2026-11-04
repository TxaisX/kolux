// T-314-d (GIT-056): the Projects table's assignee and issue-type cells are the issue's own fields
// (edited on the issue through pr_assignees and github_issue_type_set, never through the project), and
// a row of a repository that is not open in Kolux offers to add it through the clone dialog.
// The real table on the small DOM in fakeDom.ts, with the commands mocked and recorded.
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, fire, FakeNode as Node, find, installDom, mount, settle, typeInto, until, withText } from "./fakeDom";
import type { Project } from "./projects";

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  on: {} as Record<string, (a: Record<string, unknown>) => unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    const f = h.on[cmd];
    try {
      return Promise.resolve(f ? f(args) : null);
    } catch (e) {
      return Promise.reject(e);
    }
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const sent = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);
const cell = { text: "", id: "", start: "", days: 0 };

const project = (): Project => ({
  id: "PVT_1", owner: "acme", number: 3, title: "Roadmap", url: "https://github.com/orgs/acme/projects/3", closed: false, more: false,
  views: [{ number: 1, name: "Table", layout: "table" }],
  fields: [
    { id: "F_title", name: "Title", kind: "title", options: [] },
    { id: "F_assign", name: "Assignees", kind: "assignees", options: [] },
    { id: "F_type", name: "Type", kind: "issue_type", options: [] },
    { id: "F_note", name: "Release note", kind: "text", options: [] },
  ],
  items: [
    { id: "PVTI_a", kind: "issue", title: "Fix login", number: 7, url: "https://github.com/acme/app/issues/7", repo: "acme/app", state: "open", labels: [], assignees: ["ana"], issueType: "Bug", values: { F_title: cell } },
    { id: "PVTI_b", kind: "pr", title: "Patch it", number: 8, url: "https://github.com/acme/other/pull/8", repo: "acme/other", state: "open", labels: [], assignees: [], issueType: "", values: {} },
    { id: "PVTI_c", kind: "draft", title: "Idea", number: null, url: "", repo: "", state: "", labels: [], assignees: [], issueType: "", values: {} },
  ],
});

// GitHub as the test holds it: the page reads the project back after an edit, so it must change here too.
let held = project();
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
  h.calls.length = 0;
  held = project();
  h.on = {
    project_list: () => [{ id: "p1", name: "other", path: "/w/other" }],
    scm_github_repo: () => ({ owner: "acme", name: "other" }),
    github_project: () => structuredClone(held),
    github_people: () => [{ login: "ana", avatar: "" }, { login: "bo", avatar: "" }],
    github_issue_types: () => ["Bug", "Task"],
    pr_assignees: (a) => {
      held.items[0].assignees = [...(a.add as string[]), ...held.items[0].assignees.filter((x) => !(a.remove as string[]).includes(x))];
      return null;
    },
    github_issue_type_set: (a) => {
      held.items[0].issueType = String(a.name);
      return String(a.name);
    },
    clone_suggest: (a) => ({ url: String(a.url), dest: "C:/Users/me/kolux-rs/workspaces/app" }),
  };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open() {
  const { default: ProjectsView } = await import("./ProjectsView");
  const settings = { tasksProjectsPinned: [{ host: "github.com", owner: "acme", number: 3, title: "Roadmap" }] };
  const m = await mount(createElement(ProjectsView, { host: "github.com", owner: "acme", settings, save: () => {} }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => sent("project_list").length > 0, "the repositories open in Kolux");
  await settle();
  await click(c, find(c, (n) => n.localName === "button" && n.textContent.includes("Roadmap"))[0]);
  await until(() => find(c, (n) => n.localName === "table").length > 0, "the table");
  return c;
}
const cellOf = (c: FakeNode, item: string, kind: string) => find(c, (n) => n.localName === "td" && n.attrs["data-kind"] === kind && n.parentNode?.attrs["data-item"] === item)[0];
const enter = (c: FakeNode, target: FakeNode) => fire(c, "keydown", target, { key: "Enter" });

describe("T-314-d Projects table: the issue's own fields", () => {
  it("shows the assignees and the issue type of each row", async () => {
    const c = await open();
    expect(cellOf(c, "PVTI_a", "assignees").textContent).toContain("@ana");
    expect(cellOf(c, "PVTI_a", "issue_type").textContent).toBe("Bug");
  });

  it("an assignee edit adds and removes on the issue, case-blind and without the @", async () => {
    const c = await open();
    await click(c, cellOf(c, "PVTI_a", "assignees"));
    const box = find(c, (n) => n.localName === "input" && n.attrs["aria-label"] === "Assignees")[0];
    await until(() => sent("github_people").length > 0, "the people list");
    await typeInto(c, box, "@ANA, bo");
    await enter(c, box);
    await until(() => sent("pr_assignees").length > 0, "the assignee call");
    expect(sent("pr_assignees")[0].args).toEqual({ host: "github.com", repo: "acme/app", number: 7, add: ["bo"], remove: [] });
    await until(() => cellOf(c, "PVTI_a", "assignees").textContent.includes("@bo"), "the cell to show the change");
    expect(sent("github_project_set")).toEqual([]);
  });

  it("a typed name that is not a GitHub login sends nothing and says so", async () => {
    const c = await open();
    await click(c, cellOf(c, "PVTI_a", "assignees"));
    const box = find(c, (n) => n.localName === "input" && n.attrs["aria-label"] === "Assignees")[0];
    await typeInto(c, box, "ana, bad login");
    await enter(c, box);
    await until(() => find(c, (n) => !!n.attrs["data-cell-error"]).length > 0, "the message");
    expect(withText(c, "div", "bad login is not a GitHub login").length).toBeGreaterThan(0);
    expect(sent("pr_assignees")).toEqual([]);
  });

  it("the issue type is chosen from the repository's own types and set on the issue; a pull request and a draft have none to edit", async () => {
    const c = await open();
    await click(c, cellOf(c, "PVTI_a", "issue_type"));
    const pick = find(c, (n) => n.localName === "select" && n.attrs["aria-label"] === "Type")[0];
    await until(() => sent("github_issue_types").length > 0, "the types");
    expect(sent("github_issue_types")[0].args).toEqual({ host: "github.com", repo: "acme/app" });
    Object.getOwnPropertyDescriptor(Node.prototype, "value")!.set!.call(pick, "Task");
    await fire(c, "change", pick);
    await until(() => sent("github_issue_type_set").length > 0, "the type call");
    expect(sent("github_issue_type_set")[0].args).toEqual({ host: "github.com", repo: "acme/app", number: 7, name: "Task" });
    await until(() => cellOf(c, "PVTI_a", "issue_type").textContent === "Task", "the cell to show the new type");
    await click(c, cellOf(c, "PVTI_b", "issue_type"));
    await click(c, cellOf(c, "PVTI_c", "assignees"));
    await settle();
    expect(find(c, (n) => n.localName === "select" && n.attrs["aria-label"] === "Type")).toEqual([]);
    expect(sent("github_issue_types").length).toBe(1);
  });
});

describe("C15-R4-01 a write GitHub rejects keeps the typed value", () => {
  it("puts the typed text back in the cell with the reason, and the retry still works", async () => {
    let fail: ((e: unknown) => void) | null = null;
    h.on.github_project_set = () => new Promise((_, rej) => (fail = rej));
    const c = await open();
    await click(c, cellOf(c, "PVTI_a", "text"));
    const box = () => find(c, (n) => n.localName === "input" && n.attrs["aria-label"] === "Release note")[0];
    await typeInto(c, box(), "needs triage");
    await enter(c, box());
    await until(() => sent("github_project_set").length > 0, "the write");
    fail!(new Error("HTTP 403: Resource not accessible by integration"));
    await until(() => !!box(), "the editor back on the cell");
    expect(box().value).toBe("needs triage");
    expect(cellOf(c, "PVTI_a", "text").textContent).toContain("Resource not accessible");
    h.on.github_project_set = (a) => {
      held.items[0].values.F_note = { text: String(a.value), id: "", start: "", days: 0 };
      return null;
    };
    await enter(c, box());
    await until(() => sent("github_project_set").length === 2, "the retry");
    await until(() => !box(), "the editor to close on success");
    expect(cellOf(c, "PVTI_a", "text").textContent).toContain("needs triage");
  });
});

describe("T-314-d a repository that is not in Kolux offers to be added", () => {
  it("only the rows of a repository not open in Kolux carry the offer, and it opens the copy dialog with the address filled in", async () => {
    const c = await open();
    const offers = find(c, (n) => n.localName === "button" && !!n.attrs["data-add-repo"]);
    expect(offers.map((b) => b.attrs["data-add-repo"])).toEqual(["acme/app"]);
    await click(c, offers[0]);
    await until(() => sent("clone_suggest").length > 0, "the copy dialog");
    expect(sent("clone_suggest")[0].args).toEqual({ url: "https://github.com/acme/app.git" });
    expect(find(c, (n) => n.localName === "input" && n.attrs["aria-label"] === "web address of the project")[0].value).toBe("https://github.com/acme/app.git");
  });
});
