// @vitest-environment happy-dom
// FIX-2 (stand-in review FIX-SOON 1 and AFTER 5): the Tasks page's two-host wiring, proven on the
// page itself. Two GitHub hosts answer the search; a row from the second host must carry that host
// into its dialog, its full page, workspace start, the merge gate and the resume lookup. The
// commands are a mocked invoke that records every call (the real page, the small DOM in fakeDom.ts).
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byLabel, byText, click, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto, until } from "./realDom";
import type { Task } from "./model";
import type { PrPageData } from "./prModel";

type Args = Record<string, unknown>;
const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  on: {} as Record<string, (a: Record<string, unknown>) => unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    const f = h.on[cmd];
    return Promise.resolve(f ? f(args) : null);
  },
}));

const HOME = "github.com";
const CORP = "git.corp.example";
const sent = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);

const task = (over: Partial<Task>): Task => ({ kind: "pr", number: 7, title: "Fix the lib", url: "https://git.corp.example/corp/lib/pull/7", repo: "corp/lib", state: "open", draft: false, labels: [], assignees: [], updated: "2026-10-02T00:00:00Z", checks: null, ...over });
const pull = (over: Partial<PrPageData> = {}): PrPageData => ({
  number: 7, title: "Fix the lib", body: "", state: "open", draft: false, url: "https://git.corp.example/corp/lib/pull/7", author: "ana", headRef: "fix", headSha: "abc1234def", baseRef: "main",
  mergeableState: "clean", labels: [], assignees: [], reviewers: [], reactions: [], additions: 1, deletions: 1, changedFiles: 1, reviewsTruncated: false, reviewsLimit: 500, ...over,
});

type World = { projects: { id: string; name: string; path: string; remote: { host: string; owner: string; name: string } }[]; found: Record<string, Task[]>; worktrees?: Record<string, unknown[]> };
/** The commands the page reads, answered from a small world of projects, remotes and search results. */
function world(w: World) {
  const chosen = w.projects.map((p) => `${p.remote.host}/${p.remote.owner}/${p.remote.name}`.toLowerCase());
  h.on = {
    get_settings: () => ({ tasksRepos: [...new Set(chosen)], tasksDefaultPreset: "all" }),
    project_list: () => w.projects.map(({ id, name, path }) => ({ id, name, path })),
    scm_github_repo: (a: Args) => w.projects.find((p) => p.path === a.worktree)?.remote ?? null,
    scm_gh_account: () => "ana",
    github_repo_parent: () => null,
    github_people: () => [],
    scm_repo_labels: () => [],
    scm_tasks_search: (a: Args) => {
      const items = w.found[String(a.host)] ?? [];
      return { total: items.length, deepest: items.length, items };
    },
    workspace_list: (a: Args) => w.worktrees?.[String(a.projectId)] ?? [],
    scm_task_detail: (a: Args) => ({ title: "Fix the lib", body: "", state: "open", labels: [], assignees: [], updated: "2026-10-02T00:00:00Z", events: [], host: a.host }),
    pr_page: () => pull(),
    pr_checks: () => [],
    pr_threads: () => ({ threads: [], truncated: false, limit: 500 }),
    pr_files: () => ({ files: [], truncated: false, limit: 500 }),
    workspace_from_item: () => ({ path: "G:/w/made" }),
  };
}

const twoHosts: World = {
  projects: [
    { id: "p1", name: "app", path: "/w/app", remote: { host: HOME, owner: "acme", name: "app" } },
    { id: "p2", name: "lib", path: "/w/lib", remote: { host: CORP, owner: "corp", name: "lib" } },
  ],
  found: {
    [HOME]: [task({ number: 1, title: "Fix the app", url: "https://github.com/acme/app/pull/1", repo: "acme/app", updated: "2026-10-01T00:00:00Z" })],
    [CORP]: [task({})],
  },
};

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
  h.calls.length = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open() {
  const { default: TasksPage } = await import("./TasksPage");
  const m = await mount(createElement(TasksPage, { repo: { dir: "/w/app", name: "app" } }), doc);
  unmount = m.unmount;
  return m.container as FakeNode;
}
const row = (c: FakeNode, title: string) => find(c, (n) => n.localName === "li" && !!n.attrs["data-task"] && n.textContent.includes(title))[0];
const rows = async (c: FakeNode, ...titles: string[]) => {
  await until(() => titles.every((t) => row(c, t)), `the rows ${titles.join(", ")}`);
};
const onHost = (cmd: string, repo?: string) => sent(cmd).filter((x) => repo === undefined || x.args.repo === repo);

