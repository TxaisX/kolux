import { describe, expect, test } from "vitest";
import { afterBurst, boundaryMessage, captured, dialogLead, issueTitle, issueUrl, launchPrompt, NOTHING_CAPTURED, openFromHelp, openPending, updateNotice, type Crash } from "./model";
import { FEEDBACK_REPO, URL_CAP } from "../settings/privacy";

const crash = (summary: string, dismissed = false): Crash => ({ id: "1-0", when: 1_700_000_000, summary, dismissed });

describe("T-183 APP-039: the crash report", () => {
  test("the issue is marked as a crash report and the title stays short", () => {
    expect(issueTitle(crash("fatal error: panicked at src/x.rs:1: boom\nsecond line"))).toBe("[Crash] fatal error: panicked at src/x.rs:1: boom");
    expect(Array.from(issueTitle(crash("x".repeat(200)))).length).toBe(80);
    expect(issueTitle(crash("Kolux ended without a clean exit (no shutdown record in the log)"))).toBe("[Crash] Kolux closed without a clean exit");
  });

  test("the address is pre-filled, goes to the issues page and never grows past a browser address", () => {
    const c = crash("boom");
    const u = issueUrl(c, "Kolux crash report\nVersion: 0.1.0\nWhat was recorded: boom\n");
    expect(u.startsWith(`${FEEDBACK_REPO}?title=${encodeURIComponent("[Crash] boom")}&body=`)).toBe(true);
    expect(decodeURIComponent(u.split("&body=")[1])).toContain("What was recorded: boom");
    const long = issueUrl(c, "line\n".repeat(5000));
    expect(long.length).toBeLessThanOrEqual(URL_CAP);
    expect(decodeURIComponent(long.split("&body=")[1])).toContain("trimmed to fit in a browser address");
    expect(issueUrl(c, "x", "https://example.test/new").startsWith("https://example.test/new?title=")).toBe(true);
  });

  test("the newest pending report prompts, Help reopens the newest even after dismissal, and nothing captured says so", () => {
    expect(openPending(null)).toBeNull();
    expect(openPending(crash("boom"))).toEqual({ crash: crash("boom"), via: "pending" });
    expect(openFromHelp(null)).toBeNull();
    expect(openFromHelp(crash("boom", true))).toEqual({ crash: crash("boom", true), via: "help" });
    expect(dialogLead({ crash: crash("boom"), via: "pending" })).toContain("did not close properly last time");
    expect(dialogLead({ crash: crash("boom"), via: "pending" })).toContain("nothing is sent");
    const bare = crash("Kolux ended without a clean exit (no shutdown record in the log)");
    expect(captured(bare)).toBe(false);
    expect(dialogLead({ crash: bare, via: "help" })).toBe(NOTHING_CAPTURED);
    expect(dialogLead({ crash: crash("boom"), via: "help" })).toContain("most recent crash record");
  });
});

describe("T-183 APP-043: the graphics prompts", () => {
  test("the burst offer shows once and never stacks on another prompt", () => {
    expect(afterBurst(null, false)).toBeNull();
    expect(afterBurst(null, true)).toEqual({ kind: "burst" });
    expect(afterBurst({ kind: "burst" }, true)).toEqual({ kind: "burst" });
    expect(afterBurst({ kind: "launch", stay: true }, true)).toEqual({ kind: "launch", stay: true });
  });

  test("the recovered launch asks with stay preselected, and a remembered choice asks nothing", () => {
    expect(launchPrompt(null)).toBeNull();
    expect(launchPrompt({ chosen: true })).toBeNull();
    expect(launchPrompt({ chosen: false })).toEqual({ kind: "launch", stay: true });
  });
});

test("T-183 APP-042: the screen boundary names what broke in plain words", () => {
  expect(boundaryMessage(new Error("x is not a function"))).toBe("Part of the interface stopped working: x is not a function");
  expect(boundaryMessage("odd")).toBe("Part of the interface stopped working: odd");
  expect(boundaryMessage(undefined)).toBe("Part of the interface stopped working.");
});

test("T-199 (APP-028): a failed install is reported once at the next launch with Try again and the installer page", () => {
  const n = updateNotice({ kind: "failed", from: "0.2.0", to: "0.3.0", holder: null, releasesPage: "https://example.invalid/releases" });
  expect(n?.text).toBe("The update to Kolux 0.3.0 did not install, so this is still 0.2.0. Try again, or download the installer and run it yourself.");
  expect(n?.releasesPage).toBe("https://example.invalid/releases");
  expect(updateNotice({ kind: "failed", from: "1", to: "2", holder: "Explorer", releasesPage: "p" })?.text).toContain(" Explorer was holding Kolux's files.");
  expect(updateNotice({ kind: "updated", version: "0.3.0", notes: [] })).toBeNull();
  expect(updateNotice(null)).toBeNull();
});
