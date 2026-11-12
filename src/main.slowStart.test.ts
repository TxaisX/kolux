// T-597 (F05-app-shell-launch.2, VIEW-107, PROJ-067): a start whose settings read loses the 1.5 s race draws
// the window without the saved tabs and writes no layout; when the settings answer after all, the same restore
// runs on them and the saved tabs join the window already drawn (C26-R3-01: the same App, not a new one).
// main.tsx is booted for real over mocked commands (as tower/entry.test.ts does), with the real layout restore;
// App itself cannot be drawn here, so its save guard is read from its source (as skills/noticeMount.test.ts does).
import { afterEach, expect, test, vi } from "vitest";
import { LAYOUT_FIELD, layoutOf, type SavedLayout } from "./terminal/layout";
import { windowFiles, windowSource } from "./shell/windowSource";

const SOURCES = import.meta.glob(["./main.tsx", "./settings/useSettings.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const h = vi.hoisted(() => ({
  drawn: [] as unknown[],
  answer: (_s: unknown) => {},
  fail: (_e: unknown) => {},
  texts: [] as unknown[],
  langs: [] as unknown[],
  shown: 0,
  calls: [] as Array<[string, Record<string, unknown>]>,
  gate: false, // PKG-4: while set, path_kind answers only once a history removal has been asked
  forgot: false,
  release: [] as Array<() => void>,
}));
vi.mock("./App", () => ({ default: function App() { return null; } }));
vi.mock("./tower/TowerWindow", () => ({ default: function TowerWindow() { return null; } }));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: (el: unknown) => void h.drawn.push(el) }) } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push([cmd, args]);
    if (cmd === "get_settings") return new Promise((ok, no) => ((h.answer = ok), (h.fail = no)));
    if (cmd === "terminal_forget_history") (h.forgot = true), h.release.splice(0).forEach((f) => f());
    if (cmd === "path_kind") return h.gate ? new Promise((ok) => (h.forgot ? ok("dir") : h.release.push(() => ok("dir")))) : Promise.resolve("dir");
    if (cmd === "agent_start_line") return Promise.resolve({ args: ["--resume", String(args.session)], program: "claude", env: [], resumed: true });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: async () => void h.shown++ }) }));
vi.mock("./theme", () => ({ applyAppearance: () => {}, cachedAppearance: () => null, followSystemMode: () => {}, readAppearance: () => null }));
vi.mock("./settings/general", () => ({ stampLook: () => null }));
vi.mock("./settings/saveChanged", () => ({ saveChanged: async () => {} }));
// locale / onLanguageChange: the language-pack preload (i18n/packs.ts, i18n/lookup.ts) reads them before the first draw.
vi.mock("./language", () => ({ applyLanguage: (l: unknown) => void h.langs.push(l), LANGUAGE_FIELD: "language", locale: () => "en", onLanguageChange: () => () => {} }));
vi.mock("./settings/zoom", () => ({ applyZoom: () => {}, ZOOM_FIELD: "zoom" }));
vi.mock("./terminal/text", () => ({ followText: (s: unknown) => void h.texts.push(s), applyText: (s: unknown) => void h.texts.push(s) }));
vi.mock("./settings/menuWheel", () => ({ installMenuWheel: () => {} }));

// The tabs written down at the last quit: a Claude tab with a session to resume, a shell, a Codex tab.
const tab = (key: number, agent: "claude" | "codex" | "shell", extra: Record<string, unknown> = {}) => ({ key, cwd: "C:/w/app", branch: "main", agent, program: null, args: [] as string[], ...extra });
const SAVED = JSON.parse(JSON.stringify(layoutOf([tab(1, "claude", { agentId: "claude", session: "s-1" }), tab(2, "shell"), tab(3, "codex", { agentId: "codex", session: "thr_3" })], { 0: 3 }, 3, "C:/w/app", {})));

