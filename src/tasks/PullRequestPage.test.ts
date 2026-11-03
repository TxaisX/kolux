// FIX-1 (stand-in review FIX-SOON 4): the pull request page's outward-write rules, proven on the
// page itself. The commands are a mocked invoke that records every call; the page is the real
// component, mounted into the small stand-in DOM in fakeDom.ts and clicked like a user would.
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byLabel, byText, click, fire, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto, until, withText } from "./fakeDom";
import { escapeStep, partialNote } from "./prPageState";
import type { PrPageData } from "./prModel";

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  answers: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    const a = h.answers[cmd];
    return Promise.resolve(typeof a === "function" ? (a as (x: Record<string, unknown>) => unknown)(args) : a);
  },
}));

// The only commands that read. Anything else a pull request page sends changes GitHub.
const READS = ["pr_page", "pr_checks", "pr_threads", "pr_files", "github_people", "scm_repo_labels", "github_repo_lineage", "pr_viewed", "pr_editors", "scm_check_log"];
const writes = () => h.calls.filter((c) => !READS.includes(c.cmd));
const sent = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);

const page = (over: Partial<PrPageData> = {}): PrPageData => ({
  number: 7,
  title: "Fix the login",
  body: "Closes #3",
  state: "open",
  draft: false,
  url: "https://github.com/acme/app/pull/7",
  author: "ana",
  headRef: "fix-login",
  headSha: "abc1234def",
  baseRef: "main",
  mergeableState: "clean",
  labels: [],
  assignees: [],
  reviewers: [],
  reactions: [],
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  reviewsTruncated: false,
  reviewsLimit: 500,
  ...over,
});
const thread = { id: 100, path: "src/a.ts", line: 4, comments: [{ id: 100, author: "bo", body: "why?", at: "2026-10-01T00:00:00Z" }, { id: 101, author: "ana", body: "because", at: "2026-10-02T00:00:00Z" }] };

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
  h.calls.length = 0;
  h.answers = {
    pr_page: page(),
    pr_checks: [],
    pr_threads: { threads: [thread], truncated: false, limit: 500 },
    pr_files: { files: [{ filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, patch: "@@" }], truncated: false, limit: 500 },
    github_people: [],
    scm_repo_labels: [],
    github_repo_lineage: { owner: "acme", name: "app", fork: false, parent: null, parentOwner: null },
    pr_viewed: { files: [{ path: "src/a.ts", state: "unviewed" }], truncated: false, limit: 0 },
    pr_editors: [],
    pr_merge: null,
    pr_reply: null,
  };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open(over: { added?: boolean; host?: string; workspace?: string | null; onClose?: () => void } = {}) {
  const { default: PullRequestPage } = await import("./PullRequestPage");
  const m = await mount(createElement(PullRequestPage, { target: { host: over.host ?? "github.com", repo: "acme/app", number: 7, kind: "pull" }, added: over.added ?? true, onClose: over.onClose ?? (() => {}), workspace: over.workspace ?? null }), doc);
  unmount = m.unmount;
  await until(() => byText(m.container, "button", "Close pull request").length > 0, "the page to load");
  return m.container as FakeNode;
}
const mergeBox = (c: FakeNode) => c.textContent;

