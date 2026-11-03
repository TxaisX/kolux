// UX audit of the Skills page (findings/skills-automations.md:5, :6, :7, :15, :19, :22; keyboard.md:9): Escape order, the Delete skills guard,
// the Install entry, the Update dialog's keys, focus and Stop, and the menus' keyboard rules.
import { expect, test } from "vitest";
import { DELETE_NONE_ELIGIBLE, DELETE_SCAN_FAILED, INSTALL_NO_SKILLS, dialogKey, dialogStep, deleteBlocked, installBlocked, pageEscape, pageOverlay, showStep, stopRun, tabWrap, viewOf, type Scan, type Skill } from "./skills";
import { focusLost, focusStranded, returnFocus, stepTo, stillHeld } from "./menuFocus";

// src has no node types; the builtin comes through process.getBuiltinModule (as noticeMount.test.ts does).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: string, enc: string): string } } }).process.getBuiltinModule("node:fs");
const source = (p: string) => nodeFs.readFileSync(p, "utf8");

const sk = (name: string, src: Skill["source"]): Skill => ({ name, description: null, updated: null, path: `C:\s\${name}\SKILL.md`, source: src, agents: [], plugin: null });
const scanOf = (...skills: Skill[]): Scan => ({ skills, roots: [] });
const idle = { menu: false, rowMenu: false, picking: false, overlay: false };

test("Escape with the Update dialog showing leaves the page open; with nothing showing it closes the page", () => {
  const body = { tagName: "BODY" } as unknown as EventTarget;
  expect(pageEscape({ ...idle, overlay: true }, body)).toBe("none");
  expect(pageEscape({ ...idle, overlay: true, picking: true }, body)).toBe("none");
  expect(pageEscape(idle, body)).toBe("close");
});

test("Escape closes the open menu first, then a row menu, then the selection, and never leaves from a text field", () => {
  const body = { tagName: "BODY" } as unknown as EventTarget;
  const input = { tagName: "INPUT" } as unknown as EventTarget;
  expect(pageEscape({ menu: true, rowMenu: true, picking: true, overlay: true }, body)).toBe("menu");
  expect(pageEscape({ ...idle, rowMenu: true, picking: true }, body)).toBe("row-menu");
  expect(pageEscape({ ...idle, picking: true }, body)).toBe("picking");
  expect(pageEscape(idle, input)).toBe("none");
});

test("an Ask the page raised itself counts as a dialog showing, even though the DOM scan does not list it", () => {
  const never = () => {
    throw new Error("the DOM scan was not needed");
  };
  expect(pageOverlay([null, { kind: "done" }], never)).toBe(true); // a delete result Ask
  expect(pageOverlay([{ name: "x" }, null], never)).toBe(true); // the details Ask
  expect(pageOverlay([null, null], () => true)).toBe(true); // the Update dialog, found in the page
  expect(pageOverlay([null, null], () => false)).toBe(false);
  const body = { tagName: "BODY" } as unknown as EventTarget;
  expect(pageEscape({ ...idle, overlay: pageOverlay([{ kind: "error" }, null], never) }, body)).toBe("none");
  expect(pageEscape({ ...idle, overlay: pageOverlay([null, null], () => false) }, body)).toBe("close");
});

test("Delete skills is off while the scan failed, even with deletable skills in the old list", () => {
  const scan = scanOf(sk("mine", "home"));
  expect(deleteBlocked(scan, "list")).toBeNull();
  const failed = viewOf(scan, "disk error", false, 1);
  expect(failed).toBe("failed");
  expect(deleteBlocked(scan, failed)).toBe(DELETE_SCAN_FAILED);
  expect(deleteBlocked(null, "scanning")).not.toBeNull();
  expect(deleteBlocked(scanOf(sk("kolux-cli", "bundled")), "list")).toBe(DELETE_NONE_ELIGIBLE);
});

test("Install / reinstall is offered when the scan found Kolux skills, and says why not otherwise", () => {
  expect(installBlocked(scanOf(sk("kolux-cli", "bundled"), sk("mine", "home")))).toBeNull();
  expect(installBlocked(scanOf(sk("mine", "home")))).toBe(INSTALL_NO_SKILLS);
  expect(installBlocked(null)).toBe(INSTALL_NO_SKILLS);
});

test("the Update dialog closes on Escape only, and Tab wraps at its ends", () => {
  expect(dialogKey("Escape")).toBe("close");
  expect(dialogKey("Enter")).toBe("pass");
  expect(tabWrap(4, 3, false)).toBe(0);
  expect(tabWrap(4, 0, true)).toBe(3);
  expect(tabWrap(4, -1, false)).toBe(0);
  expect(tabWrap(4, 1, false)).toBeNull();
  expect(tabWrap(4, 2, true)).toBeNull();
  expect(tabWrap(0, 0, false)).toBeNull();
});

// The dialog's key handler as a function: what Escape and Tab do from any focus, including none (index -1) after Stop.
test("the dialog's keys: Escape closes, Tab wraps at the ends and from nowhere, other keys pass", () => {
  expect(dialogStep("Escape", false, 4, 2)).toEqual({ act: "close" });
  expect(dialogStep("Escape", false, 4, -1)).toEqual({ act: "close" });
  expect(dialogStep("Tab", false, 4, 3)).toEqual({ act: "focus", to: 0 });
  expect(dialogStep("Tab", true, 4, 0)).toEqual({ act: "focus", to: 3 });
  expect(dialogStep("Tab", false, 4, -1)).toEqual({ act: "focus", to: 0 }); // focus on the dialog box itself, after Stop left
  expect(dialogStep("Tab", true, 4, -1)).toEqual({ act: "focus", to: 3 });
  expect(dialogStep("Tab", false, 4, 1)).toEqual({ act: "pass" });
  expect(dialogStep("Tab", false, 0, -1)).toEqual({ act: "pass" });
  expect(dialogStep("a", false, 4, 1)).toEqual({ act: "pass" });
});

