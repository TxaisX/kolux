// T-760 (DT-C196): a commit in Source Control's history is reached by Tab and opened or closed with Enter or
// Space, as a click does; it says whether its files are showing. (History loads after the first render, so this
// checks the row's source.)
import { expect, test } from "vitest";
import panel from "./SourceControlPanel.tsx?raw";

test("a commit row is a keyboard button that opens its files like a click", () => {
  const at = panel.indexOf("data-commit-row={c.short}");
  const row = panel.slice(at, panel.indexOf("onContextMenu", at));
  expect(row).toContain('role="button"');
  expect(row).toContain("tabIndex={0}");
  expect(row).toContain("aria-expanded={picked?.hash === c.hash}");
  expect(row).toMatch(/onKeyDown=[\s\S]*?"Enter"[\s\S]*?" "[\s\S]*?pickCommit\(c\)/);
  // Ctrl/Cmd+Enter is the panel's commit key; it must not also open or close the focused row.
  expect(row).toMatch(/onKeyDown=[\s\S]*?!e\.ctrlKey && !e\.metaKey[\s\S]*?pickCommit\(c\)/);
});
