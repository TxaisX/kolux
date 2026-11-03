// T-153-f (VIEW-099 rest): Manage Sessions' background sessions, the ones the background terminal
// service holds that no window owns. Agents and busy ones are never offered, nothing is offered while
// the window loads, End N ends only what its question named and an already-ended one needs no question.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { endOffered, hostLabel, hostSummary, offerable, type HostSession } from "./hostSessions";
import { HostSessionsView } from "./BackgroundSessions";

const row = (id: number, over: Partial<HostSession> = {}): HostSession => ({ id, pid: id * 10, program: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", dir: null, agent: false, busy: false, ...over });
const rows = [row(4), row(2, { agent: true, program: "claude --permission-mode auto", busy: true }), row(3, { busy: true }), row(1)];

test("only idle shells are offered, sorted, and nothing while the window is still loading", () => {
  expect(offerable(rows, true).map((r) => r.id)).toEqual([1, 4]);
  expect(offerable(rows, false)).toEqual([]);
  expect(offerable(null, true)).toEqual([]);
  expect(offerable([row(2, { agent: true })], true)).toEqual([]); // an agent's session is never offered, even when idle
});

test("labels and the summary say what the service holds and what is left alone", () => {
  expect(hostLabel(rows[0])).toBe("Background session 4 (pwsh.exe)");
  expect(hostLabel(rows[1])).toBe("Background session 2 (claude)");
  expect(hostLabel(row(9, { program: "" }))).toBe("Background session 9");
  expect(hostSummary(rows, true)).toBe("2 background sessions no window owns (2 more left alone: agent or busy)");
  expect(hostSummary([row(1)], true)).toBe("1 background session no window owns");
  expect(hostSummary([row(2, { agent: true })], true)).toBe("1 background session no window owns: agent sessions or with a program running, left alone.");
  expect(hostSummary(rows, false)).toBeNull();
  expect(hostSummary([], true)).toBeNull();
});

test("End N ends only the named sessions a fresh read still offers; an ended one is skipped, a failed read ends nothing", async () => {
  const ended: number[] = [];
  const end = async (id: number) => {
    ended.push(id);
    return true;
  };
  // 4 ended meanwhile, 5 appeared after the question, 3 started a program.
  const fresh = async () => [row(1), row(3, { busy: true }), row(5)];
  expect(await endOffered([1, 3, 4], fresh, end)).toEqual([1]);
  expect(ended).toEqual([1]);
  expect(await endOffered([1], () => Promise.reject(new Error("no service")), end)).toEqual([]);
  expect(await endOffered([1], fresh, async () => false)).toEqual([]); // already gone at the service: not counted as ended
  expect(await endOffered([1], fresh, () => Promise.reject(new Error("refused")))).toEqual([]);
});

const view = (over: Partial<Parameters<typeof HostSessionsView>[0]>) =>
  renderToString(createElement(HostSessionsView, { rows, loaded: true, asking: null, failed: "", onAsk: () => {}, onEnd: () => {}, onKeep: () => {}, ...over }));

test("the part offers End N, asks with Keep focused, and shows nothing while loading or when there is none", () => {
  const offer = view({});
  expect(offer).toContain('data-host="offer"');
  expect(offer).toMatch(/<button class="btn"[^>]*>End 2<\/button>/);
  const ask = view({ asking: offerable(rows, true) });
  expect(ask).toContain('role="alertdialog"');
  expect(ask).toContain("Background session 1 (pwsh.exe), Background session 4 (pwsh.exe)");
  expect(ask).not.toContain("claude");
  // T-692: an open question is still drawn when a re-read leaves nothing to offer, so the Resource Manager's Escape has something to close
  expect(view({ rows: [], asking: offerable(rows, true) })).toContain('role="alertdialog"');
  expect(ask).toMatch(/<button class="btn"[^>]*autofocus=""[^>]*>Keep<\/button>|<button class="btn" autoFocus/i);
  expect(view({ loaded: false })).toBe("");
  expect(view({ rows: [] })).toBe("");
  expect(view({ rows: [row(2, { agent: true })] })).toContain('data-host="none"');
  expect(view({ rows: null, failed: "the terminal service is not answering" })).toContain("Background sessions: the terminal service is not answering");
});
