import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { ProviderUsageView, readingText, type KeyRow, type Reading } from "./ProviderUsage";

const rows: KeyRow[] = [
  { provider: "kimi", label: "Kimi (Moonshot) API key", kept: false, masked: null },
  { provider: "minimax", label: "MiniMax API key", kept: true, masked: "••••5555" },
];
const html = (r: KeyRow[], drafts: Record<string, string> = {}, readings: Partial<Record<"kimi" | "minimax", Reading>> = {}) => renderToString(createElement(ProviderUsageView, { rows: r, drafts, readings, onDraft: () => {}, onAction: () => {} }));

test("T-547: each provider row adds or removes a key, and a kept key shows only masked", () => {
  const out = html(rows);
  expect(out).toContain("Kimi (Moonshot) API key");
  expect(out).toContain("Kept: ••••5555");
  expect(out).toContain("No key");
  expect(out).toContain('type="password"');
  // No key: Add key waits for text, Remove and Check now are off.
  const kimi = out.slice(out.indexOf('data-provider="kimi"'), out.indexOf('data-provider="minimax"'));
  expect(kimi).toMatch(/<button[^>]*disabled[^>]*>Add key/);
  expect(kimi).toMatch(/<button[^>]*disabled[^>]*>Remove/);
  expect(kimi).toMatch(/<button[^>]*disabled[^>]*>Check now/);
  const mm = out.slice(out.indexOf('data-provider="minimax"'));
  expect(mm).toContain("Replace");
  expect(mm).not.toMatch(/<button[^>]*disabled[^>]*>Remove/);
  // A typed draft turns Add key on.
  expect(html(rows, { kimi: "sk-x" })).not.toMatch(/<button[^>]*disabled[^>]*>Add key/);
  expect(out).not.toContain("Claude");
});

test("T-547: every reading reads as one plain sentence, with the ones that need the user marked", () => {
  expect(readingText({ state: "balance", available: 49.58894, voucher: 46.58893, cash: 3.00001 })).toEqual({ text: "Balance $49.59 (vouchers $46.59, cash $3.00)", warn: false });
  expect(readingText({ state: "balance", available: 0, voucher: 0, cash: 0 }).warn).toBe(true);
  expect(readingText({ state: "badKey" })).toEqual({ text: "The key was refused. Check it, or replace it.", warn: true });
  expect(readingText({ state: "rateLimited" }).text).toContain("Too many checks");
  expect(readingText({ state: "offline" })).toEqual({ text: "No connection to the provider.", warn: true });
  expect(readingText({ state: "answered" }).text).toContain("no format");
  expect(readingText({ state: "unavailable", reason: "that address is not on the allowed list" }).text).toBe("Not checked: that address is not on the allowed list.");
  expect(readingText({ state: "failed", status: 500 }).text).toContain("500");
  expect(readingText({ state: "noKey" }).warn).toBe(false);
  const shown = html([{ ...rows[0], kept: true, masked: "••••9876" }], {}, { kimi: { state: "badKey" } });
  expect(shown).toContain("The key was refused");
  expect(shown).toContain('class="conn-detail warn"');
});
