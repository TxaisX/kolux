import { describe, expect, it } from "vitest";
import { accountLabel, accountPrompt, codexSetup, setupChanged, spawnRecord } from "./accountChange";
import { layoutOf, restoreLayout } from "./layout";

const accounts = [
  { id: "a1", email: "a@x.com" },
  { id: "b2", email: "b@x.com" },
  { id: "c3", email: "b@x.com" }, // ACCT-064: the same label as b2, still a different account
];
const codex = (account: string | null | undefined) => ({ agent: "codex", account });

describe("accountPrompt (ACCT-023, ACCT-064)", () => {
  it("asks a running Codex pane whose account is not the active one, by id", () => {
    expect(accountPrompt(codex("a1"), true, "b2", accounts, undefined)).toEqual({ kind: "changed", from: "a@x.com", to: "b@x.com" });
    expect(accountPrompt(codex("b2"), true, "c3", accounts, undefined)).toEqual({ kind: "changed", from: "b@x.com", to: "b@x.com" });
    // Codex's own sign-in counts as an account to move from or to.
    expect(accountPrompt(codex(null), true, "a1", accounts, undefined)).toMatchObject({ from: "Codex's own sign-in" });
    expect(accountPrompt(codex("a1"), true, null, accounts, undefined)).toMatchObject({ to: "Codex's own sign-in" });
  });
  it("leaves alone panes that are not running Codex, were never tied to an account, or sit on the active one", () => {
    expect(accountPrompt({ agent: "shell", account: "a1" }, true, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex("a1"), false, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex(undefined), true, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex("b2"), true, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex(null), true, null, accounts, undefined)).toBeNull();
  });
  it("keeping dismisses for that change only; going back to the pane's account clears it", () => {
    expect(accountPrompt(codex("a1"), true, "b2", accounts, "b2")).toBeNull();
    expect(accountPrompt(codex("a1"), true, "c3", accounts, "b2")?.kind).toBe("changed");
    expect(accountPrompt(codex("a1"), true, "a1", accounts, "b2")).toBeNull();
    expect(accountPrompt(codex("a1"), true, null, accounts, null)).toBeNull();
  });
  it("a pane whose account was removed needs a new one, kept or not", () => {
    expect(accountPrompt(codex("gone"), true, "b2", accounts, "b2")).toEqual({ kind: "removed", to: "b@x.com" });
    expect(accountPrompt(codex("gone"), true, null, accounts, undefined)).toEqual({ kind: "removed", to: null });
  });
  it("labels an account by email, else by a short id", () => {
    expect(accountLabel("a1", accounts)).toBe("a@x.com");
    expect(accountLabel("0123456789abcdef", [{ id: "0123456789abcdef", email: null }])).toBe("account 01234567");
  });
});

describe("codexSetup and setupChanged (T-139-d)", () => {
  const was = codexSetup({ agentOptions: { codex: { args: "--model m" } } });
  it("reads the command, arguments, variables and permissions; blanks and padding change nothing", () => {
    expect(codexSetup({})).toBe(codexSetup({ agentPermissions: "yolo", agentOptions: { codex: { command: "  ", args: "", env: "" } } }));
    expect(codexSetup({ agentOptions: { codex: { args: " --model m " } } })).toBe(was);
    expect(codexSetup({ agentPermissions: "manual" })).not.toBe(codexSetup({}));
    expect(codexSetup({ agentOptions: { codex: { args: "--model n" } } })).not.toBe(was);
    expect(codexSetup({ agentOptions: { claude: { args: "--model n" } } })).toBe(codexSetup({}));
  });
  it("asks a running Codex pane that started on another setup, once per change", () => {
    const now = codexSetup({ agentOptions: { codex: { args: "--model n" } } });
    expect(setupChanged({ agent: "codex", setup: was }, true, now, undefined)).toBe(true);
    expect(setupChanged({ agent: "codex", setup: was }, true, now, now)).toBe(false);
    const later = codexSetup({ agentOptions: { codex: { args: "--model o" } } });
    expect(setupChanged({ agent: "codex", setup: was }, true, later, now)).toBe(true);
    expect(setupChanged({ agent: "codex", setup: was }, true, was, now)).toBe(false);
  });
  it("leaves alone panes not running Codex, not running, or with no recorded setup", () => {
    expect(setupChanged({ agent: "claude", setup: was }, true, "x", undefined)).toBe(false);
    expect(setupChanged({ agent: "codex", setup: was }, false, "x", undefined)).toBe(false);
    expect(setupChanged({ agent: "codex" }, true, "x", undefined)).toBe(false);
  });
});

