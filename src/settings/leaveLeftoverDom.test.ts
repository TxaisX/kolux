// C20-R4-01: the leftover store must put the typed text back in the box, not only the reason. The
// fake-React test beside this one cannot see the difference: it never re-renders after an effect, so
// the mount reset that put the stored value back over the restored draft was invisible to it. This
// one mounts the real components on the small DOM in fakeDom.ts, where effects run and re-renders
// happen, and reads the box the user would see.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[], fail: {} as Record<string, string>, setup: null as unknown }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    const why = h.fail[cmd];
    if (why) return Promise.reject(why);
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "" });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "repo_setup_get") return Promise.resolve(h.setup);
    if (cmd === "project_set" || cmd === "project_display_name_set") return Promise.resolve({ id: "p1", name: "app", path: "C:/src/app", base: "develop" });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

import { byLabel, type FakeDocument, type FakeNode, installDom, mount, settle, typeInto, until } from "../tasks/fakeDom";
import RepoPage from "./RepoPage";
import RepoSetupSection from "./RepoSetup";

const project = { id: "p1", name: "app", path: "C:/src/app", base: "develop" };
const setup = { local: "pnpm i", shared: null, sharedError: null, policy: null, inherited: "local", wait: false, suggestBoth: false, runError: null };

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
  h.calls = [];
  h.fail = {};
  h.setup = null;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("C20-R4-01: the typed value is in the box after a remount, with the reason its save failed", async () => {
  h.fail = { project_set: "disk full" };
  const first = await mount(createElement(RepoPage, { project, onSaved: () => {} }), doc);
  unmount = first.unmount;
  const c1 = first.container as FakeNode;
  await settle(20);
  const box = () => byLabel(c1, "input", "New workspaces start from")[0];
  expect(box().value).toBe("develop");
  await typeInto(c1, box(), "wip/base");
  expect(box().value, "typing shows what was typed").toBe("wip/base");

  await first.unmount(); // the leave save runs in the unmount cleanup
  unmount = async () => {};
  await settle(20);
  expect(h.calls, "the leave save was attempted").toContain("project_set");

  h.fail = {};
  const second = await mount(createElement(RepoPage, { project, onSaved: () => {} }), doc);
  unmount = second.unmount;
  const c2 = second.container as FakeNode;
  await settle(20);
  expect(byLabel(c2, "input", "New workspaces start from")[0].value, "the typed value is in the box").toBe("wip/base");
  expect(c2.textContent, "the failure is shown").toContain("could not be saved");
});

test("C20-R4-01: the typed setup script is in the box after a remount, with the reason its save failed", async () => {
  h.setup = setup;
  h.fail = { repo_setup_save: "disk full" };
  const first = await mount(createElement(RepoSetupSection, { path: "C:/src/app" }), doc);
  unmount = first.unmount;
  const c1 = first.container as FakeNode;
  await until(() => byLabel(c1, "textarea", "Saved setup script").length > 0, "the setup box");
  const area = () => byLabel(c1, "textarea", "Saved setup script")[0];
  expect(area().value).toBe("pnpm i");
  await typeInto(c1, area(), "pnpm ci");
  expect(area().value, "typing shows what was typed").toBe("pnpm ci");

  await first.unmount(); // the leave save runs in the unmount cleanup
  unmount = async () => {};
  await settle(20);
  expect(h.calls, "the leave save was attempted").toContain("repo_setup_save");

  h.fail = {};
  const second = await mount(createElement(RepoSetupSection, { path: "C:/src/app" }), doc);
  unmount = second.unmount;
  const c2 = second.container as FakeNode;
  await until(() => byLabel(c2, "textarea", "Saved setup script").length > 0, "the setup box");
  expect(byLabel(c2, "textarea", "Saved setup script")[0].value, "the typed script is in the box").toBe("pnpm ci");
  expect(c2.textContent, "the failure is shown").toContain("could not be saved");
});
