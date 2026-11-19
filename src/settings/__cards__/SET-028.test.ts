// SET-028 acceptance. Box 1 (the header names the model): src-tauri/tests/cards_17.rs set028_box1 starts a real light-tier worker through
// cli::dispatch with the fast tier given Haiku in settings, takes the start notice's extra and builds the pane's start line with the real
// start_line_as; `extra` and `args` are in evidence/cards-SET-028-replay.json; the real startTail/startFields carry them into the pane and the
// real TerminalPane draws its header from them (server render). MIRROR src/App.tsx:1399-1401 (agent_start_line answers `line`, the pane takes startFields(line)).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import replay from "../../../evidence/cards-SET-028-replay.json";
import { startFields, startTail } from "../../projects/startArgs";

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
