// LAND-04 (board test, locked): the "send finished work to main by itself" switch replaces the
// quit-time merge switch. Pure logic of src/projects/autoLand.ts, plus Settings > Git rendered to a string.
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AUTO_LAND_FIELD, AUTO_LAND_LABEL, AUTO_LAND_OLD_FIELD, autoLandNote, autoLandWanted } from "./autoLand";
import { GitView } from "../settings/GitPage";
import { jargon } from "../glossary";

const NEW = "workspacesAutoLand";
const OLD = "workspacesMergeOnQuit";

describe("autoLand", () => {
  test("follows the old switch until the new one is set", () => {
    // [settings, wanted]: the same truth table as quit_merge::auto_land_wanted in the backend.
    const table: Array<[Record<string, unknown>, boolean]> = [
      [{}, true],
      [{ [OLD]: true }, true],
      [{ [OLD]: false }, false],
      [{ [NEW]: true }, true],
      [{ [NEW]: false }, false],
      [{ [NEW]: true, [OLD]: false }, true],
      [{ [NEW]: false, [OLD]: true }, false],
      [{ [NEW]: true, [OLD]: true }, true],
      [{ [NEW]: false, [OLD]: false }, false],
      [{ unrelated: false }, true],
    ];
    for (const [settings, wanted] of table) expect(autoLandWanted(settings), JSON.stringify(settings)).toBe(wanted);
  });

  test("ignores a value that is not true or false, on either key", () => {
    const table: Array<[Record<string, unknown>, boolean]> = [
      [{ [OLD]: "no" }, true],
      [{ [OLD]: 0 }, true],
      [{ [OLD]: null }, true],
      [{ [OLD]: "false" }, true],
      [{ [NEW]: "yes", [OLD]: false }, false],
      [{ [NEW]: "false" }, true],
      [{ [NEW]: null, [OLD]: false }, false],
      [{ [NEW]: 0, [OLD]: true }, true],
      [{ [NEW]: 1, [OLD]: false }, false],
      [{ [NEW]: undefined, [OLD]: false }, false],
      [{ [NEW]: {}, [OLD]: false }, false],
    ];
    for (const [settings, wanted] of table) {
      const got = autoLandWanted(settings);
      expect(typeof got, JSON.stringify(settings)).toBe("boolean");
      expect(got, JSON.stringify(settings)).toBe(wanted);
    }
  });

  test("is on when there are no settings at all", () => {
    expect(autoLandWanted(null)).toBe(true);
    expect(autoLandWanted(undefined)).toBe(true);
  });

  test("names the new key, keeps the old one for reading, and words the switch exactly", () => {
    expect(AUTO_LAND_FIELD).toBe(NEW);
    expect(AUTO_LAND_OLD_FIELD).toBe(OLD);
    expect(AUTO_LAND_LABEL).toBe("Send finished work to main by itself");
  });

  test("the notes say on or off in plain words and never talk about closing Kolux", () => {
    const on = autoLandNote(true);
    const off = autoLandNote(false);
    expect(on).toBe(
      "On: when an agent says its task is finished, Kolux sends that workspace's work to main on this computer and brings the other workspaces up to date. Work that clashes with main stays in its workspace, marked Not in main. Nothing goes to GitHub.",
    );
    expect(off).toBe(
      "Off: an agent's finished work waits in its workspace, marked Not in main, until you choose Send to main in its pane menu. Nothing goes to GitHub.",
    );
    for (const n of [on, off]) {
      expect(jargon(n)).toEqual([]);
      expect(n).not.toMatch(/close|quit|rebase|fast-forward/i);
      expect(n).not.toContain("—");
    }
  });
});

const view = (settings: Record<string, unknown>) =>
  renderToString(createElement(GitView, { settings, save: () => {}, draft: "", setDraft: () => {}, check: null }));
const folders = (html: string) => html.slice(html.indexOf('data-section="agent-folders"'), html.indexOf('data-section="base"'));
const SWITCH = /aria-label="Send finished work to main by itself"[^>]*>/;

describe("Settings > Git", () => {
  test("the switch sits in Where agents work, says Send finished work to main by itself, and follows the old setting until set", () => {
    const on = folders(view({}));
    expect(on).toContain("Send finished work to main by itself");
    expect(on.match(SWITCH)?.[0]).toContain('checked=""');
    expect(on).toContain("data-auto-land-note");
    expect(on).toContain("Nothing goes to GitHub.");
    expect(on).not.toContain("Merge workspaces into main when Kolux closes");
    expect(on).not.toContain("data-merge-on-quit-note");

    const migratedOff = folders(view({ [OLD]: false }));
    expect(migratedOff.match(SWITCH)?.[0]).toBeDefined();
    expect(migratedOff.match(SWITCH)?.[0]).not.toContain('checked=""');
    expect(migratedOff).toContain("Off: an agent&#x27;s finished work waits in its workspace");

    const newWins = folders(view({ [OLD]: false, [NEW]: true }));
    expect(newWins.match(SWITCH)?.[0]).toContain('checked=""');
    expect(newWins).toContain("On: when an agent says its task is finished");
  });
});
