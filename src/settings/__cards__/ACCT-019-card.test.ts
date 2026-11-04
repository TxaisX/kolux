// ACCT-019 acceptance, the card half: a managed Codex account whose sign-in is gone (or was rejected)
// is not "Connected", and its one fix re-signs that account instead of adding a second one.
// MIRROR CodexCard.tsx act() (`again` -> codex_account_sign_in with that id).
import { expect, test, vi } from "vitest";
import CodexCard, { CodexCardView, type CodexView } from "../CodexCard";
import { find, findAll, mount, textOf, type El } from "./shallow-react";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));
const h = vi.hoisted(() => ({ calls: [] as [string, unknown][], open: [] as (() => void)[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    h.calls.push([cmd, args]);
    return new Promise<void>((done) => h.open.push(done));
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

const off: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const kim = { id: "c1", email: "kim@example.com", home: "<codex-home>", lastSignIn: 1, signInError: false };
const settle = () => new Promise((r) => setTimeout(r, 5));
const card = (tree: El) => CodexCardView(find(tree, (e) => e.type === CodexCardView).props as never) as unknown as El;
const button = (tree: El, label: string) => findAll(card(tree), (e) => e.type === "button" && textOf(e) === label)[0];

test("ACCT-019: a gone sign-in shows needs-signin, and Sign in again re-signs that account", async () => {
  h.calls.length = h.open.length = 0;
  const gone: CodexView = { ...off, accounts: [kim], active: "c1", missing: ["c1"] };
  const page = mount(CodexCard, {}, { 0: gone });
  const tree = page.render();
  expect(card(tree).props["data-state"]).toBe("needs-signin");
  expect(textOf(card(tree))).toContain("Needs sign-in");
  expect(textOf(card(tree))).toContain("Sign in again");
  expect(textOf(card(tree))).not.toContain("Connected");
  button(tree, "Sign in again").props.onClick();
  expect(h.calls).toEqual([["codex_account_sign_in", { device: false, again: "c1" }]]);
  h.open.forEach((done) => done());
  await settle();
});
