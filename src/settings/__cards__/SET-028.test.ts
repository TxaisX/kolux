// SET-028 acceptance. Box 1 (the header names the model): src-tauri/tests/cards_17.rs set028_box1 starts a real light-tier worker through
// cli::dispatch with the fast tier given Haiku in settings, takes the start notice's extra and builds the pane's start line with the real
// start_line_as; `extra` and `args` are in evidence/cards-SET-028-replay.json; the real startTail/startFields carry them into the pane and the
// real TerminalPane draws its header from them (server render). MIRROR src/App.tsx:1399-1401 (agent_start_line answers `line`, the pane takes startFields(line)).
// Box 2: the real RoutingPage (shallow-react.ts, catalogue copy asserted equal to routing::providers() by cards_07.rs acct034_*).
// MIRROR: the parent that keeps `settings` after onSettings (the test variable `settings`).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import replay from "../../../evidence/cards-SET-028-replay.json";
import type { AgentInfo } from "../../launch/PlusMenu";
import { startFields, startTail } from "../../projects/startArgs";
import { routingOf, type Provider } from "../routing";
import catalogue from "./ACCT-034.catalogue.json";
import RoutingPage from "../RoutingPage";
import { find, findAll, isSelect, mount, type El } from "./shallow-react";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));

test("box 1: the worker's start line (tier light = Haiku) puts the model in the pane header", async () => {
  const { default: TerminalPane } = await import("../../terminal/TerminalPane");
  const notice = { kind: "start", path: "C:/work/app", branch: null, agent: "claude", prompt: "x", extra: replay.extra, title: null, dispatch: "dispatch-1" } as const;
  expect(startTail(notice)[2]).toEqual(["--model", "haiku"]); // the notice's extra is what the window hands to the start line
  const { args } = startFields({ args: replay.args, typed: null, program: null, env: [] }, "claude", "dispatch-1");
  const html = renderToStaticMarkup(createElement(TerminalPane as never, { agent: "claude", cwd: "C:/work/app", args, onClose: () => {} }));
  const head = html.match(/<header class="pane-head"[\s\S]*?<\/header>/)?.[0] ?? "";
  expect(head).toMatch(/<span class="word"[^>]*>Claude · haiku<\/span>/);
  // a pane started with no model names none
  const plain = renderToStaticMarkup(createElement(TerminalPane as never, { agent: "claude", cwd: "C:/work/app", args: ["--permission-mode", "auto"], onClose: () => {} }));
  expect(plain).not.toContain("·");
});

const agents: AgentInfo[] = [{ id: "claude", name: "claude", program: "claude", args: [], installed: true, path: "<bin>\claude.exe" }];
function open(start: Record<string, unknown>) {
  let settings = start;
  const props = () => ({ agents, initial: catalogue as Provider[], settings, onSettings: (next: Record<string, unknown>) => void (settings = next) });
  const page = mount(RoutingPage, props());
  return { render: () => page.render(props()), settings: () => settings };
}
const selects = (tree: El, label: string) => findAll(tree, isSelect(label));
const select = (tree: El, label: string) => find(tree, isSelect(label));
const pick = (tree: El, label: string, value: string) => select(tree, label).props.onChange(value);

test("box 2: picking Haiku (no effort levels) for a tier removes that tier's effort picker; the other tiers keep theirs", () => {
  const app = open({});
  let tree = app.render();
  expect(select(tree, "Build model").props.value).toBe("sonnet");
  expect(selects(tree, "Build effort")).toHaveLength(1);
  pick(tree, "Build model", "haiku");
  tree = app.render();
  expect(select(tree, "Build model").props.value).toBe("haiku");
  expect(selects(tree, "Build effort")).toHaveLength(0);
  expect(selects(tree, "Deep effort")).toHaveLength(1);
  expect(routingOf(app.settings()).claude).toEqual({ build: { model: "haiku", effort: "" } });
});

test("rule: a new model keeps the effort while it is still offered and resets it otherwise", () => {
  const app = open({});
  let tree = app.render();
  pick(tree, "Build model", "opus");
  tree = app.render();
  expect(select(tree, "Build effort").props.value).toBe("medium");
  pick(tree, "Build model", "haiku");
  tree = app.render();
  pick(tree, "Build model", "sonnet");
  tree = app.render();
  expect(select(tree, "Build effort").props.value).toBe("");
});
