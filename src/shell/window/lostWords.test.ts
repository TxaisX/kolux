import { expect, test } from "vitest";
import { lostWords } from "./lostWords";
import pane from "./Pane.tsx?raw";

test("each special kind names what is missing and does not promise a terminal", () => {
  expect(lostWords("editor").title).toContain("file");
  expect(lostWords("diff").title).toContain("diff");
  expect(lostWords("changes").title).toContain("changes view");
  expect(lostWords("check").title).toContain("check");
  expect(lostWords("preview").title).toContain("preview");
  expect(lostWords("browser").title).toContain("browser page");
  expect(lostWords("editor").body).toContain("did not start a terminal");
});

test("a pane with a kind never reaches the terminal, even when its data is missing", () => {
  const before = pane.slice(0, pane.indexOf("<TerminalPane"));
  expect(before).toMatch(/if \(p\.kind\) \{?\s*return <LostPane/);
});
