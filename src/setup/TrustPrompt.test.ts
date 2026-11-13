// @vitest-environment happy-dom
// The prompt's dialog is the shared Ask (a src/ui AlertDialog), so the tests that draw it open it on a real DOM.
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { installDom, mount, settle } from "../tasks/realDom";
import TrustPrompt, { TRUST_MEMORY } from "./TrustDialog";
import { answerFirst, askTrust, hostMounted, otherDialog, trusted, trustedSetup, trustWords, waiting, type TrustAnswer, type TrustAsk } from "./TrustPrompt";
import { issueCommand } from "./IssueCommand";

const ASK: TrustAsk = { kind: "setup", script: "pnpm install\necho <done>", changed: false, project: "web" };

/** A fake Rust: `need` is what script_trust_needed says; every call is recorded. */
function rust(need: TrustAsk | null) {
  const calls: [string, Record<string, unknown>][] = [];
  const invoke = async <T,>(cmd: string, args: Record<string, unknown>): Promise<T> => {
    calls.push([cmd, args]);
    if (cmd === "script_trust_needed") return need as T;
    if (cmd === "workspace_setup") return { program: "sh", args: ["-c", "pnpm install"], script: "pnpm install" } as T;
    if (cmd === "workspace_issue_command") return { line: { program: "sh", args: [], script: "x" }, shared: true, command: "x" } as T;
    return null as T;
  };
  return { calls, invoke, names: () => calls.map(([c]) => c) };
}
const answer = (a: TrustAnswer) => async () => a;

afterEach(() => {
  hostMounted(false);
  hostMounted(false);
});

describe("49-ux2 the trust prompt says what is remembered", () => {
  it("shows the memory line beside Run hooks and Don't run", async () => {
    installDom();
    const m = await mount(createElement(TrustPrompt));
    void askTrust({ kind: "setup", script: "pnpm i", changed: false, project: "p" });
    await settle();
    expect(document.body.textContent).toContain(TRUST_MEMORY);
    await act(async () => answerFirst("skip"));
    await m.unmount();
  });
});

