import { expect, test } from "vitest";
import { VOCAB, ageLabel, branchChip, foundAgent, headerOf, needsYouCount, nextNeedsYou, takesInband, titleState, crewLabel, crewLine, stoppedLabel, type Crew, type StatusKey } from "./status";

test("a plain shell reads as a terminal with a neutral status; an agent's word is tinted (TERM-020, TERM-021)", () => {
  expect(headerOf("shell", "running", undefined, false, null, 0)).toMatchObject({ word: "Ready", tone: "", needsYou: false });
  expect(headerOf("shell", "ended", 0, false, 0, 0)).toMatchObject({ word: "Ended", tone: "" });
  expect(headerOf("claude", "running", undefined, false, null, 0)).toMatchObject({ word: "Working", tone: "working", needsYou: false });
  expect(headerOf("claude", "running", undefined, true, null, 0)).toMatchObject({ word: "Needs you", tone: "attention", needsYou: true });
  expect(headerOf("claude", "ended", 0, false, 0, 0)).toMatchObject({ word: "Done", tone: "done", glyph: "check", state: "done" });
  expect(headerOf("claude", "ended", 2, false, 0, 0)).toMatchObject({ word: "Ended (2)", tone: "" });
  expect(headerOf("claude", "failed", undefined, false, null, 0)).toMatchObject({ word: "Failed", tone: "attention", needsYou: true });
});

test("a finished agent shows how long ago: just now, then minutes (TERM-023)", () => {
  const t = 1_000_000;
  expect(ageLabel(t, t + 59_000)).toBe("just now");
  expect(ageLabel(t, t + 60_000)).toBe("1m ago");
  expect(ageLabel(t, t + 3 * 60_000 + 20_000)).toBe("3m ago");
  expect(headerOf("claude", "ended", 0, false, t, t + 180_000).age).toBe("3m ago");
});

test("the shortcut cycles through every pane that needs you and stays put with none (TERM-030)", () => {
  const needs = new Set([1, 3]);
  expect(nextNeedsYou([1, 2, 3], needs, 1)).toBe(3);
  expect(nextNeedsYou([1, 2, 3], needs, 3)).toBe(1);
  expect(nextNeedsYou([1, 2, 3], needs, 2)).toBe(3);
  expect(nextNeedsYou([1, 2, 3], new Set([2]), 2)).toBe(2);
  expect(nextNeedsYou([1, 2, 3], new Set(), 2)).toBeNull();
});

test("the hooks feed the header while the program still runs: needs you, blocked, interrupted, done with its age (STAT-001, STAT-007)", () => {
  expect(headerOf("claude", "running", undefined, false, null, 0, "permission")).toMatchObject({ word: "Needs you", tone: "attention", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, null, 0, "waiting")).toMatchObject({ word: "Needs you", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, null, 0, "blocked")).toMatchObject({ word: "Blocked", tone: "attention", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, null, 0, "interrupted")).toMatchObject({ word: "Interrupted", tone: "attention", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, 0, 30000, "done")).toMatchObject({ word: "Done", tone: "done", needsYou: false, age: "just now" });
  expect(headerOf("claude", "running", undefined, false, null, 0, "working")).toMatchObject({ word: "Working", tone: "working", needsYou: false });
  // The hook never speaks for a shell and never changes an ended program.
  expect(headerOf("shell", "running", undefined, false, null, 0, "permission")).toMatchObject({ word: "Ready", needsYou: false });
  expect(headerOf("claude", "ended", 0, false, 0, 0, "permission")).toMatchObject({ word: "Done", needsYou: false });
});

test("the roster label counts agents and those waiting on the user; a line names role, model and state (STAT-026)", () => {
  const crew: Crew = [
    { id: "a1", kind: "code-reviewer", model: "opus", state: "permission" },
    { id: "a2", kind: "tester", state: "working" },
  ];
  expect(crewLabel(crew)).toBe("2 agents, 1 waiting");
  expect(crewLabel(crew.slice(1))).toBe("1 agent");
  expect(crewLine(crew[0])).toBe("code-reviewer (opus) · needs you");
  expect(crewLine(crew[1])).toBe("tester · working");
});

