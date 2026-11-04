// T-736: when the accounts fail to load, the switcher keeps the last list it had (it used to vanish)
// and says the list may be old, until a read works again.
import { act, createElement } from "react";
import { expect, test, vi } from "vitest";
import { find, installDom, mount, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({
  fail: false as boolean | string,
  on: [] as Array<() => void>,
  claude: { accounts: [{ id: "c1", email: "work@example.com", organization: null, stale: false }], active: "c1", signingIn: null, keyMode: false, upkeepLeftToClaude: true },
  codex: { accounts: [{ id: "x1", email: "a@example.com", signInError: false }], active: null, signingIn: null, missing: [] },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (h.fail === true || h.fail === cmd) throw "the accounts store is locked";
    return cmd === "claude_accounts" ? h.claude : h.codex;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (_: string, fn: () => void) => (h.on.push(fn), Promise.resolve(() => {})) }));

test("T-736: a failed accounts read keeps the last list and marks it stale; the next good read clears the mark", async () => {
  const { doc } = installDom();
  const { useAccountSwitcher } = await import("./AccountSwitcher");
  function Probe() {
    const { groups, stale } = useAccountSwitcher();
    return createElement("i", { "data-n": groups.length, "data-stale": String(stale) });
  }
  const m = await mount(createElement(Probe), doc);
  const probe = () => find(m.container, (n) => n.localName === "i")[0].attrs;
  await until(() => probe()["data-n"] === "2" && h.on.length > 0, "the first read");
  expect(probe()["data-stale"]).toBe("false");

  h.fail = true;
  await act(async () => h.on[0]());
  await until(() => probe()["data-stale"] === "true", "the failed read");
  expect(probe()["data-n"], "both providers still listed after the failed read").toBe("2");

  h.fail = false;
  await act(async () => h.on[0]());
  await until(() => probe()["data-stale"] === "false", "the next good read");
  expect(probe()["data-n"]).toBe("2");

  // Only Codex fails: Claude's new list still lands, Codex keeps its last one, and the list is marked stale.
  h.fail = "codex_accounts";
  h.claude = { ...h.claude, accounts: [] };
  await act(async () => h.on[0]());
  await until(() => probe()["data-stale"] === "true", "the Codex-only failure");
  expect(probe()["data-n"], "Claude's empty list landed; Codex kept its last one").toBe("1");
  await m.unmount();
});
