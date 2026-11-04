// T-722 (DT-C158): the Explorer's delete question opens with focus on Cancel, not on the button that deletes,
// so an Enter or Space pressed straight after picking Delete removes nothing.
import { expect, test } from "vitest";
import source from "./Explorer.tsx?raw";

test("T-722: the Explorer delete question focuses Cancel, and the delete button takes no focus", () => {
  const start = source.indexOf('className="notice ex-ask"');
  expect(start, "the delete question").toBeGreaterThan(0);
  const ask = source.slice(start, source.indexOf("</div>", start));
  const buttons = [...ask.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0]);
  expect(buttons).toHaveLength(2);
  const [del, cancel] = buttons;
  expect(del).toMatch(/doDelete\(asking\)/);
  expect(del).not.toMatch(/\bautoFocus\b/);
  expect(cancel).toMatch(/\bautoFocus\b/);
  expect(cancel).toMatch(/setAsking\(null\)[\s\S]*Cancel/);
});
