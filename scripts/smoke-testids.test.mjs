// Every data-testid that scripts/evidence/smoke.mjs looks for is present in the app's source, so a renamed or
// removed control fails here, in a fast test, instead of as a timeout in a ten-minute smoke run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const smoke = readFileSync(join(root, "scripts/evidence/smoke.mjs"), "utf8");

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
  });
const src = sources(join(root, "src")).join("\n");

// The ids smoke.mjs uses: tid("name"), or tid(`name-${x}`) for a family, read as name-0.
const fixed = [...smoke.matchAll(/\btid\("([a-z0-9-]+)"\)/g)].map((m) => m[1]);
const family = [...smoke.matchAll(/\btid\(`([^`]+)`\)/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, "0"));
const used = [...new Set([...fixed, ...family])];

// What src/ declares: data-testid="name", data-testid={`name-${x}`} (a template, read as a pattern), or a
// conditional assignment such as data-testid={folder ? "sidebar-folder" : undefined}.
const literal = new Set([...src.matchAll(/data-testid="([a-z0-9-]+)"/g)].map((m) => m[1]));
const conditional = new Set([...src.matchAll(/data-testid=\{[^}]*?"([a-z0-9-]+)"[^}]*?\}/g)].map((m) => m[1]));
const patterns = [...src.matchAll(/data-testid=\{`([^`]+)`\}/g)].map((m) => {
  const body = m[1].split(/\$\{[^}]*\}/).map((part) => part.replace(/[.*+?^()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${body.join("[a-z0-9-]+")}$`);
});
const declared = (id) => literal.has(id) || conditional.has(id) || patterns.some((re) => re.test(id));

test("smoke.mjs finds its elements by test id", () => {
  expect(used.length).toBeGreaterThanOrEqual(15);
});

test.each(used)("src/ carries data-testid %s", (id) => {
  expect(declared(id)).toBe(true);
});

test("flow 3 checks the Explorer delete prompt by test id, not the removed Source Control Discard", () => {
  for (const id of ["explorer-tree", "ask-dialog", "ask-body", "ask-cancel", "ask-confirm"]) expect(used, id).toContain(id);
  expect(used).not.toContain("scm-discard-file");
  expect(smoke).not.toContain('[role="alertdialog"]');
  expect(smoke).not.toContain(".btn-row");
});

test("the check itself catches a missing id", () => {
  expect(declared("no-such-control")).toBe(false);
});

test("flow 6 starts every agent the New session menu offers, from that menu", () => {
  // The rows it clicks are the menu's own data-testid rows, not the visible text a rename would change.
  expect(src).toContain("data-testid={`new-session-item-${a.id}`}");
  expect(declared("new-session-menu")).toBe(true);
  expect(declared("new-session-item-claude")).toBe(true);
  expect(declared("new-session-item-opencode")).toBe(true);
  for (const label of ["Claude Code", "Codex", "Grok", "OpenCode", "Blank terminal"]) expect(smoke, label).toContain(label);
});

test("flow 7 asserts the sidebar's real folder row and that the removed pane-row class stays gone", () => {
  // The folder row is data-testid="sidebar-folder" (src/projects/ProjectsPanel.tsx). Since 0.1.16 the sidebar lists
  // project folders only, so the smoke asks for "sidebar-session" by its raw attribute and fails when one shows: an
  // id checked for absence is not one of the ids src/ must carry.
  // pane-row was removed and four live checks still queried it, so this keeps the smoke from ever re-adopting it.
  expect(smoke).toContain("sidebar-folder");
  expect(smoke).toContain('[data-testid="sidebar-session"]');
  expect(used).not.toContain("sidebar-session");
  expect(smoke).toContain("sessions > 0");
  expect(smoke).toContain(".pane-row");
  expect(src).not.toContain("pane-row");
});

test("flow 1 grows the grid through the Start form, by test id", () => {
  // Start form E (2026-11-15): the layout strip opens the Start form for the cells it adds; no empty panes.
  // Only flow 1 uses these two ids and this message; the other Start form ids are also used by the setup's first shell.
  for (const id of ["all-agents", "seat-0-agents"]) expect(used, id).toContain(id);
  expect(smoke).toContain("before Start was pressed");
  expect(smoke).not.toContain("empty pane(s) at Layout 4");
});

test("smoke.mjs no longer matches the controls it clicks by label or class", () => {
  for (const stale of ['aria-label="Add project"', "data-add-by-path", 'aria-label="project folder"', "button.ib.panel", ".layouts", "section.pane", "button.newtab", 'title^="Split right"', 'title^="New session"'])
    expect(smoke, stale).not.toContain(stale);
});
