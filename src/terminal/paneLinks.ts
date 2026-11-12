// TERM-092 / TERM-093 / TERM-094 / TERM-096: a terminal pane's links, moved out of TerminalPane.tsx's mount
// effect as they were. Printed terminal handles (term-N), web links and file paths, a program's own OSC 8
// links, the hint under the pointer, the link click a mouse-tracking program never sees, and the link menu's
// right-click. The text work is in links.ts, the click plans in linkMenu.ts. Returns the cleanup.
import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { askLink, linkState } from "../shell/linkAsk";
import { explain as explainError } from "./errors";
import { allowed, clickTarget, handlesOn, hintFor, linkFor, linksIn, resolvePath, safeLinks, type Found } from "./links";
import { openFailed, opensMenu, planClick, type Door } from "./linkMenu";
import { claimsClick } from "./linkClick";
import { fromKeys } from "./PaneMenu";
import { currentText } from "./text";

type Ref<T> = { readonly current: T };

export type LinkDeps = {
  /** The pane's handle finder (TERM-096): a term-N handle to the function that opens its pane. */
  handle: Ref<((handle: string) => (() => void) | undefined) | undefined>;
  /** The newest openers and folder (the wiring is set up once). */
  open: Ref<{ linksOpenInKolux: boolean; onOpenLink?: (url: string) => void; onOpenFile?: (path: string, line?: number) => void; cwd: string | null }>;
  keys: Ref<{ platform: string }>;
  /** Set to the one opener, for the link menu's picks. */
  linkOpen: { current: (f: Found, door: Door) => void };
  setFlash: (text: string | null) => void;
  setLinkHint: (text: string | null) => void;
  setLinkMenu: (menu: { f: Found; top: number; left: number } | null) => void;
};

