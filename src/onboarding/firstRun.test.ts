import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CHECKLIST_CHANGED, chordFires, clearReadFailure, closer, readFailed, connectFailed, escapeLeaves, firstAiConnected, firstConnection, firstFolderAgent, leaveKey, milestone, oneClick, openAt, reopenWizard, SCREENS, STATUSES_FAILED, wizardCloser, type Outcome } from "./firstRun";
import { WizardView, sessionChoices } from "./Wizard";
import { jargon } from "../glossary";

const view = (at: number, more: Record<string, unknown> = {}) =>
  renderToString(createElement(WizardView, { at, connected: false, ping: true, hooks: true, onHooks() {}, onPing() {}, onBack() {}, onMain() {}, onSecondary() {}, onPickFolder() {}, ...more }));

test("ONB-001: the wizard opens after the last screen it finished, within the four", () => {
  expect(SCREENS.map((s) => s.id)).toEqual(["welcome", "connect", "work", "session"]);
  expect(openAt(null)).toBeNull();
  expect(openAt({ step: -1 })).toBe(0);
  expect(openAt({ step: 1 })).toBe(2);
  expect(openAt({ step: 3 })).toBe(3);
  expect(openAt({ step: 7 })).toBe(3);
});

test("ONB-001: Ctrl+Enter fires the main button, never from a text field, mid-composition or while it is off", () => {
  const key = (over: Record<string, unknown> = {}) => ({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: false, target: null, ...over });
  expect(chordFires(key(), false)).toBe(true);
  expect(chordFires(key({ ctrlKey: false, metaKey: true }), false)).toBe(true);
  expect(chordFires(key({ ctrlKey: false }), false)).toBe(false);
  expect(chordFires(key(), true)).toBe(false);
  expect(chordFires(key({ isComposing: true }), false)).toBe(false);
  expect(chordFires(key({ target: { tagName: "TEXTAREA" } }), false)).toBe(false);
  expect(chordFires(key({ target: { tagName: "INPUT", type: "text" } }), false)).toBe(false);
  expect(chordFires(key({ target: { tagName: "INPUT", type: "checkbox" } }), false)).toBe(true);
  expect(chordFires(key({ target: { tagName: "DIV", isContentEditable: true } }), false)).toBe(false);
  expect(chordFires(key({ key: "a" }), false)).toBe(false);
});

