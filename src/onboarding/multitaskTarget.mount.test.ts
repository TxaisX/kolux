// Review R27-03: the Setup Guide's parallel step reads which project is on screen. While the sidebar is closed
// its project header is not in the page, so the step reads the window's shown folder first and only falls back
// to the header.
import { createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { byText, click, installDom, mount, settle, until, type FakeDocument } from "../tasks/fakeDom";

const projects = [
  { id: "a", name: "alpha", path: "C:/w/alpha" },
  { id: "b", name: "beta", path: "C:/w/beta" },
];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "project_list") return projects;
    if (cmd === "workspace_list") return [{ path: projects.find((p) => p.id === args.projectId)!.path }];
    if (cmd === "get_settings") return {};
    return null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

let doc: FakeDocument;
beforeEach(() => {
  doc = installDom().doc;
  Object.assign(doc, { querySelector: () => null, querySelectorAll: () => [] }); // the sidebar is closed: no project header
});

test("with the sidebar closed, Create a workspace aims at the project on screen, not the first one", async () => {
  const { MultitaskPanel, composer } = await import("./StepPanels");
  const { WindowStore } = await import("../shell/window/store");
  const open = vi.spyOn(composer, "open").mockResolvedValue(undefined as never);
  const m = await mount(createElement(WindowStore.Provider, { value: { activeDir: "C:/w/beta" } as never }, createElement(MultitaskPanel, { close: () => {} })), doc);
  await settle();
  await click(m.container, byText(m.container, "button", "Create a workspace")[0]);
  await until(() => open.mock.calls.length > 0, "the composer to open");
  expect(open.mock.calls[0][0]).toEqual({ kind: "project", project: projects[1] });
  await m.unmount();
});
