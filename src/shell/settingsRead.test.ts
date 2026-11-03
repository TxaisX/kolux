import { expect, test } from "vitest";
import { readSettingsInto } from "./settingsRead";
import start from "./useWindowStart.ts?raw";

test("a failed settings read keeps what the window holds instead of replacing it with an empty set", async () => {
  const applied: unknown[] = [];
  await readSettingsInto(() => Promise.reject(new Error("read failed")), (s) => applied.push(s));
  expect(applied).toEqual([]);
  await readSettingsInto(() => Promise.resolve({ theme: "dark" }), (s) => applied.push(s));
  expect(applied).toEqual([{ theme: "dark" }]);
});

test("the window reads its settings through readSettingsInto", () => {
  expect(start).toContain("readSettingsInto(");
  expect(start).not.toContain("setSettings({})");
});