type El = { key: string | null; props: { children?: El; initial?: Record<string, unknown>; layout?: SavedLayout | null; read?: boolean; late?: SavedLayout | null } };
/** The App element inside StrictMode and ScreenBoundary. */
const appOf = (el: unknown) => (el as El).props.children!.props.children!;

async function boot() {
  h.drawn = [];
  h.calls = [];
  h.gate = false;
  h.forgot = false;
  h.release = [];
  h.texts = [];
  h.langs = [];
  vi.resetModules();
  vi.stubGlobal("location", { hash: "" });
  vi.stubGlobal("document", { getElementById: () => ({}) });
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
  await import("./main");
}
afterEach(() => vi.unstubAllGlobals());

test("a slow start draws the window without the saved tabs, then hands them to the same App once the settings answer", async () => {
  await boot();
  await vi.waitFor(() => expect(h.drawn.length).toBe(1), { timeout: 4000 });
  const slow = appOf(h.drawn[0]);
  expect(slow.props.read).toBe(false); // App writes no layout while this is false (next test)
  expect(slow.props.layout).toBeNull();
  expect(h.shown).toBeGreaterThan(0); // the window still shows on time
  h.answer({ [LAYOUT_FIELD]: SAVED, language: "fr" });
  await vi.waitFor(() => expect(h.drawn.length).toBe(2));
  const back = appOf(h.drawn[1]);
  expect(back.props.read).toBe(true);
  // C26-R3-01: the same element, so React updates it where it stands: no unmount, no terminal killed, and a tab
  // opened during the wait stays drawn.
  expect(back.key).toBe(slow.key);
  expect(back.props.late?.panes.map((p) => [p.key, p.agent, p.args])).toEqual([
    [1, "shell", []],
    [2, "shell", []],
    [3, "shell", []],
  ]); // DT-C27 (2026-11-08): a fresh start brings agent tabs back as plain shells, never resumed
  expect(back.props.late?.focused).toBe(3);
  expect(back.props.initial).toMatchObject({ language: "fr" });
  // The rest of what a timely read sets up follows the late answer too: the language and the terminal text.
  expect(h.langs[h.langs.length - 1]).toBe("fr");
  expect(h.texts[h.texts.length - 1]).toMatchObject({ language: "fr" });
});

// C26-R3-01: the late layout joins the window already drawn; it does not replace it. The merge, the once-only
// adoption and the write that follows are what keep a pane started during the wait alive.
test("a late settings answer hands the saved tabs to the drawn window instead of replacing what it holds", () => {
  const store = windowFiles["./shell/windowStore.ts"];
  expect(store).toMatch(/setPanes\(\(ps\) => joinSaved\(ps, late\)\)/); // merge, never replace
  expect(store).toMatch(/if \(!late \|\| adopted\.current\) return;/); // once, however often the prop arrives
  expect(store).toMatch(/setPinned\(marks\.pinned\)/); // the saved pins come with the saved tabs
  expect(store).toMatch(/setTabColors\(marks\.colors\)/); // and so do their Tab Colours
  expect(windowFiles["./shell/useWindowSave.ts"]).toContain("stacked, pinned, tabColors, read])"); // the wait tab is written down
});

test("a slow start whose settings never answer stays as it was drawn: no saved tabs, read false", async () => {
  await boot();
  await vi.waitFor(() => expect(h.drawn.length).toBe(1), { timeout: 4000 });
  h.fail("settings.json could not be read");
  await new Promise((r) => setTimeout(r, 30));
  expect(h.drawn.length).toBe(1);
  expect(appOf(h.drawn[0]).props.read).toBe(false);
});

test("a timely start draws once, with the saved tabs and read true", async () => {
  await boot();
  h.answer({ [LAYOUT_FIELD]: SAVED });
  await vi.waitFor(() => expect(h.drawn.length).toBe(1));
  await new Promise((r) => setTimeout(r, 30)); // the answer has landed: nothing more is drawn
  expect(h.drawn.length).toBe(1);
  const app = appOf(h.drawn[0]);
  expect(app.props.read).toBe(true);
  expect(app.props.layout?.panes.map((p) => p.key)).toEqual([1, 2, 3]);
});

