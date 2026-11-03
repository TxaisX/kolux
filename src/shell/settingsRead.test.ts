import { expect, test } from "vitest";
import start from "./useWindowStart.ts?raw";

test("a failed settings read keeps what the window holds instead of replacing it with an empty set", () => {
  expect(start).not.toContain("setSettings({})");
});
