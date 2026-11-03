import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { AccountsReadError } from "./AccountRow";
import { ClaudeAccountsView, type AccountsView } from "./ClaudeAccounts";
import { ClaudeCardView } from "./SettingsPage";
import type { KeyStatus } from "./claudeKey";

const empty: AccountsView = { accounts: [], active: null, signingIn: null, inBrowser: false, attention: null, keyMode: false, upkeepLeftToClaude: true };
const sam = { id: "a1", email: "sam@example.com", organization: "Example Org", configDir: "C:\p\claude-accounts\a1", lastSignIn: 1, stale: false };
const kim = { id: "a2", email: "kim@example.com", organization: null, configDir: "C:\p\claude-accounts\a2", lastSignIn: 2, stale: false };
const html = (view: AccountsView) => renderToString(createElement(ClaudeAccountsView, { view, onAction: () => {} }));

test("with no accounts the section offers Add Account", () => {
  const h = html(empty);
  expect(h).toContain("Add Account");
  expect(h).toContain("No managed accounts");
});

test("a running sign-in asks to finish in the browser, with Cancel, and hides Add Account", () => {
  const h = html({ ...empty, signingIn: "x", inBrowser: true });
  expect(h).toContain("Finish signing in in the browser.");
  expect(h).toContain("Cancel");
  expect(h).not.toContain("Add Account");
});

test("rows show email and organisation; every row but the active one can be picked", () => {
  const h = html({ ...empty, accounts: [sam, kim], active: "a1" });
  expect(h).toContain("sam@example.com");
  expect(h).toContain("Example Org");
  expect(h).toContain("No organisation");
  expect(h.match(/aria-pressed="false"/g)?.length).toBe(2); // ACCT-016: the row itself is the pick control (System default and kim)
  expect(h).toContain("Active");
});

test("with the 1-year key connected the section says the key wins for new panes", () => {
  expect(html({ ...empty, accounts: [sam], active: "a1", keyMode: true })).toContain("new Claude panes use the key");
  expect(html({ ...empty, accounts: [sam], active: "a1" })).not.toContain("new Claude panes use the key");
});

test("the Claude card offers the account route only while the key is not connected", () => {
  const off: KeyStatus = { connected: false, createdAt: null, expiresAt: null, daysLeft: null, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };
  const card = (s: KeyStatus) => renderToString(createElement(ClaudeCardView, { status: s, busy: false, onAction: () => {}, onUseAccount: () => {} }));
  expect(card(off)).toContain("Use my Claude account instead");
  expect(card({ ...off, connected: true, createdAt: 1, expiresAt: 2, daysLeft: 300 })).not.toContain("Use my Claude account instead");
});

const htmlAsking = (view: AccountsView, confirming: string | null) => renderToString(createElement(ClaudeAccountsView, { view, confirming, onAction: () => {} }));

test("ACCT-016: the System default row comes first and is Active when no managed account is chosen", () => {
  const h = html({ ...empty, accounts: [sam] });
  expect(h.indexOf("System default")).toBeGreaterThan(-1);
  expect(h.indexOf("System default")).toBeLessThan(h.indexOf("sam@example.com"));
  expect(h.match(/>Active</g)?.length).toBe(1);
  expect(html({ ...empty, accounts: [sam], active: "a1" }).match(/>Active</g)?.length).toBe(1);
});

test("ACCT-016: with no managed accounts the section says Kolux uses the system-default login", () => {
  expect(html(empty)).toContain("Kolux is using the system-default login");
  expect(html({ ...empty, accounts: [sam] })).not.toContain("Kolux is using the system-default login");
});

test("ACCT-016: managed rows show last sign-in, Re-authenticate, Remove and a Needs re-auth warning when stale", () => {
  // The warning shows while Kolux, not Claude Code, looks after sign-ins (ACCT-006, T-043-d).
  const h = html({ ...empty, accounts: [sam, { ...kim, stale: true }], active: "a1", upkeepLeftToClaude: false });
  expect(h).toContain("Last signed in");
  expect(h.match(/Re-authenticate/g)?.length).toBe(2);
  expect(h.match(/>Remove</g)?.length).toBe(2);
  expect(h.match(/Needs re-auth/g)?.length).toBe(1);
});

test("ACCT-016: Remove asks first, and says the system default takes over when the active one goes", () => {
  const h = htmlAsking({ ...empty, accounts: [sam, kim], active: "a1" }, "a1");
  expect(h).toContain("Remove sam@example.com?");
  expect(h).toContain("System default");
  expect(h).toContain("Keep");
  expect(htmlAsking({ ...empty, accounts: [sam, kim], active: "a1" }, "a2")).not.toContain("takes over");
});

test("the upkeep switch is on by default and reflects the setting (ACCT-006, T-043-d)", () => {
  const h = html({ ...empty, accounts: [sam], active: "a1" });
  expect(h).toContain('role="switch"');
  expect(h).toContain('checked=""');
  expect(h).toContain("Claude Code keeps these sign-ins fresh");
  const off = html({ ...empty, accounts: [sam], active: "a1", upkeepLeftToClaude: false });
  expect(off).toContain('role="switch"');
  expect(off).not.toContain('checked=""');
  expect(off).toContain("Kolux asks Claude Code");
  // Nothing to switch while no account is managed.
  expect(html(empty)).not.toContain('role="switch"');
});

test("a lapsed account is flagged only while Kolux, not Claude Code, looks after sign-ins", () => {
  const stale = { ...sam, stale: true };
  expect(html({ ...empty, accounts: [stale], active: "a1" })).not.toContain("Needs re-auth");
  expect(html({ ...empty, accounts: [stale], active: "a1", upkeepLeftToClaude: false })).toContain("Needs re-auth");
});

test("UX-audit: a first read that fails shows the reason and a Retry, not an empty gap", () => {
  const h = renderToString(createElement(AccountsReadError, { name: "Claude", error: "spawn failed", onRetry: () => {} }));
  expect(h).toContain("The list could not be read");
  expect(h).toContain("spawn failed");
  expect(h).toContain(">Retry<");
  expect(h).toContain('aria-label="Claude accounts"');
});
