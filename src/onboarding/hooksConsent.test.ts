// T-608 (brief "Path to an A", Phase 0 and section 3): status hooks on by default with one line of
// consent. The wizard's Connect screen shows the line with its switch on; moving on records the choice;
// a profile that never answered sees the same line once in a small card. Nothing writes the hooks
// switch before the line was shown. The Wizard runs with a stand-in for React's hooks (as
// useWizard.test.ts does), so what is checked is what the component does when its buttons are pressed.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = { slots: [] as unknown[], i: 0 };
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  function useState<T>(init: T | (() => T)) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((x: T) => T)) => void (h.slots[k] = typeof v === "function" ? (v as (x: T) => T)(h.slots[k] as T) : v);
    return [h.slots[k] as T, set] as const;
  }
  function useRef<T>(init: T) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { current: init };
    return h.slots[k] as { current: T };
  }
  // Effects never run here: the window listeners and the settings read are not what these tests look at.
  const hooks = { useState, useRef, useEffect: () => {}, useLayoutEffect: () => {} };
  return { ...real, ...hooks, default: { ...real, ...hooks } };
});

const calls: Array<[string, unknown]> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    return Promise.resolve(cmd === "get_settings" ? {} : null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

beforeEach(() => {
  h.slots = [];
  calls.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

const { renderToString } = await import("react-dom/server");
const { createElement } = await import("react");
const { HOOKS_FIELD, HOOKS_LINE, askHooks, hooksChosen, hooksDefault, recordHooks, recordsHooks } = await import("./hooksOn");
const { SCREENS } = await import("./firstRun");
const { default: Wizard, WizardView } = await import("./Wizard");
const { HooksAskView } = await import("./Guides");

const writes = () => calls.filter(([c]) => c === "settings_patch" || c === "agent_hooks_sync");
const flush = () => new Promise((r) => setTimeout(r, 0));

test("T-608: the Connect screen shows the one line with its switch on by default, and off when the user turned it off", () => {
  const view = (at: number, hooks: boolean) => renderToString(createElement(WizardView, { at, connected: false, ping: true, hooks, onHooks() {}, onPing() {}, onBack() {}, onMain() {}, onSecondary() {}, onPickFolder() {} } as never));
  const connect = SCREENS.findIndex((s) => s.id === "connect");
  expect(HOOKS_LINE).toMatch(/Kolux will add its status hooks to each AI.s settings/);
  const on = view(connect, true);
  expect(on).toContain(HOOKS_LINE.replace(/'/g, "&#x27;"));
  expect(on).toMatch(/<input type="checkbox" role="switch" checked=""/);
  expect(view(connect, false)).not.toMatch(/role="switch" checked=""/);
  // One line, on one screen: the other screens do not repeat it.
  for (const at of SCREENS.keys()) if (at !== connect) expect(view(at, true)).not.toContain("status hooks");
});

test("T-608: only moving on from the Connect screen records the choice; Back and the other screens record nothing", () => {
  const connect = SCREENS.findIndex((s) => s.id === "connect");
  expect(recordsHooks(connect, connect + 1)).toBe(true);
  expect(recordsHooks(connect, connect - 1)).toBe(false);
  expect(recordsHooks(connect - 1, connect)).toBe(false);
  expect(recordsHooks(connect + 1, connect + 2)).toBe(false);
});

test("T-608: recording saves the switch first, then brings every agent in line (off takes Kolux's entries out)", async () => {
  await recordHooks(true);
  await recordHooks(false);
  expect(writes()).toEqual([
    ["settings_patch", { set: { [HOOKS_FIELD]: true }, remove: [] }],
    ["agent_hooks_sync", { clear: false }],
    ["settings_patch", { set: { [HOOKS_FIELD]: false }, remove: [] }],
    ["agent_hooks_sync", { clear: true }],
  ]);
  // A save that fails syncs nothing.
  calls.length = 0;
  await recordHooks(true, (cmd) => (calls.push([cmd, null]), cmd === "settings_patch" ? Promise.reject(new Error("disk full")) : Promise.resolve(null))).catch(() => {});
  expect(calls.map(([c]) => c)).toEqual(["settings_patch"]);
});

test("T-608: a saved true or false is a choice; nothing saved (or something unreadable) is not, and the switch then starts on", () => {
  expect(hooksChosen({ [HOOKS_FIELD]: true })).toBe(true);
  expect(hooksChosen({ [HOOKS_FIELD]: false })).toBe(true);
  expect(hooksChosen({})).toBe(false);
  expect(hooksChosen({ [HOOKS_FIELD]: "yes" })).toBe(false);
  expect(hooksDefault(null)).toBe(true);
  expect(hooksDefault({})).toBe(true);
  expect(hooksDefault({ [HOOKS_FIELD]: false })).toBe(false);
  expect(hooksDefault({ [HOOKS_FIELD]: true })).toBe(true);
});

test("T-608: the one-time card asks only a profile with no saved choice, and never while the first-run wizard is open", () => {
  expect(askHooks({}, false)).toBe(true);
  expect(askHooks({}, true)).toBe(false);
  expect(askHooks({ [HOOKS_FIELD]: false }, false)).toBe(false);
  expect(askHooks({ [HOOKS_FIELD]: true }, false)).toBe(false);
});

test("T-608: the card carries the same line, its switch on by default, and Done", () => {
  const html = renderToString(createElement(HooksAskView, { on: true, onSwitch() {}, onDone() {} }));
  expect(html).toContain(HOOKS_LINE.replace(/'/g, "&#x27;"));
  expect(html).toMatch(/role="switch" checked=""/);
  expect(html).toContain(">Done<");
  expect(renderToString(createElement(HooksAskView, { on: false, onSwitch() {}, onDone() {} }))).not.toMatch(/role="switch" checked=""/);
});

test("49-ux2: the card also offers Not now and Turn off", () => {
  const html = renderToString(createElement(HooksAskView, { on: true, onSwitch() {}, onDone() {}, onLater() {}, onOff() {} }));
  expect(html).toContain(">Not now<");
  expect(html).toContain(">Turn off<");
});

test("T-608: the wizard writes no hooks until the user moves on from the line; then it records what the switch shows", async () => {
  vi.stubGlobal("navigator", { platform: "Win32" });
  const draw = (start = 0) => {
    h.i = 0;
    return Wizard({ start, ping: true, onPing() {}, onSession() {}, onPickFolder() {}, onClose() {} }) as unknown as { props: Record<string, (...a: unknown[]) => void> & { at: number; hooks: boolean } };
  };
  // The saved settings are read by an effect, which does not run here: what the switch shows while they
  // load (on) is what moving on records, so the screen and the record never differ.
  let el = draw(0);
  expect(el.props.at).toBe(0);
  el.props.onMain(); // Get started: welcome -> Connect, where the line shows
  await flush();
  el = draw();
  expect(el.props.at).toBe(1);
  expect(el.props.hooks).toBe(true);
  expect(writes()).toEqual([]);
  el.props.onHooks(false); // the off choice
  el = draw();
  expect(el.props.hooks).toBe(false);
  expect(writes()).toEqual([]);
  el.props.onSecondary(); // 49-ux2: I'll do this later leaves the screen but is not consent: nothing is recorded
  await flush();
  expect(writes()).toEqual([]);
  el = draw();
  expect(el.props.at).toBe(2);
  el.props.onBack(); // Back to the line, then Continue: the explicit move on records the choice
  await flush();
  el = draw();
  expect(el.props.at).toBe(1);
  el.props.onMain();
  await flush();
  expect(writes()).toEqual([
    ["settings_patch", { set: { [HOOKS_FIELD]: false }, remove: [] }],
    ["agent_hooks_sync", { clear: true }],
  ]);
});