test("every surface reads one vocabulary: each state has its word, glyph, tone and hover explanation (STAT-052)", () => {
  const keys = Object.keys(VOCAB) as StatusKey[];
  for (const k of keys) {
    const v = VOCAB[k];
    expect(v.word, k).not.toBe("");
    expect(v.explain, k).toMatch(/[.!]$/);
  }
  // The card's own ten states are all there, each with its own glyph: working spins, done is a check.
  expect(keys).toEqual(expect.arrayContaining(["working", "background", "blocked", "waiting", "permission", "interrupted", "failed", "done", "idle", "stale"]));
  expect(VOCAB.working.glyph).toBe("spinner");
  expect(VOCAB.done.glyph).toBe("check");
  // Blocked and waiting borrow the permission look; the Agents view's starting and cannot-reach labels are words of their own.
  expect([VOCAB.blocked.glyph, VOCAB.waiting.glyph]).toEqual([VOCAB.permission.glyph, VOCAB.permission.glyph]);
  expect([VOCAB.blocked.tone, VOCAB.waiting.tone]).toEqual([VOCAB.permission.tone, VOCAB.permission.tone]);
  expect(VOCAB.starting.word).toBe("Starting");
  expect(VOCAB.unreachable.word).toBe("Cannot reach");
  expect(stoppedLabel("exit code 2")).toBe("Stopped: exit code 2");
});

test("the pane header is the vocabulary applied to what the pane knows: hook states map to keys, a shell keeps its own words (STAT-052, TERM-020)", () => {
  const h = (hook?: Parameters<typeof headerOf>[6], needs = false) => headerOf("claude", "running", undefined, needs, null, 0, hook);
  expect(h("working")).toMatchObject({ state: "working", glyph: "spinner", explain: VOCAB.working.explain });
  expect(h("permission")).toMatchObject({ state: "permission", glyph: VOCAB.permission.glyph, word: "Needs you", needsYou: true });
  expect(h("waiting")).toMatchObject({ state: "waiting", word: "Needs you", needsYou: true, explain: VOCAB.waiting.explain });
  expect(h(undefined, true)).toMatchObject({ state: "permission" });
  expect(h("blocked")).toMatchObject({ state: "blocked", word: "Blocked", needsYou: true });
  expect(h("interrupted")).toMatchObject({ state: "interrupted", glyph: "interrupted", needsYou: true });
  expect(h("done")).toMatchObject({ state: "done", glyph: "check", tone: "done" });
  expect(headerOf("claude", "starting", undefined, false, null, 0)).toMatchObject({ state: "starting", glyph: "spinner", word: "Starting" });
  expect(headerOf("claude", "failed", undefined, false, null, 0)).toMatchObject({ state: "failed", glyph: "failed" });
  expect(headerOf("shell", "running", undefined, false, null, 0)).toMatchObject({ state: "idle", word: "Ready", glyph: "idle" });
  expect(headerOf("shell", "ended", 2, false, 0, 0)).toMatchObject({ state: "stopped", word: "Ended (2)", explain: "Stopped: exit code 2" });
});

test("a shell pane takes the header of an agent started in it by hand, and only one it can mark (ACCT-050)", () => {
  expect(foundAgent("claude")).toBe("claude");
  expect(foundAgent("codex")).toBe("codex");
  expect(foundAgent("grok")).toBeNull();
  expect(foundAgent(null)).toBeNull();
  // Once found, the pane reads as the agent: its hook state shows, not "Ready".
  expect(headerOf(foundAgent("claude") ?? "shell", "running", undefined, false, null, 0, "waiting").state).toBe("waiting");
  expect(headerOf(foundAgent(null) ?? "shell", "running", undefined, false, null, 0, "waiting").word).toBe("Ready");
});

test("TERM-022: the chip names the branch, a detached HEAD shows its short commit, a plain folder shows none", () => {
  expect(branchChip({ branch: "feature/x", head: "0123456789abcdef0123456789abcdef01234567" })).toEqual({ text: "feature/x", tip: "feature/x" });
  expect(branchChip({ branch: null, head: "0123456789abcdef0123456789abcdef01234567" })).toEqual({ text: "0123456", tip: "Detached at 0123456789abcdef0123456789abcdef01234567" });
  expect(branchChip(null)).toBeNull();
  expect(branchChip({ branch: null, head: null })).toBeNull();
});

test("a turn that ended with background tasks still running reads as watched, not done (STAT-024)", () => {
  const h = headerOf("claude", "running", undefined, false, null, 0, "background");
  expect([h.state, h.word, h.tone, h.needsYou]).toEqual(["background", "Working", "working", false]);
  expect(h.explain).toMatch(/background tasks/);
  // A permission still wins over the watch.
  expect(headerOf("claude", "running", undefined, true, null, 0, "background").state).toBe("permission");
  // A title change while the tasks run (the agent the title names, its finish time) does not end the watch.
  expect(headerOf(foundAgent("codex") ?? "shell", "running", undefined, false, 0, 90_000, "background").state).toBe("background");
  expect(headerOf("claude", "running", undefined, false, 0, 90_000, "background").word).toBe("Working");
});

