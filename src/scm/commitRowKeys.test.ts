// T-760 (DT-C196): a commit in Source Control's history is reached by Tab and opened or closed with Enter or
// Space, as a click does; it says whether its files are showing. Ctrl/Cmd+Enter on a focused row is still the
// commit key and does not also open the row. (History loads after the first render, so this checks the row's
// source: both halves of the chord live in the same handler, in that order.)
import { expect, test } from "vitest";
import panel from "./SourceControlPanel.tsx?raw";

const rowSource = () => {
  const at = panel.indexOf("data-commit-row={c.short}");
  return panel.slice(at, panel.indexOf("onContextMenu", at));
};
const keySource = () => {
  const row = rowSource();
  return row.slice(row.indexOf("onKeyDown"), row.indexOf("onContextMenu"));
};

test("a commit row is a keyboard button that opens its files like a click", () => {
  const row = rowSource();
  expect(row).toContain('role="button"');
  expect(row).toContain("tabIndex={0}");
  expect(row).toContain("aria-expanded={picked?.hash === c.hash}");
  expect(row).toMatch(/onKeyDown=[\s\S]*?"Enter"[\s\S]*?" "[\s\S]*?pickCommit\(c\)/);
  // Ctrl/Cmd+Enter is the panel's commit key; it must not also open or close the focused row.
  expect(row).toMatch(/onKeyDown=[\s\S]*?!e\.ctrlKey && !e\.metaKey[\s\S]*?pickCommit\(c\)/);
});

test("Ctrl/Cmd+Enter on a focused commit row commits again, as DT-C196 says", () => {
  const keys = keySource();
  // The commit half: the same shortcut the message field uses, calling commit() itself.
  expect(keys).toMatch(/isCommitShortcut\(e\.nativeEvent\)[\s\S]*?commit\(\)/);
  // It prevents the default and leaves before the open, so the chord never also opens or closes the row.
  const beforeOpen = keys.slice(0, keys.indexOf("pickCommit(c)"));
  expect(beforeOpen).toMatch(/isCommitShortcut\(e\.nativeEvent\)[\s\S]*?e\.preventDefault\(\)[\s\S]*?return;/);
  expect(beforeOpen).not.toMatch(/"Enter"[\s\S]*?pickCommit\(c\)/);
});