describe("T-232-c the pull request page only writes when told to", () => {
  it("reading the page and switching tabs sends no write command", async () => {
    const c = await open();
    await click(c, withText(c, "button", "Checks")[0]);
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    await click(c, withText(c, "button", "Conversation")[0]);
    expect(sent("pr_page").length).toBeGreaterThan(0);
    expect(sent("pr_files")).toHaveLength(1);
    expect(writes()).toEqual([]);
  });

  it("every command goes to the pull request's own host", async () => {
    const c = await open({ host: "git.corp.example" });
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => sent("pr_files").length > 0, "the files");
    expect(h.calls.length).toBeGreaterThan(3);
    for (const x of h.calls) expect(x.args.host, x.cmd).toBe("git.corp.example");
  });

  it("merges once, with confirmed true and the head sha the page showed, and only after both clicks", async () => {
    const c = await open();
    expect(sent("pr_merge")).toHaveLength(0);
    await click(c, byText(c, "button", "Merge...")[0]);
    expect(sent("pr_merge")).toHaveLength(0);
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(1);
    await click(c, byText(c, "button", "Yes, merge it")[0]);
    await until(() => sent("pr_merge").length > 0, "the merge");
    expect(sent("pr_merge")).toHaveLength(1);
    expect(sent("pr_merge")[0].args).toEqual({ host: "github.com", repo: "acme/app", number: 7, method: "squash", confirmed: true, sha: "abc1234def" });
  });

  it("a Reload that finds new commits closes the merge confirm, says so, and reads the files again", async () => {
    const c = await open();
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    expect(sent("pr_files")).toHaveLength(1);
    await click(c, withText(c, "button", "Conversation")[0]);
    await click(c, byText(c, "button", "Merge...")[0]);
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(1);
    // someone pushes: the next read of the page answers a new head commit
    h.answers.pr_page = page({ headSha: "fed9876cba" });
    await click(c, byText(c, "button", "Refresh")[0]);
    await until(() => sent("pr_threads").length > 1, "the reload");
    await settle();
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(0);
    expect(mergeBox(c)).toContain("New commits were pushed");
    expect(mergeBox(c)).toContain("check Files changed again");
    // the old diff is gone: opening Files changed asks for the new one
    await click(c, withText(c, "button", "Files changed")[0]);
    await settle();
    expect(sent("pr_files")).toHaveLength(2);
    // and a merge now pins the new head, after both clicks again
    await click(c, withText(c, "button", "Conversation")[0]);
    await click(c, byText(c, "button", "Merge...")[0]);
    await click(c, byText(c, "button", "Yes, merge it")[0]);
    await until(() => sent("pr_merge").length > 0, "the merge");
    expect(sent("pr_merge")[0].args).toMatchObject({ sha: "fed9876cba" });
  });

  it("a Reload on the same head leaves the confirm and the files alone", async () => {
    const c = await open();
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    await click(c, withText(c, "button", "Conversation")[0]);
    await click(c, byText(c, "button", "Merge...")[0]);
    await click(c, byText(c, "button", "Refresh")[0]);
    await until(() => sent("pr_threads").length > 1, "the reload");
    await settle();
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(1);
    expect(mergeBox(c)).not.toContain("New commits were pushed");
    await click(c, withText(c, "button", "Files changed")[0]);
    expect(sent("pr_files")).toHaveLength(1);
  });

  it("a files answer still in flight for the old head is dropped when a Reload finds a new head (stand-in review FIX-SOON 3)", async () => {
    const file = (filename: string) => ({ files: [{ filename, status: "modified", additions: 1, deletions: 0, patch: "@@" }], truncated: false, limit: 500 });
    // the first read of the files is held open by the test; later reads answer at once
    let release: (v: unknown) => void = () => {};
    let reads = 0;
    h.answers.pr_files = () => (++reads === 1 ? new Promise((res) => (release = res)) : file("src/new.ts"));
    const c = await open();
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => sent("pr_files").length === 1, "the first files read");
    // someone pushes; the page is reloaded (the button sits on the Conversation tab) while the old read is still pending
    await click(c, withText(c, "button", "Conversation")[0]);
    h.answers.pr_page = page({ headSha: "fed9876cba" });
    await click(c, byText(c, "button", "Refresh")[0]);
    await until(() => sent("pr_threads").length > 1, "the reload");
    await settle();
    // the old head's answer arrives late
    release(file("src/old.ts"));
    await settle();
    await click(c, withText(c, "button", "Files changed")[0]);
    await settle();
    expect(withText(c, "summary", "src/old.ts")).toHaveLength(0);
    expect(withText(c, "summary", "src/new.ts")).toHaveLength(1);
    expect(sent("pr_files")).toHaveLength(2);
  });

  it("Cancel on the confirm step sends nothing and closes it", async () => {
    const c = await open();
    await click(c, byText(c, "button", "Merge...")[0]);
    await click(c, byText(c, "button", "Cancel")[0]);
    expect(sent("pr_merge")).toHaveLength(0);
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(0);
    expect(writes()).toEqual([]);
  });

  it("a reply goes to the thread's root comment, not its last reply", async () => {
    const c = await open();
    await until(() => byText(c, "button", "Reply").length > 0, "the thread");
    await click(c, byText(c, "button", "Reply")[0]);
    await typeInto(c, byLabel(c, "textarea", "Reply")[0], "thanks");
    await click(c, byText(c, "button", "Reply")[0]);
    await until(() => sent("pr_reply").length > 0, "the reply");
    expect(sent("pr_reply")).toHaveLength(1);
    expect(sent("pr_reply")[0].args).toMatchObject({ comment: 100, body: "thanks" });
  });

  it("a repository not added in Kolux gets the page but no merge button, and says why", async () => {
    const c = await open({ added: false });
    expect(mergeBox(c)).toContain("Add this repository in Kolux to merge from here.");
    expect(byText(c, "button", "Merge...")).toHaveLength(0);
  });

  it("a pull request GitHub has not finished checking cannot be merged yet", async () => {
    for (const state of ["unknown", ""]) {
      h.answers.pr_page = page({ mergeableState: state });
      const c = await open();
      expect(mergeBox(c), state).toContain("GitHub is still checking whether it can merge");
      expect(byText(c, "button", "Merge...")).toHaveLength(0);
      await unmount();
      unmount = async () => {};
    }
  });

  it("links go through safeHref, and a markdown link shows where it goes", async () => {
    h.answers.pr_page = page({ url: "javascript:alert(1)", body: "see [https://github.com/x](http://elsewhere.example/y)" });
    h.answers.pr_checks = [{ id: 1, name: "build", status: "completed", conclusion: "success", url: "javascript:alert(2)", runId: 1 }, { id: 2, name: "lint", status: "completed", conclusion: "success", url: "https://ci.example/lint", runId: 2 }];
    const root = await open();
    // no "Open on GitHub" link for an address that is not http(s)
    expect(withText(root, "a", "Open on GitHub")).toHaveLength(0);
    const md = withText(root, "a", "https://github.com/x")[0];
    expect(md.attrs.href).toBe("http://elsewhere.example/y");
    expect(md.attrs.title).toBe("http://elsewhere.example/y");
    await click(root, withText(root, "button", "Checks")[0]);
    await until(() => withText(root, "li", "lint").length > 0, "the checks");
    expect(withText(root, "a", "build")).toHaveLength(0);
    expect(withText(root, "li", "build")).toHaveLength(1);
    expect(withText(root, "a", "lint")[0].attrs.href).toBe("https://ci.example/lint");
  });

  it("says when files, review threads or reviews were cut at the page limit", async () => {
    h.answers.pr_files = { files: [{ filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, patch: "@@" }], truncated: true, limit: 250 };
    h.answers.pr_threads = { threads: [thread], truncated: true, limit: 250 };
    h.answers.pr_page = page({ reviewsTruncated: true, reviewsLimit: 250 });
    const c = await open();
    expect(mergeBox(c)).toContain("Showing the first 250 review comments");
    expect(mergeBox(c)).toContain("Showing the first 250 reviews");
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => withText(c, "summary", "src/a.ts").length > 0, "the files");
    expect(mergeBox(c)).toContain("Showing the first 250 files");
  });
});

