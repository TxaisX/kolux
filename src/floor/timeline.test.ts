import { describe, expect, it } from "vitest";
import { indent, INDENT_LIMIT, kindOf, lanes, rangeStart, segments, staleNote, ticks, type Track } from "./timeline";

const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).getTime();
const track = (o: Partial<Track>): Track => ({ pane: 1, marks: [], ended: null, terminal: 7, live: true, parent: null, ...o });

describe("VIEW-013 Floor timeline", () => {
  it("range today at 09:00 starts the axis at local midnight, with six ticks", () => {
    expect(rangeStart("today", at(9))).toBe(at(0));
    expect(rangeStart("15m", at(9))).toBe(at(8, 45));
    const t = ticks(at(0), at(9));
    expect(t).toHaveLength(6);
    expect([t[0], t[5]]).toEqual([at(0), at(9)]);
  });

  it("an agent blocked on approval for 5 minutes gives a needs-you segment of that length", () => {
    const t = track({ marks: [{ at: at(8, 50), state: "working" }, { at: at(8, 52), state: "permission" }, { at: at(8, 57), state: "working" }] });
    const segs = segments(t, rangeStart("60m", at(9)), at(9));
    expect(segs.map((s) => s.kind)).toEqual(["working", "needs", "working"]);
    expect(segs[1].to - segs[1].from).toBe(5 * 60_000);
  });

  it("blocked and waiting both read needs-you; segments are clamped to the range", () => {
    expect(["blocked", "waiting", "permission"].map(kindOf)).toEqual(["needs", "needs", "needs"]);
    const segs = segments(track({ marks: [{ at: at(7), state: "working" }] }), at(8, 45), at(9));
    expect(segs).toEqual([{ kind: "working", from: at(8, 45), to: at(9) }]);
  });

  it("a lane with no live terminal shows its quiet stretches as unverifiable, and stops where the pane closed", () => {
    const closed = track({ live: false, ended: at(8, 55), marks: [{ at: at(8, 50), state: "done" }] });
    expect(segments(closed, at(8), at(9))).toEqual([{ kind: "unverifiable", from: at(8, 50), to: at(8, 55) }]);
    expect(segments({ ...closed, live: true }, at(8), at(9))[0].kind).toBe("idle");
  });

  it("lanes come in pane order and a lane with nothing in range is left off", () => {
    const tracks = [track({ pane: 5, marks: [{ at: at(8, 59), state: "working" }] }), track({ pane: 2, marks: [{ at: at(8, 59), state: "idle" }] }), track({ pane: 3, ended: at(7), marks: [{ at: at(6), state: "working" }] })];
    expect(lanes(tracks, at(8), at(9)).map((l) => l.track.pane)).toEqual([2, 5]);
  });

  it("the page draws one lane per pane with its segments and six ticks", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: FloorView } = await import("./FloorView");
    const html = renderToString(createElement(FloorView, { now: at(9), initial: [track({ marks: [{ at: at(8, 52), state: "permission" }, { at: at(8, 57), state: "working" }] })] }));
    expect(html.match(/class="floor-lane"/g)).toHaveLength(1);
    expect(html).toContain('data-ms="300000"');
    expect(html.match(/class="floor-tick"/g)).toHaveLength(6);
  });

  it("T-260-b: a child session nests right under its parent, grandchildren one step further, and a child whose parent has no lane stays on top", () => {
    const m = [{ at: at(8, 59), state: "working" }];
    const tracks = [
      track({ pane: 2, terminal: 12, parent: 1, marks: m }),
      track({ pane: 6, terminal: 16, marks: m }),
      track({ pane: 1, terminal: 11, marks: m }),
      track({ pane: 4, terminal: 14, parent: 2, marks: m }),
      track({ pane: 3, terminal: 13, parent: 1, marks: m }),
      track({ pane: 8, terminal: 18, parent: 99, marks: m }),
      track({ pane: 5, terminal: 15, parent: 7, marks: [{ at: at(6), state: "working" }], ended: at(7) }),
      track({ pane: 7, terminal: 17, ended: at(7), marks: [{ at: at(6), state: "working" }] }),
    ];
    const rows = lanes(tracks, at(8), at(9));
    expect(rows.map((r) => [r.track.pane, r.depth])).toEqual([[1, 0], [2, 1], [4, 2], [3, 1], [6, 0], [8, 0]]);
  });

  it("T-260-b: lanes that name each other as parent still all show, once, on top", () => {
    const m = [{ at: at(8, 59), state: "working" }];
    const rows = lanes([track({ pane: 1, parent: 2, marks: m }), track({ pane: 2, parent: 1, marks: m }), track({ pane: 3, parent: 3, marks: m })], at(8), at(9));
    expect(rows.map((r) => [r.track.pane, r.depth])).toEqual([[1, 0], [2, 0], [3, 0]]);
  });

  it("T-260-b: the page indents a child lane under its parent, parent first", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: FloorView } = await import("./FloorView");
    const m = [{ at: at(8, 52), state: "working" }];
    const html = renderToString(createElement(FloorView, { now: at(9), initial: [track({ pane: 2, terminal: 12, parent: 1, marks: m }), track({ pane: 1, terminal: 11, marks: m })] }));
    expect(html.match(/class="floor-lane"/g)).toHaveLength(2);
    expect([...html.matchAll(/data-depth="([0-9])"/g)].map((x) => x[1])).toEqual(["0", "1"]);
    expect(html.indexOf("Terminal 11")).toBeLessThan(html.indexOf("Terminal 12"));
  });

  it("FIX-1: the name column widens with the deepest nesting, every lane and the axis share it, and a long name is cut with its full text as a tooltip", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: FloorView } = await import("./FloorView");
    const m = [{ at: at(8, 52), state: "working" }];
    const flat = renderToString(createElement(FloorView, { now: at(9), initial: [track({ pane: 1, terminal: 11, marks: m })] }));
    expect(flat).toContain("width:110px");
    expect(flat).toContain("margin-left:118px");
    const nested = renderToString(createElement(FloorView, { now: at(9), initial: [track({ pane: 1, terminal: 11, marks: m }), track({ pane: 2, terminal: 12, parent: 1, live: false, marks: m }), track({ pane: 3, terminal: 13, parent: 2, marks: m })] }));
    expect([...nested.matchAll(/class="floor-name" [^>]*style="[^"]*?width:(\d+)px/g)].map((x) => x[1])).toEqual(["138", "138", "138"]);
    expect(nested).toContain("margin-left:146px");
    expect(nested).toContain('title="Terminal 12 (closed)"');
    expect(nested).toContain("text-overflow:ellipsis");
  });

  it("FIX-2: the name column stops growing at five levels, a deeper lane keeps the same indent and its true depth", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: FloorView } = await import("./FloorView");
    const m = [{ at: at(8, 52), state: "working" }];
    const chain = Array.from({ length: 9 }, (_, i) => track({ pane: i + 1, terminal: 11 + i, parent: i === 0 ? null : i, marks: m }));
    const html = renderToString(createElement(FloorView, { now: at(9), initial: chain }));
    // 110 + 14 * 5 = 180 for every lane, and the axis sits 8px further in.
    expect([...html.matchAll(/class="floor-name" [^>]*style="[^"]*?width:(\d+)px/g)].map((x) => x[1])).toEqual(Array(9).fill("180"));
    expect(html).toContain("margin-left:188px");
    expect([...html.matchAll(/class="floor-name" [^>]*style="[^"]*?padding-left:(\d+)/g)].map((x) => x[1])).toEqual(["0", "14", "28", "42", "56", "70", "70", "70", "70"]);
    expect([...html.matchAll(/data-depth="([0-9])"/g)].map((x) => x[1])).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(INDENT_LIMIT).toBe(5);
    expect([0, 3, 5, 6, 40].map(indent)).toEqual([0, 3, 5, 5, 5]);
  });

  it("T-035-b: a live lane is a button that jumps to its pane, a closed lane is not, and the page without a handler draws no button", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: FloorView } = await import("./FloorView");
    const m = [{ at: at(8, 52), state: "working" }];
    const initial = [track({ pane: 4, terminal: 14, marks: m }), track({ pane: 5, terminal: 15, live: false, marks: m })];
    const html = renderToString(createElement(FloorView, { now: at(9), initial, onOpen: () => {} }));
    expect(html.match(/class="floor-jump"/g)).toHaveLength(1);
    expect(html).toContain('data-pane="4"');
    expect(html).not.toContain('data-pane="5"');
    expect(html).toContain("Open in Code");
    expect(renderToString(createElement(FloorView, { now: at(9), initial }))).not.toContain("floor-jump");
  });
});

describe("floor stale lanes", () => {
  it("a failed re-read over lanes already shown says they are old; nothing to say without lanes or without an error", () => {
    expect(staleNote("boom", true)).toMatch(/last successful reading/);
    expect(staleNote("boom", false)).toBeNull();
    expect(staleNote(null, true)).toBeNull();
  });
  it("the range picker is the shared segmented control", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: FloorView } = await import("./FloorView");
    const html = renderToString(createElement(FloorView, { now: 0, initial: [] }));
    expect(html).toContain('class="seg-row"');
    expect(html).toContain('role="radio"');
  });
});
