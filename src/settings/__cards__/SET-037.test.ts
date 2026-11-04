// SET-037 acceptance. evidence/cards-SET-037-replay.json is written by src-tauri/tests/cards_17.rs from a real profile on disk:
// `legacy` is the settings a pre-redesign profile reads after the start-up stamp (Classic), `reopened` is what a Store reopened on the
// same folder holds after New and Board were saved. The window below is the product's useAppSettings + GeneralView + TopBar.
// MIRROR src/App.tsx:277 (`useState(() => startScreen(initial))`) and App.tsx:509 (a page's save merges the patch into the settings);
// which look and which screen those mean is readLook/startScreen in settings/general.ts.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import replay from "../../../evidence/cards-SET-037-replay.json";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle } from "../../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }) }));
vi.mock("../../switcher/AccountSwitcher", () => ({ default: () => null }));
vi.mock("../../usage/UsagePill", () => ({ default: () => null }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function window_(initial: Record<string, unknown>) {
  const { default: TopBar } = await import("../../chrome/TopBar");
  const { GeneralView } = await import("../GeneralPage");
  const { startScreen } = await import("../general");
  const { useAppSettings } = await import("../useAppSettings");
  const saved: Record<string, unknown>[] = [];
  const Window = () => {
    const { settings, setSettings, classic } = useAppSettings(initial);
    const [screen, setScreen] = useState(() => startScreen(initial));
    const onSave = (patch: Record<string, unknown>) => {
      saved.push(patch);
      setSettings((s) => ({ ...s, ...patch }));
    };
    return createElement("div", null, createElement(TopBar, { screen, classic, onScreen: setScreen as never, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} }), createElement(GeneralView, { settings, onSave }));
  };
  const m = await mount(createElement(Window), doc);
  unmount = m.unmount;
  await settle();
  return { c: m.container as FakeNode, saved };
}
const group = (c: FakeNode, label: string) => find(c, (n) => n.attrs.role === "radiogroup" && n.attrs["aria-label"] === label)[0];
const radios = (c: FakeNode, label: string) => find(group(c, label), (n) => n.attrs.role === "radio");
const picked = (c: FakeNode, label: string) => radios(c, label).filter((n) => n.attrs["aria-checked"] === "true").map((n) => n.textContent.trim());
const switcher = (c: FakeNode) => find(c, (n) => n.localName === "nav" && n.attrs.class === "switcher")[0];
const switcherButtons = (c: FakeNode) => (switcher(c) ? find(switcher(c), (n) => n.localName === "button").map((n) => n.textContent.trim()) : []);

test("box 1: a profile that existed before the redesign reads Classic (no Agents/Board/Terminals bar); choosing New shows the bar", async () => {
  expect(replay.legacy.uiLook).toBe("classic"); // what the start-up stamp left on a real pre-redesign profile
  const { c, saved } = await window_(replay.legacy);
  expect(picked(c, "Look")).toEqual(["Classic"]);
  expect(switcher(c)).toBeUndefined();
  await click(c, radios(c, "Look").find((n) => n.textContent.trim() === "New")!);
  await settle();
  expect(saved).toEqual([{ uiLook: "new" }]);
  expect(picked(c, "Look")).toEqual(["New"]);
  expect(switcherButtons(c).slice(0, 3)).toEqual(["Agents", "Board", "Terminals"]);
});

test("box 2: Board saved as the first screen with New, then a restart (profile reopened) opens on Board", async () => {
  // Setting it on the page: Board is offered under New and writes the choice.
  const first = await window_({ ...replay.legacy, uiLook: "new" });
  await click(first.c, radios(first.c, "Opens first").find((n) => n.textContent.trim() === "Board")!);
  await settle();
  expect(first.saved).toEqual([{ firstScreen: "board", lastScreen: "board" }]);
  await unmount();
  // The restart: the settings the reopened profile holds (real Store) are what the window starts from.
  expect(replay.reopened).toMatchObject({ uiLook: "new", firstScreen: "board" });
  const { c } = await window_(replay.reopened);
  const pressed = find(switcher(c), (n) => n.localName === "button" && n.attrs["aria-pressed"] === "true").map((n) => n.textContent.trim());
  expect(pressed).toEqual(["Board"]);
  expect(picked(c, "Opens first")).toEqual(["Board"]);
});

test("under Classic the first-screen choice shows only Terminals and greys Agents and Board with a hint", async () => {
  const { c } = await window_(replay.legacy);
  expect(picked(c, "Opens first")).toEqual(["Terminals"]);
  const off = radios(c, "Opens first").filter((n) => "disabled" in n.attrs && n.attrs.disabled !== "false").map((n) => n.textContent.trim());
  expect(off).toEqual(["Agents", "Board"]);
});

test("C17-R1-01: Opens first keeps Tower, and the next start opens on Tower", async () => {
  const first = await window_({ ...replay.legacy, uiLook: "new" });
  await click(first.c, radios(first.c, "Opens first").find((n) => n.textContent.trim() === "Tower")!);
  await settle();
  expect(first.saved).toEqual([{ firstScreen: "tower", lastScreen: "tower" }]);
  expect(picked(first.c, "Opens first")).toEqual(["Tower"]);
  await unmount();
  const { c } = await window_({ ...replay.legacy, uiLook: "new", firstScreen: "tower", lastScreen: "tower" });
  expect(picked(c, "Opens first")).toEqual(["Tower"]);
  expect(find(switcher(c), (n) => n.localName === "button" && n.attrs["aria-pressed"] === "true").map((n) => n.textContent.trim())).toEqual(["Tower"]);
});

test("C17-R1-01 guard: every screen in the top bar switcher can be Opens first", async () => {
  const [{ screens }, { startScreen }] = await Promise.all([import("../../chrome/TopBar"), import("../general")]);
  for (const s of screens) expect(startScreen({ uiLook: "new", firstScreen: s.id, lastScreen: s.id }), s.id).toBe(s.id);
});
