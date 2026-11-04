import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import RecoveryNotes from "./RecoveryNotes";
import { loadRecoveryNotes } from "./startupNotes";

const html = (e: ReturnType<typeof createElement>) => renderToString(e).replace(/<!-- -->/g, "");

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => !!n && typeof n === "object" && "props" in n;
function all(n: unknown, out: El[] = []): El[] {
  if (Array.isArray(n)) n.forEach((c) => all(c, out));
  else if (isEl(n)) {
    out.push(n);
    all(n.props.children, out);
  }
  return out;
}

test("row 789: the sentences the back end gives reach the notice as they are, and an empty answer shows nothing", async () => {
  const said = [
    "Your saved data file (state.db) was damaged. Kolux restored the last good copy and kept the damaged file at C:\p\state.db.damaged-1.",
    "Kolux could not read your settings file (expected value), so it is using the last good copy, C:\p\settings.json.bak.",
  ];
  expect(await loadRecoveryNotes(async () => said)).toEqual(said);
  const page = html(createElement(RecoveryNotes, { notes: said, onDismiss: () => {} }));
  expect(page).toContain("state.db.damaged-1");
  expect(page).toContain("settings.json.bak");
  expect(page).toContain('title="Dismiss"');
  expect(page.match(/class="notice recovery-notes"/g)).toHaveLength(1);
  expect(html(createElement(RecoveryNotes, { notes: [], onDismiss: () => {} }))).toBe("");
});

test("row 789: a failed ask or a stray answer is no notice", async () => {
  expect(await loadRecoveryNotes(async () => Promise.reject(new Error("no such command")))).toEqual([]);
  expect(await loadRecoveryNotes(async () => null)).toEqual([]);
  expect(await loadRecoveryNotes(async () => ["", "  ", "kept"])).toEqual(["kept"]);
});

test("C22-R2-01: a settings fallback notice offers Repair, and pressing it calls the repair", () => {
  let repaired = 0;
  const tree = RecoveryNotes({ notes: ["Kolux could not read C:\\p\\settings.json (expected value), so it is showing defaults and changes will not save. Nothing is written over the unreadable file."], onDismiss: () => {}, onRepair: () => repaired++ });
  const button = all(tree).find((e) => e.props.children === "Repair settings");
  expect(button, "the notice offers the one repair").toBeTruthy();
  (button!.props.onClick as () => void)();
  expect(repaired).toBe(1);
  // a notice about anything else offers no repair
  const plain = RecoveryNotes({ notes: ["Your saved data file (state.db) was damaged."], onDismiss: () => {} });
  expect(all(plain).some((e) => e.props.children === "Repair settings")).toBe(false);
});