test("ONB-001 / ONB-002: screen one of four, its bars, no Back, three AI tiles and Get started", () => {
  const html = view(0);
  expect(html).toContain("1 of 4");
  expect(html.match(/class="onb-bar[^"]*"/g)).toEqual(['class="onb-bar now"', 'class="onb-bar"', 'class="onb-bar"', 'class="onb-bar"']);
  expect(html).toContain('title="Connect an AI"');
  expect(html).not.toContain(">Back<");
  for (const ai of ["Claude", "Codex", "Grok"]) expect(html).toContain(`aria-label="${ai} at work"`);
  expect(html.match(/onb-dot/g)?.length).toBe(3);
  expect(html).toMatch(/<button[^>]*class="btn primary onb-main"[^>]*>Get started<span class="onb-chord">/);
  expect(html).toContain("data-tauri-drag-region");
});

test("ONB-003: Continue waits for a connected AI; I'll do this later always moves on; Back shows", () => {
  const off = view(1, { cards: createElement("div", { className: "cards-here" }) });
  expect(off).toContain("2 of 4");
  expect(off).toContain('class="onb-bar done"');
  expect(off).toContain(">Back<");
  expect(off).toContain("cards-here");
  expect(off).toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
  expect(off).toMatch(/<button class="btn onb-secondary"[^>]*>I’ll do this later<\/button>/);
  expect(view(1, { connected: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
});

test("ONB-004: the work screen offers Pick a folder and Continue; kits and sample data are gone", () => {
  const html = view(2);
  expect(html).toContain("Pick a folder");
  expect(html).not.toContain("onb-sample");
  expect(html).not.toContain("sample data");
  expect(html).toMatch(/>Continue<span/);
});

test("ONB-005: the last screen has the finish switch on and Open a session as its main button", () => {
  const html = view(3);
  expect(html).toContain("4 of 4");
  expect(html).toMatch(/<input type="checkbox" role="switch" checked=""/);
  expect(html).toMatch(/>Open a session<span/);
  expect(html).not.toContain("kit");
  expect(view(3, { ping: false })).not.toMatch(/role="switch" checked=""/);
});

test("ONB-036: the wizard's own words keep to plain words", () => {
  for (const at of [0, 1, 2, 3]) {
    const text = view(at).replace(/<[^>]+>/g, " ");
    expect(jargon(text)).toEqual([]);
  }
});

test("ONB-006: Escape asks to leave, but not mid-composition or once something inside handled it", () => {
  const esc = (over: Record<string, unknown> = {}) => ({ key: "Escape", isComposing: false, defaultPrevented: false, ...over });
  expect(leaveKey(esc())).toBe(true);
  expect(leaveKey(esc({ isComposing: true }))).toBe(false);
  expect(leaveKey(esc({ defaultPrevented: true }))).toBe(false);
  expect(leaveKey(esc({ key: "Enter" }))).toBe(false);
});

test("ONB-006: the leave question offers Skip and No, keep going, and names the help menu's Onboarding item", () => {
  const html = view(1, { leaving: true, onSkip() {}, onStay() {} });
  expect(html).toContain("Skip setup?");
  expect(html).toContain(">Skip<");
  expect(html).toContain(">No, keep going<");
  expect(html).toContain("Onboarding");
  expect(html).toContain("help menu");
  expect(view(1)).not.toContain("Skip setup?");
  expect(jargon(html)).toEqual([]);
});

test("ONB-007: a close is latched while it stores; a failed store frees it and the next click retries it", async () => {
  const calls: Outcome[] = [];
  let fails = 1;
  let release: () => void = () => {};
  const store = (o: Outcome) => {
    calls.push(o);
    return new Promise<void>((ok, no) => (release = () => (fails-- > 0 ? no(new Error("disk full")) : ok())));
  };
  const seen: string[] = [];
  const c = closer(store, () => seen.push("closed"), (err) => seen.push(String(err)));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  expect(c.retry()).toBe(false);
  c.end("completed", () => seen.push("after"));
  c.end("dismissed");
  expect(calls).toEqual(["completed"]);
  release();
  await flush();
  expect(seen).toEqual(["Error: disk full"]);
  expect(c.retry()).toBe(true);
  expect(calls).toEqual(["completed", "completed"]);
  release();
  await flush();
  expect(seen).toEqual(["Error: disk full", "closed", "after"]);
  expect(c.retry()).toBe(false);
});

test("ONB-010: the first folder starts only the saved default agent, never a guess", () => {
  const agents = [
    { id: "claude", installed: true },
    { id: "codex", installed: false },
  ];
  expect(firstFolderAgent(agents, "claude")?.id).toBe("claude");
  expect(firstFolderAgent(agents, "")).toBeNull();
  expect(firstFolderAgent(agents, "terminal")).toBeNull();
  expect(firstFolderAgent(agents, "codex")).toBeNull();
  expect(firstFolderAgent(agents, "grok")).toBeNull();
});

test("FIX-5: a terminal entry in the offered list is never the first folder agent, however the default is spelled", () => {
  const agents = [
    { id: "terminal", installed: true },
    { id: "Terminal", installed: true },
    { id: "claude", installed: true },
  ];
  for (const spelled of ["terminal", "Terminal", " terminal ", " Terminal "]) expect(firstFolderAgent(agents, spelled)).toBeNull();
  expect(firstFolderAgent(agents, "   ")).toBeNull();
  expect(firstFolderAgent(agents, "claude")?.id).toBe("claude");
});

test("ONB-009: clicks on Onboarding less than half a second apart count as one", () => {
  const click = oneClick();
  expect([click(1000), click(1300), click(1700), click(2300), click(2799), click(3300)]).toEqual([true, false, false, true, false, true]);
});

test("ONB-011: a milestone goes to onboarding.rs by name, and a failed write shows nothing", async () => {
  const sent: unknown[] = [];
  await expect(milestone("aiConnected", async (cmd, args) => void sent.push([cmd, args]))).resolves.toBe(true);
  expect(sent).toEqual([["onboarding_milestone", { name: "aiConnected" }]]);
  // FIX-3: the answer says whether the write landed (no throw, nothing shown), so a caller can retry.
  await expect(milestone("aiConnected", () => Promise.reject(new Error("disk full")))).resolves.toBe(false);
});

test("ACCT-035: a failed connect names the agent it was for, in plain words", () => {
  expect(connectFailed("Grok", new Error("the sign-in window was closed"))).toBe("Grok could not connect: the sign-in window was closed");
  expect(connectFailed("Codex", "Error: timed out")).toBe("Codex could not connect: timed out");
  expect(connectFailed("Claude", undefined)).toBe("Claude could not connect. Try again in a moment.");
  expect(connectFailed("Grok", "")).toMatch(/^Grok /);
  expect(jargon(connectFailed("Grok", "x") + STATUSES_FAILED)).toEqual([]);
  expect(STATUSES_FAILED.length).toBeGreaterThan(0);
});

test("ACCT-035 (FIX-2 R3): the statuses-failed text names only the re-read on coming back, never a retry timer or a Check again button the alert lacks", () => {
  // The cards re-read on window focus and an agents event; Check again shows only for some states.
  expect(STATUSES_FAILED).not.toMatch(/on its own|few seconds|automatic/i);
  expect(STATUSES_FAILED).toMatch(/come back to this window/i);
  expect(STATUSES_FAILED).not.toMatch(/Check again/i);
  expect(jargon(STATUSES_FAILED)).toEqual([]);
});

test("ACCT-035 (FIX-2 R3): a good read clears only the read-failure line and keeps a connect failure", () => {
  expect(clearReadFailure(STATUSES_FAILED)).toBeNull();
  expect(clearReadFailure(null)).toBeNull();
  const connect = connectFailed("Codex", "network down");
  expect(clearReadFailure(connect)).toBe(connect);
  // The cards pass it to their error setter as an updater: a failed read, then a good one, leaves nothing.
  let error: string | null = null;
  const setError = (v: string | null | ((e: string | null) => string | null)) => void (error = typeof v === "function" ? v(error) : v);
  setError(STATUSES_FAILED);
  setError(clearReadFailure);
  expect(error).toBeNull();
  setError(connect);
  setError(clearReadFailure);
  expect(error).toBe(connect);
});

test("VIEW-114 (FIX-2 FB1): a stored wizard close hides the wizard, then tells the sidebar its record changed; a failed close tells it nothing", async () => {
  const seen: string[] = [];
  let ok = false;
  const store = () => (ok ? Promise.resolve() : Promise.reject(new Error("disk full")));
  const c = wizardCloser(store, () => seen.push("hidden"), (err) => seen.push(String(err)), () => seen.push(CHECKLIST_CHANGED));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  c.end("dismissed");
  await flush();
  expect(seen).toEqual(["Error: disk full"]);
  ok = true;
  expect(c.retry()).toBe(true);
  await flush();
  expect(seen).toEqual(["Error: disk full", "hidden", CHECKLIST_CHANGED]);
});

test("VIEW-114 (FIX-2 FB1): a stored reopen shows screen one, then tells the sidebar; a failed reopen only reports", async () => {
  const seen: string[] = [];
  await reopenWizard(() => Promise.reject(new Error("locked")), () => seen.push("shown"), (err) => seen.push(String(err)), () => seen.push(CHECKLIST_CHANGED));
  expect(seen).toEqual(["Error: locked"]);
  await reopenWizard(() => Promise.resolve(), () => seen.push("shown"), (err) => seen.push(String(err)), () => seen.push(CHECKLIST_CHANGED));
  expect(seen).toEqual(["Error: locked", "shown", CHECKLIST_CHANGED]);
});

// FIX-4: the useWizard wiring (close, reopen, added project) is tested through the real hook in useWizard.test.ts.

test("ACCT-035: the first connected report sends the first-AI milestone once; not-connected reports send nothing", () => {
  const sent: string[] = [];
  const report = firstConnection(async (n) => (sent.push(n), true));
  report(false);
  report(false);
  expect(sent).toEqual([]);
  report(true);
  report(false);
  report(true);
  expect(sent).toEqual(["aiConnected"]);
  expect(typeof firstAiConnected).toBe("function");
});

test("ACCT-035 (FIX-3): a first-AI write that fails is sent again on the next connected report (in the app: the next page visit or connection change); one that lands is never sent again", async () => {
  const tries: boolean[] = [];
  let works = false;
  const report = firstConnection(async () => (tries.push(works), works));
  report(true);
  await Promise.resolve();
  await Promise.resolve();
  report(true);
  await Promise.resolve();
  expect(tries).toEqual([false, false]);
  works = true;
  report(false);
  await Promise.resolve();
  report(true);
  await Promise.resolve();
  await Promise.resolve();
  report(true);
  report(true);
  await Promise.resolve();
  expect(tries).toEqual([false, false, true]);
});

test("ACCT-035 (FIX-3): a failed read never replaces a connect failure the user has not seen out; it fills an empty line or its own", () => {
  const connect = connectFailed("Codex", new Error("the sign-in window was closed"));
  expect(readFailed(connect)).toBe(connect);
  expect(readFailed(null)).toBe(STATUSES_FAILED);
  expect(readFailed(STATUSES_FAILED)).toBe(STATUSES_FAILED);
  expect(readFailed("")).toBe(STATUSES_FAILED);
  // The full round: connect fails, the settle read fails too, then a good read clears only the read line.
  let e: string | null = null;
  const setError = (f: string | null | ((x: string | null) => string | null)) => (e = typeof f === "function" ? f(e) : f);
  setError(connect);
  setError(readFailed);
  expect(e).toBe(connect);
  setError(clearReadFailure);
  expect(e).toBe(connect);
  setError(null);
  setError(readFailed);
  setError(clearReadFailure);
  expect(e).toBeNull();
});

// Install trial (after-list, fix-ui): a focused terminal behind the wizard swallowed Escape in the bubble phase.
test("ONB-006: Escape from outside the wizard (a terminal behind it) still asks to leave, in the capture phase", () => {
  const added: { f: (e: never) => void; capture: boolean }[] = [];
  const win = { addEventListener: (_t: "keydown", f: (e: never) => void, capture: boolean) => void added.push({ f, capture }), removeEventListener: (_t: "keydown", f: (e: never) => void) => void added.splice(added.findIndex((a) => a.f === f), 1) };
  let held = false;
  let left = 0;
  const outsideEl = {} as EventTarget;
  const insideEl = {} as EventTarget;
  const off = escapeLeaves(win, (t) => t === insideEl, () => held, () => left++);
  expect(added).toHaveLength(1);
  expect(added[0].capture).toBe(true);
  const press = (over: Record<string, unknown> = {}) => {
    const e = { key: "Escape", isComposing: false, defaultPrevented: false, target: outsideEl, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...over };
    added[0].f(e as never);
    return e;
  };
  const e = press();
  expect(left).toBe(1);
  expect(e.prevented && e.stopped).toBe(true);
  // Inside the dialog its own controls come first; mid-composition and other keys pass.
  expect(press({ target: insideEl }).stopped).toBe(false);
  expect(press({ isComposing: true }).stopped).toBe(false);
  expect(press({ key: "Enter" }).stopped).toBe(false);
  // While the "Skip setup?" question is up, Escape is that question's (No, keep going).
  held = true;
  expect(press().stopped).toBe(false);
  expect(left).toBe(1);
  off();
  expect(added).toHaveLength(0);
});

test("ONB-006: the wizard's close button has an accessible name, and the dialog can take focus", () => {
  const html = view(0, { onClose() {} });
  expect(html).toMatch(/<button[^>]*title="Close"[^>]*aria-label="Close setup"/);
  expect(html).toMatch(/role="dialog"[^>]*tabindex="-1"/i);
});

// T-796 (p4a-04): step 3 holds Continue back until a folder exists, or says Skip; step 4 lets the user pick what starts.
const claude = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:/bin/claude" };
const codex = { id: "codex", name: "Codex", program: "codex", args: [], installed: true, path: "C:/bin/codex" };
const shell = { id: "terminal", name: "Terminal", program: "powershell", args: [], installed: true, path: "C:/bin/powershell" };

test("T-796: with no folder the Your work screen greys Continue, says why and offers Skip for now; with one it does neither", () => {
  const none = view(2, { hasFolder: false });
  expect(none).toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
  expect(none).toContain('class="onb-gap onb-why"');
  expect(none).toContain("Pick a folder to continue");
  expect(none).toMatch(/<button class="btn onb-secondary"[^>]*>Skip for now<\/button>/);
  const some = view(2, { hasFolder: true });
  expect(some).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
  expect(some).not.toContain("Skip for now");
  expect(some).not.toContain("onb-why");
});

test("T-796: the last screen lists the installed agents and a plain terminal, marks the pick, and the button names it", () => {
  const choices = sessionChoices([codex, claude, shell], { defaultAgent: "codex" });
  const html = view(3, { hasFolder: true, choices, choice: "codex" });
  expect(html).toContain('role="radiogroup"');
  expect(html.match(/type="radio"/g)).toHaveLength(3);
  expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/?><span>Codex<\/span>/);
  expect(html).toContain("Plain terminal");
  expect(html).toMatch(/>Open a session<span/);
  expect(view(3, { hasFolder: true, choices, choice: "terminal" })).toMatch(/>Open a terminal<span/);
  expect(view(3, { hasFolder: false, choices, choice: "claude" })).toMatch(/>Pick a folder<span/);
});

test("T-796: the choices are the installed, switched-on AI agents with the default first, then one plain terminal", () => {
  expect(sessionChoices([claude, codex, shell], {}).map((c) => c.id)).toEqual(["claude", "codex", "terminal"]);
  expect(sessionChoices([claude, codex, shell], { defaultAgent: "codex" }).map((c) => c.id)).toEqual(["codex", "claude", "terminal"]);
  expect(sessionChoices([claude, codex], { disabledAgents: ["claude"] }).map((c) => c.id)).toEqual(["codex", "terminal"]);
  expect(sessionChoices([{ ...claude, installed: false }, shell], {}).map((c) => c.id)).toEqual(["terminal"]);
  expect(sessionChoices([], {}).map((c) => c.id)).toEqual(["terminal"]);
});
