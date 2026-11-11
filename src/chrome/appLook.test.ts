import { describe, expect, test } from "vitest";
import { APP_ICONS, appIcon, appLookSummary, applyWindowBlur, blurOn, blurRefused } from "./appLook";

describe("T-301 app icon and window blur (APP-012, SET-041)", () => {
  test("the three icons, in the card's order", () => {
    expect(APP_ICONS.map((i) => i.id)).toEqual(["classic", "watercolor", "blue"]);
  });
  test("an unknown or missing icon reads Classic", () => {
    expect(appIcon({})).toBe("classic");
    expect(appIcon({ appIcon: "purple" })).toBe("classic");
    expect(appIcon({ appIcon: "Blue" })).toBe("classic");
    expect(appIcon({ appIcon: 2 })).toBe("classic");
    expect(appIcon({ appIcon: "blue" })).toBe("blue");
    expect(appIcon({ appIcon: "watercolor" })).toBe("watercolor");
  });
  test("blur is off unless a saved true", () => {
    expect(blurOn({})).toBe(false);
    expect(blurOn({ windowBlur: "true" })).toBe(false);
    expect(blurOn({ windowBlur: 1 })).toBe(false);
    expect(blurOn({ windowBlur: true })).toBe(true);
  });
  test("the page mark follows the switch both ways", () => {
    const root = { dataset: {} as DOMStringMap };
    applyWindowBlur({ windowBlur: true }, root);
    expect(root.dataset.windowBlur).toBe("on");
    applyWindowBlur({ windowBlur: false }, root);
    expect(root.dataset.windowBlur).toBeUndefined();
  });
  test("the page stays solid where the window has nothing to blur with, and after the window refused the effect", () => {
    const root = { dataset: {} as DOMStringMap };
    applyWindowBlur({ windowBlur: true }, root, true);
    expect(root.dataset.windowBlur, "another system, or a refused effect: never see-through").toBeUndefined();
    applyWindowBlur({ windowBlur: true }, root, false);
    expect(root.dataset.windowBlur).toBe("on");
    applyWindowBlur({ windowBlur: true }, root, true);
    expect(root.dataset.windowBlur, "a refusal takes the mark back").toBeUndefined();
    // last, because a refusal holds for the rest of the run
    blurRefused();
    applyWindowBlur({ windowBlur: true }, root);
    expect(root.dataset.windowBlur).toBeUndefined();
  });
  test("summary", () => {
    expect(appLookSummary({})).toBe("Classic icon");
    expect(appLookSummary({ appIcon: "blue", windowBlur: true })).toBe("Blue icon · Blur");
  });
});
