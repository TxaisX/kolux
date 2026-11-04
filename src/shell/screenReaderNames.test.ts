// T-755 (DT-C191): what a screen reader hears. Shortcuts: Add, Disable and Reset name their command and the
// recording hint is announced; tab search: the field has a name and points at the highlighted tab; the
// needs-strip chips are buttons in a group, not list items.
import { expect, test } from "vitest";
import shortcuts from "../settings/ShortcutsPage.tsx?raw";
import tabSearch from "./TabSearch.tsx?raw";
import content from "./window/Content.tsx?raw";

test("Shortcuts: each row's buttons say which command, and recording start is announced", () => {
  for (const name of ["Add a shortcut for ${r.title}", "Disable ${r.title}", "Reset ${r.title}"]) expect(shortcuts).toContain(`aria-label={\`${name}\`}`);
  expect(shortcuts).toMatch(/at >= 0 && <p className="keys-hint" role="alert">/);
});

test("Tab search: the field is named and follows the highlighted tab", () => {
  expect(tabSearch).toContain('aria-label="Search open tabs"');
  expect(tabSearch).toContain("aria-activedescendant={rows[at] ? `ts-${at}` : undefined}");
  expect(tabSearch).toContain("id={`ts-${i}`} role=\"option\"");
});

test("Needs-strip chips are buttons, not list items", () => {
  const strip = content.slice(content.indexOf('className="needs-strip"'), content.indexOf("</div>", content.indexOf('className="needs-strip"')));
  expect(strip).toContain('role="group"');
  expect(strip).not.toContain("listitem");
});
