// T-705 (DT-C141): the top bar's left toggle follows the T-699 step-aside as the window crosses 900 px, with no other
// re-render. Before, it read the breakpoint at render only and stayed aria-pressed="true" over a hidden sidebar.
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
import { find, installDom, mount, settle } from "../../tasks/fakeDom";
import type { WindowBag } from "../windowBag";
import { WindowStoreProvider } from "./store";

let narrow = false;
const media: Array<() => void> = [];
const flip = (to: boolean) => {
  narrow = to;
  for (const f of media) f();
};
afterEach(() => {
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
});

test("T-705: a resize across 900 px flips the left toggle's aria-pressed with the sidebar's visibility", async () => {
  const { doc, win } = installDom();
  Object.assign(win, { setTimeout, clearTimeout, setInterval, clearInterval });
  Object.assign(globalThis, {
    matchMedia: (q: string) => {
      let own: (() => void) | null = null; // a browser's MediaQueryList: one onchange slot per list
      return {
        get matches() { return q === "(max-width: 899px)" && narrow; },
        get onchange() { return own; },
        set onchange(f: (() => void) | null) {
          if (own) media.splice(media.indexOf(own), 1);
          if ((own = f)) media.push(f);
        },
      };
    },
  });
  const { default: WindowTopBar } = await import("./TopBar");
  const noop = () => {};
  // The right sidebar shows, so under 900 px the left one steps aside (styles.css, T-699).
  const bag = {
    settings: {}, screen: "terminals", setScreen: noop, needing: 0, classic: false, leftWidth: 289, terminals: true, page: null,
    setPage: noop, setPalette: noop, installedIds: [], codex: { accounts: [] }, sidebarOpen: true, setSidebarOpen: noop,
    focused: null, fullPage: false, right: { open: true, tab: "files" }, saveRight: noop, showRight: noop, step: noop,
    hist: { at: 0, list: [] }, stillThere: () => true, settingsOpen: false, setNotice: noop, rightAside: { current: { shown: true } },
  } as unknown as WindowBag;
  const { container, unmount } = await mount(createElement(WindowStoreProvider, { store: bag, children: createElement(WindowTopBar) }), doc);
  const toggle = () => find(container, (n) => n.localName === "button" && /sidebar$/.test(n.attrs.title ?? ""))[0];
  expect(toggle().attrs["aria-pressed"]).toBe("true");
  flip(true); // 1400 -> 640 px: the left sidebar steps aside
  await settle();
  expect(toggle().attrs["aria-pressed"]).toBe("false");
  expect(toggle().attrs.title).toBe("Show sidebar");
  flip(false); // wide again: it comes back
  await settle();
  expect(toggle().attrs["aria-pressed"]).toBe("true");
  expect(media.length).toBe(1); // one listener, on the breakpoint, for every redraw
  await unmount();
});
