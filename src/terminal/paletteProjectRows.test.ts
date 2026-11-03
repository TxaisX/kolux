// T-692 (E3, palette.md:7): the palette offers the sidebar's project commands as Quick actions that run
// them (runProjectCommand itself is tested in projects/uxRows4.test.ts), and lists the unbound Open Automations.
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => void vi.useRealTimers());
import { resolve } from "../keys/keymap";
import { commandRows } from "../keys/commands";
import { projectRows } from "./projectRows";

test("each project command is a Quick action with its hint; running it shows the sidebar, then runs that command", () => {
  vi.useFakeTimers();
  const seen: string[] = [];
  const rows = projectRows(() => void seen.push("show"), (id) => void seen.push(id));
  expect(rows.map((r) => [r.section, r.label, r.hint])).toEqual([
    ["Quick actions", "Add project", "Pick a folder or clone a repository"],
    ["Quick actions", "New group", "Make a group to sort projects into"],
    ["Quick actions", "Scan for repos", "Look through a folder for git repositories"],
  ]);
  rows[0].run();
  expect(seen).toEqual(["show"]); // the panel's listener is not in yet
  vi.runAllTimers();
  rows[1].run();
  rows[2].run();
  vi.runAllTimers();
  expect(seen).toEqual(["show", "project.add", "show", "show", "project.newGroup", "project.scan"]);
});

test("view.automations has no chord but is still a Commands row", () => {
  expect(commandRows(resolve(null, "win32"), []).some((r) => r.label === "Open Automations")).toBe(true);
});
