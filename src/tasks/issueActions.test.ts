import { describe, expect, it } from "vitest";
import { actionError, runAction } from "./issueActions";

const later = () => {
  let done!: () => void;
  const p = new Promise<void>((r) => (done = r));
  return { p, done };
};

describe("FIX-1 issue actions (council FS 2)", () => {
  it("stays busy until the refreshed issue has come back, so Close cannot be sent twice", async () => {
    const busy: boolean[] = [];
    const refresh = later();
    let after = 0;
    const run = runAction({ send: Promise.resolve(), refresh: () => refresh.p, after: () => after++, setBusy: (b) => busy.push(b), setError: () => {}, what: "close" });
    await Promise.resolve();
    await Promise.resolve();
    expect(busy).toEqual([true]);
    expect(after).toBe(1);
    refresh.done();
    await run;
    expect(busy).toEqual([true, false]);
  });

  it("a gh timeout on a comment says it may have been posted, and nothing is refreshed", async () => {
    const errors: (string | null)[] = [];
    let refreshed = false;
    const busy: boolean[] = [];
    await runAction({ send: Promise.reject("github.com: gh did not answer within 30 seconds; try again in a moment"), refresh: async () => void (refreshed = true), setBusy: (b) => busy.push(b), setError: (e) => errors.push(e), what: "comment" });
    expect(errors[errors.length - 1]).toMatch(/may have been posted.*refresh/i);
    expect(refreshed).toBe(false);
    expect(busy).toEqual([true, false]);
  });

  it("other failures read as gh said them", () => {
    expect(actionError("There is no issue #9 in acme/app.", "close")).toBe("There is no issue #9 in acme/app.");
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "close")).toMatch(/may have been closed/);
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "reopen")).toMatch(/may have been reopened/);
    // FIX-2 AFTER 1: there is no issue to refresh yet after a create timeout, so it names the list.
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "create")).toBe("gh did not answer in time, so the issue may have been opened; refresh the list before trying again.");
    expect(actionError("gh did not answer within 30 seconds; try again in a moment", "close")).toMatch(/refresh the issue before/);
  });
});

describe("GIT-048 (T-281-b) a change shown at once is put back when GitHub refuses it", () => {
  it("runs onFail after the error is told, and not after a success", async () => {
    const order: string[] = [];
    await runAction({ send: Promise.reject("nope"), refresh: async () => {}, setBusy: () => {}, setError: (e) => order.push(`error:${e}`), what: "close", onFail: () => order.push("put back") });
    expect(order).toEqual(["error:null", "error:nope", "put back"]);
    const ok: string[] = [];
    await runAction({ send: Promise.resolve(), refresh: async () => {}, setBusy: () => {}, setError: () => {}, what: "close", onFail: () => ok.push("put back") });
    expect(ok).toEqual([]);
  });

  it("a refresh that fails after a good write is told, and does not put the change back", async () => {
    const errors: (string | null)[] = [];
    const back: string[] = [];
    await runAction({ send: Promise.resolve(), refresh: () => Promise.reject("offline"), setBusy: () => {}, setError: (e) => errors.push(e), what: "close", onFail: () => back.push("put back") });
    expect(back).toEqual([]);
    expect(errors[errors.length - 1]).toMatch(/went through.*offline/);
  });
});
