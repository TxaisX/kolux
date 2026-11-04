// C10-R1-01: the merge box acts on the pull request it read, not on whichever one a later lookup
// finds on the same branch. No DOM in this run, so the gate reads the panel's source, as the other
// Source Control wiring gates do (panelUx.test.ts, SourceControlPanel.keys.test.ts).
import { expect, test } from "vitest";
import src from "./SourceControlPanel.tsx?raw";

const between = (from: string, to: string) => {
  const at = src.indexOf(from);
  return at < 0 ? "" : src.slice(at, src.indexOf(to, at));
};

const runMerge = between("const runMerge", "const main = mainStep");

test("C10-R1-01: the merge box keeps the pull request it read", () => {
  // the box's own state carries the URL, so the label, the buttons and the click are one reading
  expect(src).toMatch(/const \[merge, setMerge\] = useState<\{ url: string;/);
  // a late scm_merge_info answer for a superseded URL is dropped, not painted on the new box
  expect(src).toContain("m && m.url === url");
  expect(src).toContain("info: m?.url === url ? m.info : null");
});

test("C10-R1-01: the click sends the URL the box read, and a swap closes the box", () => {
  expect(runMerge).not.toContain("look.pr.url");
  expect(runMerge).toContain("const url = merge.url;");
  expect(src).toContain('await invoke("scm_merge", { worktree: dir, url, action: a.action, method: a.method })');
  // another pull request on the branch closes the box, with the confirm state it held
  expect(src).toMatch(/\[lookKey, look\.pr\?\.url\]/);
});