test("a terminal title stands in for the state while no hook reports: spinners and busy marks work, ready words rest, paths say nothing (STAT-033)", () => {
  expect(titleState("\u280b Running the tests")).toBe("working");
  expect(titleState("\u25d0 claude")).toBe("working");
  expect(titleState("Thinking\u2026")).toBe("working");
  expect(titleState("\u2733 Claude Code - ready")).toBe("done");
  expect(titleState("gemini  idle")).toBe("done");
  expect(titleState("Waiting for permission")).toBe("permission");
  expect(titleState("Needs you: allow Bash?")).toBe("permission");
  // A path, an empty title or words it does not know leave the last reading in place.
  expect(titleState("C:\\Users\\me\\notes.txt")).toBeNull();
  expect(titleState("~/src/kolux-rs")).toBeNull();
  expect(titleState("/usr/bin/zsh")).toBeNull();
  expect(titleState("")).toBeNull();
  expect(titleState("vim")).toBeNull();
  // A hook state still wins: the title only stands in when `hook` is undefined.
  expect(headerOf("claude", "running", undefined, false, null, 0, "done").state).toBe("done");
  expect(headerOf("claude", "running", undefined, false, null, 0, titleState("\u2733 ready") ?? undefined).state).toBe("done");
  expect(headerOf("claude", "running", undefined, false, null, 0, titleState("vim") ?? undefined).state).toBe("working");
});

test("a title that starts with the done mark reads done first, even when permission words follow it (T-124-c)", () => {
  expect(titleState("✳ Waiting for permission review")).toBe("done");
  expect(titleState("  ✳ Needs you: allow Bash?")).toBe("done");
  // The mark only counts at the start; elsewhere the words decide as before.
  expect(titleState("Waiting for permission ✳")).toBe("permission");
});

test("Gemini CLI's title symbols read like the other agents' marks: the hand is needs you, the four-point star is working, the diamond is ready (STAT-033, T-124-d)", () => {
  // Gemini CLI's public settings reference: "Ready: ◇, Action Required: ✋, Working: ✦" (on by default).
  expect(titleState("✋ Gemini - needs approval")).toBe("permission");
  expect(titleState("✋ Action Required")).toBe("permission");
  expect(titleState("Gemini: action required")).toBe("permission");
  expect(titleState("✦ Gemini - thinking")).toBe("working");
  expect(titleState("✦ Gemini")).toBe("working");
  expect(titleState("◇ Gemini")).toBe("done");
  expect(titleState("◇ Gemini - action required")).toBe("done");
  // The symbols count anywhere a mark would, but a path is still a path.
  expect(titleState("Gemini ✋")).toBe("permission");
  expect(titleState("~/projects/gemini-✦-notes")).toBeNull();
  expect(titleState("C:\\Users\\me\\◇.txt")).toBeNull();
  // Through the header: a hooks-off Gemini pane whose title carries the hand shows needs you.
  expect(headerOf("gemini", "running", undefined, false, null, 0, titleState("✋ Gemini - allow shell?") ?? undefined).needsYou).toBe(true);
});

test("an in-band status moves the dot only in an agent pane, never in a plain shell (STAT-034, hooks FIX-3)", () => {
  expect(takesInband("shell", null, null)).toBe(false);
  expect(takesInband("shell", undefined, null)).toBe(false);
  expect(takesInband("shell", "", null)).toBe(false);
  expect(takesInband("claude", null, null)).toBe(true);
  expect(takesInband("codex", "codex", null)).toBe(true);
  expect(takesInband("shell", "gemini", null)).toBe(true);
  expect(takesInband("shell", null, "claude")).toBe(true);
});

test("the global needs-you count is the panes waiting that are still open (ux fix 2)", () => {
  expect(needsYouCount([1, 2, 3], new Set([1, 3]))).toBe(2);
  expect(needsYouCount([1, 2, 3], new Set([9]))).toBe(0);
  expect(needsYouCount([], new Set())).toBe(0);
});

test("DT-C52: the Stopped tip covers a blocked agent whose program still runs and one whose program ended", () => {
  expect(VOCAB.stopped.explain).toBe("Stopped: waiting on a limit or sign-in, or the program has ended.");
});
