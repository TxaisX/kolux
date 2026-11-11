// DT-C268: rows of a list that is filtered as you type keep their keys while they are in the list.
import { expect, test } from "vitest";
import { rowKeys } from "./rowKeys";
import palette from "../projects/WorktreePalette.tsx?raw";
import tabSearch from "./TabSearch.tsx?raw";

test("DT-C268: a row's key is what the row is, never where it is", () => {
  const before = ["Settings|General", "Settings|Appearance", "Quick actions|New session"];
  expect(rowKeys(before)).toEqual(before);
  // rows arriving above (open tabs, workspaces) and between leave every other row's key as it was
  const after = ["Open tabs|Terminal 7", "Workspaces|atlas", ...before.slice(0, 2), "Settings|Agents", before[2]];
  const keys = rowKeys(after);
  for (const name of before) expect(keys[after.indexOf(name)], name).toBe(name);
  // and a row that leaves takes only its own key with it
  expect(rowKeys(before.filter((n) => n !== "Settings|Appearance"))).toEqual(["Settings|General", "Quick actions|New session"]);
});

test("DT-C268: two rows that read the same still have keys of their own, and the first keeps the plain one", () => {
  const keys = rowKeys(["a", "b", "a", "a", "b"]);
  expect(new Set(keys).size).toBe(5);
  expect(keys[0]).toBe("a");
  expect(keys[1]).toBe("b");
  // a row's name cannot be mistaken for another's numbered key
  expect(new Set(rowKeys(["a", "a", "a\u00001"])).size).toBe(3);
});

test("DT-C268: Go to / Run a command and tab search key their rows that way", () => {
  for (const [name, src] of [["WorktreePalette.tsx", palette], ["TabSearch.tsx", tabSearch]] as const) {
    expect(src, name).toContain("rowKeys(rows.map(");
    expect(src, name).toMatch(/key=\{keys\[i\]\}/);
    // no row key built from the row's position any more
    expect(src, name).not.toMatch(/key=\{`[^`]*\$\{i\}[^`]*`\}/);
  }
});
