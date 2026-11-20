// SET-028 acceptance. Box 1 (the header names the model): a light-tier worker's start line (the fast tier given Haiku in settings), as
// recorded in evidence/cards-SET-028-replay.json (`extra` and `args`); the real startFields carries the line into the pane and the
// real TerminalPane draws its header from it (server render). MIRROR src/App.tsx:1399-1401 (agent_start_line answers `line`, the pane takes startFields(line)).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import replay from "../../../evidence/cards-SET-028-replay.json";
import { startFields } from "../../projects/startArgs";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));

test("box 1: the worker's start line (tier light = Haiku) puts the model in the pane header", async () => {
  const { default: TerminalPane } = await import("../../terminal/TerminalPane");
  expect(replay.extra).toEqual(["--model", "haiku"]); // the extra the start line was built with
  const { args } = startFields({ args: replay.args, typed: null, program: null, env: [] }, "claude");
  const html = renderToStaticMarkup(createElement(TerminalPane as never, { agent: "claude", cwd: "C:/work/app", args, onClose: () => {} }));
  const head = html.match(/<header class="pane-head"[\s\S]*?<\/header>/)?.[0] ?? "";
  expect(head).toMatch(/<span class="word"[^>]*>Claude · haiku<\/span>/);
  // a pane started with no model names none
  const plain = renderToStaticMarkup(createElement(TerminalPane as never, { agent: "claude", cwd: "C:/work/app", args: ["--permission-mode", "auto"], onClose: () => {} }));
  expect(plain).not.toContain("·");
});
