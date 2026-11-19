import { marked } from "marked";
import { expect, test, vi } from "vitest";
import { canRequest, draftKey, feedbackMessage, keepDraft, MAX_DRAFTS, OPENING, planSections, showsReview, startFeedback, stillPending, type PlanDraft } from "./planReview";

test("SAFE-002: blank lines split the plan into numbered sections; a fenced block with an empty line stays whole", () => {
  const plan = ["", "# Plan", "Read the code.", "", "", "Then fix it:", "```ts", "const a = 1;", "", "const b = 2;", "```", "", "Ship it.", "", ""].join("\n");
  const s = planSections(plan);
  expect(s.map((x) => [x.start, x.end])).toEqual([[2, 3], [6, 11], [13, 13]]);
  expect(s[1].text).toContain("const a = 1;\n\nconst b = 2;");
  expect(planSections("  \n\n ")).toEqual([]);
  expect(planSections("one\n~~~\n\n~~~\n\ntwo").map((x) => x.text)).toEqual(["one\n~~~\n\n~~~", "two"]);
});

test("SAFE-004: Request changes needs a comment or a real note; the message opens, lists comments by line range with a quote, then the note", () => {
  expect(canRequest([], "   ")).toBe(false);
  expect(canRequest([], " tighten it ")).toBe(true);
  const c = [
    { id: "a", start: 2, end: 3, quote: "# Plan Read the code.", text: "name the files" },
    { id: "b", start: 13, end: 13, quote: "Ship it.", text: "wait for review" },
  ];
  expect(canRequest(c, "")).toBe(true);
  const m = feedbackMessage(c, "  keep it short  ");
  expect(m.startsWith(OPENING)).toBe(true);
  expect(m.indexOf("Lines 2-3")).toBeLessThan(m.indexOf("Line 13"));
  expect(m).toContain("name the files");
  expect(m).toContain("> # Plan Read the code.");
  expect(m.endsWith("keep it short")).toBe(true);
  expect(feedbackMessage(c, "")).not.toContain("Overall");
});

test("SAFE-001: the review button shows only while Claude waits on its exit-plan step with a plan", () => {
  expect(showsReview("permission", { tool: "ExitPlanMode", plan: "do it" })).toBe(true);
  expect(showsReview("waiting", { tool: "ExitPlanMode", plan: "do it" })).toBe(true);
  expect(showsReview("permission", { tool: "Bash", plan: undefined })).toBe(false);
  expect(showsReview("permission", { tool: "ExitPlanMode", plan: undefined })).toBe(false);
  expect(showsReview("working", { tool: "ExitPlanMode", plan: "do it" })).toBe(false);
  expect(showsReview(undefined, undefined)).toBe(false);
});

test("SAFE-005: one draft per pane and exact plan text, at most 128 held, the oldest dropped first", () => {
  const d = (note: string): PlanDraft => ({ comments: [], note });
  expect(draftKey(3, "# Plan")).not.toBe(draftKey(3, "# Plan v2"));
  expect(draftKey(3, "# Plan")).not.toBe(draftKey(4, "# Plan"));
  let drafts: Record<string, PlanDraft> = {};
  for (let i = 0; i < MAX_DRAFTS; i++) drafts = keepDraft(drafts, draftKey(i, "p"), d(`n${i}`));
  expect(Object.keys(drafts)).toHaveLength(128);
  // Writing to a held draft keeps its place; a new one past the limit drops the oldest.
  drafts = keepDraft(drafts, draftKey(0, "p"), d("edited"));
  expect(Object.keys(drafts)).toHaveLength(128);
  drafts = keepDraft(drafts, draftKey(200, "p"), d("new"));
  expect(Object.keys(drafts)).toHaveLength(128);
  expect(drafts[draftKey(0, "p")]).toBeUndefined();
  expect(drafts[draftKey(1, "p")]?.note).toBe("n1");
  expect(drafts[draftKey(200, "p")]?.note).toBe("new");
});

test("SAFE-007: the sheet's plan is live only while the pane still waits on that exact plan", () => {
  const waiting = { tool: "ExitPlanMode", plan: "# Plan" };
  expect(stillPending("permission", waiting, "# Plan")).toBe(true);
  expect(stillPending("working", waiting, "# Plan")).toBe(false);
  expect(stillPending("permission", { tool: "ExitPlanMode", plan: "# Plan v2" }, "# Plan")).toBe(false);
  expect(stillPending("permission", { tool: "Bash" }, "# Plan")).toBe(false);
  expect(stillPending("waiting", undefined, "# Plan")).toBe(false);
});

