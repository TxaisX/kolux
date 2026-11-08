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

// What src/ declares: data-testid="name", or data-testid={`name-${x}`} (a template, read as a pattern).
const literal = new Set([...src.matchAll(/data-testid="([a-z0-9-]+)"/g)].map((m) => m[1]));
const patterns = [...src.matchAll(/data-testid=\{`([^`]+)`\}/g)].map((m) => {
  const body = m[1].split(/\$\{[^}]*\}/).map((part) => part.replace(/[.*+?^()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${body.join("[a-z0-9-]+")}$`);
});
const declared = (id) => literal.has(id) || patterns.some((re) => re.test(id));

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

test("smoke.mjs no longer matches the controls it clicks by label or class", () => {
  for (const stale of ['aria-label="Add project"', "data-add-by-path", 'aria-label="project folder"', "button.ib.panel", ".layouts", "section.pane", "button.newtab", 'title^="Split right"', 'title^="New session"'])
    expect(smoke, stale).not.toContain(stale);
});
