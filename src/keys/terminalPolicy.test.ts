import { describe, expect, it } from "vitest";
import { heldByTerminal, inTerminal, readPolicy } from "./terminalPolicy";

const inXterm = { closest: (s: string) => (s === ".xterm" ? {} : null) } as unknown as Element;
const elsewhere = { closest: () => null } as unknown as Element;

describe("Kolux first or Terminal first (SET-014)", () => {
  it("defaults to Kolux first and reads a saved Terminal first unchanged", () => {
    expect(readPolicy({})).toBe("kolux");
    expect(readPolicy({ terminalShortcuts: "terminal" })).toBe("terminal");
    expect(readPolicy({ terminalShortcuts: "other" })).toBe("kolux");
  });
  it("with Terminal first holds Mod+B back from a focused terminal but keeps the safe commands", () => {
    const t = { terminalShortcuts: "terminal" };
    expect(heldByTerminal("sidebar.left.toggle", t, inXterm)).toBe(true);
    expect(heldByTerminal("zoom.in", t, inXterm)).toBe(false);
    expect(heldByTerminal("sidebar.left.toggle", t, elsewhere)).toBe(false);
    expect(heldByTerminal("sidebar.left.toggle", {}, inXterm)).toBe(false);
  });
  it("says on each row whether the command works in a terminal (SET 008)", () => {
    expect(inTerminal("sidebar.left.toggle", "kolux")).toBe("works");
    expect(inTerminal("sidebar.left.toggle", "terminal")).toBe("held");
    expect(inTerminal("terminal.splitRight", "terminal")).toBe("works");
    expect(inTerminal("settings.search", "terminal")).toBeNull();
  });
});
