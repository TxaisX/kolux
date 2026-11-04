import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RepoSetupView } from "./RepoSetup";
import { SETUP_POLICY_KEY, choiceOptions, choiceSave, effectiveChoice, globalChoice, globalOptions, hasSetup, runsNote, scriptSave, trustNote, type RepoSetup } from "./setupChoice";
import { SetupPolicyView } from "./SetupPolicyRow";

const base: RepoSetup = { local: null, shared: null, sharedError: null, policy: null, inherited: "local", wait: false, suggestBoth: false, runError: null };

test("FIX-1: the setup probes ask the page's read, not the runner: a setup counts when the choice in force would run it", () => {
  expect(hasSetup(base)).toBe(false);
  expect(hasSetup({ ...base, local: "make" })).toBe(true);
  expect(hasSetup({ ...base, shared: "pnpm i" })).toBe(true);
  expect(hasSetup({ ...base, local: "make", shared: "pnpm i", policy: "both" }), "a saved setup next to kolux.yaml under both is still a setup").toBe(true);
  expect(hasSetup({ ...base, local: "make", policy: "shared" }), "kolux.yaml only, and it has none").toBe(false);
  expect(hasSetup({ ...base, local: "make", shared: "pnpm i", policy: "shared" })).toBe(true);
  expect(hasSetup({ ...base, local: "make", inherited: "shared" }), "the inherited choice counts").toBe(false);
  expect(hasSetup({ ...base, sharedError: "kolux.yaml could not be read: x" }), "an unreadable kolux.yaml is there to be chosen").toBe(true);
  expect(hasSetup({ ...base, local: "make", shared: "pnpm i", policy: "both", runError: "refused" }), "refused on this PC still has a setup").toBe(true);
});

test("FIX-1: a choice that would be refused here says so next to Which runs, and the page does not claim it runs", () => {
  const refused: RepoSetup = { ...base, local: "make\nmake test", shared: "pnpm i", policy: "both", runError: "The setup script was not run: it would go through cmd." };
  const html = view(refused);
  expect(html).toContain('data-run-error="true"');
  expect(html).toContain("The setup script was not run: it would go through cmd.");
  expect(html.indexOf("Which setup script runs")).toBeLessThan(html.indexOf("data-run-error"));
  expect(runsNote(refused)).toBe("Nothing runs until that is fixed.");
  expect(trustNote(refused)).toBe("");
  expect(view({ ...refused, runError: null })).not.toContain("data-run-error");
  expect(runsNote({ ...refused, runError: null })).toBe("Runs your saved setup, then the setup script from kolux.yaml.");
});

test("FIX-1: the shown kolux.yaml is labelled as the main folder's copy, which a branch can change", () => {
  const html = view({ ...base, shared: "pnpm i" });
  expect(html).toContain("That is the setup script in kolux.yaml in the main folder of this repository.");
  expect(html).toContain("A branch can change it, and you are asked again if it does.");
});

test("SET-033: a script draft is saved only when it changed, and an emptied one is not a save", () => {
  expect(scriptSave(null, "")).toEqual({ kind: "none" });
  expect(scriptSave(null, "  \n")).toEqual({ kind: "none" });
  expect(scriptSave("pnpm i", "pnpm i\n")).toEqual({ kind: "none" });
  expect(scriptSave("make\nmake test", "make\r\nmake test")).toEqual({ kind: "none" });
  expect(scriptSave(null, " pnpm i \n")).toEqual({ kind: "save", script: "pnpm i" });
  expect(scriptSave("pnpm i", "pnpm ci")).toEqual({ kind: "save", script: "pnpm ci" });
  // emptying a saved script is what Remove is for: it says so instead of writing nothing silently
  expect(scriptSave("pnpm i", "  ")).toEqual({ kind: "empty" });
});

test("SET-033: the run choice shows what it inherits and saves only a change", () => {
  expect(effectiveChoice(base)).toBe("local");
  expect(effectiveChoice({ ...base, inherited: "shared" })).toBe("shared");
  expect(effectiveChoice({ ...base, inherited: "shared", policy: "both" })).toBe("both");
  const o = choiceOptions({ ...base, inherited: "shared" });
  expect(o.map((x) => x.value)).toEqual(["", "local", "shared", "both"]);
  expect(o[0].label).toBe("Same as everywhere (the shared script only)");
  expect(choiceSave(base, "")).toBeNull();
  expect(choiceSave(base, "both")).toEqual({ policy: "both" });
  expect(choiceSave({ ...base, policy: "both" }, "both")).toBeNull();
  expect(choiceSave({ ...base, policy: "both" }, "")).toEqual({ policy: null });
  expect(choiceSave(base, "shared-first")).toBeNull();
});

