import { expect, test } from "vitest";
import { isFirstWindow } from "./useStartAsk";

test("Start form D: outside Tauri there is one window, so it counts as the first", () => {
  expect(isFirstWindow()).toBe(true);
});
