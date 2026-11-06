// APP-038 (T-324-b-rest): a crash report copies the scrubbed diagnostic bundle instead of a screenshot.
import { describe, expect, it } from "vitest";
import { copyCrashBundle, CRASH_BUNDLE_COPIED } from "./crashBundle";

const TOKEN = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV";
const HOME = String.raw`C:\Users\jdoe\work\repo`;
// A bundle as the back end builds it, except that this one still holds a secret and a profile path
// (the way a bundle from an older back end, or a bug in its masking, would).
const BUNDLE = [
  "Kolux 0.1.0 diagnostics, 2026-10-25",
  "== kolux.log ==",
  "app start 7, Kolux 0.1.0",
  `pane env ANTHROPIC_API_KEY=${TOKEN} leaked`,
  `opened ${HOME} in terminal 3`,
].join("\n");

describe("copyCrashBundle", () => {
  it("puts the bundle on the clipboard with the seeded secret and home path masked", async () => {
    const wrote: string[] = [];
    const note = await copyCrashBundle(async () => BUNDLE, async (t) => void wrote.push(t));
    expect(note).toBe(CRASH_BUNDLE_COPIED);
    expect(wrote).toHaveLength(1);
    expect(wrote[0]).toContain("Kolux 0.1.0 diagnostics");
    expect(wrote[0]).toContain("app start 7, Kolux 0.1.0");
    expect(wrote[0]).toContain("ANTHROPIC_API_KEY=[masked] leaked");
    for (const secret of [TOKEN, "ABCDEFGHIJKLMNOPQRSTUV", "jdoe", HOME]) expect(wrote[0]).not.toContain(secret);
    expect(note).not.toContain("jdoe");
  });
  it("says so and copies nothing when the logs cannot be read", async () => {
    const wrote: string[] = [];
    const note = await copyCrashBundle(async () => { throw new Error("no log folder"); }, async (t) => void wrote.push(t));
    expect(wrote).toEqual([]);
    expect(note).toContain("could not be gathered");
    expect(note).toContain("no log folder");
  });
  it("says so when the clipboard refuses", async () => {
    const note = await copyCrashBundle(async () => BUNDLE, async () => { throw new Error("denied"); });
    expect(note).toContain("could not be put on the clipboard");
  });
  it("copies nothing for an empty bundle", async () => {
    const wrote: string[] = [];
    const note = await copyCrashBundle(async () => "  \n", async (t) => void wrote.push(t));
    expect(wrote).toEqual([]);
    expect(note).toContain("no diagnostic logs");
  });
});
