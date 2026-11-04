// There is no DOM test renderer in this repo, so the three React hooks the page uses are swapped for a
// tiny runtime (state slots, effects that run when their deps change, a redraw while state is dirty),
// the same way onboarding/useWizard.test.ts does it. The pure view tests below never call a hook.
import { beforeEach, expect, test, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import SafetyPage, { asksAtAll, ASK_FIELD, OFF_FIELD, offIds, ruleOn, SafetyView, savedState, switchAll, switchRule, type RuleInfo } from "./SafetyPage";

type Effect = { deps: unknown[] | undefined; cleanup?: () => void };
const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, effects: [] as Effect[], e: 0, queue: [] as (() => void)[], dirty: false }));
const store = vi.hoisted(() => ({ file: {} as Record<string, unknown>, failSave: false, rules: [] as unknown[] }));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  function useState<T>(init: T | (() => T)) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((x: T) => T)) => {
      const next = typeof v === "function" ? (v as (x: T) => T)(h.slots[k] as T) : v;
      if (!Object.is(next, h.slots[k])) (h.slots[k] = next), (h.dirty = true);
    };
    return [h.slots[k] as T, set] as const;
  }
  function useRef<T>(init: T) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { current: init };
    return h.slots[k] as { current: T };
  }
  function useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const k = h.e++;
    const prev = h.effects[k];
    if (prev && deps && prev.deps && deps.every((d, j) => Object.is(d, prev.deps![j]))) return;
    h.queue.push(() => {
      prev?.cleanup?.();
      const c = fn();
      h.effects[k] = { deps, cleanup: typeof c === "function" ? c : undefined };
    });
  }
  const hooks = { useState, useRef, useEffect };
  return { ...real, ...hooks, default: { ...real, ...hooks } };
});
// The saved file: what get_settings reads and what a save writes, unless the write is made to fail.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "protected_rules") return Promise.resolve(store.rules);
    if (cmd === "get_settings") return Promise.resolve({ ...store.file });
    return Promise.reject(new Error(`unexpected ${cmd}`));
  },
}));
vi.mock("./saveChanged", () => ({
  saveChanged: (_old: unknown, next: Record<string, unknown>) => {
    if (store.failSave) return Promise.reject(new Error("settings.json is read-only"));
    Object.assign(store.file, next);
    return Promise.resolve();
  },
}));

