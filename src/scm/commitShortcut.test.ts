// C10-R2-01: Ctrl+Enter commits only from a commit message box. A key pressed in a pull request
// description or a checks field is that field's own, and writes no commit. Audit F16: the Source
// Control panel these tests mounted was removed; the pull request composer and the checks panel stay,
// and still carry no commit shortcut and no commit call.
import { expect, test } from "vitest";
import prStartSrc from "./PrStart.tsx?raw";
import checksSrc from "./ChecksPanel.tsx?raw";

test("the pull request composer and the checks panel hold no commit shortcut", () => {
  for (const src of [prStartSrc, checksSrc]) {
    expect(src).not.toContain("isCommitShortcut");
    expect(src).not.toContain("scm_commit");
  }
});
