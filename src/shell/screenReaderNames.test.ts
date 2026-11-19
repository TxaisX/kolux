// T-755 (DT-C191): what a screen reader hears. Tab search: the field has a name and points at the highlighted tab; the
// needs-strip chips are buttons in a group, not list items. T-758 (DT-C194): the field is a combobox that controls the named list, whose
// options are reached by the arrows only, and the no-match line sits outside the list.
import { expect, test } from "vitest";
import tabSearch from "./TabSearch.tsx?raw";
import content from "./window/Content.tsx?raw";

test("Tab search: the field is named and follows the highlighted tab", () => {
  expect(tabSearch).toContain('aria-label="Search open tabs"');
  expect(tabSearch).toContain("aria-activedescendant={rows[at] ? `ts-${at}` : undefined}");
  expect(tabSearch).toContain("id={`ts-${i}`} role=\"option\"");
  expect(tabSearch).toMatch(/role="combobox"\s+aria-expanded=\{rows.length > 0\}\s+aria-controls="ts-l"/);
  expect(tabSearch).toContain('id="ts-l" role="listbox" aria-label="Open tabs"');
  expect(tabSearch).toContain('role="option" tabIndex={-1}');
  const list = tabSearch.slice(tabSearch.indexOf('role="listbox"'), tabSearch.indexOf("</div>", tabSearch.indexOf('role="listbox"')));
  expect(list).not.toContain("menu-hint");
});

test("Needs-strip chips are buttons, not list items", () => {
  const strip = content.slice(content.indexOf('className="needs-strip"'), content.indexOf("</div>", content.indexOf('className="needs-strip"')));
  expect(strip).toContain('role="group"');
  expect(strip).not.toContain("listitem");
});
