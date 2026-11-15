import { describe, expect, it } from "vitest";
import type { SessionUsage } from "../status/resources";
import { bulkQuestion, bulkReport, leftOver } from "./endAll";

const s = (id: number): SessionUsage => ({ id, pid: 100 + id, dir: null, bytes: 0, cpu: 0, processes: 1, committed: null });

describe("set-042 / set-060 end every session", () => {
  it("asks only when something runs, with the count and the kind's words", () => {
    expect(bulkQuestion("all", [])).toBeNull();
    const all = bulkQuestion("all", [1, 2, 3]);
    expect(all?.text).toContain("3 terminal sessions");
    expect(all?.text).toContain("Saved files are not touched.");
    expect(all?.confirm).toBe("End all");
    const restart = bulkQuestion("restart", [4]);
    expect(restart?.text).toContain("Restart every terminal (1 terminal session)? Running agents stop.");
    expect(restart?.confirm).toBe("Restart");
  });

  it("leftOver: what a fresh read still lists; a failed read keeps every id open", () => {
    expect(leftOver([1, 2, 3], [s(2), s(9)])).toEqual([2]);
    expect(leftOver([1, 2], [])).toEqual([]);
    expect(leftOver([1, 2], null)).toEqual([1, 2]);
  });

  it("reports success once none is listed, even when there was nothing to end; names what stayed", () => {
    expect(bulkReport("all", [1, 2], [])).toEqual({ ok: true, text: "2 terminal sessions ended; new terminals open straight away." });
    expect(bulkReport("all", [], [])).toEqual({ ok: true, text: "No terminal session was left to end; new terminals open straight away." });
    expect(bulkReport("restart", [1], [])).toEqual({ ok: true, text: "The terminals were restarted: 1 terminal session ended. Reopen a pane for a fresh terminal." });
    const bad = bulkReport("restart", [1, 2], [2]);
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain("1 terminal session did not end (Session 2)");
    expect(bad.text).toContain("diag log");
  });
});
