// T-763 (DT-C199): the IPC guard every prove harness arms. Runs its page script and its probe against a fake page.
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { IPC_BLOCK, IPC_GUARD_JS, guardProbeJs } from "./app-launch.mjs";

// A fake page: fetch reaches a fake backend, and invoke sends by window.fetch like Tauri's fetch IPC
// ("postMessage" = the switched-over IPC the wrapper cannot see).
function page({ ipc = "fetch" } = {}) {
  const passed = [];
  const window = { fetch: async (input) => (passed.push(typeof input === "string" ? input : input.url), new Response("real")) };
  window.__TAURI_INTERNALS__ = { invoke: (cmd) => (ipc === "fetch" ? window.fetch(url(cmd)) : Promise.reject(new Error("unknown command"))) };
  const ctx = { window, Response, Promise, decodeURIComponent, String, RegExp, setTimeout };
  const arm = () => runInNewContext(IPC_GUARD_JS, ctx);
  const probe = (name) => runInNewContext(guardProbeJs(name), ctx);
  return { window, passed, armed: arm(), arm, probe };
}
const url = (cmd) => `http://ipc.localhost/${encodeURIComponent(cmd)}`;
const BLOCKED = ["keybindings_write", "keybindings_reload", "keybindings_show", "open_external", "open_install_page", "open_notification_settings", "open_in", "open_path",
  "editor_open", "scm_open_pr", "scm_open_with", "scm_reveal", "skills_reveal", "session_reveal", "browser_download_reveal", "app_restart", "update_restart",
  "update_download", "graphics_restart_safe", "graphics_choose", "cli_register", "cli_unregister", "agents_install", "agents_install_many", "agent_install"];

test("arming returns true and starts an empty call log", () => {
  const p = page();
  expect(p.armed).toBe(true);
  expect(p.window.__v10calls).toEqual([]);
});

test.each(BLOCKED)("%s is answered by the guard and never reaches the backend", async (cmd) => {
  const p = page();
  const res = await p.window.fetch(url(cmd), { body: '{"x":1}' });
  expect(p.passed).toEqual([]);
  expect(res.headers.get("Tauri-Response")).toBe("ok");
  expect(res.headers.get("Content-Type")).toBe("application/json");
  expect(await res.text()).toBe("null");
  expect(p.window.__v10calls).toEqual([`${cmd} {"x":1} [BLOCKED]`]);
});

test("ordinary commands pass through and are logged; event and log plugins and other hosts are not logged", async () => {
  const p = page();
  for (const cmd of ["settings_read", "plugin:event|listen", "plugin:log|log"]) await p.window.fetch(url(cmd));
  await p.window.fetch("https://example.com/x");
  await p.window.fetch("http://evil-ipc.localhost.example/open_external");
  expect(p.passed).toHaveLength(5);
  expect(p.window.__v10calls).toEqual(["settings_read"]);
});

test("the block list does not catch look-alikes", () => {
  for (const cmd of ["keybindings_read", "open_externally_hint", "settings_write", "agent_installs", "agent_install_cancel", "agent_can_install", "scm_open", "session_open"])
    expect(IPC_BLOCK.test(cmd)).toBe(false);
});

test("the probe passes while calls go through the guard, and takes itself out of the log", async () => {
  const p = page();
  expect(await p.probe("v8_probe_1")).toBe(true);
  expect(p.window.__v10calls).toEqual([]);
});

test("the probe fails when IPC no longer goes by fetch (Tauri's postMessage switch)", async () => {
  expect(await page({ ipc: "postMessage" }).probe("v8_probe_1")).toBe(false);
});

test("a failed backend fetch marks the guard blind", async () => {
  const p = page();
  p.window.__v10orig = async () => {
    throw new TypeError("Failed to fetch");
  };
  p.arm();
  await expect(p.window.fetch(url("settings_read"))).rejects.toThrow("Failed to fetch");
  expect(p.window.__v10blind).toBe(true);
  expect(await p.probe("v8_probe_2")).toBe(false);
});

test("arming twice wraps the page's own fetch once", async () => {
  const p = page();
  p.arm();
  await p.window.fetch(url("open_external"));
  await p.window.fetch(url("settings_read"));
  expect(p.passed).toEqual([url("settings_read")]);
  expect(p.window.__v10calls).toEqual(["open_external  [BLOCKED]", "settings_read"]);
});