test("SAFE-006, SAFE-007: the cut notice shows only for a cut plan; a closed prompt says so and disables both answers", async () => {
  vi.doMock("../chat/renderMarkdown", () => ({ renderMarkdown: (md: string) => marked.parse(md, { async: false }) }));
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { default: PlanSheet } = await import("./PlanSheet");
  const props = { title: "orch-repo", plan: "# Plan", draft: { comments: [], note: "fine" }, onDraft: () => {}, onApprove: () => {}, onRequest: () => {}, onClose: () => {} };
  const plain = renderToString(createElement(PlanSheet, props));
  expect(plain).not.toContain("whole plan is in the terminal");
  expect(plain).not.toContain("plan prompt has closed");
  expect(plain).not.toMatch(/disabled=""[^>]*>(Approve|Request changes)/);
  expect(renderToString(createElement(PlanSheet, { ...props, cut: true }))).toContain("The whole plan is in the terminal.");
  const closed = renderToString(createElement(PlanSheet, { ...props, closed: true }));
  expect(closed).toContain("The plan prompt has closed");
  expect(closed).toMatch(/disabled=""[^>]*>Request changes<\/button>/);
  expect(closed).toMatch(/disabled=""[^>]*>Approve<\/button>/);
});

test("SAFE-002, SAFE-004: the sheet shows one block per section with its comments; Request changes waits for something to send", async () => {
  // No DOM here for the sanitiser, so the sheet gets marked's own output.
  vi.doMock("../chat/renderMarkdown", () => ({ renderMarkdown: (md: string) => marked.parse(md, { async: false }) }));
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { default: PlanSheet } = await import("./PlanSheet");
  const props = { title: "orch-repo", plan: "# Plan\n\nRead it.\n\nShip it.", onDraft: () => {}, onApprove: () => {}, onRequest: () => {}, onClose: () => {} };
  const empty = renderToString(createElement(PlanSheet, { ...props, draft: { comments: [], note: "" } }));
  expect(empty.match(/class="plan-block"/g)?.length).toBe(3);
  expect(empty).toContain("<h1>Plan</h1>");
  expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Request changes<\/button>/);
  const one = renderToString(createElement(PlanSheet, { ...props, draft: { comments: [{ id: "c1", start: 3, end: 3, quote: "Read it.", text: "which files?" }], note: "" } }));
  expect(one).toMatch(/Line 3.*which files\?.*Remove/s);
  expect(one).toContain("Request changes (1)");
  expect(one).not.toMatch(/disabled=""[^>]*>Request changes/);
});

// T-032-b: the Request changes send is a job that can be cancelled at any step (SAFE-004).
type Log = string[];
const steps = (log: Log, o: { deny?: boolean; askingFor?: number; alive?: boolean; onWait?: () => void } = {}) => {
  let asks = o.askingFor ?? 0;
  return {
    deny: async () => (log.push("no"), o.deny ?? true),
    asking: () => asks > 0,
    type: async (t: string) => void log.push(`type:${t}`),
    enter: async () => void log.push("enter"),
    alive: () => o.alive ?? true,
    wait: async (ms: number) => {
      log.push(`wait:${ms}`);
      if (asks > 0) asks--;
      o.onWait?.();
    },
  };
};

test("SAFE-004: a send with nothing in the way answers no, types the message as one paste, then presses Enter", async () => {
  const log: Log = [];
  const job = startFeedback("fix it", steps(log));
  expect(await job.done).toEqual({ outcome: "sent", answered: true, typed: true });
  expect(log).toEqual(["no", "type:fix it", "wait:300", "enter"]);
});

test("SAFE-004: the message waits while the pane still asks, and goes once it leaves", async () => {
  const log: Log = [];
  expect((await startFeedback("x", steps(log, { askingFor: 2 })).done).outcome).toBe("sent");
  expect(log).toEqual(["no", "wait:100", "wait:100", "type:x", "wait:300", "enter"]);
});

// The job's own guard: the sheet's Cancel can never be this early (its button shows only after a
// re-render, by which time the agent's no has gone out), so the window has no branch for it.
test("SAFE-004: a cancel in the same tick as the start sends nothing at all (the job's guard)", async () => {
  const log: Log = [];
  const job = startFeedback("x", steps(log));
  job.cancel();
  expect(await job.done).toEqual({ outcome: "cancelled", answered: false, typed: false });
  expect(log).toEqual([]);
});

