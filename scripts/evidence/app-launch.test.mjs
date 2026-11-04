// T-763 (DT-C199): the IPC guard every prove harness arms. Runs its page script against a fake fetch.
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { IPC_BLOCK, IPC_GUARD_JS } from "./app-launch.mjs";

function page() {
  const passed = [];
  const window = { fetch: async (input) => (passed.push(typeof input === "string" ? input : input.url), new Response("real")) };
  const armed = runInNewContext(IPC_GUARD_JS, { window, Response, Promise, decodeURIComponent, String, RegExp });
  return { window, passed, armed };
}
const ipc = (cmd) => `http://ipc.localhost/${encodeURIComponent(cmd)}`;

test("arming returns true and starts an empty call log", () => {
  const p = page();
  expect(p.armed).toBe(true);
  expect(p.window.__v10calls).toEqual([]);
});

test.each(["keybindings_write", "keybindings_reload", "keybindings_show", "open_external", "app_restart", "plugin:opener|open_url", "plugin:shell|open", "plugin:process|restart"])(
  "%s is answered by the guard and never reaches the backend",
  async (cmd) => {
    const p = page();
    const res = await p.window.fetch(ipc(cmd), { body: '{"x":1}' });
    expect(p.passed).toEqual([]);
    expect(res.headers.get("Tauri-Response")).toBe("ok");
    expect(await res.text()).toBe("null");
    expect(p.window.__v10calls).toEqual([`${cmd} {"x":1} [BLOCKED]`]);
  },
);

test("the probe and ordinary commands pass through and are logged; event and log plugins are not logged", async () => {
  const p = page();
  for (const cmd of ["v8_probe", "settings_read", "plugin:event|listen", "plugin:log|log"]) await p.window.fetch(ipc(cmd));
  await p.window.fetch("https://example.com/x");
  expect(p.passed).toHaveLength(5);
  expect(p.window.__v10calls).toEqual(["v8_probe", "settings_read"]);
});

test("the block list does not catch look-alike reads", () => {
  for (const cmd of ["keybindings_read", "open_externally_hint", "settings_write"]) expect(IPC_BLOCK.test(cmd)).toBe(false);
});
