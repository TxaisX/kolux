// T-156-b: the settings patches behind the Your rules section and the two pure views. The views
// are rendered to a string; the container components (which invoke) are not exercised here.
import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { addRule, globalRules, onIn, PROJECTS_FIELD, removeRule, resetAll, resetProject, RULES_FIELD, saveRule, SafetyAttemptsView, SafetyRulesView, scopeOf, scopes, switchIn, type Custom } from "./SafetyRules";

const g1: Custom = { id: "g1", name: "Pod deletes", kind: "starts-with", pattern: "kubectl delete" };
const p1: Custom = { id: "p1", name: "", kind: "regex", pattern: "^prisma migrate" };
const ROOT = "G:\\Dev\\shop";
const settings = () => ({ protectedOff: ["stripe"], [RULES_FIELD]: [g1], [PROJECTS_FIELD]: { [ROOT]: { off: ["g1", "force-push"], rules: [p1], dirs: ["G:/Dev/shop-lanes"] }, junk: null } });

test("rules and scopes read what is saved and ignore what is malformed", () => {
  expect(globalRules(settings())).toEqual([g1]);
  expect(globalRules({ [RULES_FIELD]: [{ id: 1 }, "x", { id: "ok", kind: "contains", pattern: "p" }] })).toEqual([{ id: "ok", kind: "contains", pattern: "p", name: "" }]);
  expect(Object.keys(scopes(settings()))).toEqual([ROOT, "junk"]);
  expect(scopeOf(settings(), "junk")).toEqual({ off: [], rules: [], dirs: [] });
  expect(scopeOf({ [PROJECTS_FIELD]: [] }, ROOT)).toEqual({ off: [], rules: [], dirs: [] });
});

test("adding and removing a rule patches the global list or the project's own and keeps the rest", () => {
  const s = settings();
  const g2: Custom = { id: "g2", name: "", kind: "contains", pattern: "flush all" };
  expect(addRule(s, null, g2)).toEqual({ [RULES_FIELD]: [g1, g2] });
  expect(removeRule(s, null, "g1")).toEqual({ [RULES_FIELD]: [] });
  const added = addRule(s, ROOT, g2) as Record<string, Record<string, unknown>>;
  expect(added[PROJECTS_FIELD][ROOT]).toEqual({ off: ["g1", "force-push"], rules: [p1, g2], dirs: ["G:/Dev/shop-lanes"] });
  expect(added[PROJECTS_FIELD].junk).toEqual({ off: [], rules: [], dirs: [] });
  const fresh = addRule({}, "G:/new", g2, ["G:/new-lanes"]) as Record<string, Record<string, unknown>>;
  expect(fresh[PROJECTS_FIELD]["G:/new"]).toEqual({ off: [], rules: [g2], dirs: ["G:/new-lanes"] });
  const removed = removeRule(s, ROOT, "p1") as Record<string, Record<string, unknown>>;
  expect(removed[PROJECTS_FIELD][ROOT]).toEqual({ off: ["g1", "force-push"], rules: [], dirs: ["G:/Dev/shop-lanes"] });
});

test("a rule switched off for one project is off there only, and off everywhere wins", () => {
  const s = settings();
  expect(onIn(s, ROOT, "force-push")).toBe(false);
  expect(onIn(s, ROOT, "db-drop")).toBe(true);
  expect(onIn(s, ROOT, "stripe")).toBe(false);
  expect(onIn(s, "G:/other", "force-push")).toBe(true);
  const on = switchIn(s, ROOT, "force-push", true) as Record<string, Record<string, { off: string[] }>>;
  expect(on[PROJECTS_FIELD][ROOT].off).toEqual(["g1"]);
  const off = switchIn(s, "G:/other", "db-drop", false, ["G:/other-lanes"]) as Record<string, Record<string, unknown>>;
  expect(off[PROJECTS_FIELD]["G:/other"]).toEqual({ off: ["db-drop"], rules: [], dirs: ["G:/other-lanes"] });
  expect(off[PROJECTS_FIELD][ROOT]).toBeDefined();
});

test("reset for all projects keeps the per-project scopes; reset for a project drops only its own", () => {
  expect(resetAll()).toEqual({ protectedAsk: true, protectedOff: [], [RULES_FIELD]: [] });
  const r = resetProject(settings(), ROOT) as Record<string, Record<string, unknown>>;
  expect(Object.keys(r[PROJECTS_FIELD])).toEqual(["junk"]);
});

const rules = [{ id: "force-push", name: "Force-push to main", samples: ["a", "b"] }];
const view = (scope: string | null) => renderToString(createElement(SafetyRulesView, { settings: settings(), rules, projects: [{ path: ROOT, name: "shop", displayName: "Shop" }], scope, setScope: () => {}, save: () => {}, check: async () => null }));

test("the rules view lists the scope's own rules, and the project scope shows what is off there", () => {
  const all = view(null);
  expect(all).toContain("kubectl delete");
  expect(all).not.toContain("prisma migrate");
  expect(all).not.toContain("data-project-switches");
  expect(all).toContain("Reset rules for all projects");
  const mine = view(ROOT);
  expect(mine).toContain("prisma migrate");
  expect(mine).not.toContain("kubectl delete</code>");
  expect(mine).toContain('data-rule-here="force-push"');
  expect(mine).toContain('data-rule-here="g1"');
  expect(mine).toContain("Reset this project&#x27;s rules");
});

test("the attempts view shows the masked command as given, newest first, and a disabled Clear when empty", () => {
  const empty = renderToString(createElement(SafetyAttemptsView, { attempts: [], clear: () => {} }));
  expect(empty).toContain("Nothing was paused yet.");
  expect(empty).toMatch(/data-clear[^>]*disabled/);
  const one = renderToString(createElement(SafetyAttemptsView, { attempts: [{ time: 0, worktree: "G:/w", command: "stripe refunds create --api-key sk_live_[hidden]", rule: "Stripe changes", outcome: "denied" }], clear: () => {} }));
  expect(one).toContain('data-outcome="denied"');
  expect(one).toContain("sk_live_[hidden]");
  expect(one).toContain("Stripe changes");
});

test("UX-audit: a rule whose save was refused gives a sentence (the form keeps its text); a stored one gives none", async () => {
  expect(await saveRule(async () => true, {})).toBeNull();
  expect(await saveRule(() => undefined, {})).toBeNull();
  expect(await saveRule(async () => false, {})).toContain("What you typed is kept");
});

test("UX-audit: Remove on a rule and Clear on the attempts ask first (the answer row replaces the button on the page itself)", () => {
  const html = view(ROOT);
  expect(html).toMatch(/data-reset[^>]*aria-label="Remove \^prisma migrate"[^>]*>Remove/);
  const attempts = [{ time: 0, worktree: "G:/w", command: "rm -rf x", rule: "Deletes", outcome: "denied" as const }];
  const out = renderToString(createElement(SafetyAttemptsView, { attempts, clear: () => {}, error: "The list was not cleared: busy" }));
  expect(out).toMatch(/data-reset[^>]*aria-label="Clear recent attempts"/);
  expect(out).not.toContain("data-clear>");
  expect(out).toContain("The list was not cleared: busy");
});
