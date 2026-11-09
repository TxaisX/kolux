// DT-C228 (APP-017): the body colour reaches the engine's default background, once per change.
import { describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { installWindowBackground, opaqueRgb } from "./windowBackground";

describe("DT-C228 window background", () => {
  test("an opaque colour is sent; transparent and translucent send null", () => {
    expect(opaqueRgb("rgb(5, 4, 5)")).toEqual([5, 4, 5]);
    expect(opaqueRgb("rgba(5, 4, 5, 1)")).toEqual([5, 4, 5]);
    expect(opaqueRgb("rgba(5, 4, 5, 0.72)")).toBeNull();
    expect(opaqueRgb("rgba(0, 0, 0, 0)")).toBeNull();
    expect(opaqueRgb("transparent")).toBeNull();
  });

  test("sent at install, again only when the colour changes, and not after stop", () => {
    const sent: unknown[] = [];
    let colour = "rgb(5, 4, 5)";
    let fire: (() => void) | null = null;
    const stop = installWindowBackground({
      read: () => colour,
      send: (rgb) => sent.push(rgb),
      on: (f) => {
        fire = f;
        return () => {
          fire = null;
        };
      },
    });
    expect(sent).toEqual([[5, 4, 5]]);
    fire!();
    expect(sent).toHaveLength(1);
    colour = "rgb(250, 250, 250)";
    fire!();
    expect(sent).toEqual([[5, 4, 5], [250, 250, 250]]);
    colour = "rgba(250, 250, 250, 0.5)";
    fire!();
    expect(sent[2]).toBeNull();
    stop();
    expect(fire).toBeNull();
  });
});
