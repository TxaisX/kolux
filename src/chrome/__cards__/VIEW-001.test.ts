// VIEW-001 supporting proof (box 1, highlight half only): the real TopBar switch. Which screen renders is decided in App.tsx
// (agentsScreen / board / terminals at :2096-2103), so both boxes stay LIVE in the ledger.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, click, find, installDom, mount, settle } from "../../test/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }) }));
vi.mock("../../switcher/AccountSwitcher", () => ({ default: () => null }));
vi.mock("../../usage/UsagePill", () => ({ default: () => null }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("clicking each of Agents, Board and Terminals selects exactly that label, and Classic has no switch", async () => {
  const { default: TopBar } = await import("../TopBar");
  const Bar = ({ classic }: { classic: boolean }) => {
    const [screen, setScreen] = useState<"agents" | "board" | "terminals">("terminals");
    return createElement(TopBar, { screen, classic, onScreen: setScreen as never, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} });
  };
  const m = await mount(createElement(Bar, { classic: false }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  const btn = (t: string) => find(c, (n) => n.localName === "button" && n.attrs["aria-pressed"] !== undefined && n.textContent.trim() === t)[0];
  const on = () => ["Agents", "Board", "Terminals"].filter((t) => btn(t).attrs["aria-pressed"] === "true");
  expect(on()).toEqual(["Terminals"]);
  for (const t of ["Agents", "Board", "Terminals"]) {
    await click(c, btn(t));
    await settle();
    expect(on()).toEqual([t]);
  }
  await unmount();
  const classic = await mount(createElement(Bar, { classic: true }), doc);
  unmount = classic.unmount;
  await settle();
  expect(find(classic.container as FakeNode, (n) => n.localName === "nav" && n.attrs.class === "switcher")).toHaveLength(0);
});
