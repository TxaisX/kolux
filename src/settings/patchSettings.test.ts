// Audit N-49: settings writes made from code with no page around it (the setup card's resume switch,
// a Claude account's upkeep, an appearance change from the window chrome) used to read, merge and
// write on their own, so one could interleave with a page save and skip the tidy the page gets.
// `patchSettings` is the same turn every page save takes; these tests hold that to account.
// @vitest-environment node
import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  disk: {} as Record<string, unknown>,
  calls: [] as { cmd: string; args: unknown }[],
  fail: null as string | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { set?: Record<string, unknown>; remove?: string[] }) => {
    h.calls.push({ cmd, args });
    if (h.fail) return Promise.reject(h.fail);
    if (cmd === "settings_patch") {
      h.disk = { ...h.disk, ...(args.set ?? {}) };
      for (const k of args.remove ?? []) delete h.disk[k];
      return Promise.resolve(null);
    }
    return Promise.resolve({ ...h.disk });
  },
}));

const { patchSettings } = await import("./useSettings");

test("a code-side write merges into what is on disk instead of replacing it", async () => {
  h.disk = { theme: "dark", fontSize: 14 };
  h.calls = [];
  const stored = await patchSettings({ resumeSessions: true });
  expect(stored).toEqual({ theme: "dark", fontSize: 14, resumeSessions: true });
  // Only the written key travels: the read-before-write keeps a key another writer stored meanwhile.
  expect(h.calls.find((c) => c.cmd === "settings_patch")?.args).toEqual({ set: { resumeSessions: true }, remove: [] });
});

test("a code-side write is tidied on the way in, as a page's save is (SET-035)", async () => {
  h.disk = { theme: "dark" };
  h.calls = [];
  const { tidySettings } = await import("./tidy");
  const patch = { appIcon: "WaterColor" }; // tidy lower-cases a known icon
  await patchSettings(patch);
  const sent = (h.calls.find((c) => c.cmd === "settings_patch")?.args as { set?: Record<string, unknown> })?.set ?? {};
  expect(sent.appIcon).toBe(tidySettings({ ...h.disk, ...patch }).appIcon);
  expect(sent.appIcon).toBe("watercolor");
});

test("a failed write rejects, so the caller still takes its switch back", async () => {
  h.disk = { theme: "dark" };
  h.fail = "the disk said no";
  await expect(patchSettings({ resumeSessions: true })).rejects.toBe("the disk said no");
  h.fail = null;
});
