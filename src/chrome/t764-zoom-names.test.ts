// T-764 / palette.md:11: the top bar's Terminal zoom menu and the palette's interface-zoom entries have different names,
// and each acts on something different: the menu on the focused terminal's font size, the palette entries on the whole
// interface's zoom level.
import { expect, test } from "vitest";
import { VIEW_ITEMS } from "./TopBar";
import { actionById } from "../keys/actions";
import { zoomLevel, nextLevel } from "../settings/zoom";
import { termFont, zoomTerm } from "../theme";

const menu = VIEW_ITEMS.map((i) => i.label);
const ui = ["ui.zoomIn", "ui.zoomOut", "ui.zoomReset"].map((id) => actionById.get(id)?.title);

test("the Terminal zoom menu names are the terminal actions' names and none equals an interface-zoom entry's name", () => {
  expect(menu).toEqual(VIEW_ITEMS.map((i) => actionById.get(i.id)?.title));
  expect(menu).toEqual(["Zoom In", "Zoom Out", "Reset Size"]);
  expect(ui).toEqual(["Zoom Interface In", "Zoom Interface Out", "Reset Interface Zoom"]);
  for (const n of menu) expect(ui).not.toContain(n);
});

test("the menu zoom changes the terminal's font size and not the interface zoom; the interface zoom steps its own level", () => {
  const key = 764;
  const base = termFont(key).fontSize;
  const level = zoomLevel();
  zoomTerm(key, "in");
  expect(termFont(key).fontSize, "terminal font grew").toBe(base + 1);
  expect(termFont(764 + 1).fontSize, "another pane is untouched").toBe(base);
  expect(zoomLevel(), "interface zoom is not touched by the terminal zoom").toBe(level);
  zoomTerm(key, "reset");
  expect(termFont(key).fontSize).toBe(base);
  expect(nextLevel(0, "in"), "the interface zoom has its own level to step").toBeGreaterThan(0);
  expect(termFont(key).fontSize, "stepping the level math leaves the terminal font alone").toBe(base);
});
