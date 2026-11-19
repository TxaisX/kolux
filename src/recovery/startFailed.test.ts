import { describe, expect, it } from "vitest";
import { showStartFailure, startFailureText } from "./startFailed";

// FIX-5 (council d2 AFTER 4): a failed start shows a message and the window instead of a hidden, blank one.
const fakePage = () => {
  const made: { tag: string; attrs: Record<string, string>; textContent: string | null }[] = [];
  const root = { textContent: "old", kids: [] as unknown[], setAttribute() {}, append(...n: unknown[]) { this.kids.push(...n); } };
  return {
    made,
    root,
    page: {
      getElementById: (id: string) => (id === "root" ? root : null),
      createElement: (tag: string) => {
        const el = { tag, attrs: {} as Record<string, string>, textContent: null as string | null, setAttribute(k: string, v: string) { this.attrs[k] = v; }, append() {} };
        made.push(el);
        return el;
      },
    },
  };
};

describe("FIX-5 a failed start", () => {
  it("names the error's first line, never a stack, and has a plain line when there is nothing to say", () => {
    expect(startFailureText(new Error("Failed to fetch dynamically imported module\n    at x (y.js:1:1)"))).toBe("Kolux could not start: Failed to fetch dynamically imported module. Close it and open it again.");
    expect(startFailureText("boom")).toContain("boom");
    expect(startFailureText({})).toBe("Kolux could not start. Close it and open it again.");
    expect(startFailureText(new Error("x".repeat(500))).length).toBeLessThan(300);
  });

  it("puts an alert in the root and shows the window", async () => {
    const f = fakePage();
    let shown = 0;
    const text = showStartFailure(new Error("chunk"), f.page, async () => void shown++);
    expect(f.root.textContent).toBe("");
    expect(f.root.kids).toHaveLength(1);
    expect(f.made[0]).toMatchObject({ tag: "p", attrs: { role: "alert" }, textContent: text });
    expect(shown).toBe(1);
  });

  // FIX-6 (council d2 AFTER 2): a root React already drew into is left as it is.
  it("never wipes a root that already holds drawn content: the alert goes on the body instead", () => {
    const f = fakePage();
    Object.assign(f.root, { firstChild: {}, textContent: "drawn by React" });
    const body = { kids: [] as unknown[], textContent: "page", setAttribute() {}, append(...n: unknown[]) { this.kids.push(...n); } };
    let shown = 0;
    showStartFailure(new Error("late"), { ...f.page, body }, async () => void shown++);
    expect(f.root.textContent).toBe("drawn by React");
    expect(f.root.kids).toHaveLength(0);
    expect(body.kids).toHaveLength(1);
    expect(f.made[0]).toMatchObject({ tag: "p", attrs: { role: "alert" } });
    expect(shown).toBe(1);
  });

  it("still shows the window when the page has no root, and survives a show that fails", () => {
    let shown = 0;
    expect(() => showStartFailure(new Error("x"), { getElementById: () => null, createElement: () => { throw new Error("unused"); } }, () => (shown++, Promise.reject(new Error("no window"))))).not.toThrow();
    expect(shown).toBe(1);
  });
});
