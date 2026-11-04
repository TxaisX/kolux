// C09-R5-01: a file link in an agent reply used to add an editor tab behind the Agents screen and
// bring nothing forward: on that screen Grid pins the drawn tab to the selected session, so the new
// tab was inert. openFile now leaves the screen, so the tab it focuses is the one drawn.
// No DOM in this run, so the gate reads the three sources, as the other wiring gates do.
import { expect, test } from "vitest";
import actions from "../terminal/paneActions.ts?raw";
import content from "../shell/window/Content.tsx?raw";
import grid from "../shell/window/Grid.tsx?raw";

const between = (src: string, from: string, to: string) => {
  const at = src.indexOf(from);
  return at < 0 ? "" : src.slice(at, src.indexOf(to, at));
};

test("C09-R5-01: on the Agents screen the drawn tab is the selected session, whatever was focused", () => {
  expect(grid).toContain("const active = mine ? (selected as number) : activeOf(c);");
  expect(grid).toContain("hidden={agentsScreen ? !mine :");
});

test("C09-R5-01: opening a file leaves the Agents screen, on both the new-tab and the already-open path", () => {
  const openFile = between(actions, "const openFile =", "// EDIT-014");
  expect(openFile).not.toBe("");
  const leave = openFile.indexOf('setScreen("terminals")');
  expect(leave).toBeGreaterThan(-1);
  // before the early return, so a file already open in the cell comes forward too
  expect(leave).toBeLessThan(openFile.indexOf("if (same)"));
  expect(openFile).toContain("return setFocused(same.key);");
  // the chat's file links are the ones this fixes
  expect(content).toContain("onOpenFile: (path, line, column) => openFile(path, line, column)");
});
