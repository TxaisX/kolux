// T-722 (DT-C158): the Explorer's delete question opens with focus on Cancel, not on the button that deletes,
// so an Enter or Space pressed straight after picking Delete removes nothing. T-729 (DT-C165): the question
// is the one Ask dialog, whose Cancel holds focus when it opens and whose Enter confirms only on prompts that
// opt in (chrome/Ask.test.ts proves both).
import { expect, test } from "vitest";
import source from "./Explorer.tsx?raw";

test("T-722: the Explorer delete question is Ask, so Cancel has focus and Enter does not delete", () => {
  const start = source.search(/<Ask\s+title="Delete"/);
  expect(start, "the delete question").toBeGreaterThan(0);
  const ask = source.slice(start, source.indexOf("/>", start));
  expect(ask).toMatch(/onConfirm=\{\(\) => doDelete\(asking\)\}/);
  expect(ask).toMatch(/onCancel=\{\(\) => \(setAsking\(null\)/);
  expect(ask).not.toMatch(/\bautoFocus\b|\benter\b/);
});
