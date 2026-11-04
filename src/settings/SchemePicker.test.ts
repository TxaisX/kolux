import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readAppearance } from "../theme";
import { schemeOptions, SchemeList } from "./SchemePicker";

const look = readAppearance({ terminalCustomSchemes: [{ name: "Mine", background: "#123456", foreground: "#fedcba" }] });

test("SET-023: Kolux and Match come first, the catalogue next and custom schemes last", () => {
  const ids = schemeOptions(look, true).map((o) => o.id);
  expect(ids.slice(0, 3)).toEqual(["default", "match", "tango-light"]);
  expect(ids[ids.length - 1]).toBe("custom:Mine");
});

test("SET-023: the list narrows as the user types and marks the pick", () => {
  const html = renderToString(createElement(SchemeList, { label: "Dark mode", options: schemeOptions(look, true), query: "dra", value: "dracula", onPick: () => {} }));
  expect(html).toContain("Dracula");
  expect(html).not.toContain("Nord");
  expect(html).toMatch(/aria-pressed="true"[^>]*>.*Dracula/);
  const none = renderToString(createElement(SchemeList, { label: "Light mode", options: schemeOptions(look, false), query: "zzz", value: "x", onPick: () => {} }));
  expect(none).toContain("No scheme matches");
});