test("focus is stranded when nothing, the body or a button that just turned off has it, so the dialog takes it back", () => {
  const body = {};
  expect(focusStranded(null, body)).toBe(true);
  expect(focusStranded(body, body)).toBe(true);
  expect(focusStranded({ disabled: true }, body)).toBe(true);
  expect(focusStranded({ disabled: false }, body)).toBe(false);
  expect(focusStranded({}, body)).toBe(false);
});

test("the dialog reclaims focus only if it last had it, never from an overlay opened over it", () => {
  const inside = {} as Node;
  const overlay = {} as Node;
  const box = { contains: (n: Node | null) => n === inside } as unknown as Node;
  expect(stillHeld(null, box)).toBe(true); // a button inside was removed or turned off
  expect(stillHeld(inside, box)).toBe(true); // Tab within the dialog
  expect(stillHeld(overlay, box)).toBe(false); // the palette or an Ask took it
  const update = source("src/skills/SkillUpdate.tsx");
  expect(update).toContain("open && held.current && focusStranded(");
});

test("a show request while the dialog is open focuses the Install panel and leaves nothing pending; closed, it opens", () => {
  expect(showStep(true, true)).toEqual({ open: false, wantsInstall: false, focusInstall: true });
  expect(showStep(true, false)).toEqual({ open: false, wantsInstall: false, focusInstall: false });
  expect(showStep(false, true)).toEqual({ open: true, wantsInstall: true, focusInstall: false });
  expect(showStep(false, false)).toEqual({ open: true, wantsInstall: false, focusInstall: false });
});

test("focus goes back to the opener when it is still there, else the first fallback that is, and never anywhere else", () => {
  const el = (connected: boolean) => {
    const e = { isConnected: connected, taken: 0, focus: () => void e.taken++ };
    return e;
  };
  const [opener, gone, more, heading] = [el(true), el(false), el(true), el(true)];
  expect(returnFocus(opener, [() => more])).toBe(true);
  expect([opener.taken, more.taken]).toEqual([1, 0]);
  expect(returnFocus(gone, [() => null, () => el(false), () => more, () => heading])).toBe(true); // the Review button was unmounted
  expect([gone.taken, more.taken, heading.taken]).toEqual([0, 1, 0]);
  expect(returnFocus(null, [() => null, () => heading])).toBe(true);
  expect(heading.taken).toBe(1);
  expect(returnFocus(gone, [() => null])).toBe(false);
});

test("Stop reports the app's refusal instead of dropping it", async () => {
  const calls: string[] = [];
  expect(await stopRun((c) => (calls.push(c), Promise.resolve()))).toBeNull();
  expect(calls).toEqual(["skills_update_stop"]);
  expect(await stopRun(() => Promise.reject(new Error("no update is running")))).toBe("Error: no update is running");
  expect(await stopRun(() => Promise.reject("plain text"))).toBe("plain text");
});

test("menu arrows step through the enabled items with wrapping; Home and End jump; a menu with none does nothing", () => {
  const item = (name: string) => ({ name, focus: () => undefined });
  const [a, b, c] = [item("a"), item("b"), item("c")];
  expect(stepTo([a, b, c], -1, "ArrowDown")).toBe(a);
  expect(stepTo([a, b, c], 2, "ArrowDown")).toBe(a);
  expect(stepTo([a, b, c], 0, "ArrowUp")).toBe(c);
  expect(stepTo([a, b, c], 1, "End")).toBe(c);
  expect(stepTo([a, b, c], 1, "Home")).toBe(a);
  expect(stepTo([a, b, c], 1, "x")).toBeNull();
  expect(stepTo([], 0, "ArrowDown")).toBeNull();
});

test("focus counts as lost only when nothing, or the page body, has it", () => {
  const body = {};
  expect(focusLost(null, body)).toBe(true);
  expect(focusLost(body, body)).toBe(true);
  expect(focusLost({}, body)).toBe(false);
});

test("the pages use these rules: dialog box is focusable and wired to the key rules, the dots button is named, no dead Type in terminal", () => {
  const update = source("src/skills/SkillUpdate.tsx");
  expect(update).toContain("dialogStep(e.key");
  expect(update).toContain("tabIndex={-1}");
  expect(update).toContain("focusStranded(document.activeElement");
  expect(update).toContain("remember(e.currentTarget, true)"); // the Review button is noted before the dialog opens
  expect(update).not.toContain("paletteCaps"); // no palette fallbacks (a terminal can sit hidden behind the page)
  expect(update).toContain("closeBtn.current");
  expect(update).toContain("stopRun(invoke)");
  expect(update).not.toContain("onType");
  expect(source("src/skills/SkillInstall.tsx")).not.toContain("onType");
  const page = source("src/skills/SkillsPage.tsx");
  expect(page).toContain('aria-label="More actions"');
  expect(page).toContain("pageEscape(");
  expect(page).toContain("pageOverlay([asking, details]");
  expect(page).toContain("returnFocus(opener.current");
  expect(page).toContain("deleteBlocked(scan, view)");
  expect(page.split("ref={focusFirst} onKeyDown={onMenuKey}").length - 1).toBe(3); // More, Filter by agent, row menus
});