// The seven rules as protected_rules lists them (the Rust catalog test proves each example asks).
const RULES: RuleInfo[] = [
  { id: "stripe", name: "Stripe changes", samples: ["stripe refunds create --charge ch_1", "stripe customers delete cus_1"] },
  { id: "force-push", name: "Force-push to main", samples: ["git push --force origin main", "git push origin +main"] },
  { id: "db-drop", name: "Deleting database tables", samples: ["psql -c \"DROP TABLE users\"", "dropdb production"] },
  { id: "infra", name: "Infrastructure changes", samples: ["terraform apply -auto-approve", "pulumi destroy"] },
  { id: "prod-deploy", name: "Production deploys", samples: ["vercel --prod", "netlify deploy --prod"] },
  { id: "delete", name: "Deleting folders outside the workspace", samples: ["rm -rf ../other-project", "rm -rf ~"] },
  { id: "discard", name: "Throwing away uncommitted work", samples: ["git reset --hard", "git clean -fdx"] },
];
const view = (settings: Record<string, unknown>, rules: RuleInfo[] | null = RULES, error: string | null = null) => renderToString(createElement(SafetyView, { settings, rules, error, save: () => {} }));
const switchOf = (html: string, label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

test("SAFE-015: the section explains itself, says only Claude Code is covered and reminds that the status hooks must be on", () => {
  const html = view({ agentStatusHooks: true });
  expect(html).toContain('data-section="protected"');
  expect(html).toContain("Protected actions");
  expect(html).toContain("Only Claude Code is covered");
  expect(html).toContain("agent status hooks");
  expect(html).not.toContain('role="alert"');
  // With the hooks switch off (its default) the reminder is a warning that points at Settings > Agents.
  const off = view({});
  expect(off).toContain('role="alert"');
  expect(off).toContain("Settings &gt; Agents");
});

test("SAFE-015: a master switch named Ask before protected actions, on by default, then one row per rule with its name, examples and a switch", () => {
  const html = view({});
  expect(switchOf(html, "Ask before protected actions")).toContain("checked");
  expect(html.indexOf("Ask before protected actions")).toBeLessThan(html.indexOf("Stripe changes"));
  for (const r of RULES) {
    expect(html, r.id).toContain(`data-rule="${r.id}"`);
    expect(switchOf(html, r.name), r.name).toContain("checked");
    for (const s of r.samples) expect(html, s).toContain(`<code>${s.replace(/"/g, "&quot;")}</code>`);
  }
  expect((html.match(/data-rule="/g) ?? []).length).toBe(7);
  expect(RULES.map((r) => r.name)).toEqual(["Stripe changes", "Force-push to main", "Deleting database tables", "Infrastructure changes", "Production deploys", "Deleting folders outside the workspace", "Throwing away uncommitted work"]);
});

test("SAFE-015: what is saved decides what is drawn: a rule in the off list is unchecked, the master switch off says nothing asks", () => {
  const html = view({ [OFF_FIELD]: ["force-push"], [ASK_FIELD]: false });
  expect(switchOf(html, "Force-push to main")).not.toContain("checked");
  expect(switchOf(html, "Stripe changes")).toContain("checked");
  expect(switchOf(html, "Ask before protected actions")).not.toContain("checked");
  expect(html).toContain("no rule asks");
  expect(html).toContain("data-master-off");
  const rulesDiv = (h: string) => h.match(/<div data-rules[^>]*>/)?.[0] ?? "";
  expect(rulesDiv(html), "T-753: the rules are dimmed while nothing asks").toContain("data-master-off");
  const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  expect(css, "T-759: by a rule that leaves the focused switch (and its focus ring) undimmed").toContain("[data-master-off] > .conn-switch:not(:has(:focus-visible)) { opacity: 0.65; }");
  expect(rulesDiv(html), "not by an inline style on the whole block, which dims the ring too").not.toContain("opacity");
  expect(switchOf(html, "Stripe changes"), "and a screen reader hears why").toContain("aria-describedby=\"safety-master-note\"");
  expect(html).toMatch(/<small id="safety-master-note">Off: no rule asks/);
  expect(rulesDiv(view({})), "not while the master switch is on").not.toContain("data-master-off");
  expect(switchOf(view({}), "Stripe changes")).not.toContain("aria-describedby");
});

test("SAFE-015: the rule list is waiting, or could not be read, without hiding the master switch", () => {
  const wait = view({}, null);
  expect(wait).toContain("Reading the rules");
  expect(switchOf(wait, "Ask before protected actions")).toContain("switch");
  const bad = view({}, null, "no such command");
  expect(bad).toContain("The rules could not be listed:");
  expect(bad).toContain("no such command");
  expect(bad).not.toContain("Reading the rules");
});

test("SAFE-015: the patches the switches save are exactly what the Rust check reads (protectedAsk, protectedOff)", () => {
  expect(switchAll(false)).toEqual({ protectedAsk: false });
  expect(switchAll(true)).toEqual({ protectedAsk: true });
  // Force-push off, then on again (the acceptance flow), keeping another rule that was already off.
  let s: Record<string, unknown> = { [OFF_FIELD]: ["discard"] };
  s = { ...s, ...switchRule(s, "force-push", false) };
  expect(s[OFF_FIELD]).toEqual(["discard", "force-push"]);
  expect([ruleOn(s, "force-push"), ruleOn(s, "discard"), ruleOn(s, "stripe")]).toEqual([false, false, true]);
  s = { ...s, ...switchRule(s, "force-push", true) };
  expect(s[OFF_FIELD]).toEqual(["discard"]);
  // Switching the same rule off twice never lists it twice; an id this page does not draw is kept.
  expect(switchRule({ [OFF_FIELD]: ["custom-1", "stripe"] }, "stripe", false)[OFF_FIELD]).toEqual(["custom-1", "stripe"]);
  expect(switchRule({ [OFF_FIELD]: ["custom-1"] }, "stripe", true)[OFF_FIELD]).toEqual(["custom-1"]);
});

test("SAFE-015: a settings file that was never saved, or hand-edited badly, leaves every rule on", () => {
  expect([asksAtAll({}), asksAtAll({ [ASK_FIELD]: "no" }), asksAtAll({ [ASK_FIELD]: true }), asksAtAll({ [ASK_FIELD]: false })]).toEqual([true, true, true, false]);
  for (const bad of [undefined, null, "force-push", 7, {}, [1, null, {}]]) expect(offIds({ [OFF_FIELD]: bad }), String(bad)).toEqual([]);
  expect(offIds({ [OFF_FIELD]: ["a", 3, "b"] })).toEqual(["a", "b"]);
  expect(ruleOn({ [OFF_FIELD]: "stripe" }, "stripe")).toBe(true);
});

test("SAFE-015: after a save that failed, the page draws what is on disk, never the switch the user just flipped", async () => {
  // The rule was off on disk; the user flips it back on; the write fails.
  const disk: Record<string, unknown> = { [OFF_FIELD]: ["force-push"] };
  const failing = () => Promise.reject(new Error("settings.json is read-only"));
  const read = () => Promise.resolve({ ...disk });
  const after = await savedState(failing, read, switchRule(disk, "force-push", true));
  expect(after).toEqual({ [OFF_FIELD]: ["force-push"] });
  expect(switchOf(view(after as Record<string, unknown>), "Force-push to main")).not.toContain("checked");
  // A save that worked is read back as written; a read that fails leaves the page on its own state (null).
  const writing = (patch: Record<string, unknown>) => Promise.resolve(Object.assign(disk, patch));
  expect(await savedState(writing, read, switchRule(disk, "force-push", true))).toEqual({ [OFF_FIELD]: [] });
  expect(await savedState(writing, () => Promise.reject(new Error("gone")), switchAll(false))).toBeNull();
  // A save that throws at once, before returning a promise, is treated the same way.
  expect(await savedState(() => { throw new Error("boom"); }, read, switchAll(false))).toEqual(disk);
});

// The page itself, drawn by the runtime above over a settings file the test controls.
async function mountPage() {
  let out!: ReactElement;
  const draw = () => {
    do {
      h.dirty = false;
      h.i = 0;
      h.e = 0;
      h.queue = [];
      out = SafetyPage() as ReactElement;
      for (const run of h.queue) run();
    } while (h.dirty);
  };
  const settle = async () => {
    for (let n = 0; n < 8; n++) {
      await new Promise((r) => setTimeout(r, 0));
      if (h.dirty) draw();
    }
  };
  draw();
  await settle();
  const html = () => renderToString(out);
  const view = () => ((out.props as { children: ReactElement[] }).children[0].props as { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => Promise<unknown> });
  return { html, view, draw, settle };
}

beforeEach(() => {
  h.slots = [];
  h.effects = [];
  store.file = {};
  store.failSave = false;
  store.rules = RULES;
});

test("SAFE-015 FIX-2: the page draws the saved settings, and after a save that failed no switch shows a state that is not on disk, not even while the next save is still running", async () => {
  store.file = { [OFF_FIELD]: ["force-push"] };
  const page = await mountPage();
  expect(switchOf(page.html(), "Ask before protected actions")).toContain("checked");
  expect(switchOf(page.html(), "Force-push to main")).not.toContain("checked");
  // The master switch is flipped off and the write is refused: the page reads the file back and says why.
  store.failSave = true;
  await page.view().save(switchAll(false));
  await page.settle();
  expect(switchOf(page.html(), "Ask before protected actions")).toContain("checked");
  expect(page.html()).toContain("settings.json is read-only");
  // The next save is slow to land. While it runs the page still draws the file as it was last read,
  // not the master switch the refused save left "off" in the settings hook.
  store.failSave = false;
  const running = page.view().save(switchRule(page.view().settings, "stripe", false));
  page.draw();
  expect(switchOf(page.html(), "Ask before protected actions"), "master switch while the next save runs").toContain("checked");
  expect(switchOf(page.html(), "Force-push to main")).not.toContain("checked");
  await running;
  await page.settle();
  // Once the new read lands the page shows the file: stripe is off, the master switch never was.
  expect(switchOf(page.html(), "Stripe changes")).not.toContain("checked");
  expect(switchOf(page.html(), "Ask before protected actions")).toContain("checked");
  expect(store.file[OFF_FIELD]).toEqual(["force-push", "stripe"]);
});
