// AUD-S3 / S3-F02: tools/kolux-memory/lib.mjs keeps credentials out of the memory file: its
// SECRETS list says "a false positive costs a phrase, a miss costs a leaked key". The key=value
// pattern requires the separator to follow the key directly, so the JSON form that a tool input
// takes after JSON.stringify -- `{"password":"..."}` -- is stored in full.
import { describe, expect, it } from "vitest";
import { redact } from "../tools/kolux-memory/lib.mjs";

describe("audit S3 · credential redaction", () => {
  it("[S3-F02] a key inside a JSON tool input is redacted", () => {
    const text = '{"password":"hunter2hunter2hunter2","api_key":"abcdefghijklmnopqrstuvwx"}';
    const out = redact(text);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("hunter2hunter2hunter2");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwx");
  });
});
