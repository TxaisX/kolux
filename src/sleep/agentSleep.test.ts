// TERM-123 / HID-028 (T-817): the agent sleep rules. Every never-sleep case of the card, the delay clamp,
// the switch off when the key is missing or an old profile's own switch is set, the timing with the switch
// off and in a release build, and Wake's fields coming from the restored-tab start line.
import { expect, test } from "vitest";
import { asleepNow, clampIdleMinutes, dueForSleep, idleMinutes, idleShown, minutesFromText, sleepOn, sleepRefusal, testFast, tickSkipped, timing, wokenFields, type Asleep, type PaneView } from "./agentSleep";

const MIN = 60_000;
const NOW = 10_000_000;
const IDLE_MS = 30 * MIN;

/** A plain agent pane with a resumable session, as the check sees it. */
const agentPane = (over: Record<string, unknown> = {}) => ({ key: 1, kind: undefined, seats: undefined, agent: "claude", agentId: "claude", program: "claude", session: "s-1", forkOf: undefined, asleep: undefined, ...over }) as never;
/** A finished, unfocused, long-idle view: the one case that may sleep. */
const ready = (over: Partial<PaneView> = {}): PaneView => ({ state: "done", changedAt: NOW - IDLE_MS - 1, running: true, ask: undefined, monitoring: undefined, draft: false, visible: false, ...over });

test("T-817 TERM-123: a finished agent pane, idle past the delay, unfocused and without a draft may sleep", () => {
  expect(sleepRefusal(agentPane(), ready(), NOW, IDLE_MS)).toBeNull();
  expect(sleepRefusal(agentPane(), ready({ state: "idle" }), NOW, IDLE_MS)).toBeNull();
  expect(sleepRefusal(agentPane(), ready({ changedAt: NOW - IDLE_MS }), NOW, IDLE_MS)).toBeNull(); // exactly the delay counts
});

test("T-817 TERM-123: never while the agent is working, queued, blocked or interrupted (the turn is not finished)", () => {
  for (const state of ["working", "queued", "blocked", "interrupted"] as const) expect(sleepRefusal(agentPane(), ready({ state }), NOW, IDLE_MS)).toBe("not finished");
});

test("T-817 TERM-123: never while the agent waits on a question or a permission", () => {
  expect(sleepRefusal(agentPane(), ready({ state: "permission" }), NOW, IDLE_MS)).toBe("waiting on the user");
  expect(sleepRefusal(agentPane(), ready({ state: "waiting" }), NOW, IDLE_MS)).toBe("waiting on the user");
  expect(sleepRefusal(agentPane(), ready({ ask: "May I delete this file?" }), NOW, IDLE_MS)).toBe("waiting on the user"); // an open ask on a finished state still waits
  expect(sleepRefusal(agentPane(), ready({ monitoring: true }), NOW, IDLE_MS)).toBe("background tasks");
});

test("T-817 TERM-123: never while the message box holds unsent text", () => {
  expect(sleepRefusal(agentPane(), ready({ draft: true }), NOW, IDLE_MS)).toBe("unsent draft");
});

test("T-817 TERM-123: never a pane drawn in a visible window, focused or not", () => {
  expect(sleepRefusal(agentPane(), ready({ visible: true }), NOW, IDLE_MS)).toBe("visible");
});

test("T-817 TERM-123: never a pane whose agent is not the running program (a plain shell, an ended agent, another command)", () => {
  expect(sleepRefusal(agentPane({ agent: "shell", agentId: undefined, program: null }), ready(), NOW, IDLE_MS)).toBe("not an agent pane");
  expect(sleepRefusal(agentPane({ program: null }), ready(), NOW, IDLE_MS)).toBe("not an agent pane"); // its program ended and a shell took over
  expect(sleepRefusal(agentPane(), ready({ running: false }), NOW, IDLE_MS)).toBe("program not running");
  expect(sleepRefusal(agentPane(), ready({ running: undefined }), NOW, IDLE_MS)).toBe("program not running"); // still starting: unknown is a no
  expect(sleepRefusal(agentPane({ kind: "editor" }), ready(), NOW, IDLE_MS)).toBe("not a terminal");
  expect(sleepRefusal(agentPane({ seats: [] }), ready(), NOW, IDLE_MS)).toBe("not a terminal");
});

