// Job 13 F1: the Start form knows the project folders whether or not the sidebar is shown, waits for them at open,
// and its "Add folder" reaches the one Add project dialog even with the sidebar hidden or on the Agents screen.
import { expect, test } from "vitest";
import type { Project } from "../projects/model";
import { readProjectsOnce } from "../projects/useWorkspaces";
import { addFolderVia, askAtOpen } from "./startForm";
import workspacesSrc from "../projects/useWorkspaces.ts?raw";
import seatChooserSrc from "../shell/window/SeatChooser.tsx?raw";
import contentSrc from "../shell/window/Content.tsx?raw";

const w = { on: true, firstWindow: true, asked: false, settingsRead: true, agentsDone: true, projectsRead: true, launching: false, sheetOpen: false };

test("F1: the ask at open waits until the project list has been read", () => {
  expect(askAtOpen({ ...w, projectsRead: false })).toBe("wait");
  expect(askAtOpen(w)).toBe("ask");
  // the window passes it in
  expect(contentSrc).toContain("projectsRead, launching");
});

const proj = (id: string) => ({ id, name: id, path: `C:/${id}` }) as unknown as Project;

test("F1: the window reads project_list once at start, outside the sidebar's panel, into the one list", async () => {
  expect(workspacesSrc).toContain('invoke<Project[]>("project_list")');
  let list: Project[] = [];
  const set = (v: Project[] | ((c: Project[]) => Project[])) => void (list = typeof v === "function" ? v(list) : v);
  let read = false;
  await readProjectsOnce(async () => [proj("a"), proj("b")], set, () => void (read = true));
  expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  expect(read).toBe(true);
  // a list the sidebar already wrote is not replaced
  list = [proj("z")];
  await readProjectsOnce(async () => [proj("a")], set, () => {});
  expect(list.map((p) => p.id)).toEqual(["z"]);
  // a failed read (or a throw outside Tauri) still marks it read, so the ask at open is not held for ever
  list = [];
  read = false;
  await readProjectsOnce(() => { throw new Error("no tauri"); }, set, () => void (read = true));
  expect(list).toEqual([]);
  expect(read).toBe(true);
  // after unmount nothing is written
  read = false;
  await readProjectsOnce(async () => [proj("a")], set, () => void (read = true), () => false);
  expect(list).toEqual([]);
  expect(read).toBe(false);
});

const hands = (shownAfter: number | null) => {
  const log: string[] = [];
  let calls = 0;
  let shownAt: number | null = null;
  return {
    log,
    h: {
      panelShown: () => shownAt !== null && calls >= shownAt,
      showPanel: () => {
        log.push("show");
        if (shownAfter !== null) shownAt = calls + shownAfter;
      },
      fire: () => void log.push("fire"),
      wait: async () => void calls++,
    },
    shownNow: () => (shownAt = 0),
  };
};

test("F1: with the sidebar hidden, Add folder shows the panel, then fires the same Add project request", async () => {
  const t = hands(2);
  expect(await addFolderVia(t.h)).toBe(true);
  expect(t.log).toEqual(["show", "fire"]);
});

test("F1: with the panel already drawn, Add folder fires at once and changes nothing else", async () => {
  const t = hands(null);
  t.shownNow();
  expect(await addFolderVia(t.h)).toBe(true);
  expect(t.log).toEqual(["fire"]);
});

test("F1: if the panel never comes, nothing is fired", async () => {
  const t = hands(null);
  expect(await addFolderVia(t.h, 3)).toBe(false);
  expect(t.log).toEqual(["show"]);
});

test("F1: the form's Add folder goes through addFolderVia, opening the sidebar and leaving the Agents screen", () => {
  expect(seatChooserSrc).toContain("addFolderVia({");
  expect(seatChooserSrc).toContain("setSidebarOpen(true)");
  expect(seatChooserSrc).toContain('if (!showsProjects(screen)) setScreen("terminals")');
  expect(seatChooserSrc).toContain("window.dispatchEvent(new CustomEvent(ADD_PROJECT))");
});
