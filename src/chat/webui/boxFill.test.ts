// The Open WebUI screen's message box (2026-11-24): a suggestion chip fills the box and sends nothing, the
// model select is gone from the box, and the screen's own picker (the effort picker) sits in it.
// The real Composer runs with its state kept by shallow-react.ts; Tauri's webview and invoke have stand-ins.
import { expect, test, vi } from "vitest";
import type { ComposerHandle } from "../MessageBox";

const handle: { current: ComposerHandle | null } = { current: null };
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => Promise.reject(new Error("no backend in this test")) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>()) as Record<string, unknown>;
  return {
    ...patched,
    useImperativeHandle: (_ref: unknown, make: () => ComposerHandle) => {
      handle.current = make();
    },
    useLayoutEffect: () => {},
  };
});

import { Composer } from "../MessageBox";
import { ModelControls } from "../ModelControls";
import { CHAT_AGENT } from "../opencode";
import { find, findAll, mount } from "../../settings/__cards__/shallow-react";

type BoxProps = { paneKey: number; live: boolean; agent: string; shownModel: string | null; onSend: (text: string) => boolean; tools?: unknown };
const Box = (Composer as unknown as { render: (props: BoxProps) => never }).render;

const sent: string[] = [];
const props = (extra: Partial<BoxProps> = {}): BoxProps => ({ paneKey: 7, live: true, agent: CHAT_AGENT, shownModel: "openrouter/anthropic/claude-opus-5.5", onSend: (t) => (sent.push(t), true), ...extra });
const field = (tree: unknown) => find(tree, (e) => e.type === "textarea");

test("fill puts the text in the box and sends nothing", () => {
  sent.length = 0;
  const m = mount(Box, props());
  expect(field(m.render()).props.value).toBe("");
  handle.current!.fill("Explain what this project does, in plain words.");
  expect(field(m.render()).props.value, "the chip's text is in the box").toBe("Explain what this project does, in plain words.");
  expect(sent, "a chip does not send").toEqual([]);
});

test("a chat on OpenCode has no model select in the box, and shows the screen's own tools", () => {
  const tools = { type: "span", props: { className: "probe" }, key: null };
  const m = mount(Box, props({ tools }));
  const tree = m.render();
  expect(findAll(tree, (e) => e.type === ModelControls)).toHaveLength(0);
  expect(findAll(tree, (e) => e.props?.className === "probe")).toHaveLength(1);
});
