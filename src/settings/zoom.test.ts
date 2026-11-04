import { describe, expect, it, vi } from "vitest";
import { nextLevel, percentOf, readZoom, stepZoom, zoomLevel } from "./zoom";
import { actions } from "../keys/actions";

const h = vi.hoisted(() => ({ fail: false, saved: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (_: string, a: unknown) => (h.saved.push(a), h.fail ? Promise.reject("disk full") : Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }) }));

describe("interface zoom (SET-019)", () => {
  it("steps half a level, about 9.5 %, and two steps make one whole level of 1.2", () => {
    expect(percentOf(nextLevel(0, "in"))).toBe(110);
    expect(percentOf(nextLevel(nextLevel(0, "in"), "in"))).toBe(120);
    expect(percentOf(nextLevel(0, "out"))).toBe(91);
  });
  it("holds between -3 and +5 levels and resets to 100 % from anywhere", () => {
    expect(nextLevel(5, "in")).toBe(5);
    expect(nextLevel(-3, "out")).toBe(-3);
    expect(percentOf(-3)).toBe(58);
    expect(percentOf(5)).toBe(249);
    expect(nextLevel(4.5, "reset")).toBe(0);
  });
  it("reads a saved level back on a half step inside the range, anything else as 100 %", () => {
    expect(readZoom(1.5)).toBe(1.5);
    expect(readZoom(1.3)).toBe(1.5);
    expect(readZoom(40)).toBe(5);
    expect(readZoom("2")).toBe(0);
    expect(readZoom(Number.NaN)).toBe(0);
  });
});

// T-723 (DT-C159): a zoom key, the View menu and the zoom control all step through stepZoom; a failed save used to be
// swallowed, so the size looked kept but was lost at the next start.
describe("a failed zoom save is told (T-723)", () => {
  it("passes the error to the caller, and the window keeps the new size", async () => {
    h.fail = true;
    const told: string[] = [];
    stepZoom("reset", () => {});
    stepZoom("in", (t) => told.push(t));
    await vi.waitFor(() => expect(told).toHaveLength(1));
    expect(told[0]).toContain("Zoom not saved");
    expect(told[0]).toContain("disk full");
    expect(zoomLevel()).toBe(0.5);
    expect(h.saved[h.saved.length - 1]).toEqual({ set: { uiZoom: 0.5 }, remove: [] });
  });
  it("says nothing when the save lands", async () => {
    h.fail = false;
    const told: string[] = [];
    stepZoom("out", (t) => told.push(t));
    await new Promise((r) => setTimeout(r, 0));
    expect(told).toEqual([]);
  });
  it("the window's zoom keys name their step in their id (useWindowKeys reads it from there)", () => {
    expect(actions.filter((x) => x.id.startsWith("ui.zoom")).map((x) => x.id.slice(7).toLowerCase())).toEqual(["in", "out", "reset"]);
  });
});
