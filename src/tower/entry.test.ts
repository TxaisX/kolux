// FIX-4 (council d2 AFTER 8): the Tower's own window never evaluates the App module. main.tsx loads
// App with import() on the main window's branch only, so nothing in App's import graph runs in the
// Tower window. The counter below goes up each time the App module is evaluated.
import { afterEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ app: 0, drawn: [] as unknown[], failApp: false, shown: 0, slow: false }));

vi.mock("../App", () => {
  seen.app++;
  if (seen.failApp) throw new Error("Failed to fetch dynamically imported module");
  return { default: function App() { return null; } };
});
vi.mock("./TowerWindow", () => ({ default: function TowerWindow() { return null; } }));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: (el: unknown) => void seen.drawn.push(el) }) } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (seen.slow) await new Promise((r) => setTimeout(r, 40));
    return cmd === "get_settings" ? {} : null;
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: async () => void seen.shown++ }) }));
vi.mock("../theme", () => ({ applyAppearance: () => {}, cachedAppearance: () => null, followSystemMode: () => {}, readAppearance: () => null }));
vi.mock("../settings/general", () => ({ stampLook: () => null }));
vi.mock("../settings/saveChanged", () => ({ saveChanged: async () => {} }));
vi.mock("../language", () => ({ applyLanguage: () => {}, LANGUAGE_FIELD: "language", locale: () => "en", onLanguageChange: () => () => {} }));
vi.mock("../settings/zoom", () => ({ applyZoom: () => {}, ZOOM_FIELD: "zoom" }));
vi.mock("../terminal/text", () => ({ followText: () => {} }));
vi.mock("../settings/menuWheel", () => ({ installMenuWheel: () => {} }));
vi.mock("../terminal/layout", () => ({ LAYOUT_FIELD: "layout", restoreAsks: () => false, restoreLayout: () => null, stillThere: (l: unknown) => l }));

async function boot(hash: string) {
  seen.app = 0;
  seen.drawn = [];
  vi.resetModules();
  vi.stubGlobal("location", { hash });
  vi.stubGlobal("document", { getElementById: () => ({}) });
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
  await import("../main");
  await vi.waitFor(() => expect(seen.drawn.length).toBe(1));
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen.failApp = false;
  seen.slow = false;
});

describe("FIX-4 the window entry point", () => {
  it("draws the Tower in the Tower window without evaluating the App module", async () => {
    await boot("#tower-window");
    expect(seen.app).toBe(0);
  });

  // FIX-5 (council d2 AFTER 4): a chunk that fails to load must not leave the hidden window blank.
  it("shows a message and the window when the App module fails to load", async () => {
    seen.failApp = true;
    seen.shown = 0;
    seen.drawn = [];
    const root = { textContent: "", kids: [] as unknown[], append(...n: unknown[]) { this.kids.push(...n); } };
    vi.resetModules();
    vi.stubGlobal("location", { hash: "" });
    vi.stubGlobal("document", { getElementById: () => root, createElement: () => ({ setAttribute() {}, textContent: null }) });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
    await import("../main");
    await vi.waitFor(() => expect(seen.shown).toBe(1));
    expect(root.kids).toHaveLength(1);
    expect(seen.drawn).toHaveLength(0);
  });

  // FIX-6 (council d2 AFTER 3): the App load starts first and is awaited late. When it fails fast, the
  // rejection must already be handled, or the webview (and vitest) report an unhandled rejection.
  it("leaves no unhandled rejection when the App module fails before it is awaited", async () => {
    const lost: unknown[] = [];
    const note = (e: unknown) => void lost.push(e);
    // the test build has no Node types, so the process object is reached through globalThis
    const proc = (globalThis as unknown as { process: { on(e: string, f: (x: unknown) => void): void; off(e: string, f: (x: unknown) => void): void } }).process;
    proc.on("unhandledRejection", note);
    try {
      seen.failApp = true;
      seen.slow = true;
      seen.shown = 0;
      const root = { textContent: "", append() {} };
      vi.resetModules();
      vi.stubGlobal("location", { hash: "" });
      vi.stubGlobal("document", { getElementById: () => root, createElement: () => ({ setAttribute() {}, textContent: null }) });
      vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
      await import("../main");
      await vi.waitFor(() => expect(seen.shown).toBe(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(lost).toEqual([]);
    } finally {
      proc.off("unhandledRejection", note);
    }
  });

  it("loads the App module in the main window", async () => {
    await boot("");
    expect(seen.app).toBe(1);
  });
});
