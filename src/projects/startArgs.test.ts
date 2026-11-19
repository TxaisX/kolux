import { expect, test } from "vitest";
import { startFields } from "./startArgs";

test("cli FIX-8: a pane takes its program, arguments, environment and typed text from the start line", () => {
  const line = { args: ["--x"], typed: null, program: null, env: [["A", "1"]] as [string, string][] };
  const pane = startFields(line, "claude");
  expect(pane.env).toBe(line.env);
  expect(pane.program).toBe("claude");
  expect(pane.args).toEqual(["--x"]);
  expect(pane.typed).toBeUndefined();
  // The line's own program wins over the agent's, and its typed text comes along.
  const own = startFields({ ...line, program: "npx", typed: "hi" }, "claude");
  expect([own.program, own.typed]).toEqual(["npx", "hi"]);
});
