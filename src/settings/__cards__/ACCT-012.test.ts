// ACCT-012 acceptance: the lapsed sign-in notice in the main window. Runs the real SignInNotice component
// body (its effects, its reads of claude_accounts, its re-read on the claude-accounts and settings-saved
// events) with a stand-in for React's hooks and a fake account list; no sign-in file or real account is read.
// The Rust half (the stale flag a Claude status check sets, and the upkeep switch the window reads) is
// src-tauri/tests/cards_07.rs acct012_box1 and acct012_box2.
import { beforeEach, expect, test, vi } from "vitest";

const slots: unknown[] = [];
const ran = new Set<number>();
let si = 0;
const pending: (() => void)[] = [];
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: (init: unknown) => {
    const i = si++;
    if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    return [slots[i], (v: unknown) => (slots[i] = typeof v === "function" ? (v as (o: unknown) => unknown)(slots[i]) : v)];
  },
  useEffect: (f: () => void) => {
    const i = si++;
    if (ran.has(i)) return;
    ran.add(i);
    pending.push(f);
  },
}));
const listeners: Record<string, () => void> = {};
const sent: { cmd: string; args?: Record<string, unknown> }[] = [];
let claudeView: unknown;
let codexView: unknown;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    sent.push({ cmd, args });
    return Promise.resolve(cmd === "claude_accounts" ? claudeView : cmd === "codex_accounts" ? codexView : null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, f: () => void) => ((listeners[name] = f), Promise.resolve(() => {})) }));
vi.mock("../codexSignInScan", () => ({ startCodexSignInScan: () => () => {} }));
const { default: SignInNotice, SignInNoticeView } = await import("../SignInNotice");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");

type El = { props: { lapsed: { agent: string; id: string; label: string; busy: boolean } | null; onSignIn: (l: never) => void } };
const account = (id: string, email: string, stale: boolean) => ({ id, email, organization: null, configDir: `G:/Temp/cards-v3/${id}`, lastSignIn: 1, stale });
const claudeOf = (accounts: ReturnType<typeof account>[], active: string | null, upkeepLeftToClaude = false) => ({ accounts, active, signingIn: null, inBrowser: false, attention: null, keyMode: false, upkeepLeftToClaude });
const codexEmpty = { accounts: [], active: null, systemDefault: "chatgpt", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const tick = () => new Promise((r) => setTimeout(r, 10));
const draw = async (): Promise<El> => {
  si = 0;
  SignInNotice();
  pending.splice(0).forEach((f) => f());
  await tick();
  si = 0;
  return SignInNotice() as unknown as El;
};
const redraw = async (): Promise<El> => {
  await tick();
  si = 0;
  return SignInNotice() as unknown as El;
};
const words = (el: El) => renderToStaticMarkup(createElement(SignInNoticeView, el.props as never));

beforeEach(() => {
  slots.length = 0;
  ran.clear();
  sent.length = 0;
  codexView = codexEmpty;
});

test("box 1: the active managed account gone stale brings a notice with its label; Sign in again starts re-authentication of that account", async () => {
  claudeView = claudeOf([account("a1", "sam@example.com", false), account("a2", "kim@example.com", true)], "a2");
  const el = await draw();
  expect(el.props.lapsed).toEqual({ agent: "claude", id: "a2", label: "Claude account kim@example.com", busy: false });
  const h = words(el);
  expect(h).toContain("Claude account kim@example.com is no longer signed in.");
  expect(h).toContain(">Sign in again<");
  el.props.onSignIn(el.props.lapsed as never);
  expect(sent.filter((s) => s.cmd === "claude_account_sign_in")).toEqual([{ cmd: "claude_account_sign_in", args: { id: "a2" } }]);
});

test("box 2: turning on the setting that lets Claude Code handle its own sign-in takes the notice away", async () => {
  claudeView = claudeOf([account("a1", "sam@example.com", true)], "a1", false);
  expect((await draw()).props.lapsed).not.toBeNull();
  // The settings page saves the switch: the back end announces settings-saved and the notice re-reads.
  claudeView = claudeOf([account("a1", "sam@example.com", true)], "a1", true);
  listeners["settings-saved"]();
  const el = await redraw();
  expect(el.props.lapsed).toBeNull();
  expect(words(el)).toBe("");
});

test("rule: nothing shows before the Claude list has loaded, so it cannot flicker at startup", async () => {
  claudeView = new Promise(() => {}); // the Claude list has not answered yet
  const el = await draw();
  expect(el.props.lapsed).toBeNull();
  expect(words(el)).toBe("");
});

test("rule: a Codex sign-in file that is gone raises the notice too", async () => {
  claudeView = claudeOf([], null);
  codexView = { ...codexEmpty, accounts: [{ id: "c1", email: "kim@example.com", home: "<codex-home>", lastSignIn: 1, signInError: false }], active: "c1", missing: ["c1"] };
  const el = await draw();
  expect(el.props.lapsed).toEqual({ agent: "codex", id: "c1", label: "Codex account kim@example.com", busy: false });
});

test("rule: Codex's system-default login never raises it, even signed out or on an API key", async () => {
  claudeView = claudeOf([], null);
  for (const systemDefault of ["signed-out", "api-key", "chatgpt"]) {
    slots.length = 0;
    ran.clear();
    codexView = { ...codexEmpty, systemDefault };
    expect((await draw()).props.lapsed).toBeNull();
  }
});
