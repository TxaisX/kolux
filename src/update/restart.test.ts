import { describe, expect, it } from "vitest";
import { popupEscapes, RESTART_ASK, RESTART_TIP, restartingLabel } from "./card";

describe("update restart honesty", () => {
  it("the tip no longer claims terminals keep running", () => {
    expect(RESTART_TIP).not.toMatch(/keep running/i);
    expect(RESTART_TIP).toMatch(/closes your open terminals and agents/);
  });
  it("the confirmation says terminals and agents end and offers a clear confirm word", () => {
    expect(RESTART_ASK.body).toMatch(/closes every open terminal and agent/);
    expect(RESTART_ASK.confirm).toBe("Restart now");
  });
  it("the button reads Restarting… while the restart runs", () => {
    expect(restartingLabel("Restart to update", true)).toBe("Restarting…");
    expect(restartingLabel("Restart to update", false)).toBe("Restart to update");
    expect(restartingLabel(null, false)).toBeNull();
  });
  it("Escape closes the pop-up unless a field has it or another handler took the key", () => {
    expect(popupEscapes({ key: "Escape", defaultPrevented: false, target: { tagName: "DIV" } })).toBe(true);
    expect(popupEscapes({ key: "Escape", defaultPrevented: true, target: { tagName: "DIV" } })).toBe(false);
    expect(popupEscapes({ key: "Escape", defaultPrevented: false, target: { tagName: "TEXTAREA" } })).toBe(false);
    expect(popupEscapes({ key: "Enter", defaultPrevented: false, target: null })).toBe(false);
  });
});
