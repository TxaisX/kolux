import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { HEADER_COLOURS_SETTING, PALETTE, headerColourOf, pickHeaderColour, readHeaderColours, swatchStep, swatchTabIndex } from "./headerColour";
import { HeaderBadge, HeaderSwatches } from "./HeaderBadge";

test("PROJ-017: a project that was never coloured has a grey badge", () => {
  expect(headerColourOf({}, "p", "new-project").id).toBe("grey");
  expect(headerColourOf({ [HEADER_COLOURS_SETTING]: "junk" }, "g", "x").id).toBe("grey");
});

test("PROJ-017: picking blue is saved and still blue when the settings are read back", () => {
  const saved = { [HEADER_COLOURS_SETTING]: pickHeaderColour({}, "p", "a", "blue") };
  expect(saved[HEADER_COLOURS_SETTING]).toEqual({ "p:a": "blue" });
  expect(headerColourOf(JSON.parse(JSON.stringify(saved)), "p", "a").hex).toBe(PALETTE.find((c) => c.id === "blue")!.hex);
  expect(headerColourOf(saved, "g", "a").id, "a group with the same id is its own header").toBe("grey");
});

test("PROJ-017: only palette colours are saved; grey removes the entry; junk in a profile is dropped", () => {
  const s = { [HEADER_COLOURS_SETTING]: { "p:a": "blue", "p:b": "#ff00ff", "g:c": "grey", "p:d": 7 } };
  expect(readHeaderColours(s)).toEqual({ "p:a": "blue" });
  expect(pickHeaderColour(s, "p", "a", "#123456"), "not in the palette: nothing changes").toEqual({ "p:a": "blue" });
  expect(pickHeaderColour(s, "p", "a", "grey")).toEqual({});
  expect(pickHeaderColour(s, "g", "z", "red")).toEqual({ "p:a": "blue", "g:z": "red" });
});

test("PROJ-017: the badge shows the colour and the swatch row marks the chosen one", () => {
  expect(renderToString(createElement(HeaderBadge, { colour: PALETTE[1] }))).toContain("background:#4f8cff");
  const row = renderToString(createElement(HeaderSwatches, { value: "red", onPick: () => {} }));
  expect(row).toMatch(/aria-checked="true"[^>]*aria-label="Red"|aria-label="Red"[^>]*aria-checked="true"/);
  expect(row.match(/aria-checked="true"/g)).toHaveLength(1);
  expect(row.match(/role="radio"/g)).toHaveLength(PALETTE.length);
});

test("swatch row: one Tab stop, arrows wrap, Home and End jump", () => {
  const ids = ["a", "b", "c"];
  expect(ids.map((i) => swatchTabIndex(i, ids, "b"))).toEqual([-1, 0, -1]);
  expect(ids.map((i) => swatchTabIndex(i, ids, "zzz"))).toEqual([0, -1, -1]);
  expect(swatchStep("ArrowRight", ids, "c")).toBe("a");
  expect(swatchStep("ArrowLeft", ids, "a")).toBe("c");
  expect(swatchStep("End", ids, "a")).toBe("c");
  expect(swatchStep("x", ids, "a")).toBeNull();
  const html = renderToString(createElement(HeaderSwatches, { value: PALETTE[0].id, onPick: () => {} }));
  expect(html.match(/tabindex="0"/g)?.length).toBe(1);
  expect(html.match(/tabindex="-1"/g)?.length).toBe(PALETTE.length - 1);
});
