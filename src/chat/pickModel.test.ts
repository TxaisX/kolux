// C07-R1-01: choosing "Agent default" in the model list sends the agent's own reset command through onSend
// (`/model default`), and a send that does not go through keeps the pick and says so instead of silently
// reverting to the model the agent showed. The real Composer runs with its state kept by shallow-react.ts;
// Tauri's webview and invoke have stand-ins.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => Promise.reject(new Error("no backend in this test")) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("react", async (orig) => {
  const patched = (await import("../settings/__cards__/shallow-react")).patchReact(await orig<object>()) as Record<string, unknown>;
  return { ...patched, useImperativeHandle: () => {}, useLayoutEffect: () => {} };
});

import { Composer } from "./MessageBox";
import { ModelControls } from "./ModelControls";
import { MODEL_NOT_SENT, type Change } from "./controls";
import { find, mount, textOf } from "../settings/__cards__/shallow-react";

type BoxProps = { paneKey: number; live: boolean; agent: string; shownModel: string | null; onSend: (text: string) => boolean };
const Box = (Composer as unknown as { render: (props: BoxProps) => never }).render;

const props = (onSend: (text: string) => boolean): BoxProps => ({ paneKey: 1, live: true, agent: "claude", shownModel: "opus", onSend });
const model = (tree: unknown) => find(tree, (e) => e.type === ModelControls);

test("choosing Agent default sends /model default", () => {
  const sent: string[] = [];
  const m = mount(Box, props((text) => (sent.push(text), true)));
  (model(m.render()).props.onModel as (id: string) => void)("default");
  expect(sent).toEqual(["/model default"]);
  const changes = model(m.render()).props.changes as Change[];
  expect(changes.map((c) => [c.what, c.value, c.status])).toEqual([["model", "default", "sent"]]);
});

test("a default pick that was not sent keeps the pick and says why", () => {
  const sent: string[] = [];
  const m = mount(Box, props((text) => (sent.push(text), false)));
  (model(m.render()).props.onModel as (id: string) => void)("default");
  expect(sent).toEqual(["/model default"]);
  // The control, from the state the pick left behind: still Agent default, with the note under it.
  const shown = ModelControls(model(m.render()).props as never);
  expect(find(shown, (e) => e.type === "select" && e.props["aria-label"] === "Model").props.value).toBe("default");
  expect(textOf(shown)).toContain(MODEL_NOT_SENT);
});