describe("FIX-2 the Tasks page uses the host each row came from", () => {
  it("the list asks each host's own search", async () => {
    world(twoHosts);
    const c = await open();
    await rows(c, "Fix the app", "Fix the lib");
    expect(sent("scm_tasks_search").map((x) => x.args.host).sort()).toEqual([CORP, HOME]);
  });

  it("opening the second host's pull request reads its detail, labels and people on that host", async () => {
    world(twoHosts);
    const c = await open();
    await rows(c, "Fix the lib");
    await click(c, row(c, "Fix the lib"));
    await until(() => sent("scm_task_detail").length > 0, "the dialog");
    expect(sent("scm_task_detail")[0].args).toMatchObject({ host: CORP, repo: "corp/lib", number: 7 });
    await until(() => onHost("scm_repo_labels", "corp/lib").length > 0 && onHost("github_people", "corp/lib").length > 0, "the dialog's other reads");
    expect(onHost("scm_repo_labels", "corp/lib")[0].args.host).toBe(CORP);
    expect(onHost("github_people", "corp/lib")[0].args.host).toBe(CORP);
  });

  it("Open full page on the second host's pull request reads and merges nothing on the first host", async () => {
    world(twoHosts);
    const c = await open();
    await rows(c, "Fix the lib");
    await click(c, row(c, "Fix the lib"));
    await until(() => byText(c, "button", "Open full page").length > 0, "the dialog");
    await click(c, byText(c, "button", "Open full page")[0]);
    await until(() => sent("pr_page").length > 0, "the page");
    expect(sent("pr_page")[0].args).toMatchObject({ host: CORP, repo: "corp/lib", number: 7 });
    await until(() => sent("pr_threads").length > 0 && byText(c, "button", "Merge...").length > 0, "the page to load");
    for (const cmd of ["pr_page", "pr_threads"]) expect(sent(cmd)[0].args, cmd).toMatchObject({ host: CORP, repo: "corp/lib", number: 7 });
    expect(sent("pr_checks")[0].args).toMatchObject({ host: CORP, repo: "corp/lib" });
    // the repository is added in Kolux on that host, so the merge button is there
    expect(byText(c, "button", "Merge...")).toHaveLength(1);
    await click(c, byText(c, "button", "Merge...")[0]);
    await click(c, byText(c, "button", "Yes, merge it")[0]);
    await until(() => sent("pr_merge").length > 0, "the merge");
    expect(sent("pr_merge")[0].args).toMatchObject({ host: CORP, repo: "corp/lib", number: 7, confirmed: true, sha: "abc1234def" });
  });

  it("starting work from the second host's row makes the workspace from that host", async () => {
    world(twoHosts);
    const c = await open();
    await rows(c, "Fix the lib");
    const button = find(row(c, "Fix the lib"), (n) => n.localName === "button" && n.attrs["data-work"] === "pr-7")[0];
    await click(c, button);
    await until(() => sent("workspace_from_item").length > 0, "the workspace start");
    expect(sent("workspace_from_item")[0].args).toEqual({ item: { host: CORP, owner: "corp", repo: "lib", kind: "pull", number: 7 } });
  });

  it("a pasted address on the second host merges only for a repository added on that host", async () => {
    world(twoHosts);
    const c = await open();
    await rows(c, "Fix the lib");
    // The field is looked up each time: going back to Tasks draws the list, and the field, again.
    const paste = () => byLabel(c, "input", "Paste a GitHub address")[0];
    const reason = (url: string) => async () => {
      await typeInto(c, paste(), url);
      await until(() => sent("pr_threads").length > 0, "the page");
      await settle();
      const text = c.textContent;
      const merge = byText(c, "button", "Merge...").length;
      await click(c, byLabel(c, "button", "Back to Tasks")[0]);
      h.calls.length = 0;
      return { text, merge };
    };
    // added on that host: Merge is offered
    const added = await reason(`https://${CORP}/corp/lib/pull/7`)();
    expect(added.merge).toBe(1);
    // the same name on the other host is not an added repository
    const wrongHost = await reason(`https://${HOME}/corp/lib/pull/7`)();
    expect(wrongHost.merge).toBe(0);
    expect(wrongHost.text).toContain("Add this repository in Kolux to merge from here.");
    // a repository nobody added
    const stranger = await reason(`https://${CORP}/other/thing/pull/3`)();
    expect(stranger.merge).toBe(0);
    expect(stranger.text).toContain("Add this repository in Kolux to merge from here.");
  });
});

describe("FIX-2 Resume looks up a workspace on the row's own host", () => {
  it("the same repository name on two hosts: only the host that has the workspace offers Resume", async () => {
    world({
      projects: [
        { id: "p1", name: "app", path: "/w/app", remote: { host: HOME, owner: "acme", name: "app" } },
        { id: "p3", name: "app corp", path: "/w/app-corp", remote: { host: CORP, owner: "acme", name: "app" } },
      ],
      found: {
        [HOME]: [task({ number: 1, title: "Home copy", url: "https://github.com/acme/app/pull/1", repo: "acme/app" })],
        [CORP]: [task({ number: 1, title: "Corp copy", url: "https://git.corp.example/acme/app/pull/1", repo: "acme/app", updated: "2026-10-01T00:00:00Z" })],
      },
      // only the github.com checkout has a workspace for number 1
      worktrees: { p1: [{ path: "/w/app-pr1", isMain: false, number: 1 }], p3: [] },
    });
    const c = await open();
    await rows(c, "Home copy", "Corp copy");
    await until(() => sent("workspace_list").length >= 2, "the workspace lookups");
    await settle();
    const label = (title: string) => find(row(c, title), (n) => n.localName === "button" && n.attrs["data-work"] === "pr-1")[0].textContent.trim();
    expect(label("Home copy")).toBe("Resume workspace");
    expect(label("Corp copy")).toBe("Check out in a workspace");
  });
});

