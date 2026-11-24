// LAND-05 (board test, locked): the pane's "Send to main" item and its land chip. Pure logic of
// src/terminal/landState.ts, which turns the backend's land records, preview and outcome (src-tauri/src/land.rs)
// into what the pane shows.
import { describe, expect, test } from "vitest";
import {
  canSendToMain,
  LAND_EVENT,
  landChip,
  landFlash,
  landKey,
  landStep,
  recordFor,
  SEND_TO_MAIN,
  SEND_TO_MAIN_ID,
  SEND_TO_MAIN_TIP,
  type LandPreview,
  type LandRecord,
} from "./landState";

const rec = (state: string, why?: string): LandRecord => (why === undefined ? { state, at: 1 } : { state, why, at: 1 });
const preview = (p: Partial<LandPreview>): LandPreview => ({ uncommitted: 0, ahead: 1, landable: true, why: null, ...p });

describe("landState", () => {
  test("landKey matches the backend's name_key", () => {
    expect(landKey("C:/Dev/App/.worktrees/a")).toBe("c:\\dev\\app\\.worktrees\\a");
    expect(landKey("C:\\Dev\\App\\.worktrees\\A\\")).toBe("c:\\dev\\app\\.worktrees\\a");
    expect(landKey("C:\\Dev\\App\\.worktrees\\A\\\\")).toBe("c:\\dev\\app\\.worktrees\\a");
    expect(landKey("c:\\dev\\x")).toBe("c:\\dev\\x");
    expect(landKey("")).toBe("");
  });

  test("recordFor finds a workspace's record whatever its slashes and case, and nothing for garbage", () => {
    const records = { "c:\\dev\\app\\.worktrees\\a": rec("landed"), "c:\\dev\\app\\.worktrees\\b": rec("behind", "agent working") };
    expect(recordFor(records, "C:/Dev/App/.worktrees/a")).toEqual({ state: "landed", at: 1 });
    expect(recordFor(records, "C:\\Dev\\App\\.worktrees\\B\\")).toEqual({ state: "behind", why: "agent working", at: 1 });
    expect(recordFor(records, "C:\\Dev\\App\\.worktrees\\c")).toBeNull();
    // A folder inside a workspace is not the workspace.
    expect(recordFor(records, "C:\\Dev\\App\\.worktrees\\a\\src")).toBeNull();
    expect(recordFor(records, null)).toBeNull();
    expect(recordFor(records, undefined)).toBeNull();
    expect(recordFor(records, "")).toBeNull();
    for (const bad of [null, undefined, 3, "x", [], [rec("landed")]]) expect(recordFor(bad, "C:/Dev/App/.worktrees/a")).toBeNull();
    const broken = { "c:\\a": null, "c:\\b": "landed", "c:\\c": { why: "x", at: 1 }, "c:\\d": { state: 7, at: 1 } };
    for (const f of ["C:\\a", "C:\\b", "C:\\c", "C:\\d"]) expect(recordFor(broken, f), f).toBeNull();
  });

  test("recordFor keeps only a text why and a number at", () => {
    expect(recordFor({ "c:\\w": { state: "clashed", why: 5, at: "soon" } }, "C:\\w")).toEqual({ state: "clashed", at: 0 });
    expect(recordFor({ "c:\\w": { state: "ready", why: "waits", at: 42 } }, "C:\\w")).toEqual({ state: "ready", why: "waits", at: 42 });
  });

  test("landChip shows Not in main, Behind main or Finished in the right colour, and nothing otherwise", () => {
    expect(landChip(rec("clashed", "Not sent to main: clashes in a.ts."))).toEqual({ text: "Not in main", color: "var(--warn)", tip: "Not sent to main: clashes in a.ts." });
    expect(landChip(rec("ready", "marked ready"))).toEqual({ text: "Not in main", color: "var(--warn)", tip: "marked ready" });
    expect(landChip(rec("behind", "its agent is working"))).toEqual({ text: "Behind main", color: "var(--warn)", tip: "its agent is working" });
    expect(landChip(rec("landed"))).toEqual({ text: "Finished", color: "var(--working)", tip: "Its work is in main." });
    expect(landChip(rec("nothingNew"))).toEqual({ text: "Finished", color: "var(--working)", tip: "Its work is in main." });
    for (const s of ["updated", "current", "refused", "", "Landed", "CLASHED", "behind "]) expect(landChip(rec(s)), s).toBeNull();
  });

  test("landChip gives a plain tip when the record says no why, and ignores garbage", () => {
    expect(landChip(rec("clashed"))?.tip).toBe("Its work clashes with main, so it was not sent.");
    expect(landChip(rec("clashed", ""))?.tip).toBe("Its work clashes with main, so it was not sent.");
    expect(landChip(rec("ready"))?.tip).toBe("Its task is finished and waits to be sent. Choose Send to main in the pane menu.");
    expect(landChip(rec("behind"))?.tip).toBe("Main has newer work this workspace could not take in yet.");
    expect(landChip({ state: "landed", why: "ignored for finished", at: 1 })?.tip).toBe("Its work is in main.");
    for (const bad of [null, undefined, 0, "landed", [], {}, { state: 3 }, { why: "x" }]) expect(landChip(bad), JSON.stringify(bad)).toBeNull();
  });

  test("Send to main is offered only for a workspace that is not the main folder", () => {
    expect(canSendToMain({ path: "C:\\Dev\\App\\.worktrees\\a", isMain: false })).toBe(true);
    expect(canSendToMain({ path: "C:\\Dev\\App", isMain: true })).toBe(false);
    expect(canSendToMain({ path: "", isMain: false })).toBe(false);
    expect(canSendToMain(null)).toBe(false);
    expect(canSendToMain(undefined)).toBe(false);
    expect(canSendToMain({ path: "C:\\x" } as unknown as { path: string; isMain: boolean })).toBe(false);
  });

  test("landStep stops with the reason when the preview says it cannot be sent, or cannot be read", () => {
    expect(landStep(preview({ landable: false, why: "main already has everything in it" }))).toEqual({ kind: "stop", text: "Not sent to main: main already has everything in it." });
    expect(landStep(preview({ landable: false, why: null }))).toEqual({ kind: "stop", text: "Not sent to main: Kolux could not check this workspace." });
    expect(landStep(preview({ landable: false, why: "" }))).toEqual({ kind: "stop", text: "Not sent to main: Kolux could not check this workspace." });
    const unread = { kind: "stop", text: "Not sent to main: Kolux could not check this workspace." };
    for (const bad of [null, undefined, "yes", 1, [], {}, { landable: "true", uncommitted: 0 }, { landable: true, uncommitted: -1 }, { landable: true, uncommitted: 1.5 }, { landable: true, uncommitted: "2" }, { landable: true }]) {
      expect(landStep(bad), JSON.stringify(bad)).toEqual(unread);
    }
  });

  test("landStep asks first when there is uncommitted work, and goes straight on when there is none", () => {
    expect(landStep(preview({ uncommitted: 0 }))).toEqual({ kind: "go" });
    expect(landStep(preview({ uncommitted: 0, ahead: 0, why: null }))).toEqual({ kind: "go" });
    expect(landStep(preview({ uncommitted: 1 }))).toEqual({
      kind: "ask",
      question: {
        title: "Send to main?",
        body: "1 file in this workspace has changes that are not committed. Kolux commits them first, then sends the work to main on this computer. Nothing goes to GitHub.",
        confirm: "Send to main",
      },
    });
    expect(landStep(preview({ uncommitted: 3 }))).toEqual({
      kind: "ask",
      question: {
        title: "Send to main?",
        body: "3 files in this workspace have changes that are not committed. Kolux commits them first, then sends the work to main on this computer. Nothing goes to GitHub.",
        confirm: "Send to main",
      },
    });
  });

  test("landFlash says what the land did, in the backend's words", () => {
    expect(landFlash({ path: "C:\\w", branch: "a", state: "landed", message: "Sent a to main.", files: [], siblings: [] })).toBe("Sent a to main.");
    expect(landFlash({ path: "C:\\w", branch: null, state: "refused", message: "Not sent to main: Kolux is closing.", files: [], siblings: [] })).toBe("Not sent to main: Kolux is closing.");
    for (const bad of [null, undefined, "Sent", {}, { message: "" }, { message: 4 }]) expect(landFlash(bad), JSON.stringify(bad)).toBe("Kolux could not send this workspace to main.");
  });

  test("the event name and the menu item's words match the backend and the spec", () => {
    expect(LAND_EVENT).toBe("workspace-land");
    expect(SEND_TO_MAIN).toBe("Send to main");
    expect(SEND_TO_MAIN_ID).toBe("sendToMain");
    expect(SEND_TO_MAIN_TIP).toBe("Sends this workspace's finished work to main on this computer. Nothing goes to GitHub.");
  });
});
