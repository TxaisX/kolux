// T-697 / DT-C133 (UX live audit W3 G9b): the five lone checkboxes are named for what they tick and sit in a
// label at least 24px square. No DOM in this run, so each box is found in its source by its role (a checkbox
// input) and its accessible name (its aria-label), and its wrapper and the wrapper's rule are checked.
import { expect, test } from "vitest";
import allChanges from "../editor/AllChangesPane.tsx?raw";
import changeTree from "../editor/ChangeTree.tsx?raw";
import skills from "../skills/SkillsPage.tsx?raw";
import space from "../space/SpaceView.tsx?raw";
import pullRequest from "../tasks/PullRequestPage.tsx?raw";
import agents from "../settings/AgentsPage.tsx?raw";
import recipes from "../settings/AiRecipesSection.tsx?raw";
import repoSetup from "../settings/RepoSetup.tsx?raw";

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
  expect(src.slice(0, at).trimEnd(), "inside the hit-box label").toMatch(/<label className="hit-box"[^>]*>$/);
  expect(src.slice(at + inputs[0][0].length).trimStart().startsWith("</label>"), "the label holds only the box").toBe(true);
});

// T-701 / DT-C137 (live verify G9): the three label rows still under 24px, each found by its page and its text

const rows: [string, string, RegExp, string][] = [
  ["Git and worktrees: Show the AI actions in Source Control", recipes, /<label className="look-select">\s*<input type="checkbox"[^]*?\/> Show the AI actions in Source Control/, ".look-select"],
  ["Repository: Wait for setup", repoSetup, /<label className="check">\s*<input type="checkbox" aria-label="Wait for setup"/, ":where(label).check"],
  ["Agents: each agent's switch", agents, /<label className="agent-on">(?:(?!<\/label>)[^])*?<input type="checkbox" role="switch"/, ".agent-on"],
];
const ruleFor = (sel: string) => [...styles.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)].filter((m) => m[2].split(",").some((s) => s.trim() === sel)).map((m) => m[3]).join(";");

test.each(rows)("%s sits in a flex row at least 24px tall", (_, src, markup, sel) => {
  expect(src, "the label class around the box").toMatch(markup);
  const rule = ruleFor(sel);
  for (const d of ["display: flex", "align-items: center", "min-height: 24px"]) expect(rule, `${sel} ${d}`).toMatch(new RegExp(`(^|;)\\s*${d}\\s*(;|$)`));
});

test("the hit-box label is at least 24px square", () => {
  const rule = styles.match(/\.hit-box \{([^}]*)\}/)?.[1] ?? "";
  for (const d of ["min-width: 24px", "min-height: 24px", "flex: none"]) expect(rule, d).toContain(d);
  // the box's own margin would push the label past 24px
  expect(styles).toMatch(/\.hit-box input \{ margin: 0; \}/);
});
