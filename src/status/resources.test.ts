import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { committedCell } from "./ResourceManager";
import { committedNote, endNeedsAsk, formatCommitted, groupSessions } from "./resources";

const u = { bytes: 1, cpu: 0, processes: 1, pid: null, committed: null };

test("sessions sit under the deepest workspace they run in, the rest under No workspace", () => {
  const sessions = [
    { ...u, id: 1, dir: "C:\\repo" },
    { ...u, id: 2, dir: "C:\\repo\\ws\\alpha\\src" },
    { ...u, id: 3, dir: "C:\\Users\\me" },
    { ...u, id: 4, pid: 44, dir: null },
    { ...u, id: 5, dir: "C:/repo/ws/alpha" },
  ];
  const groups = groupSessions(sessions, { 1: "Terminal 1", 2: "Claude", 5: "Codex" }, ["C:/repo", "C:/repo/ws/alpha"]);
  expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
    ["repo", [1]],
    ["alpha", [2, 5]],
    ["No workspace", [3, 4]],
  ]);
  const hidden = groups[2].rows[0];
  expect([hidden.name, hidden.shown]).toEqual(["Session 3 (not in a pane)", false]);
  expect(groups[1].rows[0].shown).toBe(true);
  // USAGE-028: a session that outlived a window reload keeps its pid in the row, like any other.
  expect([groups[2].rows[1].name, groups[2].rows[1].pid]).toEqual(["Session 4 (not in a pane)", 44]);
});

test("VIEW-099: End asks first unless a fresh read confirms the session has already ended", () => {
  const usage = { bytes: 1, cpu: 0, processes: 1, committed: null };
  const fresh = { app: usage, sessions: [{ id: 4, pid: null, dir: null, ...usage }], free: null, total: null };
  expect(endNeedsAsk(fresh, 4)).toBe(true);
  expect(endNeedsAsk(fresh, 7)).toBe(false);
  expect(endNeedsAsk(null, 7)).toBe(true);
});

test("T-287-b: committed memory shows beside resident, a dash when Windows gave no figure", () => {
  expect(formatCommitted(null)).toBe("–");
  expect(formatCommitted(undefined)).toBe("–");
  expect(formatCommitted(0)).toBe("0.0 MB");
  expect(formatCommitted(344338432)).toBe("328.4 MB");
  expect(formatCommitted(2 * 1024 ** 3)).toBe("2.00 GB");
  const groups = groupSessions([{ ...u, id: 9, dir: null, committed: 4096 * 1024 }], {}, []);
  expect(formatCommitted(groups[0].rows[0].committed)).toBe("4.0 MB");
});

test("FIX-1 (T-287-c): an unknown committed sum says how many processes could not be read", () => {
  expect(committedNote({ committed: null, unreadable: 1, processes: 3 })).toBe("(1 of 3 could not be read)");
  expect(committedNote({ committed: null, unreadable: 3, processes: 3 }), "none read still says so").toBe("(3 of 3 could not be read)");
  expect(committedNote({ committed: null, unreadable: 0, processes: 0 }), "no processes is the plain dash").toBe("");
  expect(committedNote({ committed: null, processes: 2 }), "an older payload without the count is the plain dash").toBe("");
  expect(committedNote({ committed: 4096, unreadable: 0, processes: 3 }), "a whole sum needs no note").toBe("");
});

test("FIX-1 (T-287-c): the committed cell shows a dash and the note when the sum is unknown, nothing extra when whole", () => {
  const partial = renderToString(committedCell({ bytes: 1, cpu: 0, processes: 3, committed: null, unreadable: 2 }));
  expect(partial).toContain("–");
  expect(partial).toContain("(2 of 3 could not be read)");
  expect(partial).toContain("res-unread");
  expect(partial).not.toContain("MB");
  const whole = renderToString(committedCell({ bytes: 1, cpu: 0, processes: 3, committed: 4 * 1024 * 1024, unreadable: 0 }));
  expect(whole).toContain("4.0 MB");
  expect(whole).not.toContain("could not be read");
  expect(renderToString(committedCell({ bytes: 1, cpu: 0, processes: 0, committed: null, unreadable: 0 }))).not.toContain("could not be read");
});
