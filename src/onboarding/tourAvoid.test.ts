// ONB-031 / UX audit 2026-10-25 Part D: a tour's callout must not cover a restored workspace pane.
import { describe, expect, it } from "vitest";
import { place, type Rect } from "./tour";

// 1400x880 viewport as measured: pane x 305-1092, y 84-848; a small control at the bottom right.
const b: Rect = { left: 8, top: 8, width: 1384, height: 864 };
const pane: Rect = { left: 305, top: 84, width: 787, height: 764 };
const button: Rect = { left: 1348, top: 792, width: 44, height: 44 };
const p = { width: 320, height: 131 };
const hits = (a: Rect, w: number, h: number, o: Rect) => a.left < o.left + o.width && a.left + w > o.left && a.top < o.top + o.height && a.top + h > o.top;

describe("tour placement keeps off panes", () => {
  it("without panes to avoid, the step's own side wins (unchanged)", () => {
    expect(place(button, p, b, "left").side).toBe("left");
  });
  it("the left-of-button callout would cover the pane corner; with the pane given it does not", () => {
    const before = place(button, p, b, "left");
    expect(hits(before as unknown as Rect, p.width, p.height, pane)).toBe(true);
    const r = place(button, p, b, "left", [pane]);
    expect(hits({ left: r.left, top: r.top, width: 0, height: 0 }, r.width ?? p.width, p.height, pane)).toBe(false);
    expect(r.left + (r.width ?? p.width)).toBeLessThanOrEqual(b.left + b.width);
  });
  it("when every side would cover a pane, the old placement stands", () => {
    const wide = { left: 0, top: 0, width: 1400, height: 880 };
    expect(place(button, p, b, "left", [wide])).toEqual(place(button, p, b, "left"));
  });

  // Fix 10: a restored grid filling everything right of the left sidebar, the target in the top bar.
  describe("no clear side", () => {
    const full: Rect = { left: 289, top: 40, width: 1311, height: 836 };
    const bar: Rect = { left: 8, top: 8, width: 1584, height: 884 };
    const topTarget: Rect = { left: 700, top: 8, width: 80, height: 28 };
    const sidebar: Rect = { left: 0, top: 0, width: 289, height: 876 };
    it("with the sidebar the callout sits inside it, 0 px on the pane, arrow toward the target", () => {
      const r = place(topTarget, p, bar, "bottom", [full], sidebar);
      expect(hits({ left: r.left, top: r.top, width: 0, height: 0 }, r.width ?? p.width, p.height, full)).toBe(false);
      expect(r.left).toBeGreaterThanOrEqual(sidebar.left);
      expect(r.left + (r.width ?? p.width)).toBeLessThanOrEqual(sidebar.left + sidebar.width);
      expect(r.side).toBe("left");
      expect(topTarget.left).toBeGreaterThanOrEqual(r.left + (r.width ?? p.width));
      expect(Math.abs(r.top + p.height / 2 - (topTarget.top + topTarget.height / 2))).toBeLessThanOrEqual(p.height / 2 + 8);
    });
    it("without the sidebar the old fallback stands", () => {
      expect(place(topTarget, p, bar, "bottom", [full])).toEqual({ side: "bottom", left: 580, top: 46 });
      expect(place(topTarget, p, bar, "bottom", [full], null)).toEqual({ side: "bottom", left: 580, top: 46 });
    });
    it("a sidebar narrower than 240 px does not change the fallback", () => {
      expect(place(topTarget, p, bar, "bottom", [full], { ...sidebar, width: 200 })).toEqual({ side: "bottom", left: 580, top: 46 });
    });
  });
});