test("SET-033: the page says which scripts run, suggests both when both exist, and says what asks first", () => {
  expect(runsNote(base)).toBe("Nothing runs: there is no setup script yet.");
  expect(runsNote({ ...base, local: "make" })).toBe("Runs your saved setup.");
  expect(runsNote({ ...base, shared: "pnpm i" })).toBe("Runs the setup script from kolux.yaml.");
  expect(runsNote({ ...base, local: "make", shared: "pnpm i" })).toBe("Runs your saved setup; kolux.yaml's setup script is not used.");
  expect(runsNote({ ...base, local: "make", shared: "pnpm i", policy: "both" })).toBe("Runs your saved setup, then the setup script from kolux.yaml.");
  expect(runsNote({ ...base, local: "make", shared: "pnpm i", policy: "shared" })).toBe("Runs the setup script from kolux.yaml only; your saved setup is not used.");
  expect(runsNote({ ...base, local: "make", policy: "shared" })).toBe("Nothing runs: the choice is kolux.yaml's setup script, and it has none.");
  expect(trustNote({ ...base, local: "make" })).toBe("Your own setup runs without asking.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i" })).toBe("Your own setup runs without asking.");
  expect(trustNote({ ...base, shared: "pnpm i" })).toBe("The script in kolux.yaml asks first, once, and again if it changes.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i", policy: "both" })).toBe("Your own setup runs without asking. The script in kolux.yaml asks first, once, and again if it changes.");
  expect(trustNote(base)).toBe("");
  expect(trustNote({ ...base, shared: "pnpm i", policy: "both" })).toBe("The script in kolux.yaml asks first, once, and again if it changes.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i", policy: "local" })).toBe("Your own setup runs without asking.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i", policy: "shared" })).toBe("The script in kolux.yaml asks first, once, and again if it changes.");
});

const none = { onSave: () => {}, onRemove: () => {}, onChoice: () => {}, onWait: () => {} };
const view = (setup: RepoSetup, notice: string | null = null) => renderToString(createElement(RepoSetupView, { setup, notice, actions: none }));

test("SET-033 / PROJ-035: the section shows the saved setup with a Remove row, the kolux.yaml script and the wait choice", () => {
  const empty = view(base);
  expect(empty).toContain("Runs in a new tab when a workspace is made.");
  expect(empty).toContain("Nothing runs: there is no setup script yet.");
  expect(empty).not.toContain("Remove");
  expect(empty).toContain('aria-label="Wait for setup"');
  expect(empty).not.toContain("checked");
  const saved = view({ ...base, local: "pnpm i", wait: true });
  expect(saved).toContain("pnpm i</textarea>");
  expect(saved).toContain("Remove");
  expect(saved).toContain("checked");
  expect(saved).toContain("Your own setup runs without asking.");
  const both = view({ ...base, local: "make", shared: "pnpm i", suggestBoth: true });
  expect(both).toContain("data-suggest=\"both\"");
  expect(both).toContain("Run both");
  expect(both).toContain("That is the setup script in kolux.yaml in the main folder of this repository");
  expect(view({ ...base, local: "make", shared: "pnpm i", policy: "both" })).not.toContain("data-suggest");
  expect(view({ ...base, local: "make", shared: "pnpm i", policy: "both" })).toContain("The script in kolux.yaml asks first");
  expect(view({ ...base, sharedError: "kolux.yaml could not be read: x" })).toContain("kolux.yaml could not be read: x");
  expect(view(base, "that failed")).toContain("that failed");
});

test("T-294-c: the global choice is read the way setup.rs reads it", () => {
  expect(globalChoice(undefined)).toBe("local");
  expect(globalChoice("  ")).toBe("local");
  expect(globalChoice("both")).toBe("both");
  expect(globalChoice("shared")).toBe("shared");
  expect(globalChoice("shared-first")).toBe("shared");
  expect(globalChoice("nonsense")).toBe("local");
});

test("T-294-c: the row offers local, shared and both, shows the saved one, and the repository's Same as everywhere names it", () => {
  expect(globalOptions().map((o) => o.value)).toEqual(["local", "shared", "both"]);
  expect(SETUP_POLICY_KEY).toBe("setupPolicy");
  const html = renderToString(createElement(SetupPolicyView, { stored: "both", onChoose: () => {} }));
  expect(html).toMatch(/<option value="both" selected="">/);
  expect(html).toContain("Which setup runs");
  expect(choiceOptions({ ...base, inherited: globalChoice("both") })[0].label).toBe("Same as everywhere (both, yours first)");
});
