import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { GitView, namingPatch } from "./GitPage";

const view = (settings: Record<string, unknown>, draft = "", check: { prefix: string; refused: boolean } | null = null) =>
  renderToString(createElement(GitView, { settings, save: () => {}, draft, setDraft: () => {}, check }));

test("T-116-a-fix: the branch prefix, its sample and the default compare base live on Settings > Git & worktrees", () => {
  const html = view({}, "", { prefix: "txais-xiong/", refused: false });
  const card = html.slice(html.indexOf('data-section="branches"'));
  expect(card).toContain("Branch prefix");
  expect(card).toContain('aria-label="branch prefix"');
  expect(card).toMatch(/Next branch: <code>txais-xiong\/&lt;name&gt;<\/code>/);
  expect(card).toContain("Default compare base");
  expect(card).not.toContain("custom branch prefix");
  expect(html.indexOf('data-section="branches"')).toBeLessThan(html.indexOf('data-section="deleting"'));
});

test("T-116-a-fix: a custom prefix shows its field, and a refused one warns", () => {
  const html = view({ branchPrefix: "custom", branchPrefixCustom: "a b", scmSummaryUpstream: true }, "a b", { prefix: "", refused: true });
  expect(html).toContain('aria-label="custom branch prefix"');
  expect(html).toContain('role="alert"');
  expect(html).toContain("Git does not accept");
  expect(html).toMatch(/<option value="upstream" selected="">Branch upstream/);
});

test("T-116-b: renaming branches after the work is on by default and switches off", () => {
  const on = view({});
  expect(on).toMatch(/aria-label="Name the branch after the work"[^>]*checked=""/);
  expect(on).toContain("is renamed to a short description");
  const off = view({ renameBranches: false });
  expect(off).not.toMatch(/aria-label="Name the branch after the work"[^>]*checked=""/);
  expect(off).toContain("keeps the branch name Kolux suggested");
  expect(view({ renameBranches: true })).toContain("is renamed to a short description");
});

test("T-725: one Branch names card with one naming switch, which reads and writes both stored keys", () => {
  const html = view({});
  expect(html.match(/>Branch names</g)).toHaveLength(1);
  expect(html.match(/aria-label="Name the branch after the work"/g)).toHaveLength(1);
  expect(html).not.toContain('data-section="auto-branch"');
  expect(view({ autoBranchName: false, autoBranchChosen: true })).toContain("keeps the branch name Kolux suggested");
  expect(namingPatch(true)).toEqual({ renameBranches: true, autoBranchName: true, autoBranchChosen: true });
  expect(namingPatch(false)).toEqual({ renameBranches: false, autoBranchName: false, autoBranchChosen: true });
});

test("T-116-b: updating the local base first stays off by default", () => {
  expect(view({})).not.toMatch(/aria-label="Refresh the base first"[^>]*checked=""/);
  expect(view({ refreshBaseFirst: true })).toMatch(/aria-label="Refresh the base first"[^>]*checked=""/);
});

test("T-228-d: the writer picker lists the agents, shows model and effort for a chosen agent, and the branch-naming switch is on by default", () => {
  const html = view({ commitWriter: "codex", commitWriterModel: "gpt-5", commitWriterEffort: "high" });
  expect(html).toContain('aria-label="commit message writer"');
  expect(html).toMatch(/<option value="codex" selected="">/);
  for (const id of ["claude", "amp", "kimi", "copilot", "pi", "cursor", "antigravity"]) expect(html).toContain(`<option value="${id}"`);
  expect(html).toContain('aria-label="commit message model"');
  expect(html).toContain('value="gpt-5"');
  expect(html).toContain('aria-label="Name the branch after the work"');
  expect(html).toMatch(/aria-label="Name the branch after the work" checked=""/);
  const off = view({ autoBranchName: false, autoBranchChosen: true });
  expect(off).not.toMatch(/aria-label="Name the branch after the work" checked=""/);
});

test("T-110-b: asking to rename the folder is on by default, switches off, and goes with the branch-rename switch", () => {
  const on = view({});
  expect(on).toMatch(/aria-label="Ask to rename the folder too"[^>]*checked=""/);
  expect(on).toContain("asks before renaming the folder on disk");
  const off = view({ renameFolders: false });
  expect(off).not.toMatch(/aria-label="Ask to rename the folder too"[^>]*checked=""/);
  expect(off).toContain("the folder keeps its name");
  expect(view({ renameBranches: false })).not.toContain("Ask to rename the folder too");
});

test("the Source Control group-order section is gone, and the AI card says what it writes", () => {
  const html = view({});
  expect(html).not.toContain('data-section="scm-groups"');
  expect(html).not.toContain("Group order");
  expect(html).toContain("Let AI write Git text (branch names, pull request titles and descriptions)");
  expect(html).toContain("Show the AI actions in Source Control"); // still the scmAiHidden switch
});
