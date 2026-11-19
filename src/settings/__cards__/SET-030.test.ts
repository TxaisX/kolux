// SET-030 acceptance (page half): the real ClaudeCard on the small DOM. evidence/cards-SET-030-replay.json is written by
// src-tauri/tests/cards_17.rs: `signedIn`/`signedOut` are what claude_own_sign_in really returns for a CLI that is signed in / signed out
// (real status reader run against a fake `claude` program), `restarted` is the settings a reopened Store really holds after the switch was saved.
// MIRROR: the stand-in invoke only answers the card's reads and records settings_patch; the card, its warning text and its switch are the product's.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import replay from "../../../evidence/cards-SET-030-replay.json";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../../test/fakeDom";

const h = vi.hoisted(() => ({
  own: null as unknown,
  settings: {} as Record<string, unknown>,
  patches: [] as { set: Record<string, unknown>; remove: string[] }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "claude_key_status") return Promise.resolve({ connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null });
    if (cmd === "claude_own_sign_in") return Promise.resolve(h.own);
    if (cmd === "get_settings") return Promise.resolve(JSON.parse(JSON.stringify(h.settings)));
    if (cmd === "settings_patch") {
      const p = args as { set: Record<string, unknown>; remove: string[] };
      h.patches.push(JSON.parse(JSON.stringify(p)));
      Object.assign(h.settings, p.set);
      for (const k of p.remove) delete h.settings[k];
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

let doc: FakeDocument;
let focusListeners: (() => void)[] = [];
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  focusListeners = [];
  Object.assign(dom.win, {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    addEventListener: (t: string, fn: () => void) => void (t === "focus" && focusListeners.push(fn)),
    removeEventListener: (t: string, fn: () => void) => void (focusListeners = focusListeners.filter((f) => f !== fn || t !== "focus")),
  });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.own = null;
  h.settings = {};
  h.patches = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function card() {
  const { ClaudeCard } = await import("../SettingsPage");
  const m = await mount(createElement(ClaudeCard), doc);
  unmount = m.unmount;
  await settle(80);
  return m.container as FakeNode;
}
const SIGN_IN_WARNING = "Claude Code is not signed in on this PC, so new Claude panes will ask you to sign in. Connect, or use your Claude account.";
const cls = (n: FakeNode) => String(n.attrs.className ?? n.attrs.class ?? "");
const warning = (c: FakeNode) => find(c, (n) => String(n.attrs.className ?? n.attrs.class ?? "").includes("own-sign-in"))[0];
const resumeSwitch = (c: FakeNode) => find(c, (n) => n.localName === "input" && n.attrs.role === "switch")[0] as FakeNode & { checked: boolean };

test("box 1: after Claude is signed out from its own CLI the card shows the sign-in warning on the next check", async () => {
  h.own = replay.signedIn;
  const c = await card();
  expect(warning(c).textContent).toBe("New Claude panes use Claude Code's own sign-in on this PC (sam@example.com).");
  expect(cls(warning(c))).not.toContain("warn");
  expect(c.textContent).not.toContain(SIGN_IN_WARNING);
  // `claude auth logout` in a terminal, then the user comes back to the window.
  h.own = replay.signedOut;
  expect(focusListeners.length).toBeGreaterThan(0);
  for (const f of focusListeners) f();
  await until(() => c.textContent.includes(SIGN_IN_WARNING), "the warning");
  expect(cls(warning(c))).toContain("warn");
  expect(c.textContent).not.toContain("sam@example.com");
});

test("box 2: turning auto-resume on saves the field, and a restart (new page on the reopened settings) shows it on", async () => {
  const first = await card();
  expect(resumeSwitch(first).checked).toBe(false); // off by default
  resumeSwitch(first).checked = true; // the user's click turns the box on before React reads it
  await click(first, resumeSwitch(first));
  await until(() => h.patches.length > 0, "the switch to be saved");
  expect(h.patches).toEqual([{ set: { claudeResumeAfterLimit: true }, remove: [] }]);
  expect(resumeSwitch(first).checked).toBe(true);
  // Restart: the window is gone; the next one reads what the reopened Store holds (the real Store round trip is in cards_17.rs).
  expect(h.patches[0].set).toEqual({ claudeResumeAfterLimit: replay.restarted.claudeResumeAfterLimit });
  await unmount();
  h.settings = replay.restarted;
  const second = await card();
  expect(resumeSwitch(second).checked).toBe(true);
});
