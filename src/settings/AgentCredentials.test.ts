import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { AgentCredentialsView, keptNote, sessionsNote, type CredsView } from "./AgentCredentials";

const base: CredsView = {
  sessionsHome: "",
  sessionsFolder: "C:/Users/me/.codex",
  sessionsFolderFound: true,
  minimax: { detected: false, cookieKept: false, keyKept: false, endpoint: "overseas", groupId: "", usageModel: "general", modelNames: "" },
  geminiDetected: false,
  geminiEnabled: false,
};
const html = (view: CredsView, drafts: Record<string, string> = {}) => renderToString(createElement(AgentCredentialsView, { view, drafts, onDraft: () => {}, onAction: () => {} }));

test("ACCT-022: an empty folder field says it means the standard folder, and Reset is off until there is something to reset", () => {
  expect(sessionsNote(base)).toContain("standard Codex folder (C:/Users/me/.codex)");
  const out = html(base);
  expect(out).toContain("Codex folder for past sessions");
  expect(out).toMatch(/<button[^>]*disabled[^>]*>Reset/);
  const custom = { ...base, sessionsHome: "D:/sessions", sessionsFolder: "D:/sessions" };
  expect(sessionsNote(custom)).toBe("Past sessions are read from this folder.");
  expect(sessionsNote({ ...custom, sessionsFolderFound: false })).toContain("not there");
  expect(html(custom)).not.toMatch(/<button[^>]*disabled[^>]*>Reset/);
});

test("ACCT-028: the MiniMax section appears only where MiniMax is detected, and marks what is kept", () => {
  expect(html(base)).not.toContain("MiniMax");
  const seen = { ...base, minimax: { ...base.minimax, detected: true, keyKept: true } };
  const out = html(seen);
  expect(out).toContain("MiniMax session cookie");
  expect(out).toContain("To copy the session cookie");
  expect(out).toContain("Kept on this computer");
  expect(out).toContain("Not saved");
  expect(out).toContain("Replace");
  expect(keptNote(true)).toBe("Kept on this computer");
  expect(keptNote(false)).toBe("Not saved");
  expect(out).not.toMatch(/value="[^"]*SECRET/);
});

test("ACCT-029: the Gemini switch appears only where Gemini is detected, and is off on a fresh profile", () => {
  expect(html(base)).not.toContain("Gemini");
  const out = html({ ...base, geminiDetected: true });
  expect(out).toContain("Use Gemini CLI credentials (experimental)");
  expect(out).not.toContain("checked");
  expect(html({ ...base, geminiDetected: true, geminiEnabled: true })).toContain("checked");
});

test("UX-audit: Forget on a kept MiniMax credential asks first", () => {
  const seen = { ...base, minimax: { ...base.minimax, detected: true, keyKept: true } };
  const out = html(seen);
  expect(out).toMatch(/data-reset[^>]*aria-label="Forget MiniMax API key"[^>]*>Forget/);
  expect(out).toMatch(/<button[^>]*disabled[^>]*>Forget/); // the cookie is not kept: nothing to forget
});
