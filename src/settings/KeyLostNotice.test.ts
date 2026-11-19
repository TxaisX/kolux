// ACCT-010: the note for a key this computer could no longer open says which and where to reconnect.
import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { invoke } from "@tauri-apps/api/core";
import { KeyLostView, dismissFailure, dismissNote, lostText } from "./KeyLostNotice";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

test("the note names each cleared key and says where to reconnect it", () => {
  expect(lostText(["claudeOauthToken"])).toBe("Your Claude 1-year key could not be opened on this computer, so it was cleared. Reconnect it in Settings › Accounts & keys.");
  expect(lostText(["claudeOauthToken", "httpProxy"])).toBe("Your Claude 1-year key and proxy address could not be opened on this computer, so they were cleared. Reconnect them in Settings › Accounts & keys.");
  expect(lostText(["somethingNew"])).toContain("A stored key could not be opened");
  expect(lostText([])).toBeNull();
});

test("nothing shows when no key was cleared", () => {
  const noop = () => {};
  expect(renderToString(createElement(KeyLostView, { names: [], onOpen: noop, onDismiss: noop }))).toBe("");
  const html = renderToString(createElement(KeyLostView, { names: ["claudeOauthToken"], onOpen: noop, onDismiss: noop }));
  expect(html).toContain('role="status"');
  expect(html).toContain("Open Accounts &amp; keys");
  expect(html).toContain("Dismiss");
});

// AFTER row 658: every stored secret field has a name in the note, none falls back to "A stored key".
test("every secret field the app stores has a label in the note", async () => {
  const { SECRET_KEYS } = await import("./settingsSync");
  for (const k of SECRET_KEYS) expect(lostText([k]), k).toContain("Your ");
  expect(lostText(["moonshotApiKey", "minimaxApiKey"])).toContain("Moonshot key and MiniMax key");
});

// AFTER row 892: a refused dismiss keeps the note and says why; only a successful one lets it go.
test("a dismiss the app refuses is reported and keeps the note", async () => {
  expect(await dismissFailure(() => Promise.resolve(null))).toBeNull();
  const why = await dismissFailure(() => Promise.reject("poisoned key: not saving over it"));
  expect(why).toContain("could not be dismissed");
  expect(why).toContain("poisoned key: not saving over it");
  expect(await dismissFailure(() => Promise.reject(new Error("locked")))).toContain("locked");
  const noop = () => {};
  const html = renderToString(createElement(KeyLostView, { names: ["claudeOauthToken"], onOpen: noop, onDismiss: noop, error: why }));
  expect(html).toContain('role="alert"');
  expect(html).toContain("will show again");
  expect(renderToString(createElement(KeyLostView, { names: ["claudeOauthToken"], onOpen: noop, onDismiss: noop }))).not.toContain('role="alert"');
});

// AFTER row 912: no DOM library is installed, so the click is the handler the button calls (dismissNote) with the real
// invoke call shape, and the markup is what that outcome renders.
test("a refused dismiss keeps the names, shows the reason, and the alert is not inside the status region", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("poisoned key: not saving over it");
  const names = ["claudeOauthToken"];
  const out = await dismissNote(names, () => invoke("secrets_dropped_dismiss"));
  expect(invoke).toHaveBeenCalledWith("secrets_dropped_dismiss");
  expect(out.names).toEqual(names);
  expect(out.error).toContain("poisoned key: not saving over it");
  const noop = () => {};
  const html = renderToString(createElement(KeyLostView, { names: out.names, onOpen: noop, onDismiss: noop, error: out.error }));
  expect(html).toContain("Claude 1-year key");
  expect(html).toContain("will show again");
  const status = /<span role="status">[\s\S]*?<\/span>/.exec(html)?.[0] ?? "";
  expect(status).not.toBe("");
  expect(html).not.toMatch(/<div[^>]*role="status"/);
  expect(status).not.toContain('role="alert"');
  expect(status).not.toContain("will show again");
  vi.mocked(invoke).mockResolvedValueOnce(null);
  expect(await dismissNote(names, () => invoke("secrets_dropped_dismiss"))).toEqual({ names: [], error: null });
});
