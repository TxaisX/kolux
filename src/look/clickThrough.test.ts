// FIX-1 (council review of 87f3fd67, items 4-7): click-through tests for the controls T-266, T-268 and
// T-270 drew. There is no DOM environment, so clickTree.ts walks each component's elements and fires
// the same handlers a click or edit reaches, against a small settings store that behaves like the app's
// (one key per sidebar save, a whole patch per Settings save).
import { createElement } from "react";
import { expect, test } from "vitest";
import { PIN_COPIES_SETTING } from "../projects/rows";
import { readAppearance } from "../theme";
import { byLabel, byTag, change, click, hosts, textOf } from "./clickTree";
import { CardDetailsChooser } from "./CardDetailsChooser";
import { CARD_DENSITY_FIELD, CARD_DETAILS_FIELD, readCardDetails } from "./cards";
import { HeaderColourPicker, HeaderSwatches } from "./HeaderBadge";
import { HEADER_COLOURS_SETTING, forgetHeaderColours, headerColourOf } from "./headerColour";
import { CardDensityBody, SidebarLookBody } from "./SidebarSettings";

/** A settings store: `one` is the sidebar's onSetting (one key), `patch` is the Settings page's save. */
function store(start: Record<string, unknown> = {}) {
  const calls: Array<[string, unknown]> = [];
  const s = { now: start };
  return {
    s,
    calls,
    one: (key: string, value: unknown) => {
      calls.push([key, value]);
      s.now = { ...s.now, [key]: value };
    },
    patch: (p: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(p)) calls.push([k, v]);
      s.now = { ...s.now, ...p };
    },
  };
}

test("PROJ-017: clicking a swatch saves that colour for that header only; grey clears it", () => {
  const picked: string[] = [];
  const row = hosts(createElement(HeaderSwatches, { value: "grey", onPick: (c) => picked.push(c) }));
  expect(byTag(row, "button").map((b) => b.props["aria-label"])).toEqual(["Grey", "Blue", "Teal", "Green", "Amber", "Red", "Pink", "Purple"]);
  click(byLabel(row, "Teal"));
  expect(picked).toEqual(["teal"]);

  const st = store();
  const draw = (kind: "p" | "g", id: string) => hosts(createElement(HeaderColourPicker, { settings: st.s.now, kind, id, onSetting: st.one }));
  click(byLabel(draw("p", "a"), "Blue"));
  click(byLabel(draw("g", "a"), "Red"));
  expect(st.s.now[HEADER_COLOURS_SETTING]).toEqual({ "p:a": "blue", "g:a": "red" });
  expect(headerColourOf(st.s.now, "p", "a").id, "the project and the group with the same id are separate").toBe("blue");
  expect(byLabel(draw("p", "a"), "Blue").props["aria-checked"]).toBe(true);
  click(byLabel(draw("p", "a"), "Grey"));
  expect(st.s.now[HEADER_COLOURS_SETTING]).toEqual({ "g:a": "red" });
  expect(st.calls.every(([k]) => k === HEADER_COLOURS_SETTING)).toBe(true);
});

test("PROJ-017: deleting a group (and its projects) takes their colours out of the map", () => {
  const s = { [HEADER_COLOURS_SETTING]: { "p:a": "blue", "p:b": "green", "g:x": "red", "g:y": "pink" } };
  expect(forgetHeaderColours(s, [{ kind: "g", id: "x" }])).toEqual({ "p:a": "blue", "p:b": "green", "g:y": "pink" });
  expect(forgetHeaderColours(s, [{ kind: "g", id: "x" }, { kind: "p", id: "a" }, { kind: "p", id: "nope" }])).toEqual({ "p:b": "green", "g:y": "pink" });
  expect(forgetHeaderColours(s, [])).toEqual(s[HEADER_COLOURS_SETTING]);
  expect(forgetHeaderColours({}, [{ kind: "g", id: "x" }])).toEqual({});
});

