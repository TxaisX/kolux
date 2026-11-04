import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { STATUSES_FAILED } from "../onboarding/firstRun";
import { CodexCardView, codexHeadline, codexState, type CodexView } from "./CodexCard";

const off: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const kim = { id: "c1", email: "kim@example.com", home: "h1", lastSignIn: 1, signInError: false };
const html = (view: CodexView) => renderToString(createElement(CodexCardView, { view, onAction: () => {} }));

test("signed out, the card offers Connect and Sign in with a code", () => {
  const h = html(off);
  expect(h).toContain("Connect with your ChatGPT plan");
  expect(h).toContain("Connect");
  expect(h).toContain("Sign in with a code");
  expect(h).toContain("Not connected");
});

test("the device view waits until it has both the link and the code", () => {
  const waiting = { ...off, signingIn: "device" as const, deviceLink: "https://auth.example.com/device" };
  expect(html(waiting)).not.toContain("auth.example.com");
  expect(codexHeadline(waiting)).toMatch(/Asking/);
  const both = { ...waiting, deviceCode: "ABCD-12345" };
  const h = html(both);
  expect(h).toContain("ABCD-12345");
  expect(h).toContain("https://auth.example.com/device");
  expect(h).toContain("Cancel");
  expect(h).not.toContain("Sign in with a code");
});

test("Codex's own login is reported truthfully when Kolux has no account", () => {
  expect(codexHeadline({ ...off, systemDefault: "chatgpt" })).toContain("a ChatGPT sign-in");
  expect(codexHeadline({ ...off, systemDefault: "custom-provider" })).toContain("an API key with a custom provider");
  expect(codexHeadline({ ...off, systemDefault: "api-key" })).toContain("an API key");
});

test("a connected account shows its email, and Connect becomes Add account", () => {
  const h = html({ ...off, accounts: [kim], active: "c1" });
  expect(h).toContain("Connected · kim@example.com");
  expect(h).toContain("Add account");
});

test("T-138-c ACCT-001: the card lists no accounts; they live under Manage accounts (advanced)", () => {
  const h = html({ ...off, accounts: [kim], active: "c1", systemDefault: "chatgpt" });
  expect(h).not.toContain("System default");
  expect(h).not.toContain(">Remove<");
  expect(h).not.toContain("Last signed in");
});

test("T-138-b: the headline names the active account by its name too", () => {
  expect(codexHeadline({ ...off, accounts: [{ ...kim, label: "Work" }], active: "c1" })).toBe("Connected · Work · kim@example.com");
});

test("ACCT-035 (FIX-3): when the first read fails the card still shows, named, with the read-failure line; with no error it waits blank", () => {
  const h = renderToString(createElement(CodexCardView, { view: null, error: STATUSES_FAILED, onAction: () => {} }));
  expect(h).toContain('aria-label="Codex"');
  expect(h).toContain('role="alert"');
  expect(h).toContain(STATUSES_FAILED);
  expect(h).not.toContain("Connect with your ChatGPT plan");
  expect(renderToString(createElement(CodexCardView, { view: null, error: null, onAction: () => {} }))).toBe("");
});

test("ACCT-019: an active account whose sign-in file is gone is not Connected", () => {
  const gone: CodexView = { ...off, accounts: [kim], active: "c1", missing: ["c1"] };
  expect(codexState(gone)).toBe("needs-signin");
  expect(codexHeadline(gone)).toBe("Sign in again · kim@example.com");
  const h = html(gone);
  expect(h).not.toContain("Connected");
  expect(h).toContain("Needs sign-in");
  expect(h).toContain("Sign in again");
  expect(h).toContain("Disconnect"); // a dead account stays removable
});

test("ACCT-019/SET-030: an account Codex rejected shows needs re-auth, not Connected", () => {
  const bad: CodexView = { ...off, accounts: [{ ...kim, signInError: true }], active: "c1" };
  expect(codexState(bad)).toBe("needs-signin");
  expect(codexHeadline(bad)).not.toContain("Connected");
  const h = html(bad);
  expect(h).toContain("Needs re-auth");
  expect(h).not.toContain("Connected");
  expect(h).toContain("Sign in again");
  expect(h).toContain("Disconnect");
});

test("ACCT-019: a listed account that is not the active one keeps the card Connected", () => {
  const other: CodexView = { ...off, accounts: [kim, { ...kim, id: "c2", email: "sam@example.com" }], active: "c1", missing: ["c2"] };
  expect(codexState(other)).toBe("connected");
  expect(html(other)).toContain("Connected · kim@example.com");
});
