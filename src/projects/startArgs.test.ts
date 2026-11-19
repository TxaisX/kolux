import { expect, test } from "vitest";
import { DISPATCH_ENV, sessionEnv, startFields, startTail } from "./startArgs";

test("T-172-e / cli FIX-7: a worker start's first session carries its dispatch id, last, and only one", () => {
  const base: [string, string][] = [["A", "1"]];
  expect(DISPATCH_ENV).toBe("KOLUX_DISPATCH_ID");
  expect(sessionEnv(base, "dispatch-3")).toEqual([["A", "1"], ["KOLUX_DISPATCH_ID", "dispatch-3"]]);
  // An entry the agent's settings already held is dropped: the runtime reads the real dispatch.
  const held: [string, string][] = [["KOLUX_DISPATCH_ID", "dispatch-user"], ["B", "2"]];
  expect(sessionEnv(held, "dispatch-3")).toEqual([["B", "2"], ["KOLUX_DISPATCH_ID", "dispatch-3"]]);
  expect(sessionEnv(held, "dispatch-3").filter(([k]) => k === DISPATCH_ENV)).toHaveLength(1);
  // A tab the user opens has no dispatch and is untouched.
  expect(sessionEnv(base)).toBe(base);
  expect(sessionEnv(held, "")).toBe(held);
});

test("T-172-e: the runtime's start notice hands its dispatch id to startIn", () => {
  const notice = { kind: "start", path: "C:/w", branch: "b", agent: "claude", prompt: "do it", extra: ["--x"], title: null, dispatch: "dispatch-9" } as const;
  expect(startTail({ ...notice, extra: [...notice.extra] })).toEqual(["do it", false, ["--x"], undefined, "dispatch-9"]);
  expect(startTail({ ...notice, extra: [], title: "T", dispatch: undefined })).toEqual(["do it", false, [], "T", undefined]);
});

test("cli FIX-8: the environment a worker's first pane hands to terminal_spawn names the notice's dispatch, once, last", () => {
  const notice = { kind: "start", path: "C:/w", branch: "b", agent: "claude", prompt: "do it", extra: [], title: null, dispatch: "dispatch-9" } as const;
  // The listener passes the notice through startTail to startIn, which builds the pane with startFields.
  const [, , , , dispatch] = startTail({ ...notice, extra: [] });
  const line = { args: ["--x"], typed: null, program: null, env: [["KOLUX_DISPATCH_ID", "dispatch-user"], ["A", "1"]] as [string, string][] };
  const pane = startFields(line, "claude", dispatch);
  expect(pane.env).toEqual([["A", "1"], ["KOLUX_DISPATCH_ID", "dispatch-9"]]);
  expect(pane.env.filter(([k]) => k === DISPATCH_ENV)).toHaveLength(1);
  expect(pane.program).toBe("claude");
  expect(pane.args).toEqual(["--x"]);
  expect(pane.typed).toBeUndefined();
  // A start with no dispatch (a tab the user opens) leaves the environment as the line had it, and the line's program wins.
  const plain = startFields({ ...line, program: "npx", typed: "hi" }, "claude");
  expect(plain.env).toBe(line.env);
  expect([plain.program, plain.typed]).toEqual(["npx", "hi"]);
});
