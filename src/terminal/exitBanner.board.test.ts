// START-06 (board test, hash-locked): an agent pane whose program ends by itself with an error shows a
// banner with the program's last output line and a "Start fresh" button, instead of a silent dead pane.
// A pane Kolux closed shows nothing.
import { describe, expect, test } from "vitest";
import { exitBanner, type ExitFacts } from "./exitBanner";
import paneRaw from "./TerminalPane.tsx?raw";

const exited = (over: Partial<ExitFacts> = {}): ExitFacts => ({ reason: "exited", code: 1, lastLine: "Error: No conversation found with session ID: abc", resumed: false, ...over });

describe("exitBanner", () => {
  test("a program that ended by itself with an error gets a banner", () => {
    expect(exitBanner(exited())).toEqual({
      title: "The program stopped with an error (exit 1)",
      lastLine: "Error: No conversation found with session ID: abc",
      action: "Start fresh",
    });
  });

  test("a resumed pane names the saved conversation", () => {
    const b = exitBanner(exited({ resumed: true, code: 2 }));
    expect(b?.title).toBe("The saved conversation did not reopen (exit 2)");
    expect(b?.action).toBe("Start fresh");
  });

  test("any non-zero code counts, negative ones too", () => {
    expect(exitBanner(exited({ code: -1073741510 }))?.title).toBe("The program stopped with an error (exit -1073741510)");
    expect(exitBanner(exited({ code: 255 }))?.title).toBe("The program stopped with an error (exit 255)");
  });

  test("a pane Kolux closed shows no banner", () => {
    expect(exitBanner(exited({ reason: "closed" }))).toBeNull();
    expect(exitBanner(exited({ reason: "closed", resumed: true }))).toBeNull();
    expect(exitBanner(exited({ reason: "closed", code: null }))).toBeNull();
  });

  test("a clean or unknown exit shows no banner", () => {
    expect(exitBanner(exited({ code: 0 }))).toBeNull();
    expect(exitBanner(exited({ code: null }))).toBeNull();
    expect(exitBanner(exited({ code: 0, resumed: true }))).toBeNull();
  });

  test("the last line loses colour codes, title sequences and stray control characters", () => {
    expect(exitBanner(exited({ lastLine: "\x1b[31;1mNo conversation found\x1b[0m" }))?.lastLine).toBe("No conversation found");
    expect(exitBanner(exited({ lastLine: "\x1b]0;claude\x07fatal: bad" }))?.lastLine).toBe("fatal: bad");
    expect(exitBanner(exited({ lastLine: "  boom\r\n" }))?.lastLine).toBe("boom");
    expect(exitBanner(exited({ lastLine: "a\x07b\x00c" }))?.lastLine).toBe("abc");
  });

  test("no line, an empty line or a blank line shows the banner without a line", () => {
    for (const lastLine of [null, "", "   ", "\r\n", "\x1b[0m"]) {
      const b = exitBanner(exited({ lastLine }));
      expect(b).not.toBeNull();
      expect(b?.lastLine).toBeNull();
    }
  });

  test("a long line is cut to 200 characters ending in an ellipsis", () => {
    const long = "x".repeat(150) + "y".repeat(350);
    const shown = exitBanner(exited({ lastLine: long }))?.lastLine ?? "";
    expect(shown).toHaveLength(200);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.slice(0, 199)).toBe(long.slice(0, 199));
    const fits = "z".repeat(200);
    expect(exitBanner(exited({ lastLine: fits }))?.lastLine).toBe(fits);
  });

  test("the facts are not changed", () => {
    const f = exited({ lastLine: "\x1b[31m x \x1b[0m" });
    const copy = { ...f };
    exitBanner(f);
    expect(f).toEqual(copy);
  });
});

const code = (raw: string) =>
  raw
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("START-06 wiring", () => {
  test("the pane asks exitBanner on exit and offers Start fresh", () => {
    const src = code(paneRaw);
    expect(src).toMatch(/import\s*\{[^}]*\bexitBanner\b[^}]*\}\s*from\s*"\.\/exitBanner"/);
    const at = src.indexOf("onTerminalExit<");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 6000)).toMatch(/exitBanner\(/);
    expect(src).toMatch(/>\s*Start fresh\s*</);
  });

  test("Start fresh starts the agent again without its resume arguments", () => {
    const src = code(paneRaw);
    expect(src).toMatch(/import\s*\{[^}]*\bbaseArgs\b[^}]*\}\s*from\s*"\.\/sessionFork"/);
    expect(src).toMatch(/baseArgs\(/);
  });
});
