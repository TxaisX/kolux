// ORCH-057: a viewer that fell behind redraws from a snapshot and drops the queued output it already holds.
import { describe, expect, it } from "vitest";
import { endedLabel } from "./codec";
import { applySnapshot, resyncGate } from "./resync";

describe("ORCH-057 viewer resync", () => {
  it("pause a viewer, flood output, resume it: it redraws from the snapshot and skips what the snapshot holds", () => {
    const gate = resyncGate();
    const screen: string[] = [];
    const term = { reset: () => void (screen.length = 0), write: (d: Uint8Array) => void screen.push(new TextDecoder().decode(d)) };
    // events queued while the viewer was paused: counts 10, 20, ... 100
    const queued = Array.from({ length: 10 }, (_, i) => ({ seq: (i + 1) * 10, text: `c${i + 1}` }));
    for (const e of queued.slice(0, 2)) if (gate.accept(e.seq)) term.write(new TextEncoder().encode(e.text));
    expect(screen).toEqual(["c1", "c2"]);
    // the next acknowledgement is answered with a snapshot covering up to count 80
    gate.took({ seq: 80, data: "" });
    applySnapshot(term, new TextEncoder().encode("tail up to c8"));
    for (const e of queued.slice(2)) if (gate.accept(e.seq)) term.write(new TextEncoder().encode(e.text));
    expect(screen).toEqual(["tail up to c8", "c9", "c10"]);
    // an older snapshot never moves the floor back; events without a count always draw
    gate.took({ seq: 50, data: "" });
    expect(gate.accept(60)).toBe(false);
    expect(gate.accept(undefined)).toBe(true);
  });

  it("an end Kolux could not confirm reads as unverifiable, not as an exit", () => {
    expect(endedLabel(null, "unverifiable")).toBe("ended, outcome unverifiable");
    expect(endedLabel(0, "exited")).toBe("ended");
    expect(endedLabel(2, "exited")).toBe("ended (exit 2)");
    expect(endedLabel(null)).toBe("ended");
  });
});
