import { describe, expect, it } from "vitest";
import { ABOUT_EVENT, ABOUT_MENU_ID, NOTICES_BUTTON, aboutRows, gpuText, noticesState, openAbout } from "./about";

describe("view-106 About panel", () => {
  it("puts Safe Graphics Mode ahead of the browser engine's GPU status, and says so when it is on", () => {
    const rows = aboutRows({ version: "0.1.0", safeGraphics: true, gpu: { webgl2: true, software: true } });
    expect(rows.map((r) => r.label)).toEqual(["Version", "Safe Graphics Mode", "Graphics (browser engine)"]);
    expect(rows[1].value).toMatch(/^on/);
    expect(rows[2].value).toBe("software drawing");
  });
  it("anything not known yet says unavailable", () => {
    const rows = aboutRows({ version: "", safeGraphics: null, gpu: null });
    expect(rows.map((r) => r.value)).toEqual(["unavailable", "unavailable", "unavailable"]);
  });
  it("reads the three GPU states", () => {
    expect(gpuText({ webgl2: true, software: false })).toBe("hardware accelerated");
    expect(gpuText({ webgl2: false, software: false })).toMatch(/WebGL 2 is not available/);
  });
});

describe("view-106 Help > About", () => {
  it("the menu item's id opens the panel's own window event, and nothing else does", () => {
    const target = new EventTarget();
    let opened = 0;
    target.addEventListener(ABOUT_EVENT, () => opened++);
    expect(ABOUT_MENU_ID).toBe("help.about");
    openAbout(target);
    expect(opened).toBe(1);
  });
});

describe("T-783 About > Third-party notices", () => {
  it("shows the text when the app returns it, and says why when it cannot", () => {
    expect(NOTICES_BUTTON).toBe("Third-party notices");
    expect(noticesState("THIRD-PARTY NOTICES\n...")).toEqual({ kind: "text", text: "THIRD-PARTY NOTICES\n..." });
    expect(noticesState(null, "THIRD-PARTY-NOTICES.txt was not found (looked in C:/x)")).toEqual({ kind: "error", message: "THIRD-PARTY-NOTICES.txt was not found (looked in C:/x)" });
    expect(noticesState("  \n")).toEqual({ kind: "error", message: "The notices file is missing from this install." });
    expect(noticesState(null, new Error("boom"))).toEqual({ kind: "error", message: "boom" });
  });
});
