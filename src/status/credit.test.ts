import { expect, test } from "vitest";
import { creditedLive, launchedAgent, launchedName, titleCredit, titleGuess, titleNames } from "./credit";

const idle = { running: false, title: null, agent: null } as const;

test("the launch record names the agent: its catalogue id first, then the pane's own agent, then its program (SESS-040)", () => {
  expect(launchedAgent({ agent: "shell", agentId: "cursor", program: "cursor-agent" })).toBe("cursor");
  expect(launchedAgent({ agent: "claude", program: "claude" })).toBe("claude");
  expect(launchedAgent({ agent: "shell", program: "C:/tools/mimo.exe" })).toBe("mimo-code");
  expect(launchedAgent({ agent: "shell", program: null })).toBeNull();
  // A browser tab or a kit's multi-seat tab is not one launched agent.
  expect(launchedAgent({ agent: "shell", agentId: "claude", program: null, seats: [{}] })).toBeNull();
  expect(launchedAgent({ agent: "claude", kind: "browser", program: null })).toBeNull();
  expect(launchedName({ agent: "shell", agentId: "mimo-code", program: "mimo" })).toBe("MiMo Code");
  expect(launchedName({ agent: "shell", agentId: "cursor", program: "cursor-agent" })).toBe("Cursor");
  expect(launchedName({ agent: "shell", program: null })).toBeNull();
});

test("title patterns are recognised for MiMo, Pi-style agents and Cursor (SESS-040)", () => {
  expect([...titleNames("MiMo Code - fixing tests")]).toEqual(["mimo-code"]);
  expect([...titleNames("mimo: thinking")]).toEqual(["mimo-code"]);
  expect([...titleNames("Cursor Agent")]).toEqual(["cursor"]);
  expect([...titleNames("cursor-agent ⠋ editing")]).toEqual(["cursor"]);
  // Pi and the agents built the Pi way (oh-my-pi) share the Pi title: either may own it.
  expect([...titleNames("π - kolux")].sort()).toEqual(["omp", "pi"]);
  expect([...titleNames("pi ⠙ working")].sort()).toEqual(["omp", "pi"]);
  expect([...titleNames("oh-my-pi")]).toEqual(["omp"]);
  expect([...titleNames("✳ Claude Code")]).toEqual(["claude"]);
  // A word that only contains a name is not that name; a path is not a program's title.
  expect([...titleNames("pipeline running")]).toEqual([]);
  expect([...titleNames("recursor")]).toEqual([]);
  expect([...titleNames("C:\\Users\\me\\cursor")]).toEqual([]);
  expect([...titleNames("")]).toEqual([]);
});

test("the busy state credits the launched agent; a title naming another agent claims nothing (SESS-040)", () => {
  // Cursor's own title with a spinner: Cursor is working, and the title named it (dot and row agree).
  expect(titleCredit("cursor", "⠋ Cursor Agent")).toEqual({ agent: "cursor", state: "working", named: true });
  // MiMo's spinner with no name in it still belongs to MiMo: it was launched there.
  expect(titleCredit("mimo-code", "⠙ thinking")).toEqual({ agent: "mimo-code", state: "working", named: false });
  expect(titleCredit("pi", "π ⠹ kolux")).toEqual({ agent: "pi", state: "working", named: true });
  // Cursor running a Claude model may print the model in its title: a model name alone names nobody (STAT-033), so it stays Cursor's.
  expect(titleCredit("cursor", "Claude Sonnet ⠋ working")).toEqual({ agent: "cursor", state: "working", named: false });
  // Marks that conflict claim nothing.
  expect(titleCredit("cursor", "Cursor Agent - Claude")).toBeNull();
  expect(titleCredit("mimo-code", "✳ Claude Code")).toBeNull();
  // No launch record: nothing is credited from output alone.
  expect(titleCredit(null, "⠋ Cursor Agent")).toBeNull();
  expect(titleCredit("cursor", "Cursor Agent")).toEqual({ agent: "cursor", state: null, named: true });
  expect(titleGuess("cursor", "⠋ Cursor Agent")).toBe("working");
  expect(titleGuess("cursor", "Claude ⠋")).toBeNull();
  expect(titleGuess(null, "⠋ working")).toBe("working");
  expect(titleGuess(null, "Codex ⠋")).toBe("working");
});

test("a launched pane's icon never takes an agent guessed from its title (SESS-040)", () => {
  const live = { running: true, title: "Claude Sonnet ⠋", agent: "claude" as const };
  expect(creditedLive("cursor", live)).toEqual({ running: true, title: "Claude Sonnet ⠋", agent: null });
  expect(creditedLive("claude", live)).toBe(live);
  // A plain shell with no launch record keeps TERM-058's hand-started agent.
  expect(creditedLive(null, live)).toBe(live);
  expect(creditedLive("cursor", idle)).toBe(idle);
});
