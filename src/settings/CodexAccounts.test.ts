import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { CodexView } from "./CodexCard";
import { CodexAccountsView, codexTrouble } from "./CodexAccounts";

// The question is the shared Ask, drawn only on a real DOM; its words are read here through a stand-in.
vi.mock("../chrome/Ask", async (real) => ({ ...(await real<object>()), default: (await import("../tasks/askStandIn")).AskStandIn }));

const off: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const kim = { id: "c1", email: "kim@example.com", home: "h1", lastSignIn: 1, signInError: false };
const html = (view: CodexView) => renderToString(createElement(CodexAccountsView, { view, onAction: () => {} }));

test("an account with a sign-in error or a changed settings file is marked and offers Sign in again (SET-030)", () => {
  const view = { ...off, accounts: [kim, { ...kim, id: "c2", email: "lee@example.com" }], active: "c1", drifted: ["c2"] };
  expect(codexTrouble(view, kim)).toBeNull();
  expect(codexTrouble(view, view.accounts[1])).toBe("Settings changed");
  expect(codexTrouble({ ...view, drifted: [] }, { ...kim, signInError: true })).toBe("Needs re-auth");
  const out = html(view);
  expect(out).toContain("Settings changed");
  expect(out).toContain("Sign in again puts Kolux");
  expect(html({ ...view, drifted: [] })).not.toContain("Sign in again");
});

const asking = (view: CodexView, confirming: string | null) => renderToString(createElement(CodexAccountsView, { view, confirming, onAction: () => {} }));
const sys = (v: CodexView) => renderToString(createElement(CodexAccountsView, { view: v, onAction: () => {} }));

test("ACCT-020: the System default row says how Codex's own login is signed in", () => {
  expect(sys({ ...off, systemDefault: "chatgpt" })).toContain("Signed in with ChatGPT");
  expect(sys({ ...off, systemDefault: "api-key" })).toContain("Running on an API key");
  expect(sys({ ...off, systemDefault: "custom-provider" })).toContain("API key with a custom provider");
  expect(sys({ ...off, systemDefault: "custom-provider" })).not.toContain("Signed in with ChatGPT");
  expect(sys(off)).toContain("Signed out");
});

test("ACCT-019: the System default row is first and Active with no managed account chosen", () => {
  const h = sys({ ...off, accounts: [kim], systemDefault: "chatgpt" });
  expect(h.indexOf("System default")).toBeLessThan(h.indexOf("kim@example.com"));
  expect(h.match(/>Active</g)?.length).toBe(1);
});

test("ACCT-019: rows warn needs sign-in when the file is missing, needs re-auth on a sign-in error, and offer Remove", () => {
  const lee = { ...kim, id: "c2", email: "lee@example.com", signInError: true };
  const view = { ...off, accounts: [kim, lee], active: "c1", missing: ["c1"] };
  expect(codexTrouble(view, kim)).toBe("Needs sign-in");
  expect(codexTrouble(view, lee)).toBe("Needs re-auth");
  const h = sys(view);
  expect(h.match(/>Remove</g)?.length).toBe(2);
  expect(h).toContain("Last signed in");
});

test("ACCT-019: Remove asks first; removing the active one hands back to the system default", () => {
  const view = { ...off, accounts: [kim], active: "c1" };
  const h = asking(view, "c1");
  expect(h).toContain("Remove kim@example.com?");
  expect(h).toContain("takes over");
  expect(h).toContain("Keep");
});

test("T-138-b ACCT-019: two accounts on one email ask to be named, and a name labels the row", () => {
  const work = { ...kim, id: "c2" };
  const both = { ...off, accounts: [kim, work], active: "c1" };
  const h = sys(both);
  expect(h.match(/Same email as another account/g)?.length).toBe(2);
  expect(h.match(/>Name</g)?.length).toBe(2);
  const named = sys({ ...both, accounts: [{ ...kim, label: "Personal" }, { ...work, label: "Work" }] });
  expect(named).toContain("Personal · kim@example.com");
  expect(named).toContain("Work · kim@example.com");
  expect(named).not.toContain("Same email as another account");
  expect(named.match(/>Rename</g)?.length).toBe(2);
  expect(sys({ ...off, accounts: [kim] })).not.toContain("Same email");
});

test("T-138-b: naming a row shows its name field in place", () => {
  const h = renderToString(createElement(CodexAccountsView, { view: { ...off, accounts: [kim] }, naming: "c1", onAction: () => {} }));
  expect(h).toContain('aria-label="Name for kim@example.com"');
  expect(h).toContain('maxLength="40"');
});

// ACCT-021: when the user's Codex settings cannot be copied, the section says why.
test("a settings copy problem is shown in the accounts section", () => {
  const view: CodexView = { ...off, accounts: [kim], active: "c1" };
  expect(html(view)).not.toContain("is empty");
  expect(html({ ...view, settingsWarning: "Codex's settings file is empty, so the accounts run on Codex's defaults." })).toContain("is empty");
});

test("T-138-c ACCT-001: the Codex accounts section sits beside the Claude one, with its own Add Account", () => {
  const h = html({ ...off, systemDefault: "chatgpt" });
  expect(h).toContain('aria-label="Codex accounts"');
  expect(h).toContain(">Codex accounts<");
  expect(h).toContain(">Add Account<");
  expect(html({ ...off, signingIn: "browser" })).not.toContain(">Add Account<");
});
