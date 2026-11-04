// TERM-041 acceptance box 2 (and TERM-040's chords): one new-tab command per agent, with no key until assigned.
import { expect, test } from "vitest";
import { actions, agents } from "../../keys/actions";
import { chordsOf, resolve } from "../../keys/keymap";

const platforms = ["win32", "linux", "darwin"] as const;

test("box 2: each agent has its own new-tab command, tab.newAgent.<id>, bound to no key on any platform", () => {
  expect(agents.length).toBeGreaterThan(30);
  for (const [id] of agents) {
    expect(actions.some((a) => a.id === `tab.newAgent.${id}`)).toBe(true);
    for (const p of platforms) expect(chordsOf(resolve(null, p), `tab.newAgent.${id}`)).toEqual([]);
  }
});

test("the user can assign a key to one agent's command, and only that one gets it", () => {
  const map = resolve({ keybindings: { "tab.newAgent.codex": "Mod+Alt+9" } }, "linux");
  expect(chordsOf(map, "tab.newAgent.codex")).toEqual(["Mod+Alt+9"]);
  expect(chordsOf(map, "tab.newAgent.claude")).toEqual([]);
});

test("new default agent: Cmd+Alt+T on macOS, Ctrl+Alt+T on Windows and Linux (T-746)", () => {
  for (const p of platforms) expect(chordsOf(resolve(null, p), "tab.newAgent")).toEqual(["Mod+Alt+T"]);
});