test("PROJ-062: the Card details chooser has a real heading and a tick-box per detail; ticking and unticking saves the right list", () => {
  const st = store({ [CARD_DENSITY_FIELD]: "detailed" });
  const draw = () => hosts(createElement(CardDetailsChooser, { settings: st.s.now, onSetting: st.one }));
  const head = draw().find((h) => h.type === "h3");
  expect(head && textOf(head.props.children), "the label is a heading element").toBe("Card details");
  expect(draw().find((h) => h.props.role === "group")?.props["aria-labelledby"]).toBe(head?.props.id);
  const boxes = byTag(draw(), "input");
  expect(boxes.map((b) => b.props["aria-label"])).toEqual(["card shows status", "card shows agent summary", "card shows pull request", "card shows changed files", "card shows note", "card shows ports", "card shows task"]);
  expect(boxes.map((b) => b.props.checked), "Detailed shows all but Ports and Task, which are the user's own ticks (T-266-b)").toEqual([true, true, true, true, true, false, false]);
  expect(boxes[0].props.disabled, "status cannot be switched off").toBe(true);

  change(byLabel(draw(), "card shows status"), { checked: false });
  expect(st.calls, "a click on the locked status writes nothing").toEqual([]);

  change(byLabel(draw(), "card shows pull request"), { checked: false });
  expect(st.s.now[CARD_DETAILS_FIELD]).toEqual(["status", "agents", "changes", "note"]);
  expect(byLabel(draw(), "card shows pull request").props.checked).toBe(false);
  change(byLabel(draw(), "card shows note"), { checked: false });
  expect(readCardDetails(st.s.now), "back to the Default set (T-609: it keeps the changed-file count)").toEqual({ shown: ["status", "agents", "changes"], density: "default" });
  expect(st.s.now[CARD_DETAILS_FIELD], "saved as the preset, not a frozen list").toEqual(["preset:default"]);
  change(byLabel(draw(), "card shows changed files"), { checked: false });
  expect(readCardDetails(st.s.now).density).toBe("custom");
  change(byLabel(draw(), "card shows agent summary"), { checked: false });
  expect(readCardDetails(st.s.now).density).toBe("compact");
  change(byLabel(draw(), "card shows ports"), { checked: true });
  expect(readCardDetails(st.s.now), "the Ports property is a custom set").toEqual({ shown: ["status", "ports"], density: "custom" });
  expect(byLabel(draw(), "card shows ports").props.checked).toBe(true);
  expect(st.calls.every(([k]) => k === CARD_DETAILS_FIELD), "every tick is one setting").toBe(true);
});

test("VIEW-052: the sidebar look controls hand the new look back; Tinted adds the colour and strength controls", () => {
  const seen: Array<ReturnType<typeof readAppearance>> = [];
  const look = readAppearance({});
  const std = hosts(createElement(SidebarLookBody, { look, onChange: (a) => seen.push(a) }));
  expect(std.some((h) => h.props["aria-label"] === "Sidebar tint colour")).toBe(false);
  const pick = (name: string) => click(byTag(std, "button").find((b) => textOf(b.props.children) === name)!);
  pick("Match terminal");
  pick("Tinted");
  pick("Standard");
  expect(seen.map((a) => a.sidebarLook)).toEqual(["terminal", "tinted", "standard"]);

  const tinted = readAppearance({ sidebarLook: "tinted", sidebarTint: "#cc2200", sidebarTintStrength: 15 });
  const body = hosts(createElement(SidebarLookBody, { look: tinted, onChange: (a) => seen.push(a) }));
  change(byLabel(body, "Sidebar tint colour"), { value: "#00aa55" });
  change(byLabel(body, "Sidebar tint strength"), { value: "40" });
  expect(seen[3]).toMatchObject({ sidebarLook: "tinted", sidebarTint: "#00aa55", sidebarStrength: 15 });
  expect(seen[4]).toMatchObject({ sidebarTint: "#cc2200", sidebarStrength: 40 });
});

test("SET-021: the workspace card layout buttons save the preset and clear a custom list; the pin switch saves its key", () => {
  const st = store({ [CARD_DETAILS_FIELD]: ["status", "pr"] });
  const draw = () => hosts(createElement(CardDensityBody, { settings: st.s.now, save: st.patch }));
  const seg = () => byTag(draw(), "button").map((b) => textOf(b.props.children));
  expect(seg()).toEqual(["Default", "Compact", "Detailed", "Custom"]);
  click(byTag(draw(), "button").find((b) => textOf(b.props.children) === "Compact")!);
  expect(st.s.now).toMatchObject({ [CARD_DENSITY_FIELD]: "compact", [CARD_DETAILS_FIELD]: [] });
  expect(seg(), "no Custom button once a preset is chosen").toEqual(["Default", "Compact", "Detailed"]);
  expect(byTag(draw(), "button").find((b) => textOf(b.props.children) === "Compact")!.props["aria-checked"]).toBe(true);
  click(byTag(draw(), "button").find((b) => textOf(b.props.children) === "Detailed")!);
  expect(readCardDetails(st.s.now).density).toBe("detailed");

  change(byLabel(draw(), "Pinned workspaces also in their groups"), { checked: true });
  expect(st.s.now[PIN_COPIES_SETTING]).toBe(true);
  change(byLabel(draw(), "Pinned workspaces also in their groups"), { checked: false });
  expect(st.s.now[PIN_COPIES_SETTING]).toBe(false);
});
