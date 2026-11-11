// DT-C270: whether Go to / Run a command is open is not the window's own state, so opening it draws the palette
// and nothing else of the window.
import { expect, test } from "vitest";
import { paletteOpen, setPaletteOpen } from "./paletteOpen";
import chrome from "./useChrome.ts?raw";
import store from "../shell/windowStore.ts?raw";
import app from "../App.tsx?raw";
import bag from "../shell/windowBag.ts?raw";
import panes from "../terminal/paneActions.ts?raw";
import dialogs from "../shell/window/Dialogs.tsx?raw";

test("DT-C270: opening and closing tells whoever watches, once per change", async () => {
  const { useSyncExternalStore } = await import("react");
  expect(typeof useSyncExternalStore).toBe("function");
  setPaletteOpen(false);
  expect(paletteOpen()).toBe(false);
  setPaletteOpen(true);
  expect(paletteOpen()).toBe(true);
  setPaletteOpen(true);
  expect(paletteOpen()).toBe(true);
  setPaletteOpen(false);
  expect(paletteOpen()).toBe(false);
});

test("DT-C270: the window's root holds no open flag for the palette and reads none", () => {
  // the opener the window hands round is the store's own, so a click or a chord changes nothing the window draws from
  expect(chrome).toMatch(/const setPalette = setPaletteOpen;/);
  expect(chrome).not.toMatch(/\[palette, setPalette\]\s*=\s*useState/);
  expect(store).toMatch(/const \{ setPalette, notice, setNotice, toast, setToast \} = useChrome\(\);/);
  expect(store).not.toMatch(/[{ ,]palette, setPalette/);
  // and nothing the window builds every time it draws depends on it: the pull-request rows are the palette's own
  expect(app).not.toMatch(/usePrRows|\bpalette\b,/);
  expect(bag).not.toMatch(/prRows/);
  expect(panes).not.toMatch(/prRows/);
});

test("DT-C270: the palette's surface is the one place that reads whether it is open, and it adds the pull-request rows", () => {
  const host = dialogs.slice(dialogs.indexOf("function PaletteHost()"));
  expect(host).toMatch(/const open = usePaletteOpen\(\);/);
  expect(host).toMatch(/usePrRows\(open,/);
  expect(host).toMatch(/items=\{\[\.\.\.prRows, \.\.\.paletteItems\(\)\]\}/);
  expect(host).toMatch(/onClose=\{\(\) => setPaletteOpen\(false\)\}/);
  const windowDialogs = dialogs.slice(dialogs.indexOf("export default function WindowDialogs()"), dialogs.indexOf("function PaletteHost()"));
  expect(windowDialogs).toMatch(/<PaletteHost \/>/);
  expect(windowDialogs).not.toMatch(/usePaletteOpen|\bpalette &&/);
});
