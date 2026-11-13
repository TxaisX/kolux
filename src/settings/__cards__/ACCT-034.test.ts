// ACCT-034 acceptance. The real RoutingPage is called (its tab choice kept by shallow-react.ts) with the
// provider catalogue hand-copied into ACCT-034.catalogue.json; cards_07.rs acct034_* asserts that copy
// equals routing::providers() and proves the tier ladders and route() before and after a reset.
// MIRROR: the parent that keeps `settings` after onSettings (the test variable `settings`).
import { expect, test, vi } from "vitest";
import type { AgentInfo } from "../../launch/PlusMenu";
import RoutingPage from "../RoutingPage";
import { routingOf, type Provider } from "../routing";
import catalogue from "./ACCT-034.catalogue.json";
import { find, findAll, isSelect, mount, textOf, type El } from "./shallow-react";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));

const mk = (id: string, installed: boolean): AgentInfo => ({ id, name: id, program: id, args: [], installed, path: installed ? `<bin>\\${id}.exe` : null });
const agents = [mk("claude", true), mk("codex", false)];
const initial = catalogue as Provider[];

/** A page plus the settings object its parent would keep. */
function open(start: Record<string, unknown>) {
  let settings = start;
  const props = () => ({ agents, initial, settings, onSettings: (next: Record<string, unknown>) => void (settings = next) });
  const page = mount(RoutingPage, props());
  return { render: () => page.render(props()), settings: () => settings };
}
const select = (tree: El, label: string) => find(tree, isSelect(label));
const pick = (tree: El, label: string, value: string) => select(tree, label).props.onChange(value);
// The provider tabs are a src/ui tab set: a Tab says whether it is open with `selected`, and a pick goes through the
// set's onValue (Base UI's, once read; the keys are proved on a real DOM in RoutingPage.keys.test.ts).
const tab = (tree: El, name: string) => find(tree, (e) => typeof e.props.selected === "boolean" && typeof e.props.value === "string" && textOf(e).startsWith(name));
const pickTab = (tree: El, name: string) => find(tree, (e) => typeof e.props.onValue === "function").props.onValue(tab(tree, name).props.value);

test("box 1: Claude Build set to Opus at high, then Reset Claude puts Build back to Sonnet at medium and leaves Codex alone", () => {
  const codexPick = { build: { model: "gpt-5.5", effort: "low" } };
  const app = open({ modelRouting: { codex: codexPick }, theme: "dark" });
  let tree = app.render();
  expect(tab(tree, "Claude Code").props.selected).toBe(true);
  expect(select(tree, "Build model").props.value).toBe("sonnet");
  expect(select(tree, "Build effort").props.value).toBe("medium");
  expect(find(tree, (e) => e.type === "button" && textOf(e) === "Reset Claude Code").props.disabled).toBe(true);
  pick(tree, "Build model", "opus");
  tree = app.render();
  expect(select(tree, "Build model").props.value).toBe("opus");
  pick(tree, "Build effort", "high");
  tree = app.render();
  expect(select(tree, "Build model").props.value).toBe("opus");
  expect(select(tree, "Build effort").props.value).toBe("high");
  expect(routingOf(app.settings()).claude).toEqual({ build: { model: "opus", effort: "high" } });
  const reset = find(tree, (e) => e.type === "button" && textOf(e) === "Reset Claude Code");
  expect(reset.props.disabled).toBe(false);
  reset.props.onClick();
  tree = app.render();
  expect(select(tree, "Build model").props.value).toBe("sonnet");
  expect(select(tree, "Build effort").props.value).toBe("medium");
  expect(find(tree, (e) => e.type === "button" && textOf(e) === "Reset Claude Code").props.disabled).toBe(true);
  // Codex is unchanged: in the saved settings, and on its own tab.
  expect(routingOf(app.settings()).codex).toEqual(codexPick);
  expect(app.settings().theme).toBe("dark");
  pickTab(tree, "Codex");
  tree = app.render();
  expect(select(tree, "Build model").props.value).toBe("gpt-5.5");
  expect(select(tree, "Build effort").props.value).toBe("low");
});

test("box 2: without Codex the Codex tab shows Not detected, can still be selected, and then lists its tiers", () => {
  const tree0 = open({}).render();
  expect(textOf(tab(tree0, "Codex"))).toContain("Not detected");
  expect(textOf(tab(tree0, "Claude Code"))).not.toContain("Not detected");
  expect(tab(tree0, "Codex").props.disabled).toBeFalsy();
  expect(findAll(tree0, (e) => e.props.className === "routing-missing")).toHaveLength(1);
  const app = open({});
  let tree = app.render();
  pickTab(tree, "Codex");
  tree = app.render();
  expect(tab(tree, "Codex").props.selected).toBe(true);
  expect(tab(tree, "Claude Code").props.selected).toBe(false);
  expect(select(tree, "Build model").props.value).toBe("gpt-6-sol");
  expect(select(tree, "Major model")).toBeDefined();
  expect(textOf(tab(tree, "Codex"))).toContain("Not detected");
});
