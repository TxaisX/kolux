// Job 68 (decided): setup closed or skipped with a folder on the list opens the Start form on the folder in front,
// as finishing does, unless the ask at start is off or work is already up (a pane, or a Start form). WindowHosts is
// drawn under the window store with the lazy pages stubbed; the stub Wizard hands its props out. endWizard is the
// real closer (onboarding/firstRun.ts), so a finish followed by a close in the same moment is latched as in the app.
import { createElement, useState } from "react";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
type WizardProps = { onSession: () => void; onClose: () => void };
const seen: { wizard: WizardProps | null } = { wizard: null };
vi.mock("../../lazy/pages", () => {
  const none = () => null;
  return {
    Guides: none, SkillUpdateNotice: none, ReviewNotes: none, UpdateCenter: none, FeedbackDialog: none,
    Wizard: (p: WizardProps) => ((seen.wizard = p), null),
  };
});
vi.mock("../../chrome/StatusBar", () => ({ default: () => null }));
vi.mock("../../editmenu/EditMenuHost", () => ({ default: () => null }));
vi.mock("../../skills/SkillBarItem", () => ({ BringSkillsUp: () => null }));
import { START_ASK_KEY } from "../../launch/startForm";
import { closer } from "../../onboarding/firstRun";
import { startPanes } from "../../projects/workspaceStart";
import { installDom, mount, settle } from "../../tasks/fakeDom";
import type { WindowBag } from "../windowBag";
import { WindowStoreProvider } from "./store";

type Case = { folders: number; askOff?: boolean; panes?: number; sheet?: boolean; notStarted?: boolean };

async function draw(c: Case) {
  const { doc, win } = installDom();
  Object.assign(win, { setTimeout, clearTimeout, setInterval, clearInterval });
  const { default: WindowHosts } = await import("./Hosts");
  const openStart = vi.fn();
  const firstFolder = { current: false };
  seen.wizard = null;
  function Host() {
    const [wizard, setWizard] = useState<number | null>(0);
    const [c0] = useState(() => closer(() => Promise.resolve(), () => setWizard(null), () => {}));
    const endWizard = (o: "completed" | "dismissed", after?: () => void) => c0.end(o, after);
    const projects = Array.from({ length: c.folders }, (_, i) => ({ id: `p${i}`, name: `App ${i}`, path: `C:\\w\\app${i}` }));
    const bag = {
      wizard, settings: c.askOff ? { [START_ASK_KEY]: false } : {}, saveSetting: () => {},
      wizardClose: c0, endWizard, firstFolder, projects, activeDir: projects[0]?.path ?? null,
      wizardSession: (open: () => void) => (c0.retry() ? undefined : endWizard("completed", open)),
      pickFolder: () => {}, screen: "grid", setScreen: () => {}, settingsRead: true, picked: null, notes: [], repoless: false,
      putNote: () => {}, setNotes: () => {}, setPicked: () => {}, reviewTargets: [], sendMenu: null, setSendMenu: () => {},
      sendReview: () => {}, startReview: () => {}, agents: [], defaultId: null, live: [],
      panes: c.notStarted // job 78 R73-1: the pane setup's "Pick a folder" really leaves (select -> startPanes)
        ? startPanes(projects[0].path, null, 1, () => 0)
        : Array.from({ length: c.panes ?? 0 }, (_, i) => ({ key: `k${i}`, agent: "claude" })),
      ptys: { current: {} }, titles: {}, owner: {}, restoredKeys: { current: [] }, setToast: () => {}, openStart,
      setSidebarOpen: () => {}, sheet: c.sheet ? { key: "s", agent: "claude", seats: [] } : null,
      firstStart: null, doneFirstStart: () => {},
    } as unknown as WindowBag;
    return createElement(WindowStoreProvider, { store: bag, children: createElement(WindowHosts) });
  }
  const { unmount } = await mount(createElement(Host), doc);
  await settle();
  const wizard = seen.wizard as WizardProps | null; // set by the stub Wizard during the draw
  if (!wizard) throw new Error("the setup screens were not drawn");
  return { openStart, firstFolder, wizard, unmount };
}

test("job 68: setup closed with a folder on the list and no pane opens the Start form once, on the folder in front", async () => {
  const d = await draw({ folders: 1 });
  d.wizard.onClose();
  await settle();
  expect(d.openStart).toHaveBeenCalledTimes(1);
  expect(d.openStart).toHaveBeenCalledWith({ here: true });
  expect(d.firstFolder.current).toBe(false);
  await d.unmount();
});

test("job 68: setup closed with a folder, but the ask at start is switched off: no Start form", async () => {
  const d = await draw({ folders: 1, askOff: true });
  d.wizard.onClose();
  await settle();
  expect(d.openStart).not.toHaveBeenCalled();
  await d.unmount();
});

test("job 68: setup (reopened from Help) closed over an open pane: no Start form", async () => {
  const d = await draw({ folders: 1, panes: 1 });
  d.wizard.onClose();
  await settle();
  expect(d.openStart).not.toHaveBeenCalled();
  await d.unmount();
});

test("job 78 R73-1: setup closed after Pick a folder left a pane not started yet: the Start form opens once", async () => {
  const d = await draw({ folders: 1, notStarted: true });
  d.wizard.onClose();
  await settle();
  expect(d.openStart).toHaveBeenCalledTimes(1);
  expect(d.openStart).toHaveBeenCalledWith({ here: true });
  await d.unmount();
});

test("job 68: setup closed while a Start form is already open: no second one", async () => {
  const d = await draw({ folders: 1, sheet: true });
  d.wizard.onClose();
  await settle();
  expect(d.openStart).not.toHaveBeenCalled();
  await d.unmount();
});

test("job 68: setup closed with no folder: no Start form now, and the first folder added will open it (as before)", async () => {
  const d = await draw({ folders: 0 });
  d.wizard.onClose();
  await settle();
  expect(d.openStart).not.toHaveBeenCalled();
  expect(d.firstFolder.current).toBe(true);
  await d.unmount();
});

test("job 68: setup finished opens the Start form once, and a close in the same moment does not open a second", async () => {
  const d = await draw({ folders: 1 });
  d.wizard.onSession();
  d.wizard.onClose();
  await settle();
  expect(d.openStart).toHaveBeenCalledTimes(1);
  expect(d.openStart).toHaveBeenCalledWith({ here: true });
  await d.unmount();
});