describe("SAFE-025 / STAT-056 the trust prompt", () => {
  it("with no prompt mounted, nothing is approved and nothing waits", async () => {
    expect(await askTrust(ASK)).toBe("skip");
    expect(waiting()).toBe(0);
  });

  it("prompts wait in line and show one at a time; a later prompt still shows after a Don't run", async () => {
    hostMounted(true);
    const first = askTrust(ASK);
    const second = askTrust({ ...ASK, kind: "issue", script: "work {{issue}}" });
    expect(waiting()).toBe(2);
    answerFirst("skip");
    expect(await first).toBe("skip");
    expect(waiting()).toBe(1);
    answerFirst("always");
    expect(await second).toBe("always");
    expect(waiting()).toBe(0);
  });

  it("closing the last prompt host counts as Don't run for every waiting prompt", async () => {
    hostMounted(true);
    const a = askTrust(ASK);
    const b = askTrust(ASK);
    hostMounted(false);
    expect([await a, await b]).toEqual(["skip", "skip"]);
  });

  it("Don't run skips the setup script: no trust saved, workspace_setup never asked", async () => {
    const r = rust(ASK);
    expect(await trustedSetup("C:/w/one", {}, r.invoke, answer("skip"))).toBeNull();
    expect(r.names()).toEqual(["script_trust_needed"]);
    expect(r.calls[0][1]).toEqual({ path: "C:/w/one", kind: "setup", local: null, policy: null });
  });

  it("Run hooks saves trust for exactly the text shown, then runs; always-trust saves the whole repository", async () => {
    const once = rust(ASK);
    expect((await trustedSetup("C:/w/one", { local: null, policy: "yaml" }, once.invoke, answer("once")))?.script).toBe("pnpm install");
    expect(once.calls).toEqual([
      ["script_trust_needed", { path: "C:/w/one", kind: "setup", local: null, policy: "yaml" }],
      ["script_trust_grant", { path: "C:/w/one", kind: "setup", script: ASK.script, always: false, root: null }],
      ["workspace_setup", { path: "C:/w/one", local: null, policy: "yaml" }],
    ]);
    const all = rust(ASK);
    await trustedSetup("C:/w/one", {}, all.invoke, answer("always"));
    expect(all.calls[1][1].always).toBe(true);
  });

  it("a trusted or the user's own script never asks", async () => {
    const r = rust(null);
    let asked = false;
    expect(await trusted("C:/w/one", "setup", {}, r.invoke, async () => ((asked = true), "skip"))).toBe(true);
    expect(asked).toBe(false);
    expect(r.names()).toEqual(["script_trust_needed"]);
  });

  it("the issue command asks with the repository's main folder and is skipped on Don't run", async () => {
    const r = rust({ ...ASK, kind: "issue", script: "work {{issue}}" });
    expect(await issueCommand("C:/repo", "C:/w/one", { kind: "issue", number: 4, title: "t", url: "u" }, r.invoke, answer("skip"))).toBeNull();
    expect(r.calls).toEqual([["script_trust_needed", { path: "C:/w/one", kind: "issue", root: "C:/repo" }]]);
    const ok = rust({ ...ASK, kind: "issue", script: "work {{issue}}" });
    expect(await issueCommand("C:/repo", "C:/w/one", { kind: "issue", number: 4, title: "t", url: "u" }, ok.invoke, answer("once"))).not.toBeNull();
    expect(ok.calls[1]).toEqual(["script_trust_grant", { path: "C:/w/one", kind: "issue", script: "work {{issue}}", always: false, root: "C:/repo" }]);
  });

  it("is worded for a changed script when one approved earlier changed", () => {
    expect(trustWords(ASK).title).toBe("Run web's setup script?");
    const changed = trustWords({ ...ASK, changed: true, kind: "issue" });
    expect(changed.title).toBe("Run the changed issue command?");
    expect(changed.lead).toContain("changed since you trusted it");
  });

  it("shows exactly the script that would run, the always-trust box, and Don't run / Run hooks", async () => {
    installDom();
    const m = await mount(createElement(TrustPrompt));
    const answered = askTrust(ASK);
    await settle();
    const box = document.querySelector('[role="alertdialog"]')!;
    expect(box, "the prompt is up").not.toBeNull();
    expect(box.querySelector("pre")!.textContent).toBe("pnpm install\necho <done>");
    expect(box.textContent).toContain("Always trust this repository's kolux.yaml");
    expect([...box.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Don't run", "Run hooks"]);
    expect(box.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    // SAFE-025: it sits above the dialog it was raised from, through classes of its own (its box is in a portal).
    expect(box.classList.contains("trust-ask")).toBe(true);
    expect(box.closest(".ask-backdrop")!.classList.contains("trust-layer")).toBe(true);
    // Its own box arriving on the page is not another dialog: the prompt stays up, unanswered.
    expect(waiting()).toBe(1);
    await act(async () => answerFirst("skip"));
    expect(await answered).toBe("skip");
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await m.unmount();
  });

  it("a dialog opened over the prompt counts as Don't run", async () => {
    installDom();
    const m = await mount(createElement(TrustPrompt));
    const answered = askTrust(ASK);
    await settle();
    expect(waiting()).toBe(1);
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    await act(async () => void document.body.appendChild(other));
    expect(await answered).toBe("skip");
    await m.unmount();
  });

  it("only a dialog opened over the prompt counts as replacing it, not the prompt's own or a non-element", () => {
    const el = (dialog: boolean, inside: unknown[] = []) => ({ matches: () => dialog, querySelectorAll: () => inside, contains: (n: unknown) => inside.includes(n) });
    const own = el(true);
    const mine = el(false, [own]);
    const text = { nodeType: 3 };
    expect(otherDialog([own, text] as unknown as Node[], mine as unknown as Element)).toBe(false);
    expect(otherDialog([el(false)] as unknown as Node[], mine as unknown as Element)).toBe(false);
    expect(otherDialog([el(true)] as unknown as Node[], mine as unknown as Element)).toBe(true);
    expect(otherDialog([el(false, [{}])] as unknown as Node[], mine as unknown as Element)).toBe(true);
    // a layer that holds only the prompt's own box (its portal) is not another dialog
    expect(otherDialog([el(false, [mine])] as unknown as Node[], mine as unknown as Element)).toBe(false);
  });
});
