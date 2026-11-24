// AUD-T4 F01: a prompt that is only an ellipsis is a prompt in its own right, not a truncation of
// every other prompt. samePrompt reads an ellipsis-ended prompt as a cut one and matches it by its
// start; with nothing before the ellipsis that start is the empty string, so every typed line matches.
import { describe, expect, test } from "vitest";
import { samePrompt } from "./livePane";

describe("samePrompt", () => {
  test("[T4-F01] an ellipsis-only prompt matches itself, not every opening line", () => {
    expect(samePrompt("Fix the login bug", "…")).toBe(false);
    expect(samePrompt("…", "…")).toBe(true);
  });
});
