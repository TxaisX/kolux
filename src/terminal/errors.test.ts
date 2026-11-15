// TERM-110: a known failure comes out in plain words without the issue link; an unknown one keeps
// its text and the link; local errors carry the environment footer. TERM-111: the Git Bash
// process-limit failure is explained with a way out.
import { expect, test } from "vitest";
import { explain, explained, exitAdvice } from "./errors";

test("a known error is explained in plain words and drops the issue link", () => {
  const text = explain("terminal 7 is not running", "G:\\Dev\\x");
  expect(text).toBe("The program in this pane has ended, so nothing can be sent to it. (G:\\Dev\\x)");
  expect(text).not.toContain("github.com");
  expect(explained("The folder G:\\gone no longer exists. It may have been moved or deleted; open the project from where it is now.")).toBe(true);
});

test("an error Kolux cannot explain keeps its text and the link for reporting an issue", () => {
  const text = explain("Error: ConPTY returned 0x8007000E", "G:\\Dev\\x");
  expect(text).toContain("ConPTY returned 0x8007000E (G:\\Dev\\x)");
  expect(text).toContain("https://github.com/");
  expect(explained("ConPTY returned 0x8007000E")).toBe(false);
});

test("the Git Bash process-limit failure is explained with recovery actions", () => {
  const text = explain("bash: fork: retry: Resource temporarily unavailable");
  expect(text).toContain("run out of process slots");
  expect(text).toContain("Close a few terminals");
  expect(exitAdvice(127)).toContain("code 127");
  expect(exitAdvice(3)).toContain("code 3");
  // A Ctrl+C (130) is above 128 too: the words do not blame something outside Kolux.
  expect(exitAdvice(130)).toBe("The program was stopped (code 130). Restart opens it again.");
});
