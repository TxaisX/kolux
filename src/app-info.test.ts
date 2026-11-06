import { expect, test } from "vitest";
import { windowTitle } from "./app-info";

test("window title carries the version once the Rust side has answered", () => {
  expect(windowTitle(null)).toBe("Kolux");
  expect(windowTitle({ version: "0.1.0", profileDir: "x", startCount: 1 })).toBe("Kolux 0.1.0");
});

test("the window title leads with the count of panes that need you, and drops it at 0 (ux fix 2)", () => {
  const info = { version: "0.1.0", profileDir: "x", startCount: 1 };
  expect(windowTitle(info, 2)).toBe("(2) Kolux 0.1.0");
  expect(windowTitle(null, 1)).toBe("(1) Kolux");
  expect(windowTitle(info, 0)).toBe("Kolux 0.1.0");
  expect(windowTitle(info)).toBe("Kolux 0.1.0");
});