describe("a restored pane is asked again after Kolux restarts (T-139-d)", () => {
  const pane = { key: 4, cwd: "/w", branch: null, agent: "codex" as const, program: "codex", args: [], agentId: "codex", account: "a1" };
  it("carries its account through the saved layout, so the prompt comes back with the kept choice forgotten", () => {
    const saved = layoutOf([pane], {}, 4, "/w", {});
    const back = restoreLayout(JSON.parse(JSON.stringify(saved)));
    const restored = back?.panes[0];
    expect(restored?.account).toBe("a1");
    // the person had kept it on a1 while b2 was active; the kept choice lives in memory only
    expect(accountPrompt(pane, true, "b2", accounts, "b2")).toBeNull();
    expect(accountPrompt(restored!, true, "b2", accounts, undefined)).toEqual({ kind: "changed", from: "a@x.com", to: "b@x.com" });
    // an account removed while Kolux was closed is asked about too
    expect(accountPrompt({ ...restored!, account: "gone" }, true, "b2", accounts, undefined)).toEqual({ kind: "removed", to: "b@x.com" });
  });
  it("a Codex pane with no account of its own (null) comes back as null, not unknown", () => {
    const back = restoreLayout(JSON.parse(JSON.stringify(layoutOf([{ ...pane, account: null }], {}, 4, "/w", {}))));
    expect(back?.panes[0].account).toBeNull();
    expect(accountPrompt(back!.panes[0], true, "a1", accounts, undefined)).toMatchObject({ kind: "changed", from: "Codex's own sign-in" });
  });
});

// T-548-b (review C): the answer terminal_spawn gives is recorded for a Claude pane too, or every Claude pane
// stays "account unknown" and shows the active account's figures whatever it runs on.
describe("spawnRecord (ACCT-023, T-548-b)", () => {
  it("a Claude pane keeps the account the terminal answered, including Claude's own sign-in (null)", () => {
    expect(spawnRecord({ agent: "claude" }, "acct-2", "s")).toEqual({ account: "acct-2" });
    expect(spawnRecord({ agent: "claude", account: undefined }, null, "s")).toEqual({ account: null });
    expect(spawnRecord({ agent: "claude", account: "acct-1" }, "acct-2", "s")).toEqual({ account: "acct-2" });
  });
  it("records nothing when the pane already holds the answer, and never a setup for Claude", () => {
    expect(spawnRecord({ agent: "claude", account: "acct-2" }, "acct-2", "s")).toBeNull();
    expect(spawnRecord({ agent: "claude" }, "acct-2", "s")).not.toHaveProperty("setup");
  });
  it("a Codex pane still keeps its account and its setup", () => {
    expect(spawnRecord({ agent: "codex" }, "cx", "s1")).toEqual({ account: "cx", setup: "s1" });
    expect(spawnRecord({ agent: "codex", account: "cx", setup: "s1" }, "cx", "s1")).toBeNull();
    expect(spawnRecord({ agent: "codex", account: "cx", setup: "s0" }, "cx", "s1")).toEqual({ account: "cx", setup: "s1" });
  });
  it("a shell remembers nothing", () => {
    expect(spawnRecord({ agent: "shell" }, null, "s")).toBeNull();
  });
});