// PKG-4: one wave before the first draw. The history removals are asked while the folder checks are still
// unanswered (the checks here answer only after a removal was asked, so a second wave would never finish), and both
// are done before the window draws (DT-C27: nothing old replays before a pane opens).
test("a timely start asks the folder checks and the history removals together, and settles both before drawing", async () => {
  await boot();
  h.gate = true;
  h.answer({ [LAYOUT_FIELD]: SAVED });
  await vi.waitFor(() => expect(h.drawn.length).toBe(1));
  const names = h.calls.map(([c]) => c);
  expect(names.filter((c) => c === "terminal_forget_history").length).toBe(3);
  expect(names.lastIndexOf("terminal_forget_history")).toBeLessThan(names.indexOf("terminal_prune_history")); // the prune still follows
  expect(names.indexOf("terminal_prune_history")).toBeLessThan(names.indexOf("startup_report"));
});

// PKG-4: the page's timeline reaches the log once, after show, as plain numbers; the call never fails the start.
test("after show the page sends its start marks once, as a map of numbers", async () => {
  await boot();
  h.answer({});
  await vi.waitFor(() => expect(h.calls.filter(([c]) => c === "startup_report").length).toBe(1));
  const [, args] = h.calls.find(([c]) => c === "startup_report")!;
  const page = args.page as Record<string, number>;
  for (const name of ["kx:entry", "kx:settings", "kx:app-loaded", "kx:first-render", "kx:shown"]) expect(typeof page[name]).toBe("number");
  expect(page["kx:entry"]).toBeLessThanOrEqual(page["kx:shown"]);
  expect(h.shown).toBeGreaterThan(0);
});

test("the start reads the settings through the shared read, so a mount read joins it", () => {
  const main = SOURCES["./main.tsx"];
  expect(main).toMatch(/sharedRead\(\)\.catch/);
  expect(main).not.toMatch(/invoke<Record<string, unknown>>\("get_settings"\)/);
  expect(SOURCES["./settings/useSettings.ts"]).toMatch(/const read = \(\) =>\s+(\/\/.*\n\s*)?sharedRead\(\)/);
});

// src has no node types; the builtin comes through process.getBuiltinModule (as skills/noticeMount.test.ts does).

test("App (evidence/reliability-App.patch): the layout effect writes nothing until the saved tabs are back, even after its own settings read lands", () => {
  const app = windowSource;
  const set = app.indexOf("layoutSaver.set(l);");
  const effect = app.slice(app.lastIndexOf("useEffect(() => {", set), set);
  expect(effect).toMatch(/^useEffect\(\(\) => \{\s*if \(!read\) return;/);
  expect(effect).not.toContain("settingsRead");
});

test("App (evidence/reliability-App.patch): a tab opened during a slow start never takes a saved tab's pane key", () => {
  // Every pane asks the terminal service for the terminal of its key (terminal_attach), and terminals live
  // on across a quit (APP-052). A wait tab with a saved tab's key would take over that tab's running agent,
  // write into its history, and kill it when the window is drawn again with the saved tabs.
  const app = windowSource;
  const init = /const nextKey = useRef\((.*)\);/.exec(app)?.[1];
  expect(init).toBeDefined();
  const first = new Function("layout", "read", `return ${init};`) as (layout: SavedLayout | null, read: boolean) => number;
  // Saved keys are handed out from 1 upward, one per tab opened in a session; none comes near the wait range.
  const many = { ...SAVED, panes: Array.from({ length: 5000 }, (_, i) => ({ ...SAVED.panes[0], key: i + 1 })) };
  expect(first(null, false)).toBeGreaterThan(Math.max(...many.panes.map((p: { key: number }) => p.key)));
  expect(first(null, true)).toBe(2); // a timely start with nothing saved counts as before
  expect(first(SAVED, true)).toBe(4);
});
