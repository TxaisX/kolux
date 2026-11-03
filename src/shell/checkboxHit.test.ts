// T-697 / DT-C133 (UX live audit W3 G9b): the five lone checkboxes are named for what they tick and sit in a
// label at least 24px square. No DOM in this run, so each box is found in its source by its role (a checkbox
// input) and its accessible name (its aria-label), and its wrapper and the wrapper's rule are checked.
import { expect, test } from "vitest";
import allChanges from "../editor/AllChangesPane.tsx?raw";
import changeTree from "../editor/ChangeTree.tsx?raw";
import skills from "../skills/SkillsPage.tsx?raw";
import space from "../space/SpaceView.tsx?raw";
import pullRequest from "../tasks/PullRequestPage.tsx?raw";

// CSS ?raw comes back empty under vitest, so read the file
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const styles = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const boxes: [string, string, string][] = [
  ["AllChangesPane", allChanges, "Viewed ${name}"],
  ["ChangeTree", changeTree, "Viewed ${rel}"],
  ["SkillsPage", skills, "Choose ${s.name}"],
  ["SpaceView", space, "Select ${labelOf(r)}"],
  ["PullRequestPage", pullRequest, "Viewed ${f.filename}"],
];

test.each(boxes)("%s: the checkbox has its name and a 24px hit area", (_, src, name) => {
  const inputs = [...src.matchAll(/<input\s[^]*?\/>/g)].filter((m) => /type="checkbox"/.test(m[0]) && m[0].includes(`aria-label={\`${name}\`}`));
  expect(inputs, "one checkbox with this name").toHaveLength(1);
  const at = inputs[0].index!;
  expect(src.slice(0, at).trimEnd().endsWith('<label className="hit-box">'), "inside the hit-box label").toBe(true);
  expect(src.slice(at + inputs[0][0].length).trimStart().startsWith("</label>"), "the label holds only the box").toBe(true);
});

test("the hit-box label is at least 24px square", () => {
  expect(styles).toMatch(/\.hit-box \{[^}]*min-width: 24px;[^}]*min-height: 24px;/);
});