describe("T-232-d the page's extra reads and writes", () => {
  const failing = { id: 5, name: "build", status: "completed", conclusion: "failure", url: "https://github.com/acme/app/actions/runs/9/job/3", runId: 9 };

  it("sends a failed check's log to the workspace agent as the Fix with AI prompt, and nowhere else", async () => {
    h.answers.pr_checks = [failing];
    h.answers.scm_check_log = "step 3\nboom: test failed";
    h.answers.scm_review_send = { terminal: "t1", receipt: "r1" };
    const c = await open({ workspace: "G:/w/pr-7" });
    await click(c, withText(c, "button", "Checks")[0]);
    await click(c, byText(c, "button", "Fix with AI")[0]);
    await until(() => sent("scm_review_send").length > 0, "the prompt to be sent");
    expect(sent("scm_check_log")[0].args).toEqual({ worktree: "G:/w/pr-7", link: failing.url });
    const out = sent("scm_review_send")[0].args as { worktree: string; text: string };
    expect(out.worktree).toBe("G:/w/pr-7");
    expect(out.text).toContain('The check "build" is failing on this pull request');
    expect(out.text).toContain("boom: test failed");
    expect(h.calls.filter((x) => !READS.includes(x.cmd) && x.cmd !== "scm_review_send")).toEqual([]);
  });

  it("without a workspace Fix with AI is off, says why and sends nothing", async () => {
    h.answers.pr_checks = [failing];
    const c = await open();
    await click(c, withText(c, "button", "Checks")[0]);
    const b = byText(c, "button", "Fix with AI")[0];
    expect("disabled" in b.attrs).toBe(true);
    expect(c.textContent).toContain("Start a workspace for this pull request first");
    await click(c, b);
    expect(sent("scm_check_log")).toHaveLength(0);
    expect(sent("scm_review_send")).toHaveLength(0);
  });

  it("saves an edited description with scm_task_body and removes a label with scm_task_labels", async () => {
    h.answers.pr_page = page({ labels: [{ name: "bug", color: "d73a4a" }] });
    h.answers.scm_task_body = { body: "New text" };
    h.answers.scm_task_labels = [];
    const c = await open();
    await click(c, byText(c, "button", "Edit description")[0]);
    await typeInto(c, byLabel(c, "textarea", "Description")[0], "New text");
    await click(c, byText(c, "button", "Save")[0]);
    await until(() => sent("scm_task_body").length > 0, "the description to be saved");
    expect(sent("scm_task_body")[0].args).toEqual({ host: "github.com", repo: "acme/app", number: 7, body: "New text" });
    await click(c, find(c, (n) => n.localName === "button" && n.attrs.title === "Remove bug")[0]);
    await until(() => sent("scm_task_labels").length > 0, "the label to be removed");
    expect(sent("scm_task_labels")[0].args).toEqual({ host: "github.com", repo: "acme/app", number: 7, add: [], remove: ["bug"] });
  });

  it("shows the fork's owner on the branch and its parent, and reads the viewed marks with the files", async () => {
    h.answers.pr_page = page({ headRepo: "me/app" });
    h.answers.github_repo_lineage = { owner: "me", name: "app", fork: true, parent: "acme/app", parentOwner: "acme" };
    const c = await open();
    await until(() => c.textContent.includes("Fork of acme/app"), "the parent");
    expect(c.textContent).toContain("me:fix-login into main");
    expect(sent("github_repo_lineage").slice(-1)[0].args).toEqual({ host: "github.com", repo: "me/app" });
    await click(c, withText(c, "button", "Files changed")[0]);
    await until(() => c.textContent.includes("0 of 1 files viewed"), "the viewed count");
    expect(sent("pr_viewed")).toHaveLength(1);
  });
});

