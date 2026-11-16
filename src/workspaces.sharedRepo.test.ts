// PROJ 008 / F21 (job 64's F1, the page's side): two Kolux projects on ONE Git repository. A is the main checkout, B a
// linked worktree of it; `git worktree list` from either names every worktree, so each project's list holds the other's
// own folder and every worktree both share. A shared folder goes with a removed project only when it is that project's
// own folder. The removed list goes through `goingFolders` before `goesWith` and `sessionsUnder` are asked.
import { describe, expect, test } from "vitest";
import { goesWith, goingFolders } from "./workspaces";
import { sessionsUnder } from "./projects/rows";

const A = "C:/r/app";
const B = "C:/r/app-b";
const W = "C:/r/wt3";
const lists: Record<string, string[]> = { A: [A, B, W], B: [B, A, W] };
const own: Record<string, string> = { A, B };
const at = (cwd: string) => ({ cwd, running: true });

/** What removing `gone` (the rest stay) asks about, closes and counts, for terminals in `open`. */
function remove(gone: string[], open: string[], all = lists, owner = own) {
  const staying = Object.keys(all).filter((k) => !gone.includes(k)).flatMap((k) => all[k]);
  const going = gone.flatMap((k) => goingFolders(owner[k], all[k], staying));
  return { going, asked: open.filter((d) => goesWith(d, going, staying)), counted: sessionsUnder(going, open.map(at), staying) };
}

describe("goingFolders: two projects on one repository", () => {
  test("g. remove B: B's own folder goes; A's folder and the shared worktree are not counted and not asked about", () => {
    const r = remove(["B"], [A, B, W]);
    expect(r.going).toEqual([B]);
    expect(r.asked).toEqual([B]);
    expect(r.counted).toBe(1);
  });
  test("h. remove A: A's own folder goes; B's folder and the shared worktree stay", () => {
    const r = remove(["A"], [A, B, W]);
    expect(r.going).toEqual([A]);
    expect(r.asked).toEqual([A]);
    expect(r.counted).toBe(1);
  });
  test("i. B's worktree folder lies inside A's folder; remove A: B's folder stays", () => {
    const inB = "C:/r/app/.wt/b";
    const r = remove(["A"], [A, inB, `${inB}/src`, W], { A: [A, inB, W], B: [inB, A, W] }, { A, B: inB });
    expect(r.going).toEqual([A]);
    expect(r.asked).toEqual([A]);
    expect(r.counted).toBe(1);
  });
  test("j. one project alone on its repository with two worktrees: all three folders go, as today", () => {
    const r = remove(["A"], [A, B, W], { A: [A, B, W] }, { A });
    expect(r.going).toEqual([A, B, W]);
    expect(r.asked).toEqual([A, B, W]);
    expect(r.counted).toBe(3);
  });
  test("k. a group delete that removes A and B together: every folder goes", () => {
    const r = remove(["A", "B"], [A, B, W]);
    expect(r.asked).toEqual([A, B, W]);
    expect(r.counted).toBe(3);
  });
  test("l. letter case and slash style differ between the two lists: the same answers", () => {
    const odd = { A: [A, B, W], B: ["c:\\R\\APP-B\\", "C:\\r\\App", "c:/R/WT3/"] };
    const b = remove(["B"], [A, B, W], odd, { A, B: "c:\\R\\APP-B\\" });
    expect(b.asked).toEqual([B]);
    expect(b.counted).toBe(1);
    const a = remove(["A"], [A, B, W], odd, { A: "c:/r/APP/", B });
    expect(a.asked).toEqual([A]);
    expect(a.counted).toBe(1);
  });
});
