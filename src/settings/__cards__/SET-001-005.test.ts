// SET-001, SET-002, SET-003, SET-005 acceptance: the real AppearancePage on the small DOM against an in-memory settings store, with the
// product's own applyAppearance writing the tokens to a recording document root.
// MIRROR src/terminal/TerminalPane.tsx:1063-1069 (`recolour`: `term.options.theme = currentTerminal()` on TERMINAL_EVENT), copied below as `openTerminal`;
// which colours a terminal gets is the product's currentTerminal/terminalFor, only the one-line assignment onto the xterm is copied.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CATALOGUE } from "../../terminal/schemes";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto, until } from "../../tasks/fakeDom";

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, patches: [] as { set: Record<string, unknown>; remove: string[] }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "get_settings") return Promise.resolve(JSON.parse(JSON.stringify(h.settings)));
    if (cmd === "settings_patch") {
      const p = args as { set: Record<string, unknown>; remove: string[] };
      h.patches.push(JSON.parse(JSON.stringify(p)));
      Object.assign(h.settings, p.set);
      for (const k of p.remove) delete h.settings[k];
      return Promise.resolve(null);
    }
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

let doc: FakeDocument;
let vars: Record<string, string> = {};
let bus: Record<string, (() => void)[]> = {};
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  vars = {};
  bus = {};
  Object.assign(dom.win, {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    addEventListener: (t: string, f: () => void) => void (bus[t] ??= []).push(f),
    removeEventListener: (t: string, f: () => void) => void (bus[t] = (bus[t] ?? []).filter((x) => x !== f)),
    dispatchEvent: (e: { type: string }) => void (bus[e.type] ?? []).slice().forEach((f) => f()),
  });
  Object.assign(globalThis, { requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  Object.assign(doc.documentElement, {
    style: { setProperty: (k: string, v: string) => void (vars[k] = v), removeProperty() {} },
    dataset: {},
    classList: { add() {}, remove() {} },
  });
  h.settings = {};
  h.patches = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function page(settings: Record<string, unknown>) {
  h.settings = settings;
  const theme = await import("../../theme");
  theme.applyAppearance(theme.readAppearance(settings)); // what the window did at start
  const { default: AppearancePage } = await import("../AppearancePage");
  const m = await mount(createElement(AppearancePage), doc);
  unmount = m.unmount;
  await until(() => radios(m.container).length > 0, "the colour theme row");
  await settle(); // get_settings has answered and the page shows what it read
  return m.container;
}
const radios = (c: FakeNode, group = "Colour theme") => {
  const g = find(c, (n) => n.attrs.role === "radiogroup" && n.attrs["aria-label"] === group)[0];
  return g ? find(g, (n) => n.attrs.role === "radio") : [];
};
const radio = (c: FakeNode, label: string, group = "Colour theme") => radios(c, group).find((n) => n.attrs["aria-label"] === label || n.textContent.trim() === label)!;
const checked = (c: FakeNode, group = "Colour theme") => radios(c, group).filter((n) => n.attrs["aria-checked"] === "true").map((n) => n.attrs["aria-label"] ?? n.textContent.trim());
const sliders = (c: FakeNode) => find(find(c, (n) => n.attrs["data-section"] === "theme")[0], (n) => n.localName === "label" && /look-slider/.test(n.attrs.class ?? "")).map((l) => ({ name: l.textContent.replace(/[-\d.]+\s*[°%]?\s*$/, "").trim(), input: find(l, (n) => n.localName === "input")[0], text: l.textContent }));
const disabled = (n: FakeNode) => "disabled" in n.attrs || n.disabled === true;
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return NaN;
  return ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
};
const grey = (hex: string) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);
const near = (a: number, b: number, tol: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= tol;
/** The tokens a window shows for these saved settings. */
async function tokensFor(settings: Record<string, unknown>) {
  const theme = await import("../../theme");
  const keep = { ...vars };
  vars = {};
  theme.applyAppearance(theme.readAppearance(settings));
  const out = vars;
  vars = keep;
  return out;
}

test("SET-001 box 1: fresh profile is Classic; clicking Teal turns sidebar, top bar and accent teal inside the click, before any save", async () => {
  const c = await page({});
  expect(radios(c).map((n) => n.attrs["aria-label"])).toHaveLength(17);
  expect(checked(c)).toEqual(["Classic"]);
  const before = { surface: vars["--surface"], accent: vars["--seg-active"], pane: vars["--pane-bg"] };
  expect(before.surface).toBe("#171717"); // Classic as measured
  await click(c, radio(c, "Teal"));
  // synchronously after the click event: the tokens the top bar and sidebar (--surface) and the accent (--seg-active) read are teal
  expect(h.patches).toHaveLength(0); // the 250 ms save pause has not run: the colours did not wait for it
  for (const k of ["--surface", "--seg-active", "--line-focus", "--row-selected"]) expect(near(hue(vars[k]), 174, 12), `${k} ${vars[k]}`).toBe(true);
  expect(vars["--surface"]).not.toBe(before.surface);
  expect(vars["--seg-active"]).not.toBe(before.accent);
  expect(vars["--pane-bg"]).not.toBe(before.pane);
  expect(vars).toMatchObject(await tokensFor({ appTheme: "teal" }));
  expect(checked(c)).toEqual(["Teal"]);
  await until(() => h.patches.length > 0, "the save after the pause");
  expect(h.patches[0].set).toMatchObject({ appTheme: "teal" });
});

test("SET-001 box 2: an unknown saved theme name starts as Classic, shown and selected", async () => {
  const c = await page({ appTheme: "chartreuse" });
  expect(checked(c)).toEqual(["Classic"]);
  expect(vars).toMatchObject(await tokensFor({}));
  expect(vars["--surface"]).toBe("#171717");
  expect(find(c, (n) => n.attrs["aria-label"]?.startsWith("Preview:")).map((n) => n.attrs["aria-label"])).toEqual(["Preview: Violet"]); // the sample shown while Classic is chosen
  const theme = await import("../../theme");
  expect(theme.writeAppearance({ appTheme: "chartreuse" }, theme.readAppearance({ appTheme: "chartreuse" }))).toMatchObject({ appTheme: "classic" });
  expect(theme.readAppearance({}).theme).toBe("classic");
  expect(theme.readAppearance({ appTheme: 7 }).theme).toBe("classic");
});

test("SET-002 box 1: Classic chosen -> tint, saturation and depth are all disabled (and enabled on a hue)", async () => {
  const c = await page({});
  const s = sliders(c);
  expect(s.map((x) => x.name)).toEqual(["Tint", "Saturation", "Depth"]);
  expect(s.every((x) => disabled(x.input))).toBe(true);
  await click(c, radio(c, "Moss"));
  expect(sliders(c).every((x) => !disabled(x.input))).toBe(true);
  await click(c, radio(c, "Classic"));
  expect(sliders(c).every((x) => disabled(x.input))).toBe(true);
});

test("SET-002 box 2: Moss, saturation to 0 -> every background and text token is grey; back to 100 -> Moss returns", async () => {
  const c = await page({ appTheme: "moss" });
  const moss = { ...vars };
  const greys = ["--surface", "--seg-active", "--line-strong", "--pane-bg", "--fg", "--fg-muted"];
  expect(greys.some((k) => grey(moss[k]))).toBe(false); // Moss is coloured
  expect(near(hue(moss["--seg-active"]), 75, 12)).toBe(true);
  const sat = () => sliders(c).find((x) => x.name === "Saturation")!.input;
  await typeInto(c, sat(), "0");
  for (const k of greys) expect(grey(vars[k]), `${k} ${vars[k]}`).toBe(true);
  expect(sat().attrs.value ?? sat().value).toBe("0");
  await typeInto(c, sat(), "100");
  expect(vars).toMatchObject(moss);
  expect(grey(vars["--seg-active"])).toBe(false);
  // T-598: the page writes only what changed. This drag ended where it began, so after the pause nothing is
  // written: what is stored reads as the last drag position, and the 0 on the way was never saved.
  await settle(300);
  expect(h.patches).toEqual([]);
  expect((await import("../../theme")).readAppearance(h.settings).saturation).toBe(100);
  // A drag that ends elsewhere saves its last position once, after the pause.
  await typeInto(c, sat(), "0");
  await typeInto(c, sat(), "40");
  await until(() => h.patches.length > 0, "the save");
  expect(h.patches).toEqual([{ set: { themeSaturation: 40 }, remove: [] }]); // the saved value is the last drag position
});

test("SET-002 box 3: saved saturation 500 is used as 160, a word as 100", async () => {
  const hi = await page({ appTheme: "moss", themeSaturation: 500 });
  const sat = sliders(hi).find((x) => x.name === "Saturation")!;
  expect(sat.text).toContain("160 %");
  expect(sat.input.attrs.max).toBe("160");
  expect(vars).toMatchObject(await tokensFor({ appTheme: "moss", themeSaturation: 160 }));
  expect(vars["--seg-active"]).not.toBe((await tokensFor({ appTheme: "moss", themeSaturation: 100 }))["--seg-active"]);
  await unmount();
  unmount = async () => {};
  const word = await page({ appTheme: "moss", themeSaturation: "loud" });
  expect(sliders(word).find((x) => x.name === "Saturation")!.text).toContain("100 %");
  expect(vars).toMatchObject(await tokensFor({ appTheme: "moss" }));
  const theme = await import("../../theme");
  expect([theme.readAppearance({ themeSaturation: -4 }).saturation, theme.readAppearance({ themeSaturation: null }).saturation]).toEqual([0, 100]);
});

/** A terminal as TerminalPane draws it: it takes the current terminal colours once when opened and again on every TERMINAL_EVENT. */
async function openTerminal() {
  const theme = await import("../../theme");
  const term = { options: { theme: theme.currentTerminal() }, opened: 1 };
  window.addEventListener(theme.TERMINAL_EVENT, () => (term.options.theme = theme.currentTerminal())); // MIRROR TerminalPane.tsx:1063-1069
  return term;
}

test("SET-003 box 1: Match, then Sky -> Ember recolours the open terminal without reopening it", async () => {
  const theme = await import("../../theme");
  const c = await page({ appTheme: "sky" });
  const term = await openTerminal();
  expect(term.options.theme.background).toBe("#0d0d0d"); // Kolux's own scheme before Match
  await click(c, find(c, (n) => n.attrs["aria-pressed"] !== undefined && n.textContent.includes("Match app theme"))[0]);
  const sky = term.options.theme;
  expect(sky).toEqual(theme.terminalFor(theme.readAppearance({ appTheme: "sky", terminalScheme: "match" })));
  expect(sky.background).not.toBe("#0d0d0d");
  expect(near(hue(sky.background!), 202, 25) || near(hue(sky.foreground!), 202, 25)).toBe(true);
  await click(c, radio(c, "Ember"));
  const ember = term.options.theme;
  expect(ember).toEqual(theme.terminalFor(theme.readAppearance({ appTheme: "ember", terminalScheme: "match" })));
  expect(ember.background).not.toBe(sky.background);
  expect(ember.red).not.toBe(sky.red);
  expect(term.opened).toBe(1); // the same terminal object throughout
  // the slider also recolours it: tint moves the hue the terminal follows
  await typeInto(c, sliders(c)[0].input, "90");
  expect(term.options.theme.background).not.toBe(ember.background);
});

test("SET-003 box 2: a catalogue scheme again -> terminals stop following the app hue", async () => {
  const theme = await import("../../theme");
  const c = await page({ appTheme: "sky", terminalScheme: "match" });
  const term = await openTerminal();
  theme.applyAppearance(theme.readAppearance({ appTheme: "sky", terminalScheme: "match" })); // the terminal opens already following
  await click(c, radio(c, "Ember"));
  const followed = term.options.theme.background;
  const option = find(c, (n) => n.attrs["aria-pressed"] !== undefined && n.textContent.includes("Dracula"))[0];
  await click(c, option);
  const dracula = CATALOGUE.find((s) => s.id === "dracula")!.colours;
  expect(term.options.theme).toEqual(dracula);
  expect(term.options.theme.background).not.toBe(followed);
  await click(c, radio(c, "Rose"));
  await typeInto(c, sliders(c)[1].input, "40");
  expect(term.options.theme).toEqual(dracula); // new hue, new saturation: the terminal does not move
  expect(vars["--seg-active"]).toBe((await tokensFor({ appTheme: "rose", themeSaturation: 40 }))["--seg-active"]); // while the app did
});

test("SET-005 box 1: Mode System follows the operating system while running", async () => {
  const theme = await import("../../theme");
  let dark = false;
  const media: (() => void)[] = [];
  Object.assign(globalThis, { matchMedia: () => ({ get matches() { return dark; }, addEventListener: (_: string, f: () => void) => void media.push(f) }) });
  try {
    theme.followSystemMode();
    theme.applyAppearance(theme.readAppearance({ appearanceMode: "system" }));
    expect(vars["color-scheme"]).toBe("light");
    expect(vars["--app-bg"]).not.toBe("#050405");
    expect(doc.documentElement.dataset.mode).toBe("light");
    dark = true; // the operating system switches to dark; no settings read, no restart
    media.forEach((f) => f());
    expect(vars["color-scheme"]).toBe("dark");
    expect(vars["--app-bg"]).toBe("#050405");
    expect(doc.documentElement.dataset.mode).toBe("dark");
    dark = false;
    media.forEach((f) => f());
    expect(vars["color-scheme"]).toBe("light");
  } finally {
    delete (globalThis as { matchMedia?: unknown }).matchMedia;
  }
});

test("SET-005 box 2: Mode Light with the separate light scheme on -> an open terminal uses the light scheme (and the dark one when it is off)", async () => {
  const c = await page({});
  const term = await openTerminal();
  expect(term.options.theme.background).toBe("#0d0d0d");
  expect(checked(c, "Mode")).toEqual(["Dark"]);
  await click(c, radio(c, "Light", "Mode"));
  const tango = CATALOGUE.find((s) => s.id === "tango-light")!.colours;
  expect(term.options.theme).toEqual(tango);
  expect(term.options.theme.background).toBe("#ffffff");
  expect(vars["color-scheme"]).toBe("light");
  const sw = find(c, (n) => n.attrs.role === "switch" && !!n.parentNode?.textContent.includes("Light scheme in light mode"))[0];
  expect(sw).toBeTruthy();
  (sw as FakeNode & { checked: boolean }).checked = false; // the user's click turns the box off before React reads it
  await click(c, sw);
  expect(term.options.theme.background).toBe("#0d0d0d"); // off keeps the one scheme in both modes
  (sw as FakeNode & { checked: boolean }).checked = true;
  await click(c, sw);
  expect(term.options.theme).toEqual(tango);
  await until(() => h.patches.length > 0, "the save");
  expect(h.patches[h.patches.length - 1].set).toMatchObject({ appearanceMode: "light" });
});
