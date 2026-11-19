// ACCT-003 acceptance, the window half. The real ConnectGrid is called with its state kept by
// shallow-react.ts; the process half (progress lines, tool found at once, the 15-minute stop) is
// src-tauri/tests/cards_07.rs acct003_box1/box2. MIRROR ConnectGrid.tsx useState order: agents 0, installs 1, can 2.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { AgentInfo } from "../../launch/PlusMenu";
import type { Attention } from "../Attention";
import { CodexCardView, type CodexView } from "../CodexCard";
import { ConnectGrid, InstallCardView, stageOf, type ConnectId } from "../ConnectGrid";
import { findAll, mount } from "./shallow-react";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));

const mk = (id: string, installed: boolean): AgentInfo => ({ id, name: id, program: id, args: [], installed, path: installed ? `<bin>\\${id}.exe` : null });
const without = [mk("claude", true), mk("codex", false)];
const withCodex = [mk("claude", true), mk("codex", true)];
const none: CodexView = { accounts: [], active: null, systemDefault: "signed-out", signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null, drifted: [], missing: [], settingsWarning: null };
const noop = () => {};
const codexSlot = (tree: unknown) => findAll(tree, (e) => e.props["data-section"] === "connect-codex")[0].props.children;
const cards = () => ({ claude: createElement("i"), codex: createElement(CodexCardView, { view: none, onAction: noop }) }) as Record<ConnectId, ReturnType<typeof createElement>>;

test("box 1: Install shows progress that moves, then the same grid shows the Codex card ready to Connect, with no restart", () => {
  const page = mount(ConnectGrid, { cards: cards() }, { 0: without, 2: { codex: true } });
  const shown = () => renderToString(codexSlot(page.render()));
  expect(shown()).toContain(">Install<");
  // Install pressed: the backend reports a running install, the bar moves.
  page.set(1, { codex: { running: true, progress: 12, attention: null } });
  const first = shown();
  expect(first).toContain('data-state="installing"');
  expect(first).toContain('aria-valuenow="12"');
  expect(first).toContain(">Cancel<");
  page.set(1, { codex: { running: true, progress: 48, attention: null } });
  expect(shown()).toContain('aria-valuenow="48"');
  // The install ends and the tool is on the list: the card is now Codex's own, not connected, Connect enabled.
  page.set(1, { codex: { running: false, progress: null, attention: null } });
  page.set(0, withCodex);
  const done = shown();
  expect(done).toContain('aria-label="Codex"');
  expect(done).toContain('data-state="disconnected"');
  expect(done).toContain("Not connected");
  expect(done).not.toContain("Install");
  expect(done).toMatch(/<button class="btn primary">Connect<\/button>/);
  expect(stageOf("codex", withCodex)).toBe("installed");
});

test("box 2: a hung install, stopped after 15 minutes, shows a failure with Try installing again", () => {
  // The failure as the backend sends it (install.rs:97, asserted in cards_07.rs): reason and message.
  const attention: Attention = { reason: "install-failed", message: "The install was still going after 15 minutes, so Kolux stopped it.", resetsAt: null };
  const html = renderToString(createElement(InstallCardView, { id: "codex", stage: stageOf("codex", without), install: { running: false, progress: null, attention }, canInstall: true, onInstall: noop, onCancel: noop, onPage: noop }));
  expect(html).toContain("still going after 15 minutes");
  expect(html).toContain("Try installing again");
  expect(html).toContain('data-state="not-installed"');
  expect(html).not.toContain('role="progressbar"');
});
