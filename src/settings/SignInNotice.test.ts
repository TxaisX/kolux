import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { lapsed, SignInNoticeView } from "./SignInNotice";
import type { AccountsView } from "./ClaudeAccounts";
import type { CodexView } from "./CodexCard";
import { attentionText, fixFor, type Attention, type Reason } from "./Attention";

const sam = { id: "a1", email: "sam@example.com", organization: null, configDir: "d", lastSignIn: 1, stale: true };
const claude: AccountsView = { accounts: [sam], active: "a1", signingIn: null, inBrowser: false, attention: null, keyMode: false, upkeepLeftToClaude: false };
const codex: CodexView = { accounts: [], active: null, systemDefault: "chatgpt", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };

test("a stale active Claude account is flagged with its label and Sign in again", () => {
  const l = lapsed(claude, codex);
  expect(l).toEqual({ agent: "claude", id: "a1", label: "Claude account sam@example.com", busy: false });
  const html = renderToString(createElement(SignInNoticeView, { lapsed: l, onSignIn: () => {} }));
  expect(html).toContain("sam@example.com");
  expect(html).toContain("Sign in again");
});

test("the notice stays away while Claude Code handles its own sign-in, the key is connected, or the account is not active", () => {
  expect(lapsed({ ...claude, upkeepLeftToClaude: true }, codex)).toBeNull();
  expect(lapsed({ ...claude, keyMode: true }, codex)).toBeNull();
  expect(lapsed({ ...claude, active: null }, codex)).toBeNull();
  expect(lapsed({ ...claude, accounts: [{ ...sam, stale: false }] }, codex)).toBeNull();
});

test("hidden until both lists have loaded, so it never flickers at startup", () => {
  expect(lapsed(null, codex)).toBeNull();
  expect(lapsed(claude, null)).toBeNull();
});

test("a managed Codex account with a sign-in error is flagged; the system default never is", () => {
  const fresh = { ...claude, accounts: [{ ...sam, stale: false }] };
  expect(lapsed(fresh, { ...codex, systemDefault: "signed-out" })).toBeNull();
  const kim = { id: "c1", email: "kim@example.com", home: "h", lastSignIn: 1, signInError: true };
  expect(lapsed(fresh, { ...codex, accounts: [kim], signingIn: "browser" })).toEqual({ agent: "codex", id: "c1", label: "Codex account kim@example.com", busy: true });
});

test("every reason has its one fix, or none (ACCT-013)", () => {
  const a = (reason: Reason): Attention => ({ reason, message: "m", resetsAt: null });
  const want: Record<Reason, string | null> = {
    "browser-blocked": "Try again",
    "sign-in-refused": "Try again",
    plan: "Check again",
    "not-found": "Check again",
    smartscreen: "Open install page",
    "usage-limit": null,
    "key-expiring": "Renew",
    "key-expired": "Renew",
    "install-failed": "Try installing again",
    "install-unavailable": "Open install page",
    unknown: null,
  };
  for (const [r, f] of Object.entries(want)) expect(fixFor(a(r as Reason), "claude-key")).toBe(f);
  expect(fixFor(a("sign-in-refused"), "claude-account")).toBe("Use a 1-year key instead");
  expect(fixFor({ reason: "something-new" as Reason, message: "m", resetsAt: null }, "codex")).toBeNull();
  const now = new Date(2026, 9, 9, 12, 0).getTime();
  expect(attentionText({ reason: "usage-limit", message: "Claude's usage limit was reached.", resetsAt: new Date(2026, 9, 9, 15, 40).getTime() }, now)).toMatch(/It can be used again at .*3.*40/);
  expect(attentionText({ reason: "usage-limit", message: "x", resetsAt: new Date(2026, 9, 10, 9, 5).getTime() }, now)).toMatch(/Sat|sam|Sa/i);
});

test("UX-audit: a sign-in that could not start says so next to the button", () => {
  const l = lapsed(claude, codex);
  const html = renderToString(createElement(SignInNoticeView, { lapsed: l, onSignIn: () => {}, error: "Sign-in did not start: no browser" }));
  expect(html).toContain("Sign-in did not start: no browser");
  expect(renderToString(createElement(SignInNoticeView, { lapsed: l, onSignIn: () => {} }))).not.toContain("data-signin-error");
});
