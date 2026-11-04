// T-764 / T-742 (#191 c3): Escape in the font field closes only its suggestion list. The key is stopped (stopPropagation),
// so it does not also reach the Settings page's own Escape; with the list already closed it is left to bubble and close Settings.
import { expect, test, vi } from "vitest";
import { FontField } from "./AppearancePage";
import { findAll, find, mount } from "./__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const p = (await import("./__cards__/shallow-react")).patchReact(await orig<object>()) as { default: object };
  const useId = () => "f";
  return { ...p, useId, default: { ...p.default, useId } };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

test("T-742: Escape with the font list open is stopped and closes the list; with the list closed it is left to bubble", () => {
  const fonts = ["Alpha Sans", "Beta Mono"];
  // Slots: text, fonts, open, typed, hi.
  const view = mount(FontField, { label: "Interface font", value: "", placeholder: "", onPick: () => {} }, { 1: fonts, 2: true });
  const esc = () => {
    const seen = { stopped: 0 };
    find(view.render(), (e) => e.type === "input").props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation: () => seen.stopped++ });
    return seen.stopped;
  };
  const listShown = () => findAll(view.render(), (e) => e.props.role === "listbox").length > 0;
  expect(listShown()).toBe(true);
  expect(esc(), "open: Escape is stopped here, so Settings stays").toBe(1);
  expect(listShown(), "and the list is closed").toBe(false);
  expect(esc(), "closed: Escape is not stopped, it goes on to close Settings").toBe(0);
});