test("T-817 TERM-123: never without a resumable session id, and never a pane already asleep", () => {
  expect(sleepRefusal(agentPane({ session: undefined }), ready(), NOW, IDLE_MS)).toBe("no resumable session");
  expect(sleepRefusal(agentPane({ session: "s-1", forkOf: "s-1" }), ready(), NOW, IDLE_MS)).toBe("no resumable session"); // a fork's parent id is not the pane's own
  expect(sleepRefusal(agentPane({ asleep: { since: NOW, idleMin: 30 } }), ready(), NOW, IDLE_MS)).toBe("already asleep");
});

test("T-817 TERM-123: the idle clock counts from the agent's last state change, not from its last output", () => {
  expect(sleepRefusal(agentPane(), ready({ changedAt: NOW - IDLE_MS + 1 }), NOW, IDLE_MS)).toBe("not idle long enough");
  expect(sleepRefusal(agentPane(), ready({ changedAt: NOW - MIN }), NOW, IDLE_MS)).toBe("not idle long enough");
  expect(sleepRefusal(agentPane(), ready({ state: undefined, changedAt: undefined }), NOW, IDLE_MS)).toBe("no state yet"); // when in doubt, awake
  expect(sleepRefusal(agentPane(), ready({ changedAt: undefined }), NOW, IDLE_MS)).toBe("no state yet");
});

test("T-817 TERM-123: dueForSleep lists only the panes that may sleep, in pane order", () => {
  const panes = [agentPane({ key: 1 }), agentPane({ key: 2 }), agentPane({ key: 3, session: undefined }), agentPane({ key: 4 })];
  const views: Record<number, PaneView> = { 1: ready({ visible: true }), 2: ready(), 3: ready(), 4: ready() };
  expect(dueForSleep(panes, (k) => views[k], NOW, IDLE_MS)).toEqual([2, 4]);
});

test("T-817 HID-028: the delay is 30 when missing, 5 below 5 and 240 above 240", () => {
  expect(clampIdleMinutes(undefined)).toBe(30);
  expect(clampIdleMinutes("abc")).toBe(30);
  expect(clampIdleMinutes(NaN)).toBe(30);
  expect(clampIdleMinutes(4)).toBe(5);
  expect(clampIdleMinutes(0)).toBe(5);
  expect(clampIdleMinutes(-3)).toBe(5);
  expect(clampIdleMinutes(241)).toBe(240);
  expect(clampIdleMinutes(99_999)).toBe(240);
  expect(clampIdleMinutes(12.6)).toBe(13);
  expect(clampIdleMinutes("45")).toBe(45);
  expect(idleMinutes({})).toBe(30);
  expect(idleMinutes({ agentSleepIdleMinutes: 2 })).toBe(5);
  expect(minutesFromText("3")).toBe(5);
  expect(minutesFromText("300")).toBe(240);
  expect(minutesFromText("")).toBeNull();
  expect(minutesFromText("ten")).toBeNull();
});

test("T-817 HID-028: the switch is on when its key is missing, off only when saved false, and an old profile's own sleep switch is never read", () => {
  expect(sleepOn({})).toBe(true);
  expect(sleepOn({ agentSleep: "false" })).toBe(true);
  expect(sleepOn({ agentSleep: 0 })).toBe(true);
  expect(sleepOn({ hibernation: false, agentHibernation: false, sleepAgents: false, experimental: { hibernation: false } })).toBe(true);
  expect(sleepOn({ agentSleep: true })).toBe(true);
  expect(sleepOn({ agentSleep: false })).toBe(false);
});

