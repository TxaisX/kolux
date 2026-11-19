// ACCT-001 acceptance. ConnectGrid itself is called (its state kept by shallow-react.ts); the agent
// list its effect would fetch is seeded into its first state slot, so which card sits in which slot is
// decided by the real ConnectGrid and stageOf. MIRROR ConnectGrid.tsx useState order: agents 0, installs 1, can 2.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { AgentInfo } from "../../launch/PlusMenu";
import type { KeyStatus } from "../claudeKey";
import { ConnectGrid, CONNECT, type ConnectId } from "../ConnectGrid";
import { ClaudeCardView } from "../SettingsPage";
import { findAll, mount, textOf } from "./shallow-react";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));

const mk = (id: string, installed: boolean): AgentInfo => ({ id, name: id, program: id, args: [], installed, path: installed ? `<bin>\${id}.exe` : null });
const onlyClaude = [mk("claude", true), mk("codex", false), mk("aider", true)];
const connected: KeyStatus = { connected: true, createdAt: 1, expiresAt: 2, daysLeft: 300, renewDue: false, expired: false, settingUp: false, inBrowser: false, attention: null };
const noop = () => {};
const cards = (): Record<ConnectId, ReturnType<typeof createElement>> => ({
  claude: createElement(ClaudeCardView, { status: connected, busy: false, onAction: noop }),
  codex: createElement("p", null, "CODEX-OWN-CARD"),
});
const slots = (tree: unknown) =>
  findAll(tree, (e) => typeof e.props["data-section"] === "string").map((e) => ({ id: String(e.props["data-section"]).replace("connect-", ""), child: e.props.children }));

test("box 1: only Claude installed gives two cards, Claude's own card in its state, Codex offering Install", () => {
  const tree = mount(ConnectGrid, { cards: cards() }, { 0: onlyClaude, 2: { codex: true } }).render();
  const got = slots(tree);
  expect(got.map((s) => s.id)).toEqual(CONNECT.map((c) => c.id));
  expect(got).toHaveLength(2);
  const html = Object.fromEntries(got.map((s) => [s.id, renderToString(s.child)]));
  expect(html.claude).toContain('data-state="connected"');
  expect(html.claude).toContain('aria-label="Claude"');
  expect(html.claude).not.toContain("Install");
  for (const id of ["codex"]) {
    expect(html[id]).toContain('data-state="not-installed"');
    expect(html[id]).toContain("Not installed");
    expect(html[id]).toContain(">Install<");
    expect(html[id]).not.toContain("OWN-CARD");
  }
  expect(textOf(tree)).not.toContain("OWN-CARD");
});

test("box 2: until detection answers every card is a loading placeholder with no install offer; once it answers they change", () => {
  const page = mount(ConnectGrid, { cards: cards() });
  const waiting = slots(page.render());
  expect(waiting).toHaveLength(2);
  for (const s of waiting) {
    const h = renderToString(s.child);
    expect(h).toContain('data-state="loading"');
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain("Checking this PC");
    expect(h).not.toContain("Install");
    expect(h).not.toContain("not on this PC");
    expect(h).not.toContain("OWN-CARD");
  }
  // The same grid, once the list is known, has left the placeholder.
  const answered = slots(mount(ConnectGrid, { cards: cards() }, { 0: onlyClaude }).render());
  expect(answered.map((s) => renderToString(s.child)).some((h) => h.includes('data-state="loading"'))).toBe(false);
});
