// T-692 (E3, palette.md:7): the palette offers the sidebar's project commands (Add project, New group,
// Scan for repos) as Quick actions run through runProjectCommand, and lists the unbound Open Automations.
import { expect, test } from "vitest";
import { resolve } from "../keys/keymap";
import { commandRows } from "../keys/commands";
import source from "./paneActions.ts?raw";

test("the palette maps every project command to a Quick action that runs it", () => {
  expect(source).toMatch(/\.\.\.PROJECT_COMMANDS\.map\(\(c\) => \(\{ section: "Quick actions", label: c\.label, hint: c\.hint, run: \(\) => runProjectCommand\(c\.id\) \}\)\)/);
});

test("view.automations has no chord but is still a Commands row", () => {
  const rows = commandRows(resolve(null, "win32"), []);
  expect(rows.some((r) => r.label === "Open Automations")).toBe(true);
});
