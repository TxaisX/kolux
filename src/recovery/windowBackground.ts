// DT-C236 (APP-017): the engine's default background follows the page's own. Since the main view is
// now told when the window is minimised or in the tray (webview_power.rs), the first frame after a
// restore may come before the page paints; the engine fills it with its default background, which is
// white unless set. The page's body colour is sent to `window_background` whenever the theme applies,
// so that frame shows the theme colour. A translucent body (the blurred-window look) sends null, which
// keeps the view transparent.
import { invoke } from "@tauri-apps/api/core";
import { TERMINAL_EVENT } from "../theme";

export type Rgb = [number, number, number];

/** The opaque colour of a computed `background-color`, or null when it is transparent or translucent. */
export function opaqueRgb(computed: string): Rgb | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(computed.trim());
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) < 1) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The parts of the page this needs, so tests can stand in for them (there is no jsdom). */
export type Page = {
  /** The body's computed `background-color`. */
  read(): string;
  send(rgb: Rgb | null): void;
  on(f: () => void): () => void;
};

const livePage = (): Page => ({
  read: () => getComputedStyle(document.body).backgroundColor,
  send: (rgb) => void invoke("window_background", { rgb }).catch(() => {}),
  on: (f) => {
    window.addEventListener(TERMINAL_EVENT, f);
    // The blurred-window switch (chrome/appLook.ts) changes the body's alpha without a theme event.
    const watch = typeof MutationObserver === "function" ? new MutationObserver(f) : null;
    watch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-window-blur"] });
    return () => {
      window.removeEventListener(TERMINAL_EVENT, f);
      watch?.disconnect();
    };
  },
});

/** Sends the body's colour now and again after every change. Returns the stop function. */
export function installWindowBackground(page: Page = livePage()): () => void {
  let last: string | null = null;
  const sync = () => {
    const rgb = opaqueRgb(page.read());
    const key = JSON.stringify(rgb);
    if (key === last) return;
    last = key;
    page.send(rgb);
  };
  sync();
  return page.on(sync);
}
