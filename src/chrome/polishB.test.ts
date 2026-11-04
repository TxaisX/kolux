// T-742 (DT-C178): three hints that named a place or a fix now act. The status bar's hooks item opens Settings >
// Agents, a failed read of the Claude setup offers Retry, and the font fields' suggestions take Up/Down/Enter.
// The real components run with their state kept by shallow-react.ts (no browser); useId gets a fixed id.
import { expect, test, vi } from "vitest";
import StatusBar from "./StatusBar";
import { FontField } from "../settings/AppearancePage";
import { ClaudeSetupView } from "../settings/ClaudeSetupPage";
import { OPEN_SETTINGS } from "../settings/pages";
import { find, findAll, mount, textOf, type El } from "../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const p = (await import("../settings/__cards__/shallow-react")).patchReact(await orig<object>()) as { default: object };
  const useId = () => "f";
  return { ...p, useId, default: { ...p.default, useId } };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

test("the status bar's hooks item is a button that opens Settings > Agents at the hooks card", () => {
  const win = new EventTarget();
  vi.stubGlobal("window", win);
  const seen: unknown[] = [];
  win.addEventListener(OPEN_SETTINGS, (e) => seen.push((e as CustomEvent).detail));
  const tree = mount(StatusBar, { terminals: 3, agents: 1, hooks: false }).render();
  const item = find(tree, (e) => String(e.props.title ?? "").startsWith("Agent status hooks are off"));
  expect(item.type).toBe("button");
  item.props.onClick();
  expect(seen).toEqual([{ page: "agents", section: "hooks" }]);
  vi.unstubAllGlobals();
});

test("a failed read of the Claude setup offers Retry, which reads it again", () => {
  let tries = 0;
  const tree = ClaudeSetupView({ data: null, error: "denied", open: () => {}, retry: () => tries++ }) as unknown as El;
  expect(tree.props.role).toBe("alert");
  const retry = find(tree, (e) => e.type === "button" && textOf(e) === "Retry");
  retry.props.onClick();
  expect(tries).toBe(1);
});

test("font suggestions take Up and Down, show which is reached, and Enter picks it", () => {
  const picked: string[] = [];
  const fonts = ["Alpha Sans", "Beta Mono", "Gamma Serif"];
  // Slots: text, fonts, open, typed, hi. The fonts are loaded and the list is open, as after focusing the field.
  const view = mount(FontField, { label: "Interface font", value: "", placeholder: "", onPick: (f: string) => picked.push(f) }, { 1: fonts, 2: true });
  const key = (k: string) => find(view.render(), (e) => e.type === "input").props.onKeyDown({ key: k, preventDefault() {}, stopPropagation() {} });
  const state = () => {
    const tree = view.render();
    const input = find(tree, (e) => e.type === "input");
    const options = findAll(tree, (e) => e.props.role === "option");
    return { active: input.props["aria-activedescendant"], hi: options.filter((o) => o.props.className === "hi").map((o) => o.props.id), ids: options.map((o) => o.props.id), names: options.map(textOf) };
  };
  expect(state().active).toBeUndefined();
  key("ArrowDown");
  const s = state();
  expect(s.active).toBe(s.ids[0]);
  expect(s.hi).toEqual([s.ids[0]]);
  key("ArrowUp"); // from the first, Up wraps to the last
  expect(state().active).toBe(state().ids[2]);
  key("ArrowDown"); // and Down wraps back to the first
  key("ArrowDown");
  expect(state().active).toBe(state().ids[1]);
  key("Enter");
  expect(picked).toEqual([s.names[1]]);
});
