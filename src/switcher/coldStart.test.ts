// C17-R5-01: the top-bar pill must not claim "Connect an AI" before the first accounts read answers
// (a launch would flash it at a user who has accounts), and a first read that fails must say so and
// offer a retry rather than claiming there is no account.
import { act, createElement } from "react";
import { expect, test, vi } from "vitest";
import { find, installDom, mount, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({
  fail: false as boolean | string,
  hold: false,
  waiting: [] as Array<() => void>,
  on: [] as Array<() => void>,
  claude: { accounts: [{ id: "c1", email: "work@example.com", organization: null, stale: false }], active: "c1", signingIn: null, keyMode: false, upkeepLeftToClaude: true },
  codex: { accounts: [{ id: "x1", email: "a@example.com", signInError: false }], active: null, signingIn: null, missing: [] },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (h.hold) await new Promise<void>((r) => h.waiting.push(r));
    if (h.fail === true || h.fail === cmd) throw "the accounts store is locked";
    return cmd === "claude_accounts" ? h.claude : h.codex;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (_: string, fn: () => void) => (h.on.push(fn), Promise.resolve(() => {})) }));

test("C17-R5-01: nothing is loaded before the first read answers; a failed first read is an error with a retry", async () => {
  const { doc } = installDom();
  const { useAccountSwitcher } = await import("./AccountSwitcher");
  function Probe() {
    const { groups, stale, loaded } = useAccountSwitcher();
    return createElement("i", { "data-n": groups.length, "data-stale": String(stale), "data-loaded": String(loaded) });
  }
  h.hold = true;
  const m = await mount(createElement(Probe), doc);
  const probe = () => find(m.container, (n) => n.localName === "i")[0].attrs;
  await until(() => h.waiting.length === 2, "both reads started");
  expect(probe()["data-loaded"], "no read has answered yet").toBe("false");
  expect(probe()["data-n"]).toBe("0");

  // The first read fails: still not loaded, marked stale, so the pill offers a retry.
  h.fail = true;
  h.hold = false;
  h.waiting.splice(0).forEach((r) => r());
  await until(() => probe()["data-stale"] === "true", "the failed first read");
  expect(probe()["data-loaded"]).toBe("false");

  // The retry answers: the lists load and the pill becomes the switcher.
  h.fail = false;
  await act(async () => h.on[0]());
  await until(() => probe()["data-loaded"] === "true", "the retry");
  expect(probe()["data-stale"]).toBe("false");
  expect(probe()["data-n"]).toBe("2");
  await m.unmount();
});
