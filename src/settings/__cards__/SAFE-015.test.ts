// SAFE-015 acceptance, the Safety page half: the real SafetyView is called, a real switch's onChange is fired,
// and the patch it saves is what the Rust hook then reads. The hook half is src-tauri/tests/cards_10.rs
// safe015_box1/box2, which feeds reply_body exactly these saved settings.
// MIRROR SafetyPage.tsx default export (save -> settings merge); the merge is replayed below as Object.assign.
import { expect, test } from "vitest";
import { SafetyView, type RuleInfo } from "../SafetyPage";
import { findAll, type El } from "./shallow-react";

const RULES: RuleInfo[] = [
  { id: "stripe", name: "Stripe changes", samples: ["stripe refunds create --charge ch_1", "stripe customers delete cus_1"] },
  { id: "force-push", name: "Force-push to main", samples: ["git push --force origin main", "git push origin +main"] },
];

function page(settings: Record<string, unknown>) {
  const saved: Record<string, unknown>[] = [];
  const tree = SafetyView({ settings: { agentStatusHooks: true, ...settings }, rules: RULES, // T-799: the switches are live only while the status hooks are on
     save: (p: Record<string, unknown>) => void saved.push(p) } as never) as unknown as El;
  const sw = (label: string) => findAll(tree, (e) => e.type === "input" && e.props["aria-label"] === label)[0];
  return { sw, saved };
}

test("box 1: the Force-push to main switch off saves it as turned off, on again takes it out of the list", () => {
  let settings: Record<string, unknown> = {};
  const off = page(settings);
  expect(off.sw("Force-push to main").props.checked).toBe(true);
  off.sw("Force-push to main").props.onChange({ target: { checked: false } });
  expect(off.saved).toEqual([{ protectedOff: ["force-push"] }]);
  settings = { ...settings, ...off.saved[0] };
  const after = page(settings);
  expect(after.sw("Force-push to main").props.checked).toBe(false);
  expect(after.sw("Stripe changes").props.checked).toBe(true);
  after.sw("Force-push to main").props.onChange({ target: { checked: true } });
  expect(after.saved).toEqual([{ protectedOff: [] }]);
});

test("box 2: the master switch named Ask before protected actions is on by default and off saves protectedAsk false", () => {
  const p = page({});
  expect(p.sw("Ask before protected actions").props.checked).toBe(true);
  p.sw("Ask before protected actions").props.onChange({ target: { checked: false } });
  expect(p.saved).toEqual([{ protectedAsk: false }]);
  expect(page({ protectedAsk: false }).sw("Ask before protected actions").props.checked).toBe(false);
});
