import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { STATUSES_FAILED } from "../onboarding/firstRun";
import { GrokCardView, GrokKeyDialog, grokDisconnect, grokHeadline, grokState, type GrokView } from "./GrokCard";
import Ask from "../chrome/Ask";
import { CodexCardView, codexDisconnect, codexState, type CodexView } from "./CodexCard";
import { ClaudeCardView, claudeDisconnect } from "./SettingsPage";
import type { KeyStatus } from "./claudeKey";
import { PENDING_MS, settleWithin } from "./pending";

const off: GrokView = { connection: "none", keySaved: false, signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null };
const html = (view: GrokView, pending: "connect" | null = null) => renderToString(createElement(GrokCardView, { view, pending, onAction: () => {} }));
const refused = { reason: "sign-in-refused" as const, message: "Grok's sign-in ended without signing in: expired", resetsAt: null };

test("signed out, Grok offers Connect and two other ways, the key one marked advanced and pay-per-use", () => {
  const h = html(off);
  expect(h).toContain("Not connected");
  expect(h).toContain(">Connect<");
  expect(h).toContain("Other ways to connect");
  expect(h).toContain("Sign in with a code");
  expect(h).toContain("Use an xAI API key (advanced, pay-per-use)");
  expect(h).not.toContain(">Cancel<");
});

test("a CLI sign-in wins over a saved key, and an existing sign-in is connected with nothing to do", () => {
  expect(grokHeadline({ ...off, connection: "cli" })).toBe("Connected · Grok sign-in");
  expect(grokHeadline({ ...off, connection: "key" })).toContain("pay-per-use");
  const h = html({ ...off, connection: "cli" });
  expect(h).toContain("Connected");
  for (const b of [">Connect<", ">Cancel<", "Other ways to connect"]) expect(h).not.toContain(b);
});

test("connecting shows exactly one state with Cancel, and the device code only once both parts are known", () => {
  const browser = { ...off, signingIn: "browser" as const, inBrowser: true };
  expect(grokState(browser)).toBe("connecting");
  expect(html(browser)).toContain("xAI page that opened");
  expect(html(browser)).toContain(">Cancel<");
  expect(html(browser)).not.toContain(">Connect<");
  const waiting = { ...off, signingIn: "device" as const, deviceLink: "https://accounts.x.ai/oauth2/device?user_code=8EMT-BJ57" };
  expect(html(waiting)).not.toContain("accounts.x.ai");
  const both = { ...waiting, deviceCode: "8EMT-BJ57" };
  expect(html(both)).toContain("8EMT-BJ57");
  expect(html(both)).toContain(">Cancel<");
});

test("a failed sign-in needs attention with its one fix and a Cancel that wipes it", () => {
  const v = { ...off, attention: refused };
  expect(grokState(v)).toBe("attention");
  const h = html(v);
  expect(h).toContain("Needs attention");
  expect(h).toContain("Try again");
  expect(h).toContain(">Cancel<");
  expect(h).not.toContain(">Connect<");
});

test("each connect choice is greyed out while its request is pending", () => {
  const h = html(off, "connect");
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Connect</);
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Sign in with a code</);
});

test("a pending request lets go after 30 seconds if no answer arrives", async () => {
  vi.useFakeTimers();
  let done = false;
  void settleWithin(new Promise(() => {})).then(() => (done = true));
  await vi.advanceTimersByTimeAsync(PENDING_MS - 1);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
  vi.useRealTimers();
  // an answer (even a refusal) releases it at once
  await settleWithin(Promise.reject(new Error("no")));
});

test("the key dialog's Connect is disabled until something is typed, and the field starts blank", () => {
  const h = renderToString(createElement(GrokKeyDialog, { open: true, onSubmit: () => {}, onClose: () => {} }));
  expect(h).toContain('type="password"');
  expect(h).toContain("Advanced. xAI bills an API key per use");
  expect(h).toMatch(/<button type="submit"[^>]*disabled=""/);
  expect(h).toContain('value=""');
});

test("Codex says needs attention after a failed sign-in, with a Cancel that wipes it", () => {
  const cx: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: refused, drifted: [], missing: [], settingsWarning: null };
  expect(codexState(cx)).toBe("attention");
  const h = renderToString(createElement(CodexCardView, { view: cx, onAction: () => {} }));
  expect(h).toContain("Needs attention");
  expect(h).toContain(">Cancel<");
  expect(codexState({ ...cx, attention: null })).toBe("disconnected");
});

