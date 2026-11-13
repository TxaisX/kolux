import { describe, expect, it } from "vitest";
import { tidyWeights } from "./tidy";

describe("term-008 tidy the grid", () => {
  const dragged = { "/w|col|3": [3, 1, 1], "/w|row|1": [1], "/w|col|2": [1, 4], "/other|col|3": [2, 1, 1] };
  it("every dragged size of this folder is dropped, whatever the pane count was", () => {
    expect(tidyWeights(dragged, "/w")).toEqual({ "/other|col|3": [2, 1, 1] });
  });
  it("a folder with nothing dragged changes nothing, and the input is not touched", () => {
    expect(tidyWeights(dragged, "/none")).toEqual(dragged);
    expect(dragged["/w|col|3"]).toEqual([3, 1, 1]);
  });
  it("TERM-009: three columns dragged to 50/25/25 are one third each after Equalize", () => {
    const share = (w: number[]) => w.map((x) => x / w.reduce((a, b) => a + b, 0));
    const before = { "/w|col|3": [2, 1, 1] };
    expect(share(before["/w|col|3"])).toEqual([0.5, 0.25, 0.25]);
    // the window reads a missing entry as one weight of 1 per column (App weightsOf)
    const after = tidyWeights(before, "/w")["/w|col|3"] ?? [1, 1, 1];
    expect(share(after).map((x) => Math.round(x * 1000) / 1000)).toEqual([0.333, 0.333, 0.333]);
  });
  it("the no-folder grid keys on the empty name", () => {
    expect(tidyWeights({ "|col|2": [1, 3], "/w|col|2": [1, 3] }, null)).toEqual({ "/w|col|2": [1, 3] });
  });
});