describe("UX audit: errors shown, Refresh, Escape and Back", () => {
  it("says so when the checks could not be read, instead of showing an empty list", async () => {
    h.answers.pr_checks = () => Promise.reject(new Error("rate limited"));
    const c = await open();
    await until(() => c.textContent.includes("Could not read the checks (rate limited)"), "the warning");
    expect(c.textContent).toContain("press Refresh to try again");
    // a good read on Refresh clears it
    h.answers.pr_checks = [];
    await click(c, byText(c, "button", "Refresh")[0]);
    await until(() => !c.textContent.includes("Could not read"), "the warning to clear");
  });

  it("names both when the checks and the review threads fail", async () => {
    h.answers.pr_checks = () => Promise.reject(new Error("a"));
    h.answers.pr_threads = () => Promise.reject(new Error("b"));
    const c = await open();
    await until(() => c.textContent.includes("the checks (a) or the review threads (b)"), "both named");
  });

  it("Refresh reads the pull request again and writes nothing", async () => {
    const c = await open();
    const before = sent("pr_page").length;
    await click(c, byText(c, "button", "Refresh")[0]);
    await until(() => sent("pr_page").length > before, "the second read");
    expect(writes()).toEqual([]);
  });

  it("the way out is labelled Back, not an X", async () => {
    const c = await open();
    expect(byLabel(c, "button", "Back to Tasks")).toHaveLength(1);
    expect(byText(c, "button", "Back")).toHaveLength(1);
  });

  it("Escape goes back to Tasks, but first closes an open merge confirm", async () => {
    // window keydown listeners as the browser runs them: capture ones first, then bubble ones in the order added.
    type L = { f: (e: unknown) => void; capture: boolean };
    let keys: L[] = [];
    const w = window as unknown as { addEventListener: (t: string, f: (e: unknown) => void, o?: unknown) => void; removeEventListener: (t: string, f: (e: unknown) => void, o?: unknown) => void };
    w.addEventListener = (t, f, o) => void (t === "keydown" && keys.push({ f, capture: o === true }));
    w.removeEventListener = (_t, f, o) => void (keys = keys.filter((k) => !(k.f === f && k.capture === (o === true))));
    (doc as unknown as { querySelectorAll: () => unknown[] }).querySelectorAll = () => [];
    // The Tasks screen's own "Escape leaves the page" listener, added before the PR page opens.
    const leftPage = vi.fn();
    w.addEventListener("keydown", (e) => void (!(e as { defaultPrevented: boolean }).defaultPrevented && leftPage()));
    const onClose = vi.fn();
    const c = await open({ onClose });
    const esc = async () => {
      const ev = { key: "Escape", target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      await fire(c, "keydown", c, {}); // lets React settle between presses
      for (const k of [...keys.filter((k) => k.capture), ...keys.filter((k) => !k.capture)]) k.f(ev);
      return ev;
    };
    await click(c, byText(c, "button", "Merge...")[0]);
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(1);
    await esc();
    await settle();
    expect(byLabel(c, "div", "Confirm merge")).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    const ev = await esc();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(leftPage).not.toHaveBeenCalled(); // back to Tasks, not out of the whole Tasks page
  });
});

describe("UX audit: pure steps", () => {
  it("partialNote is empty when nothing failed", () => {
    expect(partialNote([])).toBeNull();
    expect(partialNote(["the checks (x)"])).toContain("What is shown for it may be empty");
  });
  it("escapeStep: merge confirm first, then stay for a field, menu or edit, else back", () => {
    const base = { confirming: false, typing: false, overlay: false, editing: false };
    expect(escapeStep({ ...base, confirming: true })).toBe("cancel-merge");
    expect(escapeStep({ ...base, confirming: true, typing: true })).toBe("stay"); // the comment field's own Escape
    expect(escapeStep({ ...base, confirming: true, overlay: true })).toBe("stay");
    expect(escapeStep({ ...base, typing: true })).toBe("stay");
    expect(escapeStep({ ...base, overlay: true })).toBe("stay");
    expect(escapeStep({ ...base, editing: true })).toBe("hold");
    expect(escapeStep(base)).toBe("back");
  });
});