test("seven ways to connect exist across the three cards (ACCT-002 compat)", () => {
  const claudeOff: KeyStatus = { connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };
  const claude = renderToString(createElement(ClaudeCardView, { status: claudeOff, busy: false, onAction: () => {}, onUseAccount: () => {} }));
  const codex = renderToString(createElement(CodexCardView, { view: { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null }, onAction: () => {} }));
  const grok = html(off);
  const ways = [
    [claude, ">Connect<"], // Claude by 1-year key (the default)
    [claude, "Use my Claude account instead"],
    [codex, ">Connect<"], // Codex by ChatGPT sign-in (the default)
    [codex, "Sign in with a code"],
    [grok, ">Connect<"], // Grok by its CLI login (the default)
    [grok, "Sign in with a code"],
    [grok, "Use an xAI API key"],
  ];
  for (const [card, way] of ways) expect(card).toContain(way);
  for (const card of [claude, codex, grok]) expect(card).toContain("Other ways to connect");
});

test("a connected Codex or Grok card shows Manage and Disconnect, and Disconnect erases only what Kolux made (ACCT-015)", () => {
  const kim = { id: "c1", email: "kim@example.com", home: "h1", lastSignIn: 1, signInError: false };
  const cxOff: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
  const codex = (v: CodexView) => renderToString(createElement(CodexCardView, { view: v, onAction: () => {} }));
  const managed = { ...cxOff, accounts: [kim], active: "c1" };
  for (const b of [">Manage<", ">Disconnect<", "Add account", "Sign in with a code"]) expect(codex(managed)).toContain(b);
  expect(codex(cxOff)).not.toContain(">Disconnect<");
  expect(codexDisconnect(managed)).toMatchObject({ title: "Disconnect kim@example.com?", confirm: "Disconnect" });
  // C25-R5-01: Disconnect deletes the sign-in only; the account's Codex home stays.
  const ask = codexDisconnect(managed);
  expect(ask.body).toContain("deletes the sign-in it saved for it");
  expect(ask.body).toContain("Codex home, with its settings and sessions, stays");
  expect(ask.body).not.toContain("deletes the Codex home");
  const own = codexDisconnect({ ...cxOff, systemDefault: "chatgpt" });
  expect(own.confirm).toBeNull();
  expect(own.body).toContain("deletes nothing");
  expect(own.body).toContain("codex logout");

  for (const b of [">Manage<", ">Disconnect<", "Sign in again"]) expect(html({ ...off, connection: "cli" })).toContain(b);
  expect(html(off)).not.toContain(">Disconnect<");
  expect(html({ ...off, connection: "key", keySaved: true })).toContain("Replace the xAI API key");
  const cliOnly = grokDisconnect({ ...off, connection: "cli" });
  expect(cliOnly.confirm).toBeNull();
  expect(cliOnly.body).toContain("grok logout");
  const both = grokDisconnect({ ...off, connection: "cli", keySaved: true });
  expect(both.confirm).toBe("Disconnect");
  expect(both.body).toContain("Grok sign-in stays");
  expect(grokDisconnect({ ...off, connection: "key", keySaved: true }).confirm).toBe("Disconnect");
  expect(claudeDisconnect.body).toContain("1-year key");
});

test("the Disconnect question asks with Cancel, or only explains with a single OK", () => {
  const ask = (confirm: string | null) => renderToString(createElement(Ask, { title: "t", body: "b", confirm, onConfirm: () => {}, onCancel: () => {} }));
  expect(ask("Disconnect")).toContain(">Cancel<");
  expect(ask("Disconnect")).toContain(">Disconnect<");
  expect(ask(null)).toContain(">OK<");
  expect(ask(null)).not.toContain(">Cancel<");
});

test("ACCT-035 (FIX-3): when the first read fails the Grok card still shows, named, with the read-failure line; with no error it waits blank", () => {
  const h = renderToString(createElement(GrokCardView, { view: null, pending: null, error: STATUSES_FAILED, onAction: () => {} }));
  expect(h).toContain('aria-label="Grok"');
  expect(h).toContain('role="alert"');
  expect(h).toContain(STATUSES_FAILED);
  expect(renderToString(createElement(GrokCardView, { view: null, pending: null, error: null, onAction: () => {} }))).toBe("");
});