export function wireLinks(term: Terminal, el: HTMLElement, d: LinkDeps): () => void {
  // TERM-096: a printed handle of an open terminal (term-N) is a link that opens its pane.
  term.registerLinkProvider({
    provideLinks(y, done) {
      const links = safeLinks(() =>
        handlesOn(term.buffer.active, y - 1, term.cols).flatMap(({ handle, range }) => {
          const go = d.handle.current?.(handle);
          return go ? [{ range, text: handle, activate: go }] : [];
        }),
      );
      done(links.length > 0 ? links : undefined);
    },
  });
  // TERM-092 / TERM-093: web links and file paths are links (Ctrl+click; Cmd+click on macOS); a link wrapped over
  // rows is read as one; the hint under the pointer says where the click goes. The text work is in links.ts.
  // TERM-092: the link under the pointer, so a Ctrl+click on it is kept from a program that tracks the mouse.
  let hot: Found | null = null;
  const openFound = (f: Found, e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => {
    // ACCT-061: every link is checked before it is opened; a disallowed scheme or an odd target is ignored.
    if (!allowed(f)) return;
    const o = d.open.current;
    const mac = d.keys.current.platform === "darwin";
    // TERM-094: the secondary button with the modifier is the menu's (opened on the press, below); a release
    // reaching here is ignored. TERM-135: a plain web click asks first, until that was answered.
    const plan = planClick(f, e, mac, o.linksOpenInKolux && !!o.onOpenLink, linkState(), currentText().linkMenu);
    if (plan === null || plan.kind === "menu") return;
    if (plan.kind === "ask" && askLink(f.target, false, (to) => openAt(f, to === "kolux" && o.onOpenLink ? "kolux" : "system"))) return;
    openAt(f, plan.kind === "open" ? plan.door : (clickTarget(f, e, mac, o.linksOpenInKolux && !!o.onOpenLink) ?? "system"));
  };
  // the one opener: a click's door, the question's answer, or a pick from the link menu (which names its door)
  const openAt = (f: Found, door: Door) => {
    if (!allowed(f)) return;
    const o = d.open.current;
    const said = (err: unknown) => d.setFlash(openFailed(f.target, explainError(String(err)))); // VIEW-105: a failed open says so
    if (door === "kolux" && o.onOpenLink) o.onOpenLink(f.target);
    else if (door === "kolux" || door === "system") invoke("open_external", { url: f.target }).catch(said);
    else {
      const path = resolvePath(f.target, o.cwd);
      if (!path) d.setFlash(`${f.target} is a relative path and this pane has no folder`);
      else if (o.onOpenFile) o.onOpenFile(path, f.line);
      else invoke("open_path", { path }).catch(said);
    }
  };
  const hintOf = (f: Found) => {
    const o = d.open.current;
    const where = f.kind === "file" ? (o.onOpenFile ? "editor" : "app") : o.linksOpenInKolux && o.onOpenLink ? "kolux" : "browser";
    return hintFor(f, d.keys.current.platform === "darwin", where, currentText().linkMenu);
  };
  // the hint and the underline clear when the window loses focus (the pointer may never "leave" the link)
  const blurLinks = () => {
    d.setLinkHint(null);
    term.element?.querySelector(".xterm-screen")?.dispatchEvent(new MouseEvent("mouseleave"));
  };
  window.addEventListener("blur", blurLinks);
  const linksOn = (y: number) =>
    linksIn(term.buffer.active, y - 1, term.cols).map(({ f, range }) => ({
      range,
      text: f.target,
      activate: (e: MouseEvent) => openFound(f, e),
      hover: () => ((hot = f), d.setLinkHint(hintOf(f))),
      leave: () => ((hot = null), d.setLinkHint(null)),
    }));
  term.registerLinkProvider({
    provideLinks(y, done) {
      // ACCT-061: a scan that trips over unusual output leaves this row without links; the pane keeps working.
      const links = safeLinks(() => linksOn(y), (err) => console.warn("link scan skipped a row", err));
      done(links.length > 0 ? links : undefined);
    },
  });
  if (import.meta.env.DEV) (el as HTMLElement & { __koluxLinks?: typeof linksOn }).__koluxLinks = linksOn;
  // a program's own OSC 8 link (file:// allowed, other schemes are not links)
  term.options.linkHandler = {
    allowNonHttpProtocols: true,
    activate: (e, uri) => {
      const f = safeLinks(() => [linkFor(uri)])[0];
      if (f) openFound(f, e);
    },
    hover: (_e, uri) => {
      const f = safeLinks(() => [linkFor(uri)])[0];
      if (f) (hot = f), d.setLinkHint(hintOf(f));
    },
    leave: () => ((hot = null), d.setLinkHint(null)),
  };
  // TERM-092: xterm sends every unshifted press to a program that tracks the mouse; the link click is Kolux's.
  d.linkOpen.current = openAt;
  const claim = (e: MouseEvent) => {
    // TERM-094: the link modifier with right-click on a link opens the link menu (a tracking program never sees it)
    if (hot && opensMenu(e, d.keys.current.platform === "darwin", currentText().linkMenu)) {
      e.preventDefault();
      e.stopPropagation();
      d.setLinkMenu({ f: hot, top: e.clientY, left: e.clientX });
      return;
    }
    if (!hot || !claimsClick(e, d.keys.current.platform === "darwin", term.modes.mouseTrackingMode)) return;
    e.preventDefault();
    e.stopPropagation();
    openFound(hot, e);
  };
  el.addEventListener("mousedown", claim, true);
  // TERM-094: the right-click that opened the link menu opens neither the pane menu nor right-click paste
  // (T-710: a keyboard contextmenu opened no link menu, so it goes on to the pane menu)
  const menuClick = (e: MouseEvent) => {
    if (fromKeys(e) || !hot || !opensMenu({ button: 2, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }, d.keys.current.platform === "darwin", currentText().linkMenu)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener("contextmenu", menuClick, true);
  return () => {
    window.removeEventListener("blur", blurLinks);
    el.removeEventListener("mousedown", claim, true);
    el.removeEventListener("contextmenu", menuClick, true);
  };
}
