import { describe, expect, it } from "vitest";
import { cardKey } from "./NoteRail";

describe("cardKey: the keyboard path to a rail card's text", () => {
  it("Enter and Space on the card bring its text into view", () => {
    expect(cardKey("Enter", true)).toBe(true);
    expect(cardKey(" ", true)).toBe(true);
  });
  it("leaves every other key, and keys pressed inside the card's own buttons, alone", () => {
    expect(cardKey("a", true)).toBe(false);
    expect(cardKey("Tab", true)).toBe(false);
    expect(cardKey("Enter", false)).toBe(false);
  });
});
