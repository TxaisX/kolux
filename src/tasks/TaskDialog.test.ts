// UX audit (tasks.md rows 5-7 and 17): the task dialog tells a failed load and lets you retry, keeps an
// unsaved description for the next time it opens, and labels its close and remove buttons.
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { byLabel, byText, click, type FakeDocument, installDom, mount, settle, typeInto, until } from "./fakeDom";
import type { Task, TaskDetail } from "./model";

const h = vi.hoisted(() => ({ calls: [] as string[], answers: {} as Record<string, unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    const a = h.answers[cmd];
    return Promise.resolve(typeof a === "function" ? (a as () => unknown)() : a);
  },
}));

const task: Task = { kind: "issue", number: 5, title: "Crash on start", url: "https://github.com/acme/app/issues/5", repo: "acme/app", state: "open", draft: false, labels: [{ name: "bug", color: "d73a4a" }], assignees: ["ana"], updated: "2026-10-01T00:00:00Z", checks: null };
const detail: TaskDetail = { title: "Crash on start", body: "It crashes", state: "open", labels: [{ name: "bug", color: "d73a4a" }], assignees: ["ana"], updated: "2026-10-01T00:00:00Z", events: [] };

let doc: FakeDocument;
beforeEach(() => {
  ({ doc } = installDom());
  h.calls.length = 0;
  h.answers = { scm_task_detail: detail, scm_repo_labels: [], github_people: [] };
});

async function open() {
  const { default: TaskDialog } = await import("./TaskDialog");
  return mount(createElement(TaskDialog, { task, host: "github.com", onClose: () => {}, onLabels: () => {}, onState: () => {} }), doc);
}

describe("TaskDialog", () => {
  it("a failed load says so and offers Retry, which reads again", async () => {
    h.answers.scm_task_detail = () => Promise.reject(new Error("offline"));
    const m = await open();
    await until(() => m.container.textContent.includes("could not be read"), "the failure");
    expect(m.container.textContent).not.toContain("Loading…");
    h.answers.scm_task_detail = detail;
    await click(m.container, byText(m.container, "button", "Retry")[0]);
    await until(() => m.container.textContent.includes("It crashes"), "the description");
    expect(byText(m.container, "button", "Retry")).toHaveLength(0);
    await m.unmount();
  });

  it("an unsaved description comes back when the dialog is opened again", async () => {
    const a = await open();
    await until(() => a.container.textContent.includes("It crashes"), "the load");
    await click(a.container, byText(a.container, "button", "Edit")[0]);
    await typeInto(a.container, byLabel(a.container, "textarea", "Description")[0], "half a thought");
    await a.unmount();
    const b = await open();
    await settle();
    const box = byLabel(b.container, "textarea", "Description")[0];
    expect(box).toBeDefined();
    expect(box.value).toBe("half a thought");
    await click(b.container, byText(b.container, "button", "Cancel")[0]); // the kept draft is module state: leave none behind
    await b.unmount();
  });

  it("the close and remove buttons carry names", async () => {
    const m = await open();
    await until(() => m.container.textContent.includes("It crashes"), "the load");
    expect(byLabel(m.container, "button", "Close")).toHaveLength(1);
    expect(byLabel(m.container, "button", "Remove label bug")).toHaveLength(1);
    expect(byLabel(m.container, "button", "Unassign ana")).toHaveLength(1);
    await m.unmount();
  });
});