test("SAFE-004: cancelling while it waits for the pane to leave the ask types nothing", async () => {
  const log: Log = [];
  let job: ReturnType<typeof startFeedback> | null = null;
  job = startFeedback("x", steps(log, { askingFor: 5, onWait: () => job?.cancel() }));
  expect(await job.done).toEqual({ outcome: "cancelled", answered: true, typed: false });
  expect(log).toEqual(["no", "wait:100"]);
});

test("SAFE-004: cancelling between the paste and Enter never presses Enter", async () => {
  const log: Log = [];
  let job: ReturnType<typeof startFeedback> | null = null;
  job = startFeedback("x", { ...steps(log), wait: async (ms: number) => void (log.push(`wait:${ms}`), job?.cancel()) });
  expect(await job.done).toEqual({ outcome: "cancelled", answered: true, typed: true });
  expect(log).toEqual(["no", "type:x", "wait:300"]);
  // Cancelling after it finished changes nothing.
  job.cancel();
  expect((await job.done).outcome).toBe("cancelled");
});

test("SAFE-004: a failed answer, a pane that keeps asking, or a closed pane types nothing", async () => {
  let log: Log = [];
  expect((await startFeedback("x", steps(log, { deny: false })).done).outcome).toBe("no-answer");
  expect(log).toEqual(["no"]);
  log = [];
  expect((await startFeedback("x", steps(log, { askingFor: 99 })).done).outcome).toBe("still-asking");
  expect(log.filter((l) => l === "wait:100")).toHaveLength(30);
  expect(log.some((l) => l.startsWith("type:"))).toBe(false);
  log = [];
  expect((await startFeedback("x", steps(log, { alive: false })).done).outcome).toBe("gone");
  expect(log).toEqual(["no"]);
});

// What the sheet can really reach: a click lands while the agent's no or the paste is still in
// flight (each is an IPC call), never before the no went out.
const later = () => {
  let go: (v: boolean) => void = () => {};
  const p = new Promise<boolean>((r) => (go = r));
  return { p, go };
};

test("SAFE-004: cancelling while the agent's no is in flight types nothing; the no still went out", async () => {
  const log: Log = [];
  const no = later();
  const job = startFeedback("x", { ...steps(log), deny: () => (log.push("no"), no.p) });
  await Promise.resolve();
  await Promise.resolve();
  expect(log).toEqual(["no"]);
  job.cancel();
  no.go(true);
  expect(await job.done).toEqual({ outcome: "cancelled", answered: true, typed: false });
  expect(log).toEqual(["no"]);
});

test("SAFE-004: cancelling while the paste is in flight ends at once: no 300 ms wait, never Enter", async () => {
  const log: Log = [];
  const pasted = later();
  let job: ReturnType<typeof startFeedback> | null = null;
  job = startFeedback("x", { ...steps(log), type: async (t: string) => void (log.push(`type:${t}`), job?.cancel(), await pasted.p) });
  pasted.go(true);
  expect(await job.done).toEqual({ outcome: "cancelled", answered: true, typed: true });
  expect(log).toEqual(["no", "type:x"]);
});

test("SAFE-004: the pane re-asks while the paste goes in → Enter is held back", async () => {
  const log: Log = [];
  let asking = false;
  const s = { ...steps(log), asking: () => asking, type: async (t: string) => void (log.push(`type:${t}`), (asking = true)) };
  expect(await startFeedback("x", s).done).toEqual({ outcome: "still-asking", answered: true, typed: true });
  expect(log).toEqual(["no", "type:x", "wait:300"]);
});

test("SAFE-004: a paste that did not reach the pane is never followed by Enter; a failed Enter is not a send", async () => {
  // Stand-in review of lane/marks 243736d, AFTER 11: the window swallowed a failed write, so the job
  // took the text as typed and pressed Enter on an empty prompt. A write now says false when it failed.
  let log: Log = [];
  const failedPaste = { ...steps(log), type: async (t: string) => (log.push(`type:${t}`), false) };
  expect(await startFeedback("x", failedPaste).done).toEqual({ outcome: "write-failed", answered: true, typed: false });
  expect(log).toEqual(["no", "type:x"]);
  log = [];
  const failedEnter = { ...steps(log), enter: async () => (log.push("enter"), false) };
  expect(await startFeedback("x", failedEnter).done).toEqual({ outcome: "write-failed", answered: true, typed: true });
  expect(log).toEqual(["no", "type:x", "wait:300", "enter"]);
});