test("T-817 TERM-123: the check runs once a minute on the saved delay; a release build never reads the test-only fast setting", () => {
  expect(timing({ agentSleep: true }, false)).toEqual({ idleMs: 30 * MIN, tickMs: MIN });
  expect(timing({ agentSleep: true, agentSleepIdleMinutes: 5 }, false)).toEqual({ idleMs: 5 * MIN, tickMs: MIN });
  expect(timing({ agentSleep: true, agentSleepIdleMinutes: 1 }, false).idleMs).toBe(5 * MIN); // no sub-5 delay for users
  expect(timing({ agentSleep: true, agentSleepTestFast: true }, false)).toEqual({ idleMs: 30 * MIN, tickMs: MIN }); // release: ignored
  expect(testFast({ agentSleepTestFast: true }, false)).toBe(false);
  expect(timing({ agentSleep: true, agentSleepTestFast: true }, true)).toEqual({ idleMs: 20_000, tickMs: 5_000 }); // development only
});

test("T-817 TERM-123 (review F1, F5): Wake takes the restored-tab start line, drops the opening prompt and the launch args, and resumes the recorded session", () => {
  const p: { program: string | null; args: string[]; env: [string, string][]; typed?: string; session?: string; asleep?: Asleep } = { program: "claude", args: ["--old", "do the task"], env: [], typed: "do the task", session: "s-guess", asleep: { since: 1, idleMin: 30, session: "s-1" } };
  const woken = wokenFields(p, { args: ["--resume", "s-1"], program: "claude", env: [["A", "1"]], resumed: true });
  expect(woken).toEqual({ program: "claude", args: ["--resume", "s-1"], env: [["A", "1"]], asleep: undefined, typed: undefined, session: "s-1", resumed: true });
  expect(woken.typed).toBeUndefined(); // Pane.tsx onPty would re-type p.typed into the new terminal
  expect(wokenFields(p, { args: [], program: null, env: [], resumed: false }).program).toBe("claude"); // an unknown program keeps the pane's own
  expect(wokenFields({ program: "claude", args: [], env: [], session: "s-2" }, { args: [], program: null, env: [], resumed: false }).session).toBe("s-2"); // no recorded id: the pane's own stays
});

test("T-817 TERM-123 (review F3, F5, F7): any drawn pane of a visible document stays awake, so does a guessed session id and a draft too long to keep", () => {
  expect(sleepRefusal(agentPane(), ready({ visible: true }), NOW, IDLE_MS)).toBe("visible");
  expect(sleepRefusal(agentPane({ sessionListed: true }), ready(), NOW, IDLE_MS)).toBe("no resumable session");
  expect(sleepRefusal(agentPane(), ready({ draft: true }), NOW, IDLE_MS)).toBe("unsent draft"); // hasUnsent covers the over-limit case
  expect(asleepNow(NOW, NOW - 31 * MIN, "s-9").session).toBe("s-9");
});

test("T-817 TERM-123 (review F9): a tick far past its interval (the machine slept) is skipped", () => {
  expect(tickSkipped(MIN, MIN)).toBe(false);
  expect(tickSkipped(MIN * 2.5, MIN)).toBe(false);
  expect(tickSkipped(MIN * 3 + 1, MIN)).toBe(true);
  expect(tickSkipped(45 * MIN, MIN)).toBe(true);
});

test("T-817 TERM-123: the placeholder's idle count starts at the minutes before sleep and keeps moving", () => {
  const a = asleepNow(NOW, NOW - 31 * MIN, "s-1");
  expect(a).toEqual({ since: NOW, idleMin: 31, session: "s-1" });
  expect(idleShown(a, NOW)).toBe(31);
  expect(idleShown(a, NOW + 9 * MIN)).toBe(40);
  expect(asleepNow(NOW, undefined, "s-1").idleMin).toBe(0);
});
