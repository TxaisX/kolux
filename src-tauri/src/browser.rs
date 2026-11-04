// Browser tabs (BROW-001, BROW-002): every tab is a child web view of the main window. The
// front end says where the pane's body is and whether it is on screen; the page is laid over
// that spot and hidden, never torn down, while its tab or screen is away, so scroll position,
// form fields, sign-in and history all survive. Pages get no Tauri capability (the capability
// names the main web view only), so a site can never reach the app's commands. T-500: Tauri still
// hands every app command to a page whose origin it counts as its own (a `*.localhost` host, the
// dev server), so a tab may only ever open http, https or the blank page, never such a host, by
// the address bar or by any navigation the page makes (`evidence/T-500-isolation.txt`). Tauri's
// IPC objects stay in the page (it defines them first, non-configurable); its origin check is
// what refuses them, and this gate is what keeps a tab off every origin that check trusts.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::{Color, DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl};

// T-195 (BROW-042, BROW-046, BROW-047): the command line's browser commands; cli.rs reaches them
// through evidence/browser-T-195-cli.rs.patch.
#[path = "browser_cli.rs"]
pub mod cli;
// T-241: BROW-045 session profiles (a tab's own engine data folder) and BROW-039 HTML previews
// (a worktree's document served from a loopback port).
#[path = "browser_profiles.rs"]
pub mod profiles;
#[path = "browser_preview.rs"]
pub mod preview;
#[path = "browser_ports.rs"]
pub mod ports;
// After-list 21 (BROW-008): whether the system has a program for a link, so Open Externally can hide.
#[path = "browser_handler.rs"]
pub mod handler;
// T-240: BROW-028 cookies brought in from a file (BROW-029 keeps Google sign-ins out).
#[path = "browser_cookies.rs"]
pub mod cookies;
// T-238-b: BROW-004 the address bar's history suggestions and BROW-013 downloads.
#[path = "browser_history.rs"]
pub mod history;
#[path = "browser_downloads.rs"]
pub mod downloads;
// T-179: BROW-020 tabs come back after a restart on their trail, BROW-021 the memory budget.
#[path = "browser_session.rs"]
pub mod session;
// T-272-d: which page holds the keyboard, from the system's focus (keyboard chord provenance).
#[path = "browser_holder.rs"]
pub mod holder;
// T-283: pages are checked again after a wake (BROW-010), leftover helpers are closed (BROW-043).
#[path = "browser_wake.rs"]
pub mod wake;
#[path = "browser_helpers.rs"]
pub mod helpers;
// T-158: BROW-015 sized popups open in a small linked window whose title bar is the origin strip;
// BROW-024 the local dev-server certificate rules, answered from the engine's certificate event.
#[path = "browser_popup.rs"]
pub mod popup;
#[path = "browser_certs.rs"]
pub mod certs;
// Row 939: the saved proxy reaches the engine as a browser argument; a tab that cannot have it is refused.
#[path = "browser_proxy.rs"]
pub mod proxy;
// T-158 / T-251 / T-272-d: the glue to WebView2's own events and calls (webview2-com).
#[path = "browser_engine.rs"]
pub mod engine;
// T-286-b (APP-040): which engine process failures are real crashes, and their records.
#[path = "browser_crash.rs"]
pub mod crash;
// T-312-b (ORCH-061): page leases for the runtime browser commands.
#[path = "browser_lease.rs"]
pub mod lease;
// T-272-b (BROW-032): how a page's permission requests are answered.
#[path = "browser_permissions.rs"]
pub mod permissions;
// after-list 719 (T-272-b): notices held for a pane that is still being built.
#[path = "browser_notices.rs"]
pub mod notices;
// T-241 (BROW-038), T-240 (BROW-035): the page's picture for drawing on and for grabbing an element.
#[path = "browser_picture.rs"]
pub mod picture;
// after-list 746 (T-319-c, BROW-052): app drags pass across the pages.
#[path = "browser_drag.rs"]
pub mod drag;
// T-316-b (EDIT-018): a markdown note printed to a PDF by a hidden page.
#[path = "browser_pdf.rs"]
pub mod pdf;
// Rows 955 / 959: the Tower's own window, built here so its browser arguments are the main window's.
// Dead until lib.rs registers tower_window_open (evidence/browser-955-lib.rs.patch).
#[allow(dead_code)]
#[path = "browser_tower.rs"]
pub mod tower;
// Row 954 (b): a tab whose own window a page destroyed is built again, never in a loop.
#[path = "browser_selfclose.rs"]
pub mod selfclose;

pub const LOAD_EVENT: &str = "browser-load";
pub const TITLE_EVENT: &str = "browser-title";
pub const CHORD_EVENT: &str = "browser-chord";
pub const LINK_EVENT: &str = "browser-link";
/// T-159 (BROW-040): a document preview asked to leave its folder; the pane offers the address.
pub const OUTBOUND_EVENT: &str = "browser-outbound";
/// T-661 (DT-C97): a page asked for the system browser; the pane asks the user before it opens.
pub const LEAVE_EVENT: &str = "browser-leave";
pub const ICON_EVENT: &str = "browser-icon";
/// T-272-c (BROW-016): a page on screen asked for another tab and its family's allowance was used
/// up; the pane shows "popups blocked" in its toolbar.
pub const BLOCKED_EVENT: &str = "browser-blocked";
/// T-272-b (BROW-032): a page's permission request was refused; `text` names the permission.
pub const PERMISSION_EVENT: &str = "browser-permission";
/// T-239 (BROW-017): a right-click inside a page (`kind: "menu"`, with the pointer, the page's
/// size, the link under it and whether text is selected) or an entry picked in the menu it opened
/// (`kind: "pick"`, with the entry and its address).
pub const MENU_EVENT: &str = "browser-menu";
/// T-239 (BROW-018): an app shortcut pressed while the keyboard is inside a page (`k`, `c`, `m`).
pub const KEY_EVENT: &str = "browser-key";

/// Asks a finished page where its icon is (BROW-023): the first `<link rel~=icon>`, else the
/// site's /favicon.ico. Runs as the page's own script; the answer is only ever fetched by the app.
const ICON_QUERY: &str = r#"(() => { const l = document.querySelector('link[rel~="icon" i][href]'); return l ? l.href : new URL("/favicon.ico", location.href).href; })()"#;

/// Icons larger than this are not shown (a real site icon is a few kilobytes).
const ICON_MAX: usize = 256 * 1024;

/// The scheme the page's script navigates to for a browser chord (`kolux-chord:back`). The
/// navigation handler turns it into `CHORD_EVENT` and cancels it, so it never reaches the
/// network or the operating system, and a page that has no script of ours sees nothing.
const CHORD_SCHEME: &str = "kolux-chord:";

/// Runs in a tab before the page's own script (row 954, BROW-001): the page's `window.close()`
/// does nothing. On Windows the engine runs it in the tab's child frames too; popups do not get it
/// (a sign-in popup closes itself when it is done), so a popup can still call `close` on the tab's
/// window: `selfclose` rebuilds the tab then. wry answers the engine's close request by destroying
/// the tab's window, which left a dead page under the "stopped responding" overlay.
pub const NO_CLOSE_SCRIPT: &str = r#"(() => {
  const keep = function close() {};
  try { Object.defineProperty(window, "close", { value: keep, writable: false, configurable: false }); } catch (_) { try { window.close = keep; } catch (_) {} }
})();"#;

/// Runs in every page's main frame before the page's own script (BROW-003, BROW-005): the
/// browser chords pressed while the keyboard is inside the page, Mod+L, Alt+Left / Alt+Right
/// (Mod+[ / Mod+] on a Mac), Mod+R and the mouse's back and forward buttons, are taken away
/// from the web view, which would otherwise go back on its own and leave the toolbar's history
/// behind, and handed to the app as a chord navigation. T-012-b-fix.
pub const CHORD_SCRIPT: &str = r#"(() => {
  if (window !== window.top) return;
  const mac = navigator.platform.startsWith("Mac");
  const send = (what) => location.assign("kolux-chord:" + what);
  addEventListener("keydown", (e) => {
    const mod = mac ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    let what = null;
    if (mod && !e.altKey && !e.shiftKey && k === "l") what = "focusAddressBar";
    else if (mod && !e.altKey && !e.shiftKey && k === "f") what = "find";
    else if (mod && !e.altKey && (k === "=" || k === "+")) what = "zoomIn";
    else if (mod && !e.altKey && k === "-") what = "zoomOut";
    else if (mod && !e.altKey && k === "0") what = "zoomReset";
    else if (mod && !e.altKey && k === "r") what = "reload";
    else if (mac ? mod && k === "[" : e.altKey && !mod && e.key === "ArrowLeft") what = "back";
    else if (mac ? mod && k === "]" : e.altKey && !mod && e.key === "ArrowRight") what = "forward";
    if (!what) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    send(what);
  }, true);
  addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    send(e.button === 3 ? "back" : "forward");
  }, true);
  // BROW-012: Ctrl (Cmd on a Mac) with the wheel zooms this tab by the app's steps; Alt or Shift
  // with it scrolls as usual. One step per burst, so a trackpad does not race to the limit.
  let wheeled = -1000;
  addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || (mac && e.metaKey)) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    if (e.timeStamp - wheeled < 120) return;
    wheeled = e.timeStamp;
    send(e.deltaY < 0 ? "zoomIn" : "zoomOut");
  }, { capture: true, passive: false });
  // BROW-014: middle click or Mod+click on a link opens it as another tab, behind this one, or in
  // front with Shift. Runs after the page's own handlers: a click the page cancelled, a click a
  // script made, a download link or a link with no web address is left to the page.
  const link = (e) => {
    if (!e.isTrusted || e.defaultPrevented) return;
    const middle = e.type === "auxclick" && e.button === 1;
    const modded = e.type === "click" && e.button === 0 && (mac ? e.metaKey : e.ctrlKey) && !e.altKey;
    if (!middle && !modded) return;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download") || !/^https?:/i.test(a.href)) return;
    e.preventDefault();
    send((e.shiftKey ? "open-front" : "open-back") + "?u=" + encodeURIComponent(a.href));
  };
  addEventListener("click", link);
  addEventListener("auxclick", link);
  // T-239 (BROW-018): the app's own shortcuts pressed while the keyboard is inside the page go to
  // the app, never to the page. The app hands in the chords it binds (`__kxKeys`, from its keymap,
  // so customised bindings count); until then the defaults below hold. The matching mirrors the
  // app's (a letter by code or key, a digit by code or key, Plus, Space, else code or key; `i`
  // takes any digit 1-9). A held-down key is taken once: repeats are swallowed, not sent.
  let keys = [{ c: 1, k: "Tab" }, { c: 1, s: 1, k: "Tab" }, { c: 1, k: "W" }, { c: 1, s: 1, k: "T" }, { c: 1, k: "T" }, { c: 1, s: 1, k: "B" }, { c: 1, k: "PageDown" }, { c: 1, k: "PageUp" }, { a: 1, k: "1", i: 1 }];
  window.__kxKeys = (list) => { if (Array.isArray(list)) keys = list; };
  const keyHit = (d, e) => {
    if (!!d.c !== e.ctrlKey || !!d.m !== e.metaKey || !!d.a !== e.altKey || !!d.s !== e.shiftKey) return false;
    const k = d.k;
    if (d.i) return /^Digit[1-9]$/.test(e.code) || /^[1-9]$/.test(e.key);
    if (/^[A-Z]$/.test(k)) return e.code === "Key" + k || e.key.toUpperCase() === k;
    if (/^[0-9]$/.test(k)) return e.code === "Digit" + k || e.key === k;
    if (k === "Plus") return e.key === "+" || e.code === "NumpadAdd";
    if (k === "Space") return e.code === "Space" || e.key === " ";
    return e.code === k || e.key === k;
  };
  // T-240 (BROW-035): a chord marked `n` (Mod+C, bound to grabbing an element) is the app's only
  // when no text is selected, in the page or in a field; with a selection the page copies as usual.
  const copying = () => {
    const a = document.activeElement;
    try { if (a && typeof a.selectionStart === "number" && a.selectionStart !== a.selectionEnd) return true; } catch (_) {}
    const s = getSelection();
    return !!s && !s.isCollapsed && String(s).length > 0;
  };
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey || e.altKey)) return;
    if (!keys.some((d) => keyHit(d, e) && !(d.n && copying()))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const m = (e.ctrlKey ? "c" : "") + (e.metaKey ? "m" : "") + (e.altKey ? "a" : "") + (e.shiftKey ? "s" : "") + (e.getModifierState("AltGraph") ? "g" : "");
    send("key?k=" + encodeURIComponent(e.key) + "&c=" + encodeURIComponent(e.code) + "&m=" + m);
  }, true);
  // T-239 (BROW-017): a right-click opens Kolux's own menu in place of the engine's. The app
  // decides the entries and where the menu sits (flipped to stay inside the pane near its edges)
  // and hands them back through `__kxMenu`. A left or middle click elsewhere, or Escape, closes
  // it; a right click elsewhere moves it. Copy and Copy Link Address run here, where the
  // selection and the clipboard are; every other entry is the app's (`pick`).
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  addEventListener("contextmenu", (e) => {
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    const link = a && /^https?:/i.test(a.href) ? a.href : "";
    const s = String(getSelection()) !== "" ? "1" : "0";
    send("menu?x=" + Math.round(e.clientX) + "&y=" + Math.round(e.clientY) + "&vw=" + innerWidth + "&vh=" + innerHeight + "&s=" + s + "&l=" + encodeURIComponent(link));
  }, true);
  addEventListener("mousedown", (e) => { if (menu && e.button !== 2 && !menu.contains(e.target)) closeMenu(); }, true);
  addEventListener("keydown", (e) => { if (menu && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); } }, true);
  window.__kxMenu = (spec) => {
    closeMenu();
    const m = document.createElement("div");
    m.setAttribute("role", "menu");
    m.style.cssText = "position:fixed;z-index:2147483647;left:" + spec.x + "px;top:" + spec.y + "px;min-width:" + spec.w + "px;box-sizing:border-box;padding:4px 0;background:" + spec.bg + ";color:" + spec.fg + ";border:1px solid " + spec.line + ";border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:12px system-ui,sans-serif;line-height:16px;user-select:none;";
    for (const it of spec.items) {
      if (it.sep) { const d = document.createElement("div"); d.style.cssText = "height:1px;margin:4px 0;background:" + spec.line; m.append(d); continue; }
      const b = document.createElement("div");
      b.setAttribute("role", "menuitem");
      b.textContent = it.label;
      b.style.cssText = "padding:5px 12px;cursor:default;white-space:nowrap;" + (it.off ? "opacity:.45;" : "");
      if (!it.off) {
        b.onmouseenter = () => { b.style.background = spec.hover; };
        b.onmouseleave = () => { b.style.background = ""; };
        b.onclick = () => {
          const u = it.url || "";
          closeMenu();
          if (it.id === "copy") document.execCommand("copy");
          else if (it.id === "copy-link") { if (navigator.clipboard) navigator.clipboard.writeText(u).catch(() => {}); }
          else send("pick?what=" + encodeURIComponent(it.id) + "&u=" + encodeURIComponent(u));
        };
      }
      m.append(b);
    }
    (document.body || document.documentElement).append(m);
    menu = m;
  };
  // T-242 (BROW-049 / BROW-050): the command line's recorder and emulation. Console messages are
  // kept from the first script on (a bounded ring), so `kolux console` sees what the page logged;
  // fetch and XHR go through one wrapper that holds requests matching the intercept
  // patterns (released when interception is disabled), fails them while offline and adds the extra
  // headers and credentials; geolocation, matchMedia and the dialogs answer as emulated. The app
  // hands the state in with `__kxEmu` on every load (so it stays in force), arms one dialog answer
  // with `__kxDialog` and reads the logs with `__kxLog`.
  const E = { intercept: null, offline: false, headers: {}, headersOrigin: null, auth: null, authOrigin: null, geo: null, media: {}, mobile: false };
  const L = { console: [], net: [], held: [], dialogs: [], armed: [], seq: 0 };
  const keep = (list, item) => { item.seq = ++L.seq; item.t = Date.now(); list.push(item); if (list.length > 500) list.shift(); };
  const shown = (a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch (_) { return String(a); } };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const real = console[level];
    console[level] = function (...args) { keep(L.console, { level, text: args.map(shown).join(" ").slice(0, 2000) }); return real.apply(this, args); };
  }
  addEventListener("error", (e) => keep(L.console, { level: "error", text: String(e.message || e) }));
  addEventListener("unhandledrejection", (e) => keep(L.console, { level: "error", text: "Unhandled rejection: " + String((e.reason && e.reason.message) || e.reason) }));
  const glob = (p, s) => new RegExp("^" + p.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(s);
  const hit = (u) => Array.isArray(E.intercept) && E.intercept.some((p) => (p.includes("*") ? glob(p, u) : u.includes(p)));
  // T-656: the extra headers and credentials go only to the site (origin) they were set for, and only
  // from a page on that site. Addresses resolve as the engine resolves them (against the document's
  // base address), the request is sent to exactly the address that was checked, and every built-in the
  // check uses is kept here, before any page script runs, so a page on another site cannot swap one to
  // read the values or to point a checked request at itself. Script the site itself serves is trusted
  // with them (DT-C92).
  const R = Reflect.apply, assign = Object.assign, ownKeys = Object.keys, desc = Object.getOwnPropertyDescriptor, define = Object.defineProperty, bare = Object.create;
  const RealURL = URL, urlHref = desc(URL.prototype, "href").get, urlOrigin = desc(URL.prototype, "origin").get;
  const baseOf = desc(Node.prototype, "baseURI").get, reqUrl = desc(Request.prototype, "url").get;
  const parse = (u, base) => { try { return new RealURL(u, base); } catch (_) { return null; } };
  const absolute = (u) => { const p = parse(u, R(baseOf, document, [])); return p ? R(urlHref, p, []) : String(u); };
  const site = (u) => { const p = parse(u); return p ? R(urlOrigin, p, []) : "null"; };
  const requestUrl = (x) => { try { return R(reqUrl, x, []); } catch (_) { return null; } };
  const extra = (url, set) => {
    const o = site(url);
    if (o === "null" || o !== location.origin) return;
    if (o === E.headersOrigin) { const hs = E.headers, ks = ownKeys(hs); for (let i = 0; i < ks.length; i++) set(ks[i], hs[ks[i]]); }
    if (E.auth && o === E.authOrigin) set("Authorization", E.auth);
  };
  const RealHeaders = Headers, headerSet = Headers.prototype.set;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const asked = requestUrl(input), url = asked !== null ? asked : absolute(input);
    if (E.offline) { keep(L.net, { url, kind: "fetch", failed: "offline" }); return Promise.reject(new TypeError("Failed to fetch (Kolux emulates offline)")); }
    const go = () => {
      const h = new RealHeaders((init && init.headers) || (asked !== null ? input.headers : undefined));
      extra(url, (k, v) => R(headerSet, h, [k, v]));
      const r = realFetch(asked !== null ? input : url, assign(bare(null), init, { headers: h }));
      r.then((res) => keep(L.net, { url, kind: "fetch", status: res.status }), () => keep(L.net, { url, kind: "fetch", failed: "error" }));
      return r;
    };
    if (hit(url)) return new Promise((res, rej) => { L.held.push({ url, kind: "fetch", go: () => go().then(res, rej) }); });
    return go();
  };
  // Each request's checked address is kept out of the page's reach (not on the request object).
  const X = XMLHttpRequest.prototype, realSetHeader = X.setRequestHeader, realOpen = X.open, realSend = X.send, opened = new WeakMap(), wmGet = WeakMap.prototype.get, wmSet = WeakMap.prototype.set;
  X.open = function (m, u, ...rest) { const url = absolute(u); R(wmSet, opened, [this, { url, method: m }]); return R(realOpen, this, [m, url, ...rest]); };
  X.send = function (body) {
    const o = R(wmGet, opened, [this]), url = o ? o.url : "";
    if (E.offline) { keep(L.net, { url, kind: "xhr", failed: "offline" }); this.dispatchEvent(new Event("error")); return; }
    const go = () => { try { extra(url, (k, v) => R(realSetHeader, this, [k, v])); } catch (_) {} this.addEventListener("loadend", () => keep(L.net, { url, kind: "xhr", method: o && o.method, status: this.status }), { once: true }); return R(realSend, this, [body]); };
    if (hit(url)) { L.held.push({ url, kind: "xhr", go }); return; }
    go();
  };
  const realOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  if (realOnLine && realOnLine.get) Object.defineProperty(navigator, "onLine", { get: () => !E.offline && realOnLine.get.call(navigator), configurable: true });
  const G = navigator.geolocation;
  if (G) {
    const realGet = G.getCurrentPosition.bind(G), realWatch = G.watchPosition.bind(G);
    const pos = () => ({ coords: { latitude: E.geo.latitude, longitude: E.geo.longitude, accuracy: E.geo.accuracy || 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
    G.getCurrentPosition = (ok, bad, o) => (E.geo ? setTimeout(() => ok(pos()), 0) : realGet(ok, bad, o));
    G.watchPosition = (ok, bad, o) => (E.geo ? setTimeout(() => ok(pos()), 0) : realWatch(ok, bad, o));
  }
  const realMatch = window.matchMedia.bind(window);
  window.matchMedia = (q) => {
    const scheme = /prefers-color-scheme:\s*(dark|light)/.exec(q), motion = /prefers-reduced-motion:\s*(reduce|no-preference)/.exec(q);
    const want = scheme && E.media.colorScheme ? scheme[1] === E.media.colorScheme : motion && E.media.reducedMotion ? motion[1] === E.media.reducedMotion : null;
    if (want === null) return realMatch(q);
    return { matches: want, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } };
  };
  const realDialog = { alert: window.alert.bind(window), confirm: window.confirm.bind(window), prompt: window.prompt.bind(window) };
  const dialog = (type, message, def) => {
    const a = L.armed.shift();
    const answer = !a ? realDialog[type](message, def) : type === "alert" ? undefined : type === "confirm" ? !!a.accept : a.accept ? (a.text != null ? String(a.text) : def == null ? "" : String(def)) : null;
    keep(L.dialogs, { type, message: String(message == null ? "" : message), answered: a ? (a.accept ? "accepted" : "dismissed") : "shown", answer: answer === undefined ? null : answer });
    return answer;
  };
  window.alert = (m) => { dialog("alert", m); };
  window.confirm = (m) => dialog("confirm", m);
  window.prompt = (m, d) => dialog("prompt", m, d);
  window.__kxDialog = (a) => { if (a && typeof a === "object") L.armed.push(a); return L.armed.length; };
  // T-656: fixed in place, so a page cannot take the state over, and values named for another site
  // than this page's are dropped before they are kept (the app blanks them too). Only the state's own
  // fields are copied, into an object with no prototype, so nothing the page put on the prototypes runs.
  define(window, "__kxEmu", { writable: false, configurable: false, value: (given) => {
    if (!given || typeof given !== "object") return;
    const s = bare(null), ks = ownKeys(given);
    for (let i = 0; i < ks.length; i++) s[ks[i]] = given[ks[i]];
    const here = location.origin;
    if ("headers" in s && s.headersOrigin !== here) s.headers = {};
    if ("auth" in s && s.authOrigin !== here) s.auth = null;
    const was = E.offline;
    assign(E, s);
    if (E.media.colorScheme) document.documentElement.style.colorScheme = E.media.colorScheme;
    if (E.mobile) Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5, configurable: true });
    if (!Array.isArray(E.intercept)) for (const h of L.held.splice(0)) { try { h.go(); } catch (_) {} }
    if (was !== E.offline) dispatchEvent(new Event(E.offline ? "offline" : "online"));
  } });
  window.__kxLog = (what, n) => {
    const last = (list) => list.slice(-(n || 100));
    if (what === "held") return L.held.map((h) => ({ url: h.url, kind: h.kind }));
    if (what === "network") {
      const perf = performance.getEntriesByType("resource").map((e) => ({ url: e.name, kind: e.initiatorType, ms: Math.round(e.duration), bytes: e.transferSize || 0 }));
      return last(perf.concat(L.net.map((e) => ({ url: e.url, kind: e.kind, method: e.method, status: e.status, failed: e.failed, t: e.t }))));
    }
    return last(what === "dialogs" ? L.dialogs : L.console);
  };
})();"#;

/// T-242: the script that hands a tab's emulation state to its page (`state` is its JSON object).
/// T-656: handed in as an object literal (re-serialised here, so it is always one), not through the
/// page's `JSON.parse`, which a page could replace to read the state.
pub fn emu_script(state: &str) -> String {
    format!("window.__kxEmu && window.__kxEmu({})", emu_literal(state))
}

/// T-656: like [`emu_script`], but `full` is only written into a document that is on `site` when the
/// script runs (a load hook can run while the previous page is still showing); any other gets `blank`.
pub fn emu_script_for(site: &str, full: &str, blank: &str) -> String {
    format!("window.__kxEmu && window.__kxEmu(location.origin === {} ? {} : {})", serde_json::Value::from(site), emu_literal(full), emu_literal(blank))
}

fn emu_literal(state: &str) -> serde_json::Value {
    serde_json::from_str(state).unwrap_or(serde_json::Value::Null)
}

/// The chord a navigation carries, if it is one of ours and names a browser action.
pub fn chord_of(url: &str) -> Option<&'static str> {
    let what = url.strip_prefix(CHORD_SCHEME)?;
    CHORDS.iter().copied().find(|c| *c == what)
}

/// BROW-016: how many tabs pages may open within `TABS_WINDOW`; the rest are absorbed.
pub const TABS_ALLOWED: usize = 5;
pub const TABS_WINDOW: Duration = Duration::from_secs(10);

/// A sliding window of the tabs pages have opened lately. A burst gets `TABS_ALLOWED` through and
/// a slow, steady stream cannot get more than that into any window either; the allowance fills up
/// again as old opens fall out of the window.
#[derive(Default)]
pub struct Allowance(VecDeque<Instant>);

impl Allowance {
    pub fn take(&mut self, now: Instant) -> bool {
        while self.0.front().is_some_and(|t| now.duration_since(*t) >= TABS_WINDOW) {
            self.0.pop_front();
        }
        if self.0.len() >= TABS_ALLOWED {
            return false;
        }
        self.0.push_back(now);
        true
    }
}

/// How long an address a page was let open waits for its tab before the promise is dropped.
pub const PROMISE_WINDOW: Duration = Duration::from_secs(10);

/// T-272-c: every family (the tab the user opened plus every tab its pages opened) has its own
/// allowance, so a storm in one tab leaves real clicks in the others alone. The members of a
/// family share one allowance, so a self-copying page cannot hand each copy a fresh five. A tab a
/// page opened joins its opener's family when it opens, matched by the address the page was let
/// open (the pane opens exactly that address as the new tab); a tab opened any other way (by the
/// user, restored after a restart) starts a family of its own.
#[derive(Default)]
pub struct Families {
    tabs: HashMap<u32, Arc<Mutex<Allowance>>>,
    promised: VecDeque<(String, Arc<Mutex<Allowance>>, Instant)>,
}

impl Families {
    /// The allowance `id`'s family shares (a tab not seen yet starts a family of its own).
    pub fn of(&mut self, id: u32) -> Arc<Mutex<Allowance>> {
        self.tabs.entry(id).or_default().clone()
    }

    /// A page in `opener` was let open `url` as another tab: that tab will join the family.
    pub fn promise(&mut self, opener: u32, url: &str, now: Instant) {
        self.prune(now);
        let family = self.of(opener);
        self.promised.push_back((same_address(url), family, now));
    }

    /// Tab `id` opens on `url`: it joins the family whose page was let open that address, else it
    /// starts its own. A tab already in a family stays there (opening it again resets nothing).
    pub fn join(&mut self, id: u32, url: &str, now: Instant) {
        if self.tabs.contains_key(&id) {
            return;
        }
        self.prune(now);
        let key = same_address(url);
        let family = match self.promised.iter().position(|p| p.0 == key) {
            Some(i) => self.promised.remove(i).map(|p| p.1).unwrap_or_default(),
            None => Arc::default(),
        };
        self.tabs.insert(id, family);
    }

    /// A closed tab leaves its family; the allowance goes with the family's last tab.
    pub fn leave(&mut self, id: u32) {
        self.tabs.remove(&id);
    }

    fn prune(&mut self, now: Instant) {
        while self.promised.front().is_some_and(|p| now.duration_since(p.2) >= PROMISE_WINDOW) {
            self.promised.pop_front();
        }
    }
}

/// One spelling per address: the page's request and the pane's open both go through the
/// web-address rules, so "HTTPS://Example.com" and "https://example.com/" are the same tab.
fn same_address(url: &str) -> String {
    Url::parse(url).map(|u| u.to_string()).unwrap_or_else(|_| url.to_string())
}

static FAMILIES: LazyLock<Mutex<Families>> = LazyLock::new(Mutex::default);

fn families() -> std::sync::MutexGuard<'static, Families> {
    FAMILIES.lock().unwrap_or_else(|e| e.into_inner())
}

/// T-272-c: a page on screen asked to open `target` and was refused only because its family's
/// allowance is used up (call it after a refusal): the opener's toolbar says popups were blocked.
/// A hidden tab or an address no tab may open is refused silently, as before.
pub fn popup_refused(target: &Url, dev: Option<&Url>, on_screen: bool) -> bool {
    on_screen && allowed(target, dev).is_ok()
}

#[derive(Clone, Serialize)]
struct BlockedPayload {
    id: u32,
}

/// The tabs whose page is on screen now (BROW-002 bounds calls keep it, and the open call says
/// whether a new tab starts on screen), so a page in a hidden tab opens no tab and sends no chord
/// (council FIX-1 A3, FIX-2 FS1).
static SHOWN: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(Mutex::default);

fn is_shown(id: u32) -> bool {
    SHOWN.lock().is_ok_and(|s| s.contains(&id))
}

fn set_shown(id: u32, on: bool) {
    if let Ok(mut s) = SHOWN.lock() {
        if on {
            s.insert(id);
        } else {
            s.remove(&id);
        }
    }
}

/// BROW-014 / BROW-016: whether a page may open `url` as another tab. Both ways a page opens tabs
/// (a new-window request and our own link navigation) come through here, so a page that loops
/// either one still gets only the allowance. A refused address takes nothing from it.
pub fn may_open(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, now: Instant) -> bool {
    allowed(url, dev).is_ok() && tabs.lock().map(|mut a| a.take(now)).unwrap_or(false)
}

/// What a navigation the page asks for becomes.
#[derive(Debug, PartialEq)]
pub enum Nav {
    /// An ordinary navigation: load it (true) or refuse it (false).
    Load(bool),
    /// Open this address as another tab, in front or behind (BROW-014).
    Link(String, bool),
    /// A browser chord pressed inside the page (BROW-003, BROW-005).
    Chord(&'static str),
    /// T-239 (BROW-017): a right-click in the page, or an entry picked in the menu it opened.
    Menu(serde_json::Value),
    /// T-239 (BROW-018): an app shortcut pressed inside the page.
    Key(serde_json::Value),
}

/// The fields of one of our `kolux-chord:<kind>?...` navigations as a JSON object (`kind` plus
/// each query field as a string); `None` unless `kind` is one of `kinds`.
fn fields_of(url: &str, kinds: &[&str]) -> Option<serde_json::Value> {
    let (kind, query) = url.strip_prefix(CHORD_SCHEME)?.split_once('?')?;
    if !kinds.contains(&kind) {
        return None;
    }
    let full = Url::parse(&format!("{CHORD_SCHEME}x?{query}")).ok()?;
    let mut m = serde_json::Map::new();
    m.insert("kind".to_string(), kind.into());
    // T-657: the kind comes from the address itself; a query field named `kind` cannot replace it.
    for (k, v) in full.query_pairs().filter(|(k, _)| k != "kind") {
        m.insert(k.into_owned(), serde_json::Value::String(v.into_owned()));
    }
    Some(serde_json::Value::Object(m))
}

/// T-239 (BROW-017): a right-click (`menu`: x, y, vw, vh, s, l) or a picked entry (`pick`: what, u).
pub fn menu_of(url: &str) -> Option<serde_json::Value> {
    fields_of(url, &["menu", "pick"])
}

/// T-239 (BROW-018): an app shortcut pressed in the page (`key`: k, c, m).
pub fn key_of(url: &str) -> Option<serde_json::Value> {
    fields_of(url, &["key"])
}

/// The event payload for a page's navigation: its fields plus the tab's id.
fn with_id(id: u32, mut v: serde_json::Value) -> serde_json::Value {
    if let Some(m) = v.as_object_mut() {
        m.insert("id".to_string(), id.into());
    }
    v
}

/// T-657 (DT-C93): whether a menu request may go to the pane. A pick that opens a Kolux tab, or asks
/// to open the system browser (T-661: the pane shows Kolux's own ask, never opens it straight away),
/// takes one from the tab family's allowance, so picks in a burst stop at it and cannot flood asks.
pub fn pick_allowed(v: &serde_json::Value, dev: Option<&Url>, tabs: &Mutex<Allowance>, now: Instant) -> bool {
    let field = |k: &str| v.get(k).and_then(|s| s.as_str());
    if field("kind") == Some("menu") || !matches!(field("what"), Some("open-kolux" | "open-default")) {
        return true;
    }
    field("u").and_then(|u| parse(u).ok()).is_some_and(|t| may_open(&t, dev, tabs, now))
}

/// T-239: the page's menu renderer and shortcut list take their data as one JSON text, embedded
/// as a string and parsed in the page, so nothing from the app ever runs there as code.
pub fn menu_script(spec: &str) -> String {
    format!("window.__kxMenu && window.__kxMenu(JSON.parse({}))", serde_json::Value::from(spec))
}

pub fn keys_script(list: &str) -> String {
    format!("window.__kxKeys && window.__kxKeys(JSON.parse({}))", serde_json::Value::from(list))
}

/// T-657 (DT-C93): whether a link request the user started may open its tab now; it takes one
/// from the tab family's allowance. Asked only after the engine's word, so a page's script sending
/// links on its own uses up nothing the user's own clicks share.
pub fn link_opens(link: &str, dev: Option<&Url>, tabs: &Mutex<Allowance>, now: Instant) -> bool {
    parse(link).ok().is_some_and(|t| may_open(&t, dev, tabs, now))
}

/// T-657 (DT-C93): the page's own requests the engine's word decides (links and the right-click menu).
pub fn needs_word(uri: &str) -> bool {
    link_of(uri).is_some() || menu_of(uri).is_some()
}

/// Decides one navigation of a tab's page. `on_screen` is whether that tab is shown now: a tab
/// that is not cannot have a user's click or key behind it (council FIX-2, FS1), so it opens no
/// tab, takes nothing from the allowance the user's own clicks share, and sends no chord (a
/// hidden page looping `focusAddressBar` would pull the keyboard off the pane the user types in).
pub fn navigation(url: &Url, dev: Option<&Url>, on_screen: bool) -> Nav {
    if let Some((target, front)) = link_of(url.as_str()) {
        return match parse(&target) {
            // T-657: the allowance is taken later, once the engine says the user started it (link_opens).
            Ok(t) if on_screen && allowed(&t, dev).is_ok() => Nav::Link(target, front),
            _ => Nav::Load(false),
        };
    }
    // T-239: a right-click, a menu pick or an app shortcut from a page that is not on screen is
    // dropped like a chord (FS1: no user is behind it).
    if let Some(v) = menu_of(url.as_str()) {
        return if on_screen { Nav::Menu(v) } else { Nav::Load(false) };
    }
    if let Some(v) = key_of(url.as_str()) {
        return if on_screen { Nav::Key(v) } else { Nav::Load(false) };
    }
    match chord_of(url.as_str()) {
        Some(_) if !on_screen => Nav::Load(false),
        Some(what) => Nav::Chord(what),
        // T-500: a redirect, link or script cannot take the tab where the bar may not.
        None => Nav::Load(allowed(url, dev).is_ok()),
    }
}

const CHORDS: [&str; 8] = ["focusAddressBar", "back", "forward", "reload", "find", "zoomIn", "zoomOut", "zoomReset"];

/// A page asked for a new window (a `_blank` link, `window.open`): the tab to open in its place,
/// in front. Only a tab on screen gets one (FS1, as for links above).
pub fn new_window(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, on_screen: bool, now: Instant) -> Option<(String, bool)> {
    (on_screen && may_open(url, dev, tabs, now)).then(|| (url.to_string(), true))
}

/// A link the page's script asked to open as another tab (BROW-014): the address and whether
/// the new tab comes to the front.
pub fn link_of(url: &str) -> Option<(String, bool)> {
    let (what, query) = url.strip_prefix(CHORD_SCHEME)?.split_once("?u=")?;
    let front = match what {
        "open-front" => true,
        "open-back" => false,
        _ => return None,
    };
    let full = Url::parse(&format!("{CHORD_SCHEME}x?u={query}")).ok()?;
    let target = full.query_pairs().find(|(k, _)| k == "u")?.1.into_owned();
    Some((target, front))
}

#[derive(Clone, Serialize)]
struct LoadPayload {
    id: u32,
    event: &'static str,
    url: String,
}

#[derive(Clone, Serialize)]
struct TitlePayload {
    id: u32,
    title: String,
}

#[derive(Clone, Serialize)]
struct IconPayload {
    id: u32,
    /// The page the icon belongs to, so the pane can tell a late answer for an old site.
    page: String,
    /// The icon as a data: address (the app's own pages may not load images from the web).
    icon: String,
}

/// The icon address a page gave (`eval_with_callback` hands back the result as JSON), if it is a
/// web address a tab could open (T-500: never one of the app's own origins). The app fetches it
/// itself, so a public page may not point it at the user's own machine or network (a router, a
/// LAN dev server): an icon on such a host is fetched only for a page on that same host.
pub fn icon_address(answer: &str, app: Option<&Url>, page: &Url) -> Option<Url> {
    let href: String = serde_json::from_str(answer).ok()?;
    let url = parse(&href).ok()?;
    let near_ok = !local_host(&url) || same_spot(&url, page);
    (url.scheme() != "about" && allowed(&url, app).is_ok() && near_ok).then_some(url)
}

/// Whether an address names this machine or the local network rather than the public web:
/// loopback, private, link-local, carrier-grade NAT and unspecified addresses, `localhost`, and
/// names that only a local network resolves (no dot, `.local`, `.lan`, `.internal`, `.home.arpa`).
/// A public name that resolves to such an address is caught by the icon fetch's own lookup
/// (`Resolver`), which also covers a name rebound after the page loaded (council FIX-2, FS2).
pub fn local_host(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']');
    match host.parse::<IpAddr>() {
        Ok(ip) => local_ip(ip),
        Err(_) => {
            let d = host.trim_end_matches('.').to_ascii_lowercase();
            d.is_empty() || !d.contains('.') || [".localhost", ".local", ".lan", ".internal", ".home.arpa"].iter().any(|s| d.ends_with(s))
        }
    }
}

/// Whether an address is on this machine or the local network: loopback, private, link-local,
/// carrier-grade NAT, `0.0.0.0/8` and broadcast, and the IPv6 forms of those, including an IPv4
/// address written as IPv6 (mapped `::ffff:a.b.c.d` or compatible `::a.b.c.d`, council FIX-2).
/// Council FIX-3 adds, whole: `198.18.0.0/15` (benchmarking), `192.0.0.0/24`, `240.0.0.0/4`
/// (reserved, broadcast inside), NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4 `2002::/16` and
/// site-local `fec0::/10`, each of which can carry or reach a local IPv4 address.
pub fn local_ip(ip: IpAddr) -> bool {
    let v4 = |ip: Ipv4Addr| {
        let [a, b, c, _] = ip.octets();
        a == 0
            || ip.is_loopback()
            || ip.is_private()
            || ip.is_link_local()
            || (a == 100 && (b & 0xc0) == 64)
            || (a == 198 && (b & 0xfe) == 18)
            || (a == 192 && b == 0 && c == 0)
            || a >= 240
    };
    match ip {
        IpAddr::V4(ip) => v4(ip),
        IpAddr::V6(ip) => {
            let g = ip.segments();
            ip.is_loopback()
                || ip.is_unspecified()
                || (g[0] & 0xfe00) == 0xfc00
                || (g[0] & 0xffc0) == 0xfe80
                || (g[0] & 0xffc0) == 0xfec0
                || g[0] == 0x2002
                || (g[0] == 0x64 && g[1] == 0xff9b && (g[2..6] == [0; 4] || g[2] == 1))
                || ip.to_ipv4().is_some_and(v4)
        }
    }
}

/// How many redirects an icon fetch follows.
const ICON_HOPS: usize = 5;

/// Whether an icon fetch may follow a redirect to `next`, given the addresses already asked
/// (`previous`, first the icon address the page gave): the same rule as a tab's address on every
/// hop, never from https down to http, and never onto this machine or the local network unless
/// the chain started on that very host (which `icon_address` only allows for a page there).
pub fn hop_ok(next: &Url, previous: &[Url], app: Option<&Url>) -> bool {
    let (Some(first), Some(last)) = (previous.first(), previous.last()) else { return false };
    previous.len() <= ICON_HOPS
        && next.scheme() != "about"
        && allowed(next, app).is_ok()
        && !(last.scheme() == "https" && next.scheme() == "http")
        && (!local_host(next) || same_spot(next, first))
}

/// How the icon fetch looks a host name up: the system's own lookup, or a stand-in in tests.
pub type Lookup = fn(&str) -> std::io::Result<Vec<IpAddr>>;

fn system_lookup(host: &str) -> std::io::Result<Vec<IpAddr>> {
    use std::net::ToSocketAddrs;
    Ok((host, 0).to_socket_addrs()?.map(|a| a.ip()).collect())
}

/// The addresses an icon fetch for another host may connect to (council FIX-2, FS2).
pub fn public_addrs(ips: Vec<IpAddr>) -> Vec<IpAddr> {
    ips.into_iter().filter(|ip| !local_ip(*ip)).collect()
}

/// The icon fetch's own name lookup: for any host other than the page's own, only public
/// addresses come back, so a public name that points at this machine or the local network
/// (`192-168-1-1.nip.io`, `localtest.me`, or a name rebound after the page loaded) is never asked.
struct Resolver {
    lookup: Lookup,
    public: bool,
}

impl reqwest::dns::Resolve for Resolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let (lookup, public, host) = (self.lookup, self.public, name.as_str().to_string());
        Box::pin(async move {
            let ips = tauri::async_runtime::spawn_blocking(move || lookup(&host)).await??;
            let ips = if public { public_addrs(ips) } else { ips };
            if ips.is_empty() {
                return Err("the icon host is on this machine or the local network".into());
            }
            let addrs: reqwest::dns::Addrs = Box::new(ips.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

/// The two icon clients, both built by the one `icon_client_for` builder line. `near` fetches a
/// page's own-host icon only when that page is itself open on this machine or the local network
/// (`icon_near`); a redirect off that host stops and is handed to `far`. `far` fetches every
/// other icon, a public page's own-host icon included, through the public-only lookup. Neither
/// goes through a proxy (a proxy would resolve the name where the lookup cannot see it), so with a saved
/// proxy no icon is fetched at all (T-323-c: `fetch_icon_unless_proxied`; never around the proxy).
/// DNS rebinding: a public name rebound to a local address after its page loaded reaches `far`
/// as an empty lookup and is never asked (council FIX-3: reqwest goes through none of the
/// engine's local-network checks, so `near` never serves a public page).
pub struct IconClients {
    near: reqwest::Client,
    far: reqwest::Client,
}

/// An icon client with the redirect rule above: a refused hop fails the fetch.
fn icon_client_for(app: Option<Url>, near: bool, lookup: Lookup) -> Option<reqwest::Client> {
    let policy = reqwest::redirect::Policy::custom(move |hop| {
        let same = hop.previous().first().is_some_and(|first| same_spot(first, hop.url()));
        if !hop_ok(hop.url(), hop.previous(), app.as_ref()) {
            let to = hop.url().to_string();
            hop.error(format!("icon redirect to {to} refused"))
        } else if near && !same {
            hop.stop()
        } else {
            hop.follow()
        }
    });
    let resolver = Resolver { lookup, public: !near };
    reqwest::Client::builder().timeout(Duration::from_secs(8)).redirect(policy).no_proxy().dns_resolver(resolver).build().ok()
}

pub fn icon_clients(app: Option<Url>, lookup: Lookup) -> Option<IconClients> {
    Some(IconClients { near: icon_client_for(app.clone(), true, lookup)?, far: icon_client_for(app, false, lookup)? })
}

/// The clients every icon fetch shares (the dev origin never changes while the app runs).
fn icon_client(app: Option<Url>) -> Option<&'static IconClients> {
    static CLIENTS: OnceLock<Option<IconClients>> = OnceLock::new();
    CLIENTS.get_or_init(move || icon_clients(app, system_lookup)).as_ref()
}

/// What a tab's icon request should do: answer from the icon already fetched for that address,
/// wait for the fetch already under way, or fetch it.
#[derive(Debug, PartialEq)]
pub enum IconStep {
    Have(String),
    Busy,
    Fetch,
}

/// The icon fetch under way for each tab and the last icon each tab got, so a page that reloads
/// itself in a loop, even with a new icon address each time, has one fetch at a time (council
/// FIX-2, AFTER 2). A request while that fetch runs is dropped, not queued: the tab's next
/// finished load asks again, and a fetch ends within `ICON_TIME`.
#[derive(Default)]
pub struct Icons {
    busy: HashMap<u32, String>,
    got: HashMap<u32, (String, String)>,
}

impl Icons {
    pub fn begin(&mut self, id: u32, url: &str) -> IconStep {
        if let Some((at, icon)) = self.got.get(&id) {
            if at == url {
                return IconStep::Have(icon.clone());
            }
        }
        if self.busy.contains_key(&id) {
            return IconStep::Busy;
        }
        self.busy.insert(id, url.to_string());
        IconStep::Fetch
    }

    /// A fetch ended; a failed one (`None`) is tried again on the next load.
    pub fn end(&mut self, id: u32, url: &str, icon: Option<&str>) {
        // A tab closed while its fetch ran keeps nothing.
        if self.busy.get(&id).is_some_and(|at| at == url) {
            self.busy.remove(&id);
            if let Some(icon) = icon {
                self.got.insert(id, (url.to_string(), icon.to_string()));
            }
        }
    }

    pub fn forget(&mut self, id: u32) {
        self.got.remove(&id);
        self.busy.remove(&id);
    }
}

static ICONS: LazyLock<Mutex<Icons>> = LazyLock::new(Mutex::default);

/// The icon bytes as a data: address, if the server said it is an image and it is small enough.
pub fn icon_data(kind: &str, bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    let kind = kind.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    if !kind.starts_with("image/") || bytes.is_empty() || bytes.len() > ICON_MAX {
        return None;
    }
    Some(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Whether an icon is fetched by the near client: it is on the page's own host and that page is
/// itself open on this machine or the local network (council FIX-3). A public page's icon, on its
/// own name or not, goes through the public-only lookup, so a name rebound to a local address
/// after the page loaded is never asked.
pub fn icon_near(url: &Url, page: &Url) -> bool {
    local_host(page) && same_spot(url, page)
}

/// Whether two addresses name the same host on the same port, a scheme's default port counting
/// as written (council FIX-4, AFTER 2): a page on one port of this machine never reaches another.
pub fn same_spot(a: &Url, b: &Url) -> bool {
    a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// What is left of an icon fetch's time limit after `elapsed`; `None` once it has run out
/// (council FIX-4, AFTER 3: the far request after a hand-off gets only this).
pub fn time_left(elapsed: Duration, limit: Duration) -> Option<Duration> {
    limit.checked_sub(elapsed).filter(|d| !d.is_zero())
}

/// Whether a focusAddressBar chord may move the keyboard into the app's own view: only while the
/// app's window holds the keyboard at the system level (a child page holding it still counts), so
/// a page cannot pull the keyboard while the user is in another program (council FIX-4, item 3).
pub fn focus_app_ok(window_focused: bool) -> Result<(), String> {
    if window_focused {
        Ok(())
    } else {
        Err("the app's window does not hold the keyboard".into())
    }
}

/// Where a redirect the near client stopped at goes next, if the far client may follow it: the
/// `Location` joined to the address that answered, under the same rule as every other hop.
pub fn hand_off(from: &Url, location: Option<&str>, app: Option<&Url>) -> Option<Url> {
    let next = from.join(location?).ok()?;
    hop_ok(&next, std::slice::from_ref(from), app).then_some(next)
}

/// T-323-c: whether an icon may be fetched. The icon clients connect directly (their public-only name
/// lookup would not see a proxy's side), so a saved proxy, or one that cannot be read, means no icon
/// rather than a connection around the user's proxy. An empty setting means "the system's proxy"
/// (OD-18): it allows the fetch only while [`system_proxy_in_use`] says there is none (T-323-e).
pub fn icon_fetch_allowed(saved: &Result<Option<String>, String>) -> bool {
    matches!(saved, Ok(p) if matches!(proxy_of(p.as_deref()), Ok(None))) && !system_proxy_in_use()
}

/// T-323-e: whether the system names a proxy: the Windows per-user proxy (`ProxyEnable` 1 with a
/// `ProxyServer`) or a PAC script (`AutoConfigURL`), or a proxy environment variable on any platform.
/// ponytail: "Automatically detect settings" (WPAD) alone is not counted: it is on by default on most
/// Windows machines, so failing closed on it would remove icons for nearly everyone. A WPAD-only
/// proxy still goes unseen, as do macOS and Linux desktop proxy settings (no process spawned per check).
pub(crate) fn system_proxy_from(enable: Option<u32>, server: Option<&str>, pac: Option<&str>, env: impl Fn(&str) -> Option<String>) -> bool {
    let set = |v: Option<&str>| v.is_some_and(|v| !v.trim().is_empty());
    (enable == Some(1) && set(server))
        || set(pac)
        || ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].iter().any(|n| set(env(n).as_deref()))
}

/// The machine's proxy settings, read now. A read error or a missing key (the normal case) is "not in use".
fn read_system_proxy() -> bool {
    #[cfg(windows)]
    let (enable, server, pac) = {
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
        const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let (key, name) = (wide(KEY), wide("ProxyEnable"));
        let (mut value, mut bytes) = (0u32, 4u32);
        // SAFETY: both strings are NUL-terminated and outlive the call; `value` holds the 4 bytes a DWORD needs.
        let rc = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&mut value as *mut u32).cast(), &mut bytes) };
        let reg = |v: &str| crate::agents::registry_string(HKEY_CURRENT_USER, KEY, v);
        ((rc == 0).then_some(value), reg("ProxyServer"), reg("AutoConfigURL"))
    };
    #[cfg(not(windows))]
    let (enable, server, pac): (Option<u32>, Option<String>, Option<String>) = (None, None, None);
    system_proxy_from(enable, server.as_deref(), pac.as_deref(), |n| std::env::var(n).ok())
}

/// [`read_system_proxy`], remembered for 30 s: icons and HEADs fire often and there is no watcher.
#[cfg(not(test))]
fn system_proxy_in_use() -> bool {
    static SEEN: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    match *seen {
        Some((at, v)) if at.elapsed() < Duration::from_secs(30) => v,
        _ => {
            let v = read_system_proxy();
            *seen = Some((Instant::now(), v));
            v
        }
    }
}

// Tests never read this machine's registry or environment: the answer is set per test thread.
#[cfg(test)]
thread_local! {
    static SYSTEM_PROXY_FOR_TEST: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn system_proxy_in_use() -> bool {
    SYSTEM_PROXY_FOR_TEST.with(|c| c.get())
}

#[cfg(test)]
fn set_system_proxy_for_test(on: bool) {
    SYSTEM_PROXY_FOR_TEST.with(|c| c.set(on));
}

/// The sealed proxy setting as saved (None without a store or a value).
fn saved_proxy(app: &AppHandle) -> Result<Option<String>, String> {
    match app.try_state::<Mutex<crate::state::Store>>() {
        Some(store) => {
            let store = store.lock().map_err(|e| e.to_string())?;
            proxy_in_profile(store.try_settings(), &store.dir())
        },
        None => Ok(None),
    }
}

const SETTINGS_UNREADABLE: &str = "Kolux can't read its settings, so the in-app browser won't open pages in case a proxy is set. Nothing was loaded directly; restart Kolux or check settings.json.";

/// The saved `httpProxy`, opened. A file that cannot be read is an error, never "no proxy"; a file
/// that is simply not there (first run) reads as no settings.
fn proxy_in_settings(read: std::io::Result<serde_json::Value>) -> Result<Option<String>, String> {
    match read.map_err(|_| SETTINGS_UNREADABLE.to_string())?.get("httpProxy") {
        Some(serde_json::Value::String(s)) if !s.is_empty() => crate::secrets::unseal(s).map(Some),
        _ => Ok(None),
    }
}

/// `proxy_in_settings` plus a second look at the last good copy for a missing settings.json (the
/// load itself reads that copy since row 944; this is the belt for a copy too damaged to say). That is "can't read", never "no proxy".
fn proxy_in_profile(read: std::io::Result<serde_json::Value>, dir: &std::path::Path) -> Result<Option<String>, String> {
    let saved = proxy_in_settings(read)?;
    if saved.is_some() || !matches!(std::fs::metadata(dir.join("settings.json")), Err(e) if e.kind() == std::io::ErrorKind::NotFound) {
        return Ok(saved);
    }
    match std::fs::read(dir.join("settings.json.bak")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(SETTINGS_UNREADABLE.to_string()),
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) if v.is_object() && v.get("httpProxy").is_none_or(|p| p.as_str() == Some("")) => Ok(None),
            _ => Err(SETTINGS_UNREADABLE.to_string()),
        },
    }
}

/// `fetch_icon` unless a proxy is saved: then no connection is made and there is no icon.
pub(crate) async fn fetch_icon_unless_proxied(saved: &Result<Option<String>, String>, clients: &IconClients, near: bool, url: Url, app: Option<&Url>) -> Option<String> {
    if !icon_fetch_allowed(saved) {
        return None;
    }
    fetch_icon(clients, near, url, app).await
}

/// How long one icon fetch may take in all, near and far together.
const ICON_TIME: Duration = Duration::from_secs(8);

/// `near` is whether the icon is on the page's own host.
/// Fetches an icon, reading no more of the body than an icon may be: a non-image answer or one
/// that says it is too large is dropped before its body is read, and a body that turns out too
/// large is dropped as soon as it passes the limit.
async fn fetch_icon(clients: &IconClients, near: bool, url: Url, app: Option<&Url>) -> Option<String> {
    fetch_icon_within(clients, near, url, app, ICON_TIME).await
}

/// The fetch under one overall time limit: each request's own timeout runs until its body is
/// read, and the far request after a hand-off gets only what the near one left. The redirect cap
/// is per client, so a hand-off can take up to twice `ICON_HOPS` hops, all inside the limit.
pub(crate) async fn fetch_icon_within(clients: &IconClients, near: bool, url: Url, app: Option<&Url>, limit: Duration) -> Option<String> {
    let start = Instant::now();
    let mut res = if near { &clients.near } else { &clients.far }.get(url).timeout(limit).send().await.ok()?;
    if near && res.status().is_redirection() {
        // The near client stopped at a redirect off the page's host: the rest is the far client's.
        let next = hand_off(res.url(), res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()), app)?;
        let left = time_left(start.elapsed(), limit)?;
        res = clients.far.get(next).timeout(left).send().await.ok()?;
    }
    let mut res = res.error_for_status().ok()?;
    let kind = res.headers().get(reqwest::header::CONTENT_TYPE)?.to_str().ok()?.to_string();
    if !kind.trim().to_ascii_lowercase().starts_with("image/") || res.content_length().is_some_and(|n| n > ICON_MAX as u64) {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.ok()? {
        if body.len() + chunk.len() > ICON_MAX {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    icon_data(&kind, &body)
}

/// BROW-023: the icon for one finished load, fetched at most once per address at a time.
fn icon_for(app: AppHandle, dev: Option<Url>, id: u32, page: String, url: Url, near: bool) {
    let step = ICONS.lock().map(|mut i| i.begin(id, url.as_str())).unwrap_or(IconStep::Busy);
    match step {
        IconStep::Busy => {}
        IconStep::Have(icon) => {
            let _ = app.emit(ICON_EVENT, IconPayload { id, page, icon });
        }
        IconStep::Fetch => {
            let saved = saved_proxy(&app);
            tauri::async_runtime::spawn(async move {
                let icon = match icon_client(dev.clone()) {
                    Some(clients) => fetch_icon_unless_proxied(&saved, clients, near, url.clone(), dev.as_ref()).await,
                    None => None,
                };
                if let Ok(mut i) = ICONS.lock() {
                    i.end(id, url.as_str(), icon.as_deref());
                }
                if let Some(icon) = icon {
                    let _ = app.emit(ICON_EVENT, IconPayload { id, page, icon });
                }
            });
        }
    }
}

#[derive(Clone, Serialize)]
struct LinkPayload {
    id: u32,
    url: String,
    front: bool,
}

#[derive(Clone, Serialize)]
struct ChordPayload {
    id: u32,
    what: String,
}

/// Where a pane body is, in CSS pixels from the window's top left.
#[derive(Clone, Copy, Deserialize)]
pub struct Spot {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The web view label for a tab; the front end's pane key is the id.
pub fn label(id: u32) -> String {
    format!("browser-{id}")
}

/// A full address for the web view. What the user typed is resolved in the front end
/// (BROW-003); the back end only refuses what is not an address at all.
pub fn parse(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|e| format!("invalid address: {e}"))
}

/// Whether a tab may go to `url` (T-500): http, https or the blank page only. A `*.localhost`
/// host is where the app itself (tauri.localhost), its IPC (ipc.localhost) and every custom scheme
/// (kolux-artifact.localhost) answer, and `app` is the app's own origin in a development build;
/// Tauri counts a page at any of those as its own and opens every app command to it, so a tab
/// never goes there. Plain `localhost` (a user's own dev server) is fine.
pub fn allowed(url: &Url, app: Option<&Url>) -> Result<(), String> {
    if url.as_str() == "about:blank" {
        return Ok(());
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("{}: addresses do not open in a browser tab", url.scheme()));
    }
    // `tauri.localhost.` is the same host as `tauri.localhost` (council FIX-2, AFTER 5).
    let host = url.host_str().unwrap_or_default().trim_end_matches('.');
    let app_own = |a: &Url| a.scheme() == url.scheme() && a.port_or_known_default() == url.port_or_known_default() && a.host_str().map(|h| h.trim_end_matches('.')) == Some(host);
    if host.ends_with(".localhost") || app.is_some_and(app_own) {
        return Err(format!("{host} is the app's own address and does not open in a browser tab"));
    }
    Ok(())
}

/// The app's own origin while it runs from the dev server; a release build serves itself from a
/// `*.localhost` host, which `allowed` refuses on its own.
fn app_origin(app: &AppHandle) -> Option<Url> {
    tauri::is_dev().then(|| app.config().build.dev_url.clone()).flatten()
}

fn view(app: &AppHandle, id: u32) -> Result<Webview, String> {
    app.get_webview(&label(id)).ok_or_else(|| format!("browser tab {id} is not open"))
}

/// after-list 91: does page `id` exist in the engine (opened, whether or not its pane has reported
/// it yet)? False before the app is known.
pub fn page_exists(id: u32) -> bool {
    driver().ok().and_then(|d| d(Act::Exists(id)).ok()).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn err(e: tauri::Error) -> String {
    e.to_string()
}

/// Opens a tab's page over the given spot (CSS pixels, window-relative). Async on purpose:
/// creating a child web view from the main thread deadlocks on Windows. Creating the page moves
/// the keyboard off the app's web view (to the page, or with `focused(false)` to the bare window),
/// so it is handed back for the address bar (BROW-001).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // a Tauri command takes its arguments one by one
pub async fn browser_open(app: AppHandle, window: tauri::Window, webview: Webview, id: u32, url: String, spot: Spot, background: Option<[u8; 3]>, shown: Option<bool>, profile: Option<String>, rebuild: Option<String>) -> Result<(), String> {
    // Row 954 (c): "auto" / "retry" mark a rebuild of a tab that had a page: it keeps its saved profile and never takes focus.
    // Row 977: "restore" marks a pane that came back from the saved layout: it reads its own saved profile row.
    let rebuild = selfclose::Rebuild::from_arg(rebuild.as_deref());
    if let Ok(dir) = app.path().app_data_dir() {
        helpers::sweep_at_start(&dir); // T-283 (BROW-043); the app's start-up normally ran it already
        profiles::set_root(dir.clone()); // T-241
        // Row 979: before any step that can fail, so a failed open never leaves an older tab's row for a later restore of this id.
        profiles::clear_stale_row(&dir, id, rebuild);
    }
    // Row 954f: Tauri may still hold the label of the page this open replaces; wait a bounded time for it, never reuse it.
    if app.get_webview(&label(id)).is_some() {
        let probe = app.clone();
        let name = label(id);
        let free = tauri::async_runtime::spawn_blocking(move || {
            selfclose::wait_until_free(|| probe.get_webview(&name).is_some(), Duration::from_millis(1500), Duration::from_millis(20))
        })
        .await
        .unwrap_or(false);
        if !free {
            return Err(format!("browser tab {id} is still being closed; try again"));
        }
    }
    let url = parse(&url)?;
    notices::opening(id); // after-list 719: its notices wait for the pane's browser_pane_ready
    families().join(id, url.as_str(), Instant::now()); // T-272-c
    let _ = APP.set(app.clone()); // T-195: the command line's browser commands need the app
    wake::watch(&app); // T-283 (BROW-010)
    // T-179 (BROW-020): a tab that was open at the last quit comes back on its trail; one that is
    // not on screen stays blank until it is shown. Its saved title names the tab meanwhile.
    let opening = session::opening(id, url.as_str(), shown.unwrap_or(true));
    let url = parse(&opening.url)?;
    if let Some(title) = opening.title {
        let _ = app.emit(TITLE_EVENT, TitlePayload { id, title });
    }
    let _ = DRIVER.set(Box::new(drive));
    let dev = app_origin(&app);
    allowed(&url, dev.as_ref())?;
    let load_app = app.clone();
    let chord_app = app.clone();
    let window_app = app.clone();
    let permission_app = app.clone();
    #[cfg(windows)]
    let self_close_app = app.clone();
    let window_dev = dev.clone();
    let icon_dev = dev.clone();
    let download_app = app.clone();
    // T-240 (BROW-033): every tab of every profile goes through the configured proxy; a value the
    // engine cannot take leaves the tab unopened rather than going direct.
    let saved = proxy_of(saved_proxy(&app)?.as_deref())?;
    #[cfg(windows)]
    let crash_dir = app.path().app_data_dir().ok();
    // T-239-b (BROW-025): whether this tab's profile shows Firefox on the sign-in hosts.
    let key = url.to_string();
    let (builder, spoof, folder, profile_gone) = with_profile(WebviewBuilder::new(label(id), WebviewUrl::External(url)), id, profile, rebuild, &key);
    if profile_gone {
        // Row 977: held with the other open notices until the pane says it is up.
        notices::send(&app, id, PERMISSION_EVENT, serde_json::json!({ "id": id, "text": profiles::RESTORE_GONE_NOTICE }), Some(profiles::RESTORE_GONE_NOTICE.to_string()));
    }
    // Row 939: on Windows wry drops `.proxy_url()` whenever browser arguments are passed, so the proxy
    // rides in them; elsewhere `.proxy_url()` is the only road and stays. Tabs already open keep the
    // proxy they opened with until Kolux restarts.
    let launch = crate::resources::recovery::browser_args_now();
    let setup = proxy::tab_setup(&launch, &folder, saved.as_ref());
    let (args, url_proxy) = setup.inspect_err(|_| profiles::page_closed(id))?; // no engine page was made: the profile's folder is not in use
    let builder = match url_proxy {
        Some(u) => builder.proxy_url(u),
        None => builder,
    };
    let builder = builder
        .focused(false)
        // T-286-b (APP-017): the window's browser arguments (throttling exemption, safe graphics),
        // or the engine refuses a second set on the same data folder; plus the saved proxy.
        .additional_browser_args(&args)
        // BROW-012: zoom is the app's, in its own steps, so the engine's own zoom keys are off.
        .zoom_hotkeys_enabled(false)
        .initialization_script(CHORD_SCRIPT)
        .initialization_script(NO_CLOSE_SCRIPT)
        // BROW-014: a link or script asking for a new window becomes another Kolux tab, in front.
        .on_new_window(move |url, features| {
            // T-657: the engine's word is used up first, so none is left over for a later window.
            let started = popup::window_started(id, &url);
            // T-159 (BROW-040): a document preview's popups and script-opened windows are blocked;
            // an outside address is offered to the user once, with its full address.
            if let Some(v) = preview::navigating(id, url.as_str()) {
                if v == preview::Verdict::Offer {
                    let _ = window_app.emit(OUTBOUND_EVENT, LinkPayload { id, url: url.to_string(), front: true });
                }
                return NewWindowResponse::Deny;
            }
            // T-657 (DT-C93): a window the user did not start (a page's timer) opens nothing, not
            // even the system browser; the toolbar says a popup was blocked.
            if !started {
                if popup_refused(&url, window_dev.as_ref(), is_shown(id)) {
                    let _ = window_app.emit(BLOCKED_EVENT, BlockedPayload { id });
                }
                return NewWindowResponse::Deny;
            }
            // BROW-016: a page opening windows in a loop gets a handful of tabs, never a flood;
            // T-272-c: counted per family, and a refusal is shown in this tab's toolbar.
            let (now, shown) = (Instant::now(), is_shown(id));
            let family = families().of(id);
            match new_window(&url, window_dev.as_ref(), &family, shown, now) {
                Some((link, front)) => {
                    // T-158 (BROW-015): a sized window.open is a popup window linked to this tab;
                    // before the tab's page finished a load it goes to the system browser.
                    match popup::route(features.size().is_some(), popup::is_ready(id)) {
                        popup::Route::Window => {
                            if let Some(window) = popup::open(&window_app, id, &url, features, window_dev.clone(), spoof) {
                                return NewWindowResponse::Create { window };
                            }
                            return NewWindowResponse::Deny;
                        }
                        // T-661 (DT-C97): the page's word and a click it may have steered are not
                        // enough to leave Kolux; the pane asks, naming the host, and opens it on Open.
                        popup::Route::System => {
                            let _ = window_app.emit(LEAVE_EVENT, LinkPayload { id, url: link, front: true });
                            return NewWindowResponse::Deny;
                        }
                        popup::Route::Tab => {}
                    }
                    let url = link;
                    families().promise(id, &url, now);
                    let _ = window_app.emit(LINK_EVENT, LinkPayload { id, url, front });
                }
                None if popup_refused(&url, window_dev.as_ref(), shown) => {
                    let _ = window_app.emit(BLOCKED_EVENT, BlockedPayload { id });
                }
                None => {}
            }
            NewWindowResponse::Deny
        })
        .on_navigation(move |url| {
            let shown = is_shown(id);
            let nav = navigation(url, dev.as_ref(), shown);
            match nav {
            // T-159 (BROW-040): a document preview follows its own files and what the app asked for;
            // the first outside address is offered to the user, the rest are dropped.
            // T-242 (BROW-050): a tab emulating offline loads nothing new, as a cut cable would.
            Nav::Load(go) => match preview::navigating(id, url.as_str()) {
                Some(preview::Verdict::Offer) => {
                    let _ = chord_app.emit(OUTBOUND_EVENT, LinkPayload { id, url: url.to_string(), front: true });
                    false
                }
                Some(preview::Verdict::Drop) => false,
                _ => go && !cli::offline(id),
            },
            // T-657 (DT-C93): a link or menu request acts only once the engine says the user
            // started it; one a page's script sent on its own is dropped.
            // T-272-c: one refused only by the family's allowance is shown in the toolbar.
            Nav::Link(link, front) => {
                let (app, dev) = (chord_app.clone(), dev.clone());
                popup::when_started(id, url.as_str(), Box::new(move || {
                    if link_opens(&link, dev.as_ref(), &families().of(id), Instant::now()) {
                        families().promise(id, &link, Instant::now());
                        let _ = app.emit(LINK_EVENT, LinkPayload { id, url: link, front });
                    } else {
                        let _ = app.emit(BLOCKED_EVENT, BlockedPayload { id });
                    }
                }));
                false
            }
            // T-272-d: a keyboard chord or app shortcut with no real key pressed in that very page
            // (the engine's key events), or sent while another page holds the keyboard, was sent
            // by this page's script, not pressed: it is dropped.
            Nav::Chord(what) if holder::drop_chord(id, &holder::need_for_chord(what)) => false,
            Nav::Key(ref v) if holder::drop_chord(id, &holder::need_for_key(v)) => false,
            Nav::Chord(what) => {
                // Council FIX-3: the keyboard is not moved here. The app tells a chord pressed in
                // the page (its own window does not hold the keyboard) from one the page's script
                // sent, and only a pressed focusAddressBar asks `browser_go("focusApp")`.
                let _ = chord_app.emit(CHORD_EVENT, ChordPayload { id, what: what.to_string() });
                false
            }
            // T-239: the pane decides the menu (BROW-017) and replays the shortcut (BROW-018).
            // T-657: a pick that opens a tab or the system browser counts against the family's allowance.
            Nav::Menu(v) => {
                let (app, dev) = (chord_app.clone(), dev.clone());
                popup::when_started(id, url.as_str(), Box::new(move || {
                    if pick_allowed(&v, dev.as_ref(), &families().of(id), Instant::now()) {
                        let _ = app.emit(MENU_EVENT, with_id(id, v));
                    } else {
                        let _ = app.emit(BLOCKED_EVENT, BlockedPayload { id });
                    }
                }));
                false
            }
            Nav::Key(v) => {
                let _ = chord_app.emit(KEY_EVENT, with_id(id, v));
                false
            }
        }})
        .on_page_load(move |page, payload| {
            let event = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            // BROW-023: every finished load asks for the site's icon again, so an icon that failed
            // is tried again after a reload; the pane keeps the old one while the site is the same.
            // T-242 (BROW-050): what the command line emulates for this tab stays in force across
            // loads; a new document starts from the script's defaults, so the state goes in again.
            // T-657 (DT-C93): the app's own scripts run without a user gesture, so they never let
            // the page's timers pass for the user's click.
            if let Some(script) = cli::emu_hand_in(id, payload.url().as_str()) {
                engine::quiet_eval(&page, script, None);
            }
            if event == "finished" {
                let (icon_app, icon_dev, at) = (load_app.clone(), icon_dev.clone(), payload.url().to_string());
                engine::quiet_eval(&page, ICON_QUERY.to_string(), Some(Box::new(move |answer: String| {
                    let Ok(page) = parse(&at) else { return };
                    let Some(url) = icon_address(&answer, icon_dev.as_ref(), &page) else { return };
                    let near = icon_near(&url, &page);
                    icon_for(icon_app.clone(), icon_dev.clone(), id, at.clone(), url, near);
                })));
            }
            if event == "finished" {
                history::noted_load(id, payload.url().as_str()); // T-238-b (BROW-004)
                session::noted_load(id, payload.url().as_str()); // T-179 (BROW-020)
                preview::rendered(id); // T-159 (BROW-040): agent tools may drive a preview now
                popup::mark_ready(id); // T-158 (BROW-015): its sized popups get their own window now
            } else {
                preview::loading(id, payload.url().as_str()); // T-159: a preview address fences the tab
            }
            let _ = load_app.emit(LOAD_EVENT, LoadPayload { id, event, url: payload.url().to_string() });
        })
        .on_document_title_changed(move |_, title| {
            history::noted_title(id, &title);
            session::noted_title(id, &title);
            let _ = app.emit(TITLE_EVENT, TitlePayload { id, title });
        })
        // T-238-b (BROW-013): a download goes to the system Downloads folder under a safe, unique
        // name; the pane hears its progress and its end. No free name, or no Downloads folder,
        // and the download is refused with a failed row instead of a loop.
        .on_download(move |_, event| match event {
            DownloadEvent::Requested { url, destination } => {
                let suggested = destination.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                // T-159 (BROW-040): a document preview downloads nothing; one notice per burst.
                if let Some(notice) = preview::download_refused(id) {
                    if notice {
                        downloads::refused(&download_app, id, url.as_str(), &suggested, "a document preview may not download");
                    }
                    return false;
                }
                let dir = download_app.path().download_dir().map_err(|e| e.to_string());
                match dir.and_then(|dir| downloads::requested(&download_app, id, url.as_str(), &dir, &suggested)) {
                    Ok(path) => {
                        *destination = path;
                        true
                    }
                    Err(why) => {
                        downloads::refused(&download_app, id, url.as_str(), &suggested, &why);
                        false
                    }
                }
            }
            DownloadEvent::Finished { url, path, success } => {
                downloads::finished(&download_app, id, url.as_str(), path.as_deref(), success);
                true
            }
            _ => true,
        });
    // BROW-011: until the page paints, the web view shows the pane's colour, never a white flash.
    let builder = match surface(background) {
        Some(c) => builder.background_color(c),
        None => builder,
    };
    let page = window.add_child(builder, LogicalPosition::new(spot.x, spot.y), LogicalSize::new(spot.w, spot.h)).map_err(err)?;
    // Row 954 (c): this build's own record of its destroy, shared by both detectors and the failure handler.
    // Row 954f: made only once the page exists, so an open that failed never replaces the live page's record.
    let engine_rec = selfclose::register(id, rebuild);
    // T-272-d: remember the page's container window, so a keyboard chord can be checked against
    // the window that really holds the keyboard.
    #[cfg(windows)]
    let _ = page.with_webview(move |pw| {
        let mut container = Default::default();
        // SAFETY: ParentWindow only writes the controller's parent window handle into `container`.
        if unsafe { pw.controller().ParentWindow(&mut container) }.is_ok() {
            holder::record(id, container.0 as isize);
            engine_rec.set_container(container.0 as isize);
            drag::settle(container.0 as isize); // after-list 746: a page made mid-drag lets it through
        }
        // T-283 (BROW-043): the engine's browser process behind this page is recorded for clean-up.
        // SAFETY: CoreWebView2 hands back the page's engine; BrowserProcessId only writes the id.
        if let Ok(core) = unsafe { pw.controller().CoreWebView2() } {
            let mut pid = 0u32;
            if unsafe { core.BrowserProcessId(&mut pid) }.is_ok() && pid != 0 {
                helpers::record(pid);
            }
        }
        // T-158 (BROW-024): the engine's certificate errors are answered by the certificate rules.
        engine::attach(id, &pw);
        // T-239-b (BROW-025): Firefox on the sign-in hosts unless the profile is in native mode.
        engine::identity(&pw, spoof);
        // T-272-b (BROW-032): the page's permission requests are answered by the permission rules.
        engine::permissions(id, &pw, permission_app);
        // T-734 (DT-C170): the strip's Cancel reaches the engine's running download.
        engine::downloads(id, &pw);
        // T-286-b (APP-040): the engine's process failures become crash records when real.
        engine::watch_page_failures(id, &pw, crash_dir, engine_rec.clone());
        // Row 954 (b): a page that destroyed its own tab gets it built again.
        engine::watch_self_close(id, &pw, self_close_app, engine_rec);
    });
    #[cfg(not(windows))]
    let _ = page;
    // A new page is laid over its pane; a tab opened behind starts hidden (council FIX-2, AFTER 3),
    // and the pane's bounds keep this true from here on.
    set_shown(id, shown.unwrap_or(true));
    // Row 954 (c), row 978: a rebuild, a restore and a tab opened behind never take the keyboard.
    if selfclose::focuses_after_open(rebuild, shown) {
        webview.set_focus().map_err(err)
    } else {
        Ok(())
    }
}

/// The loading surface for a pane colour (BROW-011): opaque, so the engine's white never shows
/// through before the page's own first paint.
pub fn surface(rgb: Option<[u8; 3]>) -> Option<Color> {
    rgb.map(|[r, g, b]| Color(r, g, b, 255))
}

/// Moves a tab's page to where its pane body is, or hides it while the tab is away (BROW-002).
/// `background` is the pane colour again when the app theme changed (BROW-011).
#[tauri::command]
pub async fn browser_bounds(app: AppHandle, id: u32, spot: Spot, shown: bool, background: Option<[u8; 3]>) -> Result<(), String> {
    let v = view(&app, id)?;
    if let Some(c) = surface(background) {
        v.set_background_color(Some(c)).map_err(err)?;
    }
    set_shown(id, shown);
    if !shown {
        return v.hide().map_err(err);
    }
    if let Ok(mut s) = SPOTS.lock() {
        s.insert(id, spot);
    }
    place(&v, id, &spot)?;
    // T-179 (BROW-020, BROW-021): a page left blank for later (a restart, or the memory budget)
    // loads now that its tab is on screen.
    if let Some(url) = session::take_pending(id) {
        v.navigate(parse(&url)?).map_err(err)?;
    }
    v.show().map_err(err)
}

/// The pane spot each tab was last laid out in, so an emulated viewport (BROW-050) can lay the page
/// out again without waiting for the pane.
static SPOTS: LazyLock<Mutex<HashMap<u32, Spot>>> = LazyLock::new(Mutex::default);

/// Puts a page where its pane body is, cut down to the viewport the command line emulates, if any.
fn place(v: &Webview, id: u32, spot: &Spot) -> Result<(), String> {
    let (w, h) = cli::fit(id, spot.w, spot.h);
    v.set_bounds(Rect { position: LogicalPosition::new(spot.x, spot.y).into(), size: LogicalSize::new(w, h).into() }).map_err(err)
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    let url = parse(&url)?;
    allowed(&url, app_origin(&app).as_ref())?;
    preview::expect(id); // T-159: the bar's own navigation leaves a preview freely
    view(&app, id)?.navigate(url).map_err(err)
}

/// What the toolbar does to the page (BROW-005). wry offers reload only, so the rest runs as
/// page script; `None` is a request this tab does not know.
pub fn script(what: &str) -> Option<&'static str> {
    match what {
        "back" => Some("history.back()"),
        "forward" => Some("history.forward()"),
        "stop" => Some("window.stop()"),
        _ => None,
    }
}

/// Find in page (BROW-007): the engine's own find, which selects and scrolls to the next match
/// (or the previous one), wrapping at the ends. The text goes in as a JSON string, never as code.
/// It runs inside the page, so the page's own script can see what is searched for (as a
/// page's own find box would; council T-272-c).
pub fn find_script(text: &str, back: bool) -> String {
    format!("window.find({}, false, {back}, true)", serde_json::Value::from(text))
}

/// A tab's zoom (BROW-012) kept inside what the engine accepts; the steps are the front end's.
pub fn zoom_level(level: f64) -> f64 {
    if level.is_finite() {
        level.clamp(0.25, 5.0)
    } else {
        1.0
    }
}

/// `text` is the find text for `find` and `findBack`; `level` is the zoom for `zoom`.
#[tauri::command]
pub async fn browser_go(app: AppHandle, id: u32, what: String, text: Option<String>, level: Option<f64>) -> Result<(), String> {
    if what == "focusApp" {
        // A focusAddressBar chord pressed in the page: the bar lives in the app's own web view.
        // Council FIX-5: the label "main" is hard-coded here (both lines below), while browser_open
        // adds a page to whichever window called it. That holds today because tauri.conf.json
        // defines one app window with the default label; if a second app window ever hosts a
        // browser pane, pass the calling window in instead.
        focus_app_ok(app.get_window("main").ok_or("no app window")?.is_focused().map_err(err)?)?;
        return app.get_webview("main").ok_or("no app view")?.set_focus().map_err(err);
    }
    let v = view(&app, id)?;
    match what.as_str() {
        "reload" => v.reload().map_err(err),
        "zoom" => v.set_zoom(zoom_level(level.unwrap_or(1.0))).map_err(err),
        "back" | "forward" => step_history(&v, id, &what),
        // T-657 (DT-C93): the app's scripts run without a user gesture (the keys list goes in on
        // every load), so a page's timer never borrows one to open windows.
        _ => {
            let script = match what.as_str() {
                "find" | "findBack" => find_script(text.as_deref().unwrap_or_default(), what == "findBack"),
                // T-239: `text` is the menu's JSON spec (BROW-017) or the JSON list of chords the page forwards (BROW-018).
                "menu" => menu_script(text.as_deref().unwrap_or("{}")),
                "keys" => keys_script(text.as_deref().unwrap_or("[]")),
                _ => script(&what).ok_or_else(|| format!("unknown browser action {what}"))?.to_string(),
            };
            engine::quiet_eval(&v, script, None);
            Ok(())
        }
    }
}

/// Back and forward (BROW-005), with the trail behind them (T-179, BROW-020): the engine's own list
/// is asked first; a tab that came back from a restart (or a page the budget reloaded) has none,
/// and then the trail's neighbour is loaded instead.
fn step_history(v: &Webview, id: u32, what: &str) -> Result<(), String> {
    let (probe, delta) = if what == "back" { ("!!(window.navigation && navigation.canGoBack)", -1) } else { ("!!(window.navigation && navigation.canGoForward)", 1) };
    let page = v.clone();
    let own = script(what).ok_or_else(|| format!("unknown browser action {what}"))?;
    preview::expect(id); // T-159: Back and Forward leave a preview freely
    engine::quiet_eval(v, probe.to_string(), Some(Box::new(move |answer: String| {
        if answer.trim() == "true" {
            engine::quiet_eval(&page, own.to_string(), None);
        } else if let Some(url) = session::step_tab(id, delta).and_then(|u| parse(&u).ok()) {
            let _ = page.navigate(url);
        }
    })));
    Ok(())
}

#[tauri::command]
pub async fn browser_viewport(id: u32, name: Option<String>) -> Result<String, String> {
    // T-240 (BROW-034): the toolbar's Viewport Size. Async: the page's answer comes on the main
    // thread, so the wait must not happen there.
    cli::preset(id, name.as_deref()).map(|v| v["summary"].as_str().unwrap_or_default().to_string()).map_err(|f| f.message)
}

#[tauri::command]
pub async fn browser_cookies_import(app: AppHandle, id: u32, path: String) -> Result<cookies::Report, String> {
    // T-240 (BROW-028): a cookie file the user picked goes into this tab's engine (its profile's
    // cookie store), one site at a time; a site that fails gets its old cookies back.
    let meta = std::fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
    if meta.len() > cookies::FILE_MAX {
        return Err(format!("{path} is {} MB; a cookie file is read up to {} MB", meta.len() / (1024 * 1024), cookies::FILE_MAX / (1024 * 1024)));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (entries, mut report) = cookies::parse(&text, now)?;
    let page = view(&app, id)?;
    cookies::apply(&page, &entries, &mut report)?;
    Ok(report)
}

/// BROW-033: the sealed `httpProxy` setting as the engine takes it. Empty means the system's own
/// proxy (OD-18's default); anything else must be an http:// or socks5:// address with a host, or
/// the tab is not opened. The value itself never goes into a message: it may carry credentials
/// (SAFE-026 seals it for that reason).
pub fn proxy_of(setting: Option<&str>) -> Result<Option<Url>, String> {
    let Some(v) = setting.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    // The URL parser drops tabs and newlines inside the text, so a setting holding one would pass as another address.
    match Url::parse(v) {
        Ok(u) if matches!(u.scheme(), "http" | "socks5") && u.host_str().is_some() && !v.chars().any(char::is_control) => Ok(Some(u)),
        _ => Err("the HTTP proxy setting is not an http:// or socks5:// address with a host; the tab stays closed until the setting is fixed or cleared".into()),
    }
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: u32) -> Result<(), String> {
    selfclose::closed(id); // row 954 (c): what the engine raises from here on is not a self-close
    set_shown(id, false);
    families().leave(id); // T-272-c
    notices::closed(id); // after-list 719
    holder::forget(id); // T-272-d
    certs::closed(id); // T-158: a closed tab's waiting certificate challenge goes with it
    forget_tab(id);
    if let Ok(mut i) = ICONS.lock() {
        i.forget(id);
    }
    if let Ok(mut s) = SPOTS.lock() {
        s.remove(&id);
    }
    // BROW-049: a closed tab's interception, capture and emulation go with it.
    cli::forget(id);
    // T-238-b (BROW-013): closing the web view cancels its running downloads; the pane is told.
    downloads::cancel_tab(&app, id);
    history::forget_tab(id);
    session::forget(id); // T-179: a closed tab does not come back after a restart
    preview::forget(id); // T-159
    popup::close_for(&app, id); // T-158 (BROW-015): a tab's popups close with it
    let closed = view(&app, id).and_then(|v| v.close().map_err(err));
    profiles::page_closed(id); // after-list 153: the profile's folder can go once its last page is closed
    closed
}

/// T-074 (BROW-008, BROW-009): the probe the pane runs about four times a second while a page is
/// on screen. wry reports only that a load started and finished (its NavigationCompleted handler
/// drops the success flag), so the page itself is asked where it is: WebView2's own error page
/// answers `chrome-error://chromewebdata/`, a live page answers its address, and a page whose
/// process died answers nothing (or nothing that is a string). The pane's state machine
/// (src/browser/loadState.ts) turns the answers into the overlay and the one automatic reload.
const PROBE_QUERY: &str = "location.href";
/// How long a probe waits for the page before it counts as unanswered. A page running a long
/// script answers late, not never; three unanswered probes in a row count as a dead page.
const PROBE_WAIT: Duration = Duration::from_millis(1500);
/// How long the diagnosis waits for a connection or a TLS answer from a failed address.
const DIAGNOSE_WAIT: Duration = Duration::from_secs(4);

/// What the probe's answer (the JSON `eval_with_callback` hands back) says about the page.
pub fn probe_result(answer: &str) -> &'static str {
    match serde_json::from_str::<serde_json::Value>(answer) {
        // A certificate the engine refuses leaves the page on about:blank (the navigation never
        // becomes a document), so it is a failed load, not a live blank page. A real New Tab is in
        // the blank phase and is never probed.
        Ok(serde_json::Value::String(href)) if href.starts_with("chrome-error://") || href == "about:blank" => "error-page",
        Ok(serde_json::Value::String(_)) => "page",
        _ => "no-answer",
    }
}

/// The probe's verdict: a query the engine refused to send is silence too, and silence makes the caller check the container (row 954 d, H2).
pub fn probe_verdict(sent: bool, answer: Option<&str>) -> &'static str {
    if sent { answer.map_or("no-answer", probe_result) } else { "no-answer" }
}

/// Asks a tab's page where it is: `"page"`, `"error-page"` or `"no-answer"` (see `probe_result`).
#[tauri::command]
pub async fn browser_probe(app: AppHandle, id: u32) -> Result<&'static str, String> {
    let v = view(&app, id)?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    // T-657: quietly, or the pane's few-times-a-second probe would keep the page user-activated.
    engine::quiet_eval(&v, PROBE_QUERY.to_string(), Some(Box::new(move |answer: String| {
        let _ = tx.send(answer);
    })));
    let sent = true;
    let answer = if sent { tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(PROBE_WAIT).ok()).await.map_err(|e| e.to_string())? } else { None };
    let verdict = probe_verdict(sent, answer.as_deref());
    if verdict == "no-answer" {
        selfclose::probe_missed(&app, id, holder::window_exists); // row 954 (c): a destroyed container is a self-close, not a crash
    }
    Ok(verdict)
}

// ---------------------------------------------------------------- T-195: agents and notes drive the tab

/// The app, for the browser commands of the command line (BROW-042): cli.rs answers requests on
/// a thread of its own with no handle to the app, so the first tab opened leaves one here.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// An open tab as its pane reports it (`browser_tab`): whose worktree it belongs to and whether it
/// is the one on screen in its split. `seen` orders the tabs by when they were last on screen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tab {
    pub id: u32,
    pub worktree: Option<String>,
    pub shown: bool,
    pub seen: u64,
    /// The page's address and title as the pane last reported them (BROW-044 `kolux tab list`).
    pub url: String,
    pub title: String,
}

static TABS: Mutex<Vec<Tab>> = Mutex::new(Vec::new());
static TICK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// How long a page command may take before the tab counts as not answering (a long script
/// answers late; `wait` asks again).
pub const EVAL_WAIT: Duration = Duration::from_millis(3000);
/// Two unanswered page commands in a row and the page's helper is dropped, so the next command
/// installs a fresh one (BROW-042: a stuck helper restarts).
const EVAL_STRIKES: u8 = 2;
static STRIKES: Mutex<Vec<(u32, u8)>> = Mutex::new(Vec::new());

pub fn tabs() -> Vec<Tab> {
    TABS.lock().map(|t| t.clone()).unwrap_or_default()
}

/// Records a tab's worktree and whether it is on screen; a tab on screen is the most recently seen.
pub fn note_tab(tabs: &mut Vec<Tab>, id: u32, worktree: Option<String>, shown: bool, tick: u64) {
    let seen = if shown { tick } else { tabs.iter().find(|t| t.id == id).map_or(0, |t| t.seen) };
    match tabs.iter_mut().find(|t| t.id == id) {
        Some(t) => {
            t.worktree = worktree;
            t.shown = shown;
            t.seen = seen;
        }
        None => tabs.push(Tab { id, worktree, shown, seen, url: String::new(), title: String::new() }),
    }
}

fn forget_tab(id: u32) {
    if let Ok(mut t) = TABS.lock() {
        t.retain(|t| t.id != id);
    }
    if let Ok(mut s) = STRIKES.lock() {
        s.retain(|s| s.0 != id);
    }
}

/// Two spellings of one folder: the real path when it exists, else the text with slashes and
/// case made alike (Windows paths).
pub fn same_dir(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        let real = std::path::Path::new(p).canonicalize().map(|r| r.to_string_lossy().to_string()).unwrap_or_else(|_| p.to_string());
        real.replace('\\', "/").trim_end_matches('/').to_lowercase()
    }
    norm(a) == norm(b)
}

/// BROW-042: which tab a command goes to. `--page` names one (a tab its pane has reported);
/// otherwise the worktree's tab on screen, else the one last on screen there. Tabs the panes have
/// not described yet (none carry a worktree) count for any worktree.
pub fn pick_tab(tabs: &[Tab], page: Option<u32>, worktree: Option<&str>) -> Result<u32, String> {
    if let Some(id) = page {
        return if tabs.iter().any(|t| t.id == id) { Ok(id) } else { Err(format!("browser tab {id} is not open")) };
    }
    let best = |set: &[&Tab]| set.iter().find(|t| t.shown).or_else(|| set.iter().max_by_key(|t| t.seen)).map(|t| t.id);
    let all: Vec<&Tab> = tabs.iter().collect();
    let Some(wt) = worktree else {
        return best(&all).ok_or_else(|| "no browser tab is open".to_string());
    };
    let mine: Vec<&Tab> = tabs.iter().filter(|t| t.worktree.as_deref().is_some_and(|w| same_dir(w, wt))).collect();
    if let Some(id) = best(&mine) {
        return Ok(id);
    }
    if tabs.iter().all(|t| t.worktree.is_none()) {
        if let Some(id) = best(&all) {
            return Ok(id);
        }
    }
    Err(format!("no browser tab is open in {wt}"))
}

/// The pane says which worktree its tab belongs to and whether it is on screen (BROW-042).
#[tauri::command]
pub async fn browser_tab(app: AppHandle, id: u32, worktree: Option<String>, shown: bool, url: Option<String>, title: Option<String>) -> Result<(), String> {
    // T-241: the command line's profile store lives under the app's data folder; the app says where.
    if let Ok(dir) = app.path().app_data_dir() {
        profiles::set_root(dir);
    }
    let tick = TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    session::placed(id, worktree.clone()); // T-179 (BROW-020): the trail knows its worktree
    {
        let mut t = TABS.lock().map_err(|e| e.to_string())?;
        note_tab(&mut t, id, worktree, shown, tick);
        if let Some(t) = t.iter_mut().find(|t| t.id == id) {
            if let Some(url) = url {
                t.url = url;
            }
            if let Some(title) = title {
                t.title = title;
            }
        }
    }
    // T-179 (BROW-021): a tab coming on screen is a visit to its worktree; past the budget the
    // least recently visited hidden worktrees give up their pages (blank until shown again).
    if shown {
        let pages: Vec<session::Page> = tabs().into_iter().map(|t| session::Page { id: t.id, worktree: t.worktree, seen: t.seen, live: session::is_live(t.id), spared: downloads::downloading(t.id) || session::driven(t.id) }).collect();
        for id in session::to_unload(&pages, session::BUDGET) {
            if session::unloading(id).is_some() {
                if let Ok(v) = view(&app, id) {
                    let _ = v.navigate(parse(session::BLANK)?);
                }
            }
        }
    }
    let _ = APP.set(app);
    Ok(())
}

/// What the command line asks of a page. The code that reaches the web view sits behind this
/// hook, set when the first tab opens, so cli.rs never links it directly: a test binary that links
/// the window toolkit cannot load without the app's manifest (comctl32 v6), and cli.rs's tests
/// call dispatch.
pub enum Act<'a> {
    Eval(u32, &'a str, Duration),
    Navigate(u32, &'a str),
    Go(u32, &'a str),
    /// T-241 (BROW-044): a word to the front end, which owns the tabs (open, show, close).
    Emit(&'a str, serde_json::Value),
    /// T-242 (BROW-050): lay the page out again in its last pane spot (an emulated viewport came
    /// or went) and set its zoom (the emulated scale).
    Relayout(u32, Option<f64>),
    /// T-251 (CLI-047): a cookie the page itself cannot set (HTTP-only) goes to the engine's store.
    SetCookie(u32, cookies::Entry),
    /// T-251 (CLI-047): one DevTools call on the page's engine (a picture of the page).
    DevTools(u32, &'a str, String),
    /// T-251 (CLI-047): the engine prints the page to a PDF file at this path.
    Pdf(u32, &'a str),
    /// after-list 91: does this page exist in the engine (opened, reported or not)?
    Exists(u32),
    /// after-list 732: is this handle an open Kolux terminal?
    TerminalLive(&'a str),
}
type Driver = dyn Fn(Act) -> Result<serde_json::Value, String> + Send + Sync;
static DRIVER: OnceLock<Box<Driver>> = OnceLock::new();

fn driver() -> Result<&'static Driver, String> {
    DRIVER.get().map(|d| d.as_ref()).ok_or_else(|| "no browser tab has been opened yet".to_string())
}

/// The driver behind the hook: the one place the command line's work touches a web view.
fn drive(act: Act) -> Result<serde_json::Value, String> {
    let app = APP.get().ok_or("no browser tab has been opened yet")?;
    // T-179 (BROW-021): a page an agent drives is under agent control, never unloaded for a while.
    if let Act::Eval(id, ..) | Act::Navigate(id, _) | Act::Go(id, _) | Act::Relayout(id, _) | Act::DevTools(id, ..) | Act::Pdf(id, _) = act {
        preview::drivable(id)?; // T-159 (BROW-040): a preview is driven only once it has rendered
        session::drove(id);
    }
    match act {
        Act::Eval(id, script, wait) => {
            let v = view(app, id)?;
            let (tx, rx) = std::sync::mpsc::channel::<String>();
            // T-657 (DT-C93): quietly, so an agent's script lends the page no user gesture either.
            engine::quiet_eval(&v, script.to_string(), Some(Box::new(move |answer: String| {
                let _ = tx.send(answer);
            })));
            match rx.recv_timeout(wait) {
                Ok(answer) => {
                    if let Ok(mut s) = STRIKES.lock() {
                        s.retain(|s| s.0 != id);
                    }
                    serde_json::from_str(&answer).map_err(|_| "the page answered with something that is not JSON".to_string())
                }
                Err(_) => {
                    let strikes = STRIKES.lock().map(|mut s| match s.iter_mut().find(|s| s.0 == id) {
                        Some(s) => {
                            s.1 += 1;
                            s.1
                        }
                        None => {
                            s.push((id, 1));
                            1
                        }
                    });
                    if strikes.is_ok_and(|n| n >= EVAL_STRIKES) {
                        engine::quiet_eval(&v, "delete window.__kx; delete window.__kxa".to_string(), None);
                        if let Ok(mut s) = STRIKES.lock() {
                            s.retain(|s| s.0 != id);
                        }
                    }
                    Err(format!("browser tab {id} did not answer within {} ms", wait.as_millis()))
                }
            }
        }
        Act::Navigate(id, url) => {
            // `kolux goto`: the same gate as the address bar (T-500), then the page goes there.
            let url = parse(url)?;
            allowed(&url, app_origin(app).as_ref())?;
            let to = url.to_string();
            preview::expect(id); // T-159: the command line's goto leaves a preview freely
            view(app, id)?.navigate(url).map_err(err)?;
            Ok(serde_json::Value::String(to))
        }
        Act::Go(id, what) => {
            let v = view(app, id)?;
            match what {
                "reload" => v.reload().map_err(err)?,
                "back" | "forward" => step_history(&v, id, what)?,
                _ => engine::quiet_eval(&v, script(what).ok_or_else(|| format!("unknown browser action {what}"))?.to_string(), None),
            }
            Ok(serde_json::Value::Null)
        }
        Act::Emit(event, payload) => {
            app.emit(event, payload).map_err(err)?;
            Ok(serde_json::Value::Null)
        }
        Act::Relayout(id, zoom) => {
            let v = view(app, id)?;
            if let Some(spot) = SPOTS.lock().ok().and_then(|s| s.get(&id).copied()) {
                place(&v, id, &spot)?;
            }
            if let Some(z) = zoom {
                v.set_zoom(zoom_level(z)).map_err(err)?;
            }
            Ok(serde_json::Value::Null)
        }
        Act::SetCookie(id, c) => {
            engine::set_cookie(&view(app, id)?, c, cookies::COOKIE_WAIT)?;
            Ok(serde_json::Value::Null)
        }
        Act::DevTools(id, method, params) => {
            let text = engine::devtools(&view(app, id)?, method, params, CAPTURE_WAIT)?;
            serde_json::from_str(&text).map_err(|_| "the page's engine answered with something that is not JSON".to_string())
        }
        Act::Pdf(id, path) => engine::print_pdf(&view(app, id)?, path, CAPTURE_WAIT).map(serde_json::Value::Bool),
        Act::Exists(id) => Ok(serde_json::Value::Bool(view(app, id).is_ok())),
        Act::TerminalLive(handle) => {
            use tauri::Manager;
            Ok(serde_json::Value::Bool(app.try_state::<crate::terminal::Terminals>().is_none_or(|t| t.live(handle))))
        }
    }
}

/// T-251 (CLI-047): how long a picture or a PDF of a page may take.
const CAPTURE_WAIT: Duration = Duration::from_secs(30);

/// `kolux screenshot|full-screenshot`: one DevTools call on the page's engine, its JSON answer.
pub fn devtools(id: u32, method: &str, params: String) -> Result<serde_json::Value, String> {
    driver()?(Act::DevTools(id, method, params))
}

/// `kolux pdf`: the engine prints the page to `path`; whether it succeeded.
pub fn print_pdf(id: u32, path: &str) -> Result<bool, String> {
    driver()?(Act::Pdf(id, path)).map(|v| v.as_bool().unwrap_or(false))
}

/// T-251 (CLI-047): where a capture goes when the command names no `--path`.
pub fn captures_dir() -> Result<std::path::PathBuf, String> {
    let app = APP.get().ok_or("no browser tab has been opened yet")?;
    app.path().app_data_dir().map(|d| d.join("captures")).map_err(err)
}

/// `kolux viewport` / `kolux set device`: the page is laid out again at the emulated size and scale.
pub fn relayout(id: u32, zoom: Option<f64>) -> Result<(), String> {
    driver()?(Act::Relayout(id, zoom)).map(|_| ())
}

/// `kolux tab switch|create|close`, `tab profile ...`: the front end is told and acts.
pub fn tell(event: &str, payload: serde_json::Value) -> Result<(), String> {
    driver()?(Act::Emit(event, payload)).map(|_| ())
}

/// after-list 732: is `handle` an open Kolux terminal? Before the app is known (no tab opened
/// yet) every holder counts as live, so nothing is freed on a guess.
pub fn terminal_live(handle: &str) -> bool {
    // Through the driver, so the command line's code never links the window toolkit itself.
    driver().ok().and_then(|d| d(Act::TerminalLive(handle)).ok()).and_then(|v| v.as_bool()).unwrap_or(true)
}

/// BROW-045: the profile the next `browser_open` runs in, left by `kolux tab create --profile`
/// (the front end opens the tab and does not know the profile). ponytail: one slot, since tabs
/// open one at a time from the command line; a map by url if that stops holding.
static NEXT_PROFILE: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// after-list 154: `tab create --profile` hands its profile over keyed by the address the tab
/// opens at, so two creates close together each get their own profile, not each other's.
pub fn hand_profile(url: &str, profile: String) {
    if let Ok(mut n) = NEXT_PROFILE.lock() {
        n.push((url.to_string(), profile));
    }
}

/// Takes the profile handed over for `url`, oldest first; none when nothing waits for it.
pub fn take_profile(url: &str) -> Option<String> {
    let mut n = NEXT_PROFILE.lock().ok()?;
    let at = n.iter().position(|(u, _)| u == url)?;
    Some(n.remove(at).1)
}

/// The profile the command line handed over for a NEW tab at `url`. A rebuild or a restore never takes
/// one: it would steal the entry meant for a new tab at the same address (row 954 d, N2).
fn given_profile(kind: selfclose::Rebuild, url: &str) -> Option<String> {
    if kind == selfclose::Rebuild::Fresh { take_profile(url) } else { None }
}

/// A tab in a profile other than the default runs in that profile's own engine data folder; the
/// answer also says whether that profile shows Firefox on the sign-in hosts (BROW-025), and whether a
/// restored tab lost its saved profile (row 977: the pane shows `profiles::RESTORE_GONE_NOTICE`).
fn with_profile(b: WebviewBuilder<tauri::Wry>, id: u32, profile: Option<String>, kind: selfclose::Rebuild, url: &str) -> (WebviewBuilder<tauri::Wry>, bool, String, bool) {
    let shared = || proxy::DEFAULT_FOLDER.to_string();
    let profile = profile.or_else(|| given_profile(kind, url));
    let Ok(root) = profiles::root() else { return (b, true, shared(), false) };
    // Row 954 (c): a rebuild (crash, self-close) passes no profile but keeps the tab's saved one; a restore reads its own row; any other open rewrites the row.
    let (profile, spoof, gone) = profiles::open_tab(&root, id, profile, kind);
    let Some(p) = profile else { return (b, true, shared(), gone) };
    match profiles::data_dir(&root, &p) {
        Some(dir) => {
            profiles::page_opened(id, &p); // after-list 153: a deleted profile's folder waits for its last page
            let folder = dir.to_string_lossy().into_owned();
            (b.data_directory(dir), spoof, folder, gone)
        }
        None => (b, spoof, shared(), gone),
    }
}

/// Runs a script in a tab's page and hands back the JSON it completes with. Blocking: it waits for
/// the page's answer, so it runs on the command line's thread or under `spawn_blocking`, never on
/// the app's main thread (which delivers the answer).
pub fn eval_json(id: u32, script: &str, wait: Duration) -> Result<serde_json::Value, String> {
    driver()?(Act::Eval(id, script, wait))
}

/// `kolux goto`; the answer is the address the page was sent to.
pub fn navigate_to(id: u32, url: &str) -> Result<String, String> {
    driver()?(Act::Navigate(id, url)).map(|v| v.as_str().unwrap_or_default().to_string())
}

/// `kolux cookie set --httpOnly`: the engine's cookie store takes it (blocking; never called from
/// the main thread, the command line's requests run on their own).
pub fn set_cookie(id: u32, c: cookies::Entry) -> Result<(), String> {
    driver()?(Act::SetCookie(id, c)).map(|_| ())
}

/// `kolux back|forward|reload`.
pub fn go(id: u32, what: &str) -> Result<(), String> {
    driver()?(Act::Go(id, what)).map(|_| ())
}

/// BROW-037: the picker that runs in the page while the user annotates it. A hover outlines the
/// element under the pointer; a click is taken (the page does not get it) and queued as a pick:
/// a selector, the element's path, its text, its data-* hints, the React component chain and
/// source location when the page carries them, and the computed styles that matter. `poll` drains
/// the queue; `stop` takes the picker out again.
const ANNOTATE_START: &str = r#"(function(){
if(window.__kxa) return {ok:true,active:true};
const A={q:[]};
const box=document.createElement('div'); box.setAttribute('data-kx-annotate',''); box.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #ff5a00;background:rgba(255,90,0,.08);border-radius:2px;transition:all .05s;display:none';
(document.body||document.documentElement).appendChild(box);
const sel=e=>{ if(e.id&&document.querySelectorAll('#'+CSS.escape(e.id)).length===1) return '#'+CSS.escape(e.id); const tid=e.getAttribute('data-testid'); if(tid) return '[data-testid="'+tid+'"]';
 const parts=[]; let n=e; while(n&&n.nodeType===1&&parts.length<5){ let p=n.tagName.toLowerCase(); if(n.id){ parts.unshift('#'+CSS.escape(n.id)); break; } const sib=[...(n.parentElement?n.parentElement.children:[])].filter(c=>c.tagName===n.tagName); if(sib.length>1) p+=':nth-of-type('+(sib.indexOf(n)+1)+')'; parts.unshift(p); n=n.parentElement; } return parts.join(' > '); };
const path=e=>{ const out=[]; let n=e; while(n&&n.nodeType===1&&out.length<8){ out.unshift(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+(n.classList.length?'.'+[...n.classList].slice(0,2).join('.'):'')); n=n.parentElement; } return out.join(' > '); };
const react=e=>{ const k=Object.keys(e).find(k=>k.startsWith('__reactFiber$')||k.startsWith('__reactInternalInstance$')); if(!k) return {}; let f=e[k]; const chain=[]; let src=null;
 while(f&&chain.length<6){ const t=f.type; if(t&&typeof t!=='string'){ const nm=t.displayName||t.name||(t.render&&(t.render.displayName||t.render.name)); if(nm) chain.push(nm); } if(!src&&f._debugSource) src=f._debugSource.fileName+':'+f._debugSource.lineNumber; f=f.return; }
 return {component:chain.length?chain.join(' < '):undefined,source:src||undefined}; };
const styles=e=>{ const s=getComputedStyle(e); const out={}; for(const k of ['color','background-color','font-size','font-family','font-weight','line-height','padding','margin','border','border-radius','display','position','width','height','opacity','z-index']){ const v=s.getPropertyValue(k); if(v&&v!=='none'&&v!=='normal'&&v!=='0px') out[k]=v; } return out; };
const hints=e=>{ const out={}; for(const a of e.attributes){ if(a.name.startsWith('data-')||a.name.startsWith('aria-')||a.name==='role'||a.name==='name'||a.name==='href'||a.name==='type'||a.name==='class') out[a.name]=a.value.slice(0,200); } return out; };
A.move=ev=>{ const e=ev.target; if(!(e instanceof Element)||e===box){ return; } const r=e.getBoundingClientRect(); box.style.display='block'; box.style.left=r.left+'px'; box.style.top=r.top+'px'; box.style.width=r.width+'px'; box.style.height=r.height+'px'; };
A.click=ev=>{ ev.preventDefault(); ev.stopImmediatePropagation(); const e=ev.target; if(!(e instanceof Element)) return; const r=e.getBoundingClientRect(); const rx=react(e);
 A.q.push({selector:sel(e),path:path(e),tag:e.tagName.toLowerCase(),text:((e.innerText||e.textContent||'').trim().replace(/\s+/g,' ')).slice(0,200),component:rx.component,source:rx.source,hints:hints(e),styles:styles(e),box:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},url:location.href}); };
A.swallow=ev=>{ ev.preventDefault(); ev.stopImmediatePropagation(); };
A.key=ev=>{ if(ev.key==='Escape'){ ev.preventDefault(); ev.stopImmediatePropagation(); A.q.push({escape:true}); } };
document.addEventListener('mousemove',A.move,true); document.addEventListener('click',A.click,true); document.addEventListener('mousedown',A.swallow,true); document.addEventListener('mouseup',A.swallow,true); document.addEventListener('keydown',A.key,true);
A.box=box; window.__kxa=A; return {ok:true,active:true};
})()"#;
const ANNOTATE_POLL: &str = "(function(){ const a=window.__kxa; if(!a) return {active:false,picks:[]}; return {active:true,picks:a.q.splice(0)}; })()";
const ANNOTATE_STOP: &str = "(function(){ const a=window.__kxa; if(!a) return {ok:true,active:false}; document.removeEventListener('mousemove',a.move,true); document.removeEventListener('click',a.click,true); document.removeEventListener('mousedown',a.swallow,true); document.removeEventListener('mouseup',a.swallow,true); document.removeEventListener('keydown',a.key,true); a.box.remove(); delete window.__kxa; return {ok:true,active:false}; })()";

/// The picker's script for `start`, `poll` or `stop`.
pub fn annotate_script(what: &str) -> Option<&'static str> {
    match what {
        "start" => Some(ANNOTATE_START),
        "poll" => Some(ANNOTATE_POLL),
        "stop" => Some(ANNOTATE_STOP),
        _ => None,
    }
}

/// BROW-037: starts, polls or stops the page picker in a tab; `poll` answers `{active, picks}`.
#[tauri::command]
pub async fn browser_annotate(app: AppHandle, id: u32, what: String) -> Result<serde_json::Value, String> {
    let _ = APP.set(app);
    let script = annotate_script(&what).ok_or_else(|| format!("unknown annotate step {what}"))?;
    tauri::async_runtime::spawn_blocking(move || eval_json(id, script, EVAL_WAIT)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod agent_tests {
    use super::*;

    fn tab(id: u32, worktree: Option<&str>, shown: bool, seen: u64) -> Tab {
        Tab { id, worktree: worktree.map(str::to_string), shown, seen, url: String::new(), title: String::new() }
    }

    #[test]
    fn brow042_the_worktrees_tab_on_screen_else_its_last_seen_else_a_clear_refusal() {
        let tabs = vec![tab(1, Some("G:/wt/a"), false, 5), tab(2, Some("G:/wt/a"), true, 7), tab(3, Some("G:/wt/b"), false, 9)];
        assert_eq!(pick_tab(&tabs, None, Some("G:/wt/a")), Ok(2));
        assert_eq!(pick_tab(&tabs, None, Some("g:\\wt\\b\\")), Ok(3), "spellings of one folder match");
        assert_eq!(pick_tab(&tabs, None, Some("G:/wt/c")), Err("no browser tab is open in G:/wt/c".into()));
        assert_eq!(pick_tab(&tabs, None, None), Ok(2));
        assert_eq!(pick_tab(&[tab(1, Some("G:/wt/a"), false, 5), tab(4, Some("G:/wt/a"), false, 8)], None, Some("G:/wt/a")), Ok(4), "none on screen: the last seen");
        assert_eq!(pick_tab(&tabs, Some(3), Some("G:/wt/a")), Ok(3), "--page wins");
        assert_eq!(pick_tab(&tabs, Some(9), None), Err("browser tab 9 is not open".into()));
        assert_eq!(pick_tab(&[], None, None), Err("no browser tab is open".into()));
        // Panes that have not reported a worktree yet: their tabs serve any worktree.
        assert_eq!(pick_tab(&[tab(1, None, true, 1)], None, Some("G:/wt/a")), Ok(1));
    }

    #[test]
    fn brow042_the_registry_keeps_one_row_per_tab_and_orders_by_last_shown() {
        let mut tabs = Vec::new();
        note_tab(&mut tabs, 1, Some("G:/wt/a".into()), true, 1);
        note_tab(&mut tabs, 2, Some("G:/wt/a".into()), true, 2);
        note_tab(&mut tabs, 1, Some("G:/wt/a".into()), false, 3);
        assert_eq!(tabs, vec![tab(1, Some("G:/wt/a"), false, 1), tab(2, Some("G:/wt/a"), true, 2)]);
        note_tab(&mut tabs, 2, None, false, 4);
        assert_eq!(tabs[1], tab(2, None, false, 2), "hidden keeps the last time it was seen");
        assert!(same_dir("G:/x/y", "g:\\x\\y\\") && !same_dir("G:/x/y", "G:/x/z"));
    }

    #[test]
    fn brow037_the_picker_scripts_queue_picks_and_can_be_taken_out() {
        assert!(annotate_script("start").unwrap().contains("window.__kxa=A"));
        assert!(annotate_script("poll").unwrap().contains("a.q.splice(0)"));
        assert!(annotate_script("stop").unwrap().contains("delete window.__kxa"));
        assert_eq!(annotate_script("peek"), None);
        for ev in ["mousemove", "click", "mousedown", "mouseup", "keydown"] {
            assert!(ANNOTATE_START.contains(&format!("addEventListener('{ev}'")), "{ev} is taken while picking");
            assert!(ANNOTATE_STOP.contains(&format!("removeEventListener('{ev}'")), "{ev} is given back");
        }
        for field in ["selector:", "path:", "component:", "source:", "hints:", "styles:", "box:"] {
            assert!(ANNOTATE_START.contains(field), "a pick carries {field}");
        }
    }

    // eval_json, navigate_to and go are not called from tests: linking them pulls the window
    // toolkit into the test binary, which then needs the app's manifest (comctl32 v6) to load.
}

/// Why an address failed, for the overlay's wording (BROW-008).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnosis {
    /// `unknown-host`, `refused`, `timeout`, `unreachable`, `certificate`, `unknown`, or `skipped`
    /// (a proxy is saved, so nothing was asked: T-323-d).
    pub kind: &'static str,
    /// The address is this computer's (local-server advice makes sense).
    pub local: bool,
    /// The same address over https when the switch makes sense: a failed http address that is not
    /// this computer's, with nothing but the scheme changed.
    pub https: Option<String>,
}

/// The TLS error text names a certificate problem (native-tls and the OS wording vary).
pub fn certificate_error(text: &str) -> bool {
    let t = text.to_ascii_lowercase();
    ["certificate", "self-signed", "self signed", "x509", "cert_", "untrusted root"].iter().any(|w| t.contains(w))
}

/// Names what failed from the three checks: name lookup, a TCP connection, and (https only) the
/// TLS handshake's error text when the connection itself worked.
pub fn failure_kind(dns_ok: bool, tcp: Option<std::io::ErrorKind>, tls: Option<&str>) -> &'static str {
    use std::io::ErrorKind as K;
    if !dns_ok {
        return "unknown-host";
    }
    match tcp {
        Some(K::ConnectionRefused) => "refused",
        Some(K::TimedOut | K::WouldBlock) => "timeout",
        Some(_) => "unreachable",
        None => match tls {
            Some(t) if certificate_error(t) => "certificate",
            _ => "unknown",
        },
    }
}

/// The https twin of a failed http address (BROW-008): scheme only, and never for this
/// computer's addresses, where https is rarely served.
pub fn https_twin(url: &Url) -> Option<String> {
    if url.scheme() != "http" || local_host(url) {
        return None;
    }
    let mut u = url.clone();
    u.set_scheme("https").ok()?;
    Some(u.to_string())
}

/// The addresses the address's host name looks up to (blocking); empty when the name does not resolve.
pub fn lookup(url: &Url) -> Vec<IpAddr> {
    url.socket_addrs(|| None).map(|a| a.into_iter().map(|s| s.ip()).collect()).unwrap_or_default()
}

/// What a HEAD request through the approved clients got back: the status and the length the
/// answer says its body has.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Answer {
    pub status: u16,
    pub length: Option<u64>,
}

/// Why a HEAD request through the approved clients failed: the error chain's text, whether it ran
/// out of time, and the socket error underneath when there is one.
#[derive(Debug, Clone, PartialEq)]
pub struct Failed {
    pub text: String,
    pub timeout: bool,
    pub io: Option<std::io::ErrorKind>,
}

/// The socket error somewhere down an error's chain of causes.
fn io_kind(e: &(dyn std::error::Error + 'static)) -> Option<std::io::ErrorKind> {
    let mut cur = Some(e);
    while let Some(x) = cur {
        if let Some(io) = x.downcast_ref::<std::io::Error>() {
            return Some(io.kind());
        }
        cur = x.source();
    }
    None
}

/// APP-070: every request Kolux itself makes outside the page (a download's size, a dev server's
/// check, the failed-load diagnosis, the update check's installer) is one HEAD through the icon
/// clients, the one approved way out: `near` for an address on this machine or the local network,
/// the public-only client otherwise, both without a proxy and under the icon redirect rule. Nothing
/// of the body is read. This one asks unconditionally; `head` is the way in for the app, because
/// it never goes around a saved proxy (T-323-d): a connection Kolux makes itself is made direct, so
/// under a saved (or unreadable, or unusable, or in-use system) proxy only this machine's own addresses are asked
/// (a proxy never carries them: the dev-server check, a download from `localhost`); every other
/// address, the local network included, is skipped with [`PROXY_SKIPPED`] and no connection
/// (the browser pane sets no bypass list, so its own local-network traffic goes through the proxy).
/// The callers then show no download size, no diagnosis ("skipped") and no installer check.
pub async fn head_with(clients: &IconClients, url: &Url, near: bool, wait: Duration) -> Result<Answer, Failed> {
    match if near { &clients.near } else { &clients.far }.head(url.clone()).timeout(wait).send().await {
        Ok(r) => Ok(Answer { status: r.status().as_u16(), length: r.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse().ok()) }),
        Err(e) => Err(Failed { text: error_text(&e), timeout: e.is_timeout(), io: io_kind(&e) }),
    }
}

/// T-323-d: what a skipped request says; the diagnosis tells it from a real failure by this text.
pub const PROXY_SKIPPED: &str = "skipped: a proxy is saved, so Kolux made no direct request";

/// Whether the request may be made at all: without a proxy (saved, or the system's when the setting is empty: T-323-e) always, with one (or one that cannot
/// be read or used) only to this machine's own addresses, which no proxy carries.
pub fn head_gate(saved: &Result<Option<String>, String>, url: &Url) -> Result<(), Failed> {
    if icon_fetch_allowed(saved) || url.host_str().is_some_and(popup::loopback) {
        return Ok(());
    }
    Err(Failed { text: PROXY_SKIPPED.into(), timeout: false, io: None })
}

pub fn proxy_skipped(f: &Failed) -> bool {
    f.text == PROXY_SKIPPED
}

/// `head_with` unless a proxy is saved: then no connection is made.
pub(crate) async fn head_unless_proxied(saved: &Result<Option<String>, String>, clients: &IconClients, url: &Url, near: bool, wait: Duration) -> Result<Answer, Failed> {
    head_gate(saved, url)?;
    head_with(clients, url, near, wait).await
}

/// `head_unless_proxied` through the clients the app shares: the one way the app asks anything directly.
pub async fn head(app: &AppHandle, url: &Url, near: bool, wait: Duration) -> Result<Answer, Failed> {
    let Some(clients) = icon_client(app_origin(app)) else {
        return Err(Failed { text: "no network client".into(), timeout: false, io: None });
    };
    head_unless_proxied(&saved_proxy(app), clients, url, near, wait).await
}

/// What a failed diagnosis request says, as `failure_kind`'s connection and TLS inputs: a
/// certificate the OS does not trust is the handshake's (strict checking, as the page's own load),
/// a time-out or a socket error is the connection's, and anything else on https is the handshake's
/// text; on http the server was reached.
pub fn failed_parts(https: bool, f: &Failed) -> (Option<std::io::ErrorKind>, Option<String>) {
    if certificate_error(&f.text) {
        (None, Some(f.text.clone()))
    } else if f.timeout {
        (Some(std::io::ErrorKind::TimedOut), None)
    } else if let Some(k) = f.io {
        (Some(k), None)
    } else {
        (None, https.then(|| f.text.clone()))
    }
}

fn error_text(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push_str(" / ");
        out.push_str(&s.to_string());
        cur = s.source();
    }
    out
}

/// The diagnosis when `head_gate` would skip every probe of `url`: no request is made for it.
pub fn skipped_diagnosis(saved: &Result<Option<String>, String>, url: &Url) -> Option<Diagnosis> {
    head_gate(saved, url).err().map(|_| Diagnosis { kind: "skipped", local: local_host(url), https: https_twin(url) })
}

/// Looks at why `url` failed to load, for the overlay's wording. The address passes the same
/// check as a page load (`allowed`), so a page cannot aim this at the user's own network.
#[tauri::command]
pub async fn browser_diagnose(app: AppHandle, url: String) -> Result<Diagnosis, String> {
    let url = parse(&url)?;
    allowed(&url, app_origin(&app).as_ref())?;
    let (local, https) = (local_host(&url), https_twin(&url));
    // T-323-d: under a saved proxy nothing is asked, not even the name lookup (it would go around the proxy).
    if let Some(d) = skipped_diagnosis(&saved_proxy(&app), &url) {
        return Ok(d);
    }
    let probe = url.clone();
    let ips = tauri::async_runtime::spawn_blocking(move || lookup(&probe)).await.map_err(|e| e.to_string())?;
    let (tcp, tls) = if ips.is_empty() {
        (None, None)
    } else {
        // An address that looks up to this machine or the local network goes through the near client.
        match head(&app, &url, ips.iter().any(|ip| local_ip(*ip)), DIAGNOSE_WAIT).await {
            Ok(_) => (None, None),
            // A proxy saved since the check above: still no answer of its own.
            Err(f) if proxy_skipped(&f) => return Ok(Diagnosis { kind: "skipped", local, https }),
            Err(f) => failed_parts(url.scheme() == "https", &f),
        }
    };
    Ok(Diagnosis { kind: failure_kind(!ips.is_empty(), tcp, tls.as_deref()), local, https })
}

#[cfg(test)]
mod tests {
    use super::selfclose::Rebuild;
    use super::*;

    #[test]
    fn row_954d_a_rebuild_leaves_the_pending_cli_profile_for_the_new_tab() {
        hand_profile("https://n2.example/", "work".into());
        assert_eq!(given_profile(Rebuild::Auto, "https://n2.example/"), None, "a rebuild takes nothing");
        assert_eq!(given_profile(Rebuild::Retry, "https://n2.example/"), None);
        assert_eq!(given_profile(Rebuild::Fresh, "https://n2.example/"), Some("work".into()), "the new tab still gets it");
        assert_eq!(given_profile(Rebuild::Fresh, "https://n2.example/"), None);
    }

    #[test]
    fn row_977_a_restore_leaves_the_pending_cli_profile_for_the_new_tab() {
        hand_profile("https://n3.example/", "work".into());
        assert_eq!(given_profile(Rebuild::Restore, "https://n3.example/"), None, "a restore takes nothing");
        assert_eq!(given_profile(Rebuild::Fresh, "https://n3.example/"), Some("work".into()), "the entry waited for the new tab");
    }

    #[test]
    fn two_tab_creates_close_together_each_open_in_their_own_profile() {
        hand_profile("https://a.example/", "work".into());
        hand_profile("https://b.example/", "home".into());
        // The second tab opens first: it still gets its own profile, not the first create's.
        assert_eq!(take_profile("https://b.example/"), Some("home".into()));
        assert_eq!(take_profile("https://a.example/"), Some("work".into()));
        // Nothing left over for a later tab at either address.
        assert_eq!(take_profile("https://a.example/"), None);
        assert_eq!(take_profile("https://c.example/"), None);
    }

    #[test]
    fn brow017_a_right_click_and_a_menu_pick_arrive_as_menu_navigations() {
        // T-239: the page reports the pointer, its size, the link under it and whether text is selected.
        let v = menu_of("kolux-chord:menu?x=12&y=34&vw=800&vh=600&s=1&l=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2").unwrap();
        assert_eq!(v["kind"], "menu");
        assert_eq!(v["x"], "12");
        assert_eq!(v["vh"], "600");
        assert_eq!(v["s"], "1");
        assert_eq!(v["l"], "https://example.com/a?b=1&c=2");
        let p = menu_of("kolux-chord:pick?what=open-kolux&u=https%3A%2F%2Fexample.com%2F").unwrap();
        assert_eq!(p["kind"], "pick");
        assert_eq!(p["what"], "open-kolux");
        assert_eq!(p["u"], "https://example.com/");
        assert_eq!(with_id(7, p)["id"], 7);
        assert_eq!(menu_of("kolux-chord:back"), None);
        assert_eq!(menu_of("kolux-chord:key?k=w"), None);
        assert_eq!(menu_of("https://example.com/kolux-chord:menu?x=1"), None);
        // Only a page on screen gets a menu (FS1); a hidden page's request is dropped, not loaded.
        let menu = Url::parse("kolux-chord:menu?x=1&y=2&vw=3&vh=4&s=0&l=").unwrap();
        assert!(matches!(navigation(&menu, None, true), Nav::Menu(_)));
        assert!(matches!(navigation(&menu, None, false), Nav::Load(false)));
        // The menu's data goes into the page as a string, never as code.
        assert_eq!(menu_script(r#"{"x":1,"items":[]}"#), r#"window.__kxMenu && window.__kxMenu(JSON.parse("{\"x\":1,\"items\":[]}"))"#);
        for needle in ["contextmenu", "__kxMenu", "execCommand(\"copy\")", "e.button !== 2", "\"Escape\""] {
            assert!(CHORD_SCRIPT.contains(needle), "{needle}");
        }
    }

    #[test]
    fn brow018_an_app_shortcut_pressed_in_the_page_arrives_as_a_key_navigation() {
        // T-239: the key, its code and the modifiers held (c, m, a, s, and g for AltGraph).
        let v = key_of("kolux-chord:key?k=Tab&c=Tab&m=c").unwrap();
        assert_eq!(v["kind"], "key");
        assert_eq!(v["k"], "Tab");
        assert_eq!(v["c"], "Tab");
        assert_eq!(v["m"], "c");
        assert_eq!(key_of("kolux-chord:menu?x=1"), None);
        assert_eq!(key_of("kolux-chord:key"), None);
        let url = Url::parse("kolux-chord:key?k=w&c=KeyW&m=c").unwrap();
        assert!(matches!(navigation(&url, None, true), Nav::Key(_)));
        assert!(matches!(navigation(&url, None, false), Nav::Load(false)));
        assert_eq!(keys_script("[]"), r#"window.__kxKeys && window.__kxKeys(JSON.parse("[]"))"#);
        // The page takes a held key once, honours the app's list, and mirrors the app's key matching.
        for needle in ["__kxKeys", "if (e.repeat) return;", "AltGraph", "\"Key\" + k", "\"Digit\" + k", "k === \"Plus\"", "d.n && copying()", "a.selectionStart !== a.selectionEnd", "s.isCollapsed"] {
            assert!(CHORD_SCRIPT.contains(needle), "{needle}");
        }
    }

    #[test]
    fn brow001_tab_labels_and_addresses() {
        assert_eq!(label(7), "browser-7");
        assert_eq!(parse("about:blank").unwrap().as_str(), "about:blank");
        assert_eq!(parse("https://example.com").unwrap().host_str(), Some("example.com"));
        assert!(parse("not an address").unwrap_err().starts_with("invalid address"));
    }

    #[test]
    fn chords_pressed_inside_the_page_arrive_as_a_blocked_navigation() {
        // T-012-b-fix: the page's script navigates to `kolux-chord:<action>`; only the four
        // browser actions count, so a site cannot smuggle anything else through the channel.
        assert_eq!(chord_of("kolux-chord:focusAddressBar"), Some("focusAddressBar"));
        assert_eq!(chord_of("kolux-chord:back"), Some("back"));
        assert_eq!(chord_of("kolux-chord:forward"), Some("forward"));
        assert_eq!(chord_of("kolux-chord:reload"), Some("reload"));
        assert_eq!(chord_of("kolux-chord:find"), Some("find"));
        assert_eq!(chord_of("kolux-chord:zoomIn"), Some("zoomIn"));
        assert_eq!(chord_of("kolux-chord:zoomReset"), Some("zoomReset"));
        assert_eq!(chord_of("kolux-chord:close"), None);
        assert_eq!(chord_of("https://example.com/kolux-chord:back"), None);
        for needle in ["kolux-chord:", "ArrowLeft", "ArrowRight", "preventDefault", "window.top"] {
            assert!(CHORD_SCRIPT.contains(needle), "{needle}");
        }
    }

    // Row 954 (BROW-001): wry destroys a tab's window when the page asks to close (WindowCloseRequested),
    // so the page's own close() is made a no-op before its scripts run.
    #[test]
    fn row954_a_tab_page_cannot_close_its_own_tab() {
        assert!(NO_CLOSE_SCRIPT.contains("\"close\"") && NO_CLOSE_SCRIPT.contains("defineProperty"), "close is replaced on the window");
        let install = format!(".initialization_script({})", "NO_CLOSE_SCRIPT");
        assert!(include_str!("browser.rs").contains(&install), "the tab builder installs it");
        // Popups close themselves when a sign-in ends, so they never get it.
        assert!(!include_str!("browser_popup.rs").contains("NO_CLOSE_SCRIPT"));
    }

    // Row 954 (b): the close request is observed on tab views only; a popup closing itself is normal.
    #[test]
    fn row954b_only_tab_views_hear_their_close_request() {
        let hook = format!("engine::{}(id, &pw, self_close_app, engine_rec)", "watch_self_close"); // not spelled out, so this test cannot match itself
        assert!(include_str!("browser.rs").contains(&hook), "the tab builder hooks it");
        assert!(!include_str!("browser_popup.rs").contains("watch_self_close"));
        assert!(!include_str!("browser_popup.rs").contains("selfclose"));
    }

    #[test]
    fn t500_a_tab_never_opens_an_origin_tauri_counts_as_the_apps_own() {
        // evidence/T-500-isolation.txt: a page at the dev origin or at a custom-scheme host got
        // every app command; remote http, https and the blank page are what a tab is for.
        let dev = Url::parse("http://localhost:1420").unwrap();
        let ok = |u: &str| allowed(&Url::parse(u).unwrap(), Some(&dev));
        assert_eq!(ok("https://example.com/"), Ok(()));
        assert_eq!(ok("http://localhost:3000/app"), Ok(()));
        assert_eq!(ok("http://127.0.0.1:8745/probe.html"), Ok(()));
        assert_eq!(ok("about:blank"), Ok(()));
        assert!(ok("http://localhost:1420/kolux-probe").unwrap_err().contains("app's own address"));
        assert!(ok("http://kolux-artifact.localhost/x/index.html").unwrap_err().contains("app's own address"));
        assert!(ok("http://tauri.localhost/").unwrap_err().contains("app's own address"));
        assert!(ok("https://ipc.localhost/app_info").is_err());
        assert!(ok("file:///G:/Temp/browser-t195/probe.html").unwrap_err().starts_with("file: addresses do not open"));
        assert!(ok("tauri://localhost/").is_err());
        assert!(ok("javascript:alert(1)").is_err());
        // A release build has no dev origin; the *.localhost rule still holds.
        assert_eq!(allowed(&Url::parse("http://localhost:1420/").unwrap(), None), Ok(()));
        assert!(allowed(&Url::parse("http://tauri.localhost/").unwrap(), None).is_err());
    }

    #[test]
    fn brow011_the_loading_surface_is_the_pane_colour_and_opaque() {
        assert_eq!(surface(Some([13, 13, 13])), Some(Color(13, 13, 13, 255)));
        assert_eq!(surface(Some([250, 250, 249])), Some(Color(250, 250, 249, 255)));
        assert_eq!(surface(None), None);
    }

    #[test]
    fn brow005_toolbar_actions_run_as_page_script() {
        assert_eq!(script("back"), Some("history.back()"));
        assert_eq!(script("forward"), Some("history.forward()"));
        assert_eq!(script("stop"), Some("window.stop()"));
        assert_eq!(script("close"), None);
    }

    #[test]
    fn brow014_a_modded_link_opens_as_a_tab_behind_or_in_front() {
        // What the page script sends: encodeURIComponent of the link's address.
        let sent = "kolux-chord:open-back?u=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2%23top";
        assert_eq!(link_of(sent), Some(("https://example.com/a?x=1&y=2#top".to_string(), false)));
        assert_eq!(link_of("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F"), Some(("https://example.com/".to_string(), true)));
        assert_eq!(link_of("kolux-chord:open-sideways?u=https%3A%2F%2Fexample.com%2F"), None);
        assert_eq!(link_of("kolux-chord:back"), None);
        assert_eq!(link_of("https://example.com/kolux-chord:open-back?u=x"), None);
        assert_eq!(chord_of("kolux-chord:open-back?u=x"), None);
    }

    #[test]
    fn brow007_find_runs_the_engine_find_with_the_text_quoted() {
        assert_eq!(find_script("word", false), r#"window.find("word", false, false, true)"#);
        assert_eq!(find_script(r#"a"); alert(1); (""#, true), r#"window.find("a\"); alert(1); (\"", false, true, true)"#);
    }

    #[test]
    fn brow012_zoom_stays_inside_the_engine_limits() {
        assert_eq!(zoom_level(1.5), 1.5);
        assert_eq!(zoom_level(9.0), 5.0);
        assert_eq!(zoom_level(0.1), 0.25);
        assert_eq!(zoom_level(f64::NAN), 1.0);
    }

    // T-272-c: a storm in one family uses that family's allowance only; real clicks in an
    // unrelated tab still open.
    #[test]
    fn t272c_a_storm_in_one_tab_leaves_real_clicks_in_another_tab_alone() {
        let now = Instant::now();
        let web = Url::parse("https://example.com/").unwrap();
        let mut f = Families::default();
        f.join(1, "https://storm.example/", now);
        f.join(2, "https://docs.example/", now);
        for _ in 0..TABS_ALLOWED {
            assert!(new_window(&web, None, &f.of(1), true, now).is_some());
        }
        assert_eq!(new_window(&web, None, &f.of(1), true, now), None);
        assert!(popup_refused(&web, None, true), "the storm's tab is told popups were blocked");
        // The other family's whole allowance is still there.
        for _ in 0..TABS_ALLOWED {
            assert!(new_window(&web, None, &f.of(2), true, now).is_some());
        }
        assert_eq!(new_window(&web, None, &f.of(2), true, now), None);
    }

    // T-272-c: a tab a page opened shares its opener's allowance, so a page that copies itself
    // into each new tab still gets only the allowance in all, however the address is spelled.
    #[test]
    fn t272c_a_self_copying_page_shares_one_allowance_across_its_family() {
        let now = Instant::now();
        let mut f = Families::default();
        f.join(1, "https://copy.example/", now);
        let mut opener = 1;
        let mut opened = 0;
        for next in 2..20u32 {
            let target = Url::parse(&format!("https://copy.example/{next}")).unwrap();
            match new_window(&target, None, &f.of(opener), true, now) {
                Some((url, _)) => {
                    f.promise(opener, &url, now);
                    // The pane opens the address as typed by the page, in another spelling.
                    f.join(next, &url.replace("https://copy.example", "HTTPS://COPY.example"), now);
                    assert!(Arc::ptr_eq(&f.of(next), &f.of(1)), "tab {next} joined the family");
                    opener = next;
                    opened += 1;
                }
                None => break,
            }
        }
        assert_eq!(opened, TABS_ALLOWED);
        // A link navigation from the newest copy draws on the same, used-up allowance.
        let link = Url::parse("kolux-chord:open-front?u=https%3A%2F%2Fcopy.example%2Fx").unwrap();
        assert_eq!(link_nav(&link, None, &f.of(opener), true, now), Nav::Load(false));
    }

    // T-272-c: a tab nobody promised (the user's own, a restored one), a promise past its window,
    // and a tab opened again keep to the rules: own family, own family, same family.
    #[test]
    fn t272c_unpromised_late_and_reopened_tabs() {
        let now = Instant::now();
        let mut f = Families::default();
        f.join(1, "https://a.example/", now);
        f.promise(1, "https://b.example/", now);
        f.join(2, "https://c.example/", now);
        assert!(!Arc::ptr_eq(&f.of(1), &f.of(2)), "another address starts its own family");
        f.join(3, "https://b.example/", now + PROMISE_WINDOW);
        assert!(!Arc::ptr_eq(&f.of(1), &f.of(3)), "a promise past its window is dropped");
        f.promise(1, "https://d.example/", now);
        f.join(4, "https://d.example/", now);
        assert!(Arc::ptr_eq(&f.of(1), &f.of(4)));
        // Opening tab 4 again keeps its family; closing it and opening the id fresh does not.
        f.join(4, "https://e.example/", now);
        assert!(Arc::ptr_eq(&f.of(1), &f.of(4)));
        f.leave(4);
        f.join(4, "https://e.example/", now);
        assert!(!Arc::ptr_eq(&f.of(1), &f.of(4)));
        // Each promise opens one tab only.
        f.promise(1, "https://g.example/", now);
        f.join(5, "https://g.example/", now);
        f.join(6, "https://g.example/", now);
        assert!(Arc::ptr_eq(&f.of(1), &f.of(5)));
        assert!(!Arc::ptr_eq(&f.of(1), &f.of(6)));
    }

    // T-272-c: only a refusal a user could have caused shows "popups blocked": not a hidden
    // tab's, not an address no tab may open.
    #[test]
    fn t272c_popups_blocked_shows_only_for_a_shown_tab_and_a_web_address() {
        let web = Url::parse("https://example.com/").unwrap();
        assert!(popup_refused(&web, None, true));
        assert!(!popup_refused(&web, None, false));
        assert!(!popup_refused(&Url::parse("http://tauri.localhost/").unwrap(), None, true));
        assert!(!popup_refused(&Url::parse("file:///C:/x").unwrap(), None, true));
    }

    #[test]
    fn brow016_a_window_storm_opens_a_handful_of_tabs_and_the_allowance_comes_back() {
        let start = Instant::now();
        let mut a = Allowance::default();
        // 100 windows from one click: a few open, the rest are absorbed.
        let opened = (0..100).filter(|_| a.take(start)).count();
        assert_eq!(opened, TABS_ALLOWED);
        // A steady stream inside the same window gets nothing more.
        assert!(!a.take(start + Duration::from_secs(9)));
        // Once the window has passed (a minute later) links open again.
        assert!(a.take(start + Duration::from_secs(60)));
        // A slow, steady stream, one a second for a minute, never beats the window either.
        let mut b = Allowance::default();
        let through = (0..60).filter(|i| b.take(start + Duration::from_secs(*i))).count();
        assert_eq!(through, TABS_ALLOWED * 6);
    }

    #[test]
    fn brow023_the_site_icon_is_a_small_image_from_a_web_address() {
        let page = Url::parse("https://example.com/a").unwrap();
        assert_eq!(icon_address(r#""https://example.com/favicon.ico""#, None, &page).map(|u| u.to_string()), Some("https://example.com/favicon.ico".into()));
        assert_eq!(icon_address(r#""http://tauri.localhost/x.png""#, None, &page), None);
        assert_eq!(icon_address(r#""data:image/png;base64,AA==""#, None, &page), None);
        assert_eq!(icon_address("null", None, &page), None);
        assert_eq!(icon_data("image/png", &[1, 2, 3]), Some("data:image/png;base64,AQID".into()));
        assert_eq!(icon_data("Image/X-Icon; charset=binary", &[1]), Some("data:image/x-icon;base64,AQ==".into()));
        assert_eq!(icon_data("text/html", b"<html>"), None);
        assert_eq!(icon_data("image/png", &[]), None);
        assert_eq!(icon_data("image/png", &vec![0; ICON_MAX + 1]), None);
    }

    /// A link request as it ends once the user started it: `Nav::Link` only if the allowance had room.
    fn link_nav(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, on_screen: bool, now: Instant) -> Nav {
        match navigation(url, dev, on_screen) {
            Nav::Link(l, _) if !link_opens(&l, dev, tabs, now) => Nav::Load(false),
            nav => nav,
        }
    }

    // Council FIX-1 (d2/browser-80d198b-review.md). A page that loops
    // `location.assign("kolux-chord:open-front?u=" + location.href)` must hit the same allowance a
    // window storm does, or each new tab copies itself until memory runs out.
    #[test]
    fn fix1_a_link_navigations_take_from_the_same_allowance_as_new_windows() {
        let now = Instant::now();
        let me = Url::parse("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F").unwrap();
        let web = Url::parse("https://example.com/").unwrap();
        let tabs = Mutex::new(Allowance::default());
        let links = (0..100).filter(|_| matches!(link_nav(&me, None, &tabs, true, now), Nav::Link(..))).count();
        assert_eq!(links, TABS_ALLOWED);
        assert_eq!(link_nav(&me, None, &tabs, true, now), Nav::Load(false));
        // The two ways share one allowance, in either order.
        assert_eq!(new_window(&web, None, &tabs, true, now), None);
        let tabs = Mutex::new(Allowance::default());
        for _ in 0..TABS_ALLOWED {
            assert_eq!(new_window(&web, None, &tabs, true, now), Some(("https://example.com/".into(), true)));
        }
        assert_eq!(link_nav(&me, None, &tabs, true, now), Nav::Load(false));
        // It comes back once the window has passed.
        assert_eq!(link_nav(&me, None, &tabs, true, now + TABS_WINDOW), Nav::Link("https://example.com/".into(), true));
        // A refused address takes nothing from it.
        let tabs = Mutex::new(Allowance::default());
        let bad = Url::parse("kolux-chord:open-back?u=http%3A%2F%2Ftauri.localhost%2F").unwrap();
        for _ in 0..50 {
            assert_eq!(link_nav(&bad, None, &tabs, true, now), Nav::Load(false));
            assert_eq!(new_window(&Url::parse("http://tauri.localhost/").unwrap(), None, &tabs, true, now), None);
        }
        assert!(matches!(link_nav(&me, None, &tabs, true, now), Nav::Link(..)));
        // Ordinary navigations and chords are not counted and behave as before.
        for _ in 0..20 {
            assert_eq!(link_nav(&web, None, &tabs, true, now), Nav::Load(true));
            assert_eq!(link_nav(&Url::parse("kolux-chord:back").unwrap(), None, &tabs, true, now), Nav::Chord("back"));
        }
        assert_eq!(link_nav(&Url::parse("http://tauri.localhost/").unwrap(), None, &tabs, true, now), Nav::Load(false));
        assert_eq!(link_nav(&Url::parse("kolux-chord:close").unwrap(), None, &tabs, true, now), Nav::Load(false));
    }

    #[test]
    fn fix1_c_a_public_page_never_points_the_icon_fetch_at_this_machine_or_network() {
        let public = Url::parse("https://example.com/a").unwrap();
        for icon in [
            "http://127.0.0.1:8745/x.ico",
            "http://localhost/favicon.ico",
            "http://[::1]/x",
            "http://[fe80::1]/x",
            "http://[fd00::5]/x",
            "http://[::ffff:192.168.0.1]/x",
            "http://192.168.1.1/x",
            "http://10.0.0.1/x",
            "http://172.16.4.4/x",
            "http://169.254.169.254/latest",
            "http://100.64.0.1/x",
            "http://0.0.0.0/x",
            "http://router/x",
            "http://nas.local/x",
            "http://box.lan/x",
            "http://svc.internal/x",
        ] {
            assert_eq!(icon_address(&format!("\"{icon}\""), None, &public), None, "{icon}");
        }
        assert!(icon_address(r#""https://cdn.example.net/i.png""#, None, &public).is_some());
        assert!(icon_address(r#""https://8.8.8.8/i.png""#, None, &public).is_some());
        assert!(icon_address(r#""https://[2001:db8::1]/i.png""#, None, &public).is_some());
        // A page on the user's own dev server or LAN box may show that host's own icon.
        let dev = Url::parse("http://localhost:3000/app").unwrap();
        assert!(icon_address(r#""http://localhost:3000/favicon.ico""#, None, &dev).is_some());
        assert_eq!(icon_address(r#""http://192.168.1.1/favicon.ico""#, None, &dev), None);
        let lan = Url::parse("http://192.168.1.5/").unwrap();
        assert!(icon_address(r#""http://192.168.1.5/f.ico""#, None, &lan).is_some());
        // Council FIX-4, AFTER 2 (flipped): the same host on another port is another service.
        assert_eq!(icon_address(r#""http://192.168.1.5:8080/f.ico""#, None, &lan), None);
        // The app's own dev origin stays refused even for a page on localhost.
        let app = Url::parse("http://localhost:1420").unwrap();
        assert_eq!(icon_address(r#""http://localhost:1420/favicon.ico""#, Some(&app), &dev), None);
    }

    #[test]
    fn fix1_c_every_redirect_hop_is_checked_again() {
        let u = |s: &str| Url::parse(s).unwrap();
        let https = [u("https://example.com/favicon.ico")];
        assert!(hop_ok(&u("https://cdn.example.net/i.png"), &https, None));
        assert!(!hop_ok(&u("http://cdn.example.net/i.png"), &https, None), "https down to http");
        assert!(hop_ok(&u("http://cdn.example.net/i.png"), &[u("http://example.com/x")], None));
        assert!(!hop_ok(&u("http://192.168.1.1/"), &https, None));
        assert!(!hop_ok(&u("https://localhost:3000/"), &https, None));
        assert!(!hop_ok(&u("https://tauri.localhost/"), &https, None));
        assert!(!hop_ok(&u("file:///C:/Windows/win.ini"), &https, None));
        assert!(!hop_ok(&u("about:blank"), &https, None));
        let app = u("http://localhost:1420");
        let local = [u("http://localhost:3000/favicon.ico")];
        assert!(hop_ok(&u("http://localhost:3000/real.ico"), &local, Some(&app)));
        assert!(!hop_ok(&u("http://localhost:1420/x"), &local, Some(&app)));
        assert!(!hop_ok(&u("http://192.168.0.1/"), &local, Some(&app)));
        let long: Vec<Url> = (0..=ICON_HOPS).map(|i| u(&format!("https://example.com/{i}"))).collect();
        assert!(!hop_ok(&u("https://example.com/next"), &long, None));
        assert!(!hop_ok(&u("https://example.com/next"), &[], None));
    }

    /// One HTTP answer on a loopback port: `head` (status line and headers), then `body` bytes.
    /// The thread returns whether the whole body went out.
    fn answer_once(head: String, body: usize) -> (Url, std::thread::JoinHandle<bool>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let t = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let (mut buf, mut got) = ([0u8; 4096], Vec::new());
            while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                match s.read(&mut buf) {
                    Ok(0) | Err(_) => return false,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                }
            }
            if s.write_all(head.as_bytes()).is_err() {
                return false;
            }
            let (chunk, mut sent) = (vec![7u8; 64 * 1024], 0);
            while sent < body {
                let n = chunk.len().min(body - sent);
                if s.write_all(&chunk[..n]).is_err() {
                    return false;
                }
                sent += n;
            }
            true
        });
        (url, t)
    }

    #[test]
    fn fix1_b_the_icon_fetch_stops_reading_past_the_limit() {
        let clients = icon_clients(None, system_lookup).unwrap();
        let fetch = |url: Url| tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None));
        let big = 32 * 1024 * 1024;
        // No length given: the body is read only until it passes the limit.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n".into(), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "the whole 32 MB body was read");
        // A length over the limit: refused before the body is read.
        let (url, server) = answer_once(format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {big}\r\n\r\n"), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "a body said to be 32 MB was read");
        // Not an image: refused before the body is read.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n".into(), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "a 32 MB page was read as an icon");
        // A real icon still comes through.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n".into(), 3);
        assert_eq!(fetch(url), Some("data:image/png;base64,BwcH".into()));
        assert!(server.join().unwrap());
    }

    #[test]
    fn fix1_c_the_icon_client_refuses_a_redirect_onto_another_local_host() {
        use std::io::{Read, Write};
        // The second host: counts whether anything asked it.
        let second = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = second.local_addr().unwrap().port();
        second.set_nonblocking(true).unwrap();
        // The first answer sends the fetch to the same machine under another name.
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://localhost:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        let clients = icon_clients(None, system_lookup).unwrap();
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        let start = Instant::now();
        let mut asked = false;
        while start.elapsed() < Duration::from_millis(500) {
            if let Ok((mut s, _)) = second.accept() {
                asked = true;
                let _ = s.read(&mut [0u8; 64]);
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!asked, "the redirect onto localhost was followed");
        // A redirect within the host and port the chain started on is followed (council FIX-4,
        // AFTER 2: another port of that host is refused, fix4_2_a_same_host_redirect_...).
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            let answers: [&[u8]; 2] = [
                b"HTTP/1.1 302 Found\r\nLocation: /real.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x07\x07\x07",
            ];
            let mut asked = Vec::new();
            for answer in answers {
                let (mut s, _) = l.accept().unwrap();
                let (mut buf, mut got) = ([0u8; 4096], Vec::new());
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                asked.push(String::from_utf8_lossy(&got).lines().next().unwrap_or_default().to_string());
                let _ = s.write_all(answer);
            }
            asked
        });
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), Some("data:image/png;base64,BwcH".into()));
        assert_eq!(server.join().unwrap(), ["GET /favicon.ico HTTP/1.1", "GET /real.png HTTP/1.1"]);
    }

    #[test]
    fn fix1_b_a_reloading_page_starts_one_icon_fetch_per_address() {
        let mut i = Icons::default();
        let a = "https://example.com/favicon.ico";
        assert_eq!(i.begin(1, a), IconStep::Fetch);
        for _ in 0..100 {
            assert_eq!(i.begin(1, a), IconStep::Busy);
        }
        // Another tab fetches on its own.
        assert_eq!(i.begin(2, a), IconStep::Fetch);
        i.end(1, a, Some("data:image/png;base64,AQ=="));
        assert_eq!(i.begin(1, a), IconStep::Have("data:image/png;base64,AQ==".into()));
        // A new address is fetched; a failed fetch is tried again on the next load.
        assert_eq!(i.begin(1, "https://example.com/b.ico"), IconStep::Fetch);
        i.end(1, "https://example.com/b.ico", None);
        assert_eq!(i.begin(1, "https://example.com/b.ico"), IconStep::Fetch);
        // A tab closed mid-fetch keeps nothing.
        i.forget(2);
        i.end(2, a, Some("data:image/png;base64,AQ=="));
        assert_eq!(i.begin(2, a), IconStep::Fetch);
    }

    // Council FIX-2, FS1: a tab that is not on screen cannot have a user gesture, so it opens no
    // tab, sends no chord and takes nothing from the allowance the user's own clicks share.
    #[test]
    fn fix2_a_a_hidden_tab_opens_nothing_sends_no_chord_and_leaves_the_allowance() {
        let now = Instant::now();
        let tabs = Mutex::new(Allowance::default());
        let front = Url::parse("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F").unwrap();
        let back = Url::parse("kolux-chord:open-back?u=https%3A%2F%2Fexample.com%2F").unwrap();
        let web = Url::parse("https://example.com/").unwrap();
        for _ in 0..100 {
            assert_eq!(link_nav(&front, None, &tabs, false, now), Nav::Load(false));
            assert_eq!(link_nav(&back, None, &tabs, false, now), Nav::Load(false));
            assert_eq!(new_window(&web, None, &tabs, false, now), None);
            for what in CHORDS {
                let chord = Url::parse(&format!("kolux-chord:{what}")).unwrap();
                assert_eq!(link_nav(&chord, None, &tabs, false, now), Nav::Load(false), "{what}");
            }
        }
        // The hidden storm took nothing: a shown tab's real clicks still get the whole allowance.
        for _ in 0..TABS_ALLOWED - 1 {
            assert_eq!(link_nav(&back, None, &tabs, true, now), Nav::Link("https://example.com/".into(), false));
        }
        assert_eq!(new_window(&web, None, &tabs, true, now), Some(("https://example.com/".into(), true)));
        assert_eq!(link_nav(&front, None, &tabs, true, now + TABS_WINDOW), Nav::Link("https://example.com/".into(), true));
        assert_eq!(link_nav(&Url::parse("kolux-chord:focusAddressBar").unwrap(), None, &tabs, true, now), Nav::Chord("focusAddressBar"));
        // A hidden tab still loads ordinary pages and still refuses the app's own.
        assert_eq!(link_nav(&web, None, &tabs, false, now), Nav::Load(true));
        assert_eq!(link_nav(&Url::parse("http://tauri.localhost/").unwrap(), None, &tabs, false, now), Nav::Load(false));
    }

    /// An icon server on a loopback port that answers every request with a 3-byte image; the
    /// count is how many connections reached it.
    fn icon_server() -> (u16, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = hits.clone();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let Ok(mut s) = s else { continue };
                seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let (mut buf, mut got) = ([0u8; 4096], Vec::new());
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x07\x07\x07");
            }
        });
        (port, hits)
    }

    /// A stand-in lookup: every name is this machine (what nip.io, localtest.me or a rebound
    /// name answers), so no test ever asks the real network.
    fn to_this_machine(_: &str) -> std::io::Result<Vec<IpAddr>> {
        Ok(vec![IpAddr::from([127, 0, 0, 1])])
    }

    // Council FIX-2, FS2.
    #[test]
    fn fix2_b_a_public_name_that_resolves_to_this_machine_is_never_asked() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        for name in ["192-168-1-1.nip.io", "localtest.me", "rebound.example.com"] {
            let url = Url::parse(&format!("http://{name}:{port}/favicon.ico")).unwrap();
            assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, false, url, None)), None, "{name}");
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0, "an icon fetch reached this machine through a public name");
        // Council FIX-3: a page on that very public name gets no icon from there either (a name
        // rebound after the page loaded would take the fetch onto this machine).
        let own = Url::parse(&format!("http://localtest.me:{port}/favicon.ico")).unwrap();
        let page = Url::parse(&format!("http://localtest.me:{port}/")).unwrap();
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, icon_near(&own, &page), own, None)), None);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn fix2_b_a_redirect_off_the_pages_own_host_goes_through_the_public_lookup() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://lan-box.example:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "the redirect reached this machine through a public name");
    }

    #[test]
    fn fix2_b_the_public_lookup_keeps_only_public_addresses() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let all = [
            "127.0.0.1", "192.168.1.1", "10.0.0.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::5",
            "::ffff:10.0.0.1", "::7f00:1", "8.8.8.8", "2001:db8::1",
        ];
        assert_eq!(public_addrs(all.map(ip).to_vec()), vec![ip("8.8.8.8"), ip("2001:db8::1")]);
    }

    // Council FIX-2, AFTER 4 and 5.
    #[test]
    fn fix2_c_ipv4_compatible_addresses_and_a_trailing_dot_are_caught() {
        let u = |s: &str| Url::parse(s).unwrap();
        for s in ["http://[::7f00:1]/", "http://[::a00:1]/", "http://[::c0a8:101]/"] {
            assert!(local_host(&u(s)), "{s}");
        }
        assert!(!local_host(&u("http://[::808:808]/")));
        let public = u("https://example.com/");
        assert_eq!(icon_address(r#""http://[::7f00:1]:8745/x""#, None, &public), None);
        assert!(allowed(&u("http://tauri.localhost./"), None).is_err());
        assert!(allowed(&u("http://ipc.localhost./x"), None).is_err());
        let app = u("http://localhost:1420");
        assert!(allowed(&u("http://localhost.:1420/"), Some(&app)).is_err());
        assert!(allowed(&u("http://localhost:3000/"), Some(&app)).is_ok());
        assert!(allowed(&u("https://example.com./"), Some(&app)).is_ok());
    }

    // Council FIX-2, AFTER 2: `?r=random` on every reload cannot fan out icon fetches.
    #[test]
    fn fix2_c_a_tab_has_one_icon_fetch_at_a_time() {
        let mut i = Icons::default();
        assert_eq!(i.begin(1, "https://example.com/i.png?r=1"), IconStep::Fetch);
        for n in 2..50 {
            assert_eq!(i.begin(1, &format!("https://example.com/i.png?r={n}")), IconStep::Busy, "{n}");
        }
        assert_eq!(i.begin(2, "https://example.com/i.png?r=1"), IconStep::Fetch);
        i.end(1, "https://example.com/i.png?r=1", None);
        assert_eq!(i.begin(1, "https://example.com/i.png?r=9"), IconStep::Fetch);
    }

    // Council FIX-3, FIX-BEFORE 1: DNS rebinding through the page's own name, on any port.
    #[test]
    fn fix3_1_a_public_pages_own_name_goes_through_the_public_lookup_on_any_port() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        for (page, icon) in [
            ("http://rb.example/".to_string(), format!("http://rb.example:{port}/x")),
            ("https://rb.example/".to_string(), format!("http://rb.example:{port}/x")),
            (format!("http://rb.example:{port}/"), format!("http://rb.example:{port}/favicon.ico")),
        ] {
            let (page, icon) = (Url::parse(&page).unwrap(), Url::parse(&icon).unwrap());
            assert!(!icon_near(&icon, &page), "{page} {icon}");
            assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, icon_near(&icon, &page), icon, None)), None);
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0, "a rebound public name reached this machine");
        // A page that is itself on this machine or the local network still gets its own icon.
        let page = Url::parse(&format!("http://localhost:{port}/app")).unwrap();
        let icon = Url::parse(&format!("http://localhost:{port}/favicon.ico")).unwrap();
        assert!(icon_near(&icon, &page));
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, icon, None)), Some("data:image/png;base64,BwcH".into()));
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert!(!icon_near(&Url::parse("http://other.lan/x").unwrap(), &Url::parse("http://box.lan/").unwrap()));
    }

    // Council FIX-3, AFTER 1.
    #[test]
    fn fix3_3_translation_and_reserved_ranges_are_local() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let local = [
            "64:ff9b::7f00:1", "64:ff9b::808:808", "64:ff9b:1::1", "64:ff9b:1:ffff::1", "2002:c0a8:101::1", "2002:808:808::1", "fec0::1", "feff::1",
            "198.18.0.1", "198.19.255.255", "192.0.0.8", "240.0.0.1", "255.255.255.254",
        ];
        for s in local {
            assert!(local_ip(ip(s)), "{s}");
        }
        let public = ["198.17.255.255", "198.20.0.1", "192.0.1.1", "64:ff9c::1", "64:ff9b:2::1", "2003::1", "fe00::1", "8.8.8.8"];
        for s in public {
            assert!(!local_ip(ip(s)), "{s}");
        }
        let mut all: Vec<IpAddr> = local.map(ip).to_vec();
        all.push(ip("8.8.8.8"));
        assert_eq!(public_addrs(all), vec![ip("8.8.8.8")]);
    }

    // Council FIX-3, AFTER 2 (review "Tests"): the hand-off from the near client to the far one.
    #[test]
    fn fix3_3_a_redirect_off_the_pages_host_is_handed_on_under_the_hop_rule() {
        let u = |s: &str| Url::parse(s).unwrap();
        let from = u("https://example.com/favicon.ico");
        assert_eq!(hand_off(&from, Some("/i.png"), None), Some(u("https://example.com/i.png")));
        assert_eq!(hand_off(&from, Some("https://cdn.example.net/i.png"), None), Some(u("https://cdn.example.net/i.png")));
        assert_eq!(hand_off(&from, Some("//cdn.example.net/i.png"), None), Some(u("https://cdn.example.net/i.png")));
        assert_eq!(hand_off(&from, Some("http://cdn.example.net/i.png"), None), None, "https down to http");
        assert_eq!(hand_off(&from, Some("https://192.168.1.1/"), None), None);
        assert_eq!(hand_off(&from, Some("https://[::7f00:1]/"), None), None);
        assert_eq!(hand_off(&from, Some("https://tauri.localhost/"), None), None);
        assert_eq!(hand_off(&from, Some("file:///C:/Windows/win.ini"), None), None);
        assert_eq!(hand_off(&from, None, None), None);
        let local = u("http://localhost:3000/favicon.ico");
        assert_eq!(hand_off(&local, Some("/real.ico"), None), Some(u("http://localhost:3000/real.ico")));
        assert_eq!(hand_off(&local, Some("http://127.0.0.1:8745/"), None), None);
        assert_eq!(hand_off(&local, Some("http://localhost:1420/x"), Some(&u("http://localhost:1420"))), None);
    }

    #[test]
    fn row939_an_unreadable_settings_file_is_an_error_not_no_proxy() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-row939-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        assert_eq!(proxy_in_settings(store.try_settings()), Ok(None), "no file yet (first run) is no proxy");
        std::fs::write(dir.join("settings.json"), "{ half written").unwrap();
        assert_eq!(proxy_in_settings(store.try_settings()), Err(SETTINGS_UNREADABLE.to_string()), "corrupt with no usable backup");
        assert!(!icon_fetch_allowed(&proxy_in_settings(store.try_settings())), "and no icon goes direct either");
        std::fs::write(dir.join("settings.json"), r#"{"httpProxy":"http://127.0.0.1:3128"}"#).unwrap();
        assert_eq!(proxy_in_settings(store.try_settings()), Ok(Some("http://127.0.0.1:3128".to_string())));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Row 939b, changed by row 944: a missing settings.json beside a .bak reads the .bak (state.rs read_file),
    // so a proxy in it is honoured and a copy that cannot be read refuses the tab, the icon and the HEAD.
    #[test]
    fn row939b_a_missing_settings_file_with_a_proxy_in_the_last_good_copy_refuses_everything() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-row939b-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        let read = |s: &crate::state::Store| proxy_in_profile(s.try_settings(), &s.dir());
        let bak = dir.join("settings.json.bak");
        assert_eq!(read(&store), Ok(None), "neither file: first run");
        // Row 944: the load now reads the copy for a missing file, so a proxy in it is the saved proxy.
        for (what, bytes, want) in [
            ("a proxy", r#"{"httpProxy":"http://127.0.0.1:3128"}"#, Ok(Some("http://127.0.0.1:3128".to_string()))),
            ("an empty proxy", r#"{"httpProxy":""}"#, Ok(None)),
            ("no proxy", r#"{"theme":"dark"}"#, Ok(None)),
            ("a copy that cannot be read", "{ half written", Err(SETTINGS_UNREADABLE.to_string())),
        ] {
            std::fs::write(&bak, bytes).unwrap();
            let got = read(&store);
            assert_eq!(got, want, "{what}");
            if got.is_err() {
                assert!(!icon_fetch_allowed(&got), "{what}: no icon or HEAD goes direct");
            }
        }
        std::fs::write(dir.join("settings.json"), r#"{"theme":"dark"}"#).unwrap();
        std::fs::write(&bak, r#"{"httpProxy":"http://127.0.0.1:3128"}"#).unwrap();
        assert_eq!(read(&store), Ok(None), "a settings file that is there is the truth; the copy is only for a corrupt one");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // T-323-c: a saved proxy means no icon fetch at all; the icon clients only ever connect directly.
    #[test]
    fn t323c_with_a_saved_proxy_no_icon_fetch_goes_direct() {
        use std::io::{Read, Write};
        let ok = |p: Option<&str>| icon_fetch_allowed(&Ok(p.map(str::to_string)));
        assert!(ok(None) && ok(Some("  ")));
        assert!(!ok(Some("http://127.0.0.1:8080")) && !ok(Some("socks5://proxy.test:1080")));
        assert!(!ok(Some("not a url")), "a setting the engine cannot take is not an excuse to go direct");
        assert!(!icon_fetch_allowed(&Err("sealed value unreadable".into())));
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.set_nonblocking(true).unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let clients = icon_clients(None, system_lookup).unwrap();
        let proxied = Ok(Some("http://127.0.0.1:8080".to_string()));
        assert_eq!(tauri::async_runtime::block_on(fetch_icon_unless_proxied(&proxied, &clients, true, url.clone(), None)), None);
        assert!(l.accept().is_err(), "a connection reached the icon host under a saved proxy");
        l.set_nonblocking(false).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 4096]);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n\x07\x07\x07");
        });
        let got = tauri::async_runtime::block_on(fetch_icon_unless_proxied(&Ok(None), &clients, true, url, None));
        assert_eq!(got, Some("data:image/png;base64,BwcH".into()), "without a proxy the icon is fetched as before");
        server.join().unwrap();
    }

    // T-323-d: every other direct request Kolux makes (download size, diagnosis, update probe) follows the same rule.
    #[test]
    fn t323d_with_a_saved_proxy_no_head_goes_direct() {
        use std::io::{Read, Write};
        let u = |s: &str| Url::parse(s).unwrap();
        let proxied: Result<Option<String>, String> = Ok(Some("http://127.0.0.1:8080".into()));
        let unusable: Result<Option<String>, String> = Ok(Some("not a url".into()));
        let unreadable: Result<Option<String>, String> = Err("sealed value unreadable".into());
        let free: Result<Option<String>, String> = Ok(None);
        // The gate, per address: only this machine's own addresses skip a proxy (the engine never sends them to one).
        for saved in [&proxied, &unusable, &unreadable] {
            for own in ["http://127.0.0.1:3000/", "http://localhost:3000/", "http://[::1]:3000/", "http://127.9.9.9/"] {
                assert!(head_gate(saved, &u(own)).is_ok(), "{own} is this machine's: a proxy never carries it");
            }
            // The browser pane sets no bypass list, so its own LAN traffic goes through the proxy: so does the rule here.
            for other in ["https://example.com/a.zip", "http://192.168.1.5/", "http://10.0.0.2:8080/", "http://nas.lan/", "http://intranet/", "http://0.0.0.0:80/"] {
                let f = head_gate(saved, &u(other)).unwrap_err();
                assert!(proxy_skipped(&f) && f.text.contains("proxy is saved") && !f.timeout && f.io.is_none(), "{other} must be skipped");
            }
        }
        for any in ["https://example.com/", "http://192.168.1.5/", "http://127.0.0.1/"] {
            assert!(head_gate(&free, &u(any)).is_ok(), "without a proxy {any} is asked as before");
        }
        assert!(!proxy_skipped(&Failed { text: "connect error".into(), timeout: false, io: None }));
        // The real sockets: a host that would be reached (the lookup says this machine) sees 0 connections under a proxy.
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        l.set_nonblocking(true).unwrap();
        let clients = icon_clients(None, |_| Ok(vec![IpAddr::from([127, 0, 0, 1])])).unwrap();
        let ask = |saved: &Result<Option<String>, String>, url: &Url, near: bool| tauri::async_runtime::block_on(head_unless_proxied(saved, &clients, url, near, DIAGNOSE_WAIT));
        let lan = u(&format!("http://nas.lan:{port}/big.zip"));
        let public = u(&format!("http://files.example.com:{port}/big.zip"));
        for saved in [&proxied, &unusable, &unreadable] {
            assert!(proxy_skipped(&ask(saved, &lan, true).unwrap_err()));
            assert!(proxy_skipped(&ask(saved, &public, false).unwrap_err()));
        }
        assert!(l.accept().is_err(), "a connection reached the host under a saved proxy");
        l.set_nonblocking(false).unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut s, _) = l.accept().unwrap();
                let _ = s.read(&mut [0u8; 4096]);
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 42\r\nConnection: close\r\n\r\n");
            }
        });
        let seen = Ok(Answer { status: 200, length: Some(42) });
        assert_eq!(ask(&proxied, &u(&format!("http://127.0.0.1:{port}/")), true), seen, "a loopback address still connects under a proxy");
        assert_eq!(ask(&free, &lan, true), seen, "without a proxy the request goes as before");
        assert_eq!(ask(&unusable, &u(&format!("http://localhost:{port}/")), true), seen);
        server.join().unwrap();
    }

    // T-323-e: an EMPTY setting means "the system's proxy" (OD-18): when one is in use, the gate fails closed too.
    #[test]
    fn t323e_system_proxy_decision_rows() {
        let none = |_: &str| None;
        let env = |name: &'static str| move |n: &str| (n == name).then(|| "http://proxy.test:3128".to_string());
        assert!(system_proxy_from(Some(1), Some("proxy.test:3128"), None, none), "enabled with a server");
        assert!(!system_proxy_from(Some(1), Some(""), None, none), "enabled, no server");
        assert!(!system_proxy_from(Some(1), Some("  "), None, none), "enabled, blank server");
        assert!(!system_proxy_from(Some(0), Some("proxy.test:3128"), None, none), "a server left behind, switched off");
        assert!(!system_proxy_from(None, Some("proxy.test:3128"), None, none), "no ProxyEnable value");
        assert!(system_proxy_from(None, None, Some("http://wpad.corp/proxy.pac"), none), "a PAC script");
        assert!(system_proxy_from(Some(0), None, Some("http://wpad.corp/proxy.pac"), none), "a PAC script needs no ProxyEnable");
        assert!(!system_proxy_from(None, None, Some(" "), none), "a blank PAC address");
        assert!(!system_proxy_from(None, None, None, none), "nothing set (WPAD auto-detect alone is not counted)");
        for name in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
            assert!(system_proxy_from(None, None, None, env(name)), "{name}");
        }
        assert!(!system_proxy_from(None, None, None, |_| Some(String::new())), "an empty variable is not a proxy");
        assert!(!system_proxy_from(None, None, None, env("NO_PROXY")), "NO_PROXY is not a proxy");
        // The real reader never panics, whatever this machine has (a missing key is the normal case).
        let _ = read_system_proxy();
    }

    #[test]
    fn t323e_an_empty_setting_with_a_system_proxy_makes_no_direct_request() {
        use std::io::{Read, Write};
        let u = |s: &str| Url::parse(s).unwrap();
        let empty: Result<Option<String>, String> = Ok(None);
        let blank: Result<Option<String>, String> = Ok(Some("  ".into()));
        set_system_proxy_for_test(false);
        assert!(icon_fetch_allowed(&empty) && icon_fetch_allowed(&blank) && head_gate(&empty, &u("https://example.com/")).is_ok());
        set_system_proxy_for_test(true);
        assert!(!icon_fetch_allowed(&empty) && !icon_fetch_allowed(&blank), "a system proxy closes the icon gate");
        for own in ["http://127.0.0.1:3000/", "http://localhost:3000/", "http://[::1]:3000/"] {
            assert!(head_gate(&empty, &u(own)).is_ok(), "{own} is this machine's: a proxy never carries it");
        }
        for other in ["https://example.com/a.zip", "http://192.168.1.5/", "http://nas.lan/"] {
            let f = head_gate(&empty, &u(other)).unwrap_err();
            assert!(proxy_skipped(&f), "{other} must be skipped");
        }
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        l.set_nonblocking(true).unwrap();
        let clients = icon_clients(None, |_| Ok(vec![IpAddr::from([127, 0, 0, 1])])).unwrap();
        let ask = |saved: &Result<Option<String>, String>, url: &Url, near: bool| tauri::async_runtime::block_on(head_unless_proxied(saved, &clients, url, near, DIAGNOSE_WAIT));
        let public = u(&format!("http://files.example.com:{port}/big.zip"));
        assert!(proxy_skipped(&ask(&empty, &public, false).unwrap_err()));
        let icon = u(&format!("http://files.example.com:{port}/favicon.ico"));
        assert_eq!(tauri::async_runtime::block_on(fetch_icon_unless_proxied(&empty, &clients, false, icon, None)), None);
        assert!(l.accept().is_err(), "a connection reached the host under the system proxy");
        l.set_nonblocking(false).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 4096]);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 42\r\nConnection: close\r\n\r\n");
        });
        let seen = Ok(Answer { status: 200, length: Some(42) });
        assert_eq!(ask(&empty, &u(&format!("http://127.0.0.1:{port}/")), true), seen, "a loopback address still connects");
        server.join().unwrap();
        set_system_proxy_for_test(false);
    }

    #[test]
    fn t323d_the_diagnosis_under_a_proxy_is_skipped_not_probed() {
        let u = |s: &str| Url::parse(s).unwrap();
        let proxied: Result<Option<String>, String> = Ok(Some("socks5://proxy.test:1080".into()));
        assert_eq!(skipped_diagnosis(&proxied, &u("http://example.com/a")), Some(Diagnosis { kind: "skipped", local: false, https: Some("https://example.com/a".into()) }));
        assert_eq!(skipped_diagnosis(&proxied, &u("http://nas.lan/")).map(|d| (d.kind, d.local)), Some(("skipped", true)));
        assert_eq!(skipped_diagnosis(&Err("sealed value unreadable".into()), &u("https://example.com/")).map(|d| d.kind), Some("skipped"));
        assert_eq!(skipped_diagnosis(&proxied, &u("http://localhost:3000/")), None);
        assert_eq!(skipped_diagnosis(&Ok(None), &u("https://example.com/")), None);
        assert_eq!(serde_json::to_string(&skipped_diagnosis(&proxied, &u("https://example.com/")).unwrap()).unwrap(), r#"{"kind":"skipped","local":false,"https":null}"#);
        // Every caller goes through the one gate in `head`.
        let src = include_str!("browser.rs").replace("\r\n", "\n"); // a Windows checkout is CRLF
        let body = &src[src.find("pub async fn head(app").unwrap()..];
        assert!(body[..body.find("\n}\n").unwrap()].contains("head_unless_proxied(&saved_proxy(app)"));
    }

    // Row 979 (F1): a Fresh open clears its tab's saved row before any step that can fail.
    #[test]
    fn row_979_browser_open_clears_the_stale_row_before_its_first_fallible_step() {
        let src = include_str!("browser.rs").replace("\r\n", "\n"); // a Windows checkout is CRLF
        let from = src.find("pub async fn browser_open(").unwrap();
        let body = &src[from..];
        let body = &body[body.find(") -> Result<(), String> {\n").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let code: String = body.lines().filter(|l| !l.trim_start().starts_with("//")).map(|l| format!("{l}\n")).collect();
        let clear = code.find("profiles::clear_stale_row(").expect("browser_open clears the stale row");
        let first_try = code.find(")?").expect("browser_open has fallible steps");
        assert!(clear < first_try, "the clear sits before the first `?` in browser_open");
        assert!(code.find("profiles::set_root(").unwrap() < clear, "the clear has its root");
    }

    /// browser_open's body without its comment lines, for the source-order ratchets below.
    fn browser_open_code() -> String {
        let src = include_str!("browser.rs").replace("\r\n", "\n"); // a Windows checkout is CRLF
        let body = &src[src.find("pub async fn browser_open(").unwrap()..];
        let body = &body[body.find(") -> Result<(), String> {\n").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        body.lines().filter(|l| !l.trim_start().starts_with("//")).map(|l| format!("{l}\n")).collect()
    }

    // Row 954f: a failed open (the label was taken) must not leave its engine record as the tab's current one,
    // or the live page's next destroy is ignored and the loop cap is never reached.
    #[test]
    fn row_954f_browser_open_records_its_engine_only_once_the_page_exists() {
        let code = browser_open_code();
        let made = code.find("window.add_child(").expect("browser_open adds the page");
        let record = code.find("selfclose::register(").expect("browser_open records the engine");
        assert!(made < record, "selfclose::register comes after add_child");
    }

    // Row 954f: a reopen right after a close sees the label still registered; it waits a bounded time, never reuses the old page.
    #[test]
    fn row_954f_browser_open_waits_for_a_closing_pages_label_before_building() {
        let code = browser_open_code();
        let wait = code.find("selfclose::wait_until_free(").expect("browser_open waits for the label");
        assert!(wait < code.find("window.add_child(").unwrap(), "the wait comes before the page is built");
        assert!(wait < code.find("selfclose::register(").unwrap());
        assert!(code.find("profiles::clear_stale_row(").unwrap() < wait, "the row-979 clear still comes first");
    }

    // Council FIX-3, AFTER 2: one overall time limit, however the fetch goes.
    #[test]
    fn fix3_3_an_icon_fetch_ends_at_its_time_limit() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 4096]);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n");
            std::thread::sleep(Duration::from_millis(2500));
            let _ = s.write_all(b"\x07\x07\x07");
        });
        let clients = icon_clients(None, system_lookup).unwrap();
        let start = Instant::now();
        let got = tauri::async_runtime::block_on(fetch_icon_within(&clients, true, url, None, Duration::from_millis(300)));
        let took = start.elapsed();
        assert_eq!(got, None);
        assert!(took < Duration::from_millis(1500), "took {took:?}");
        server.join().unwrap();
    }

    // Council FIX-4, item 3; renamed in FIX-5: this checks only how focus_app_ok maps the window's
    // focus reading to allow or refuse. The wiring in browser_go and Tauri's cached focus state (true
    // while any web view of the window holds the keyboard) are proven by the batched live proof
    // (evidence/browser-FIX-4.txt steps 2-3), not by this test.
    #[test]
    fn fix4_1_focus_app_ok_allows_a_focused_window_and_refuses_an_unfocused_one() {
        assert_eq!(focus_app_ok(true), Ok(()));
        assert!(focus_app_ok(false).is_err());
    }

    // Council FIX-4, AFTER 2: the port counts, so a page on one local port reaches no other.
    #[test]
    fn fix4_2_a_local_page_reaches_no_other_port_of_its_host() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(same_spot(&u("http://localhost/"), &u("http://localhost:80/x")));
        assert!(same_spot(&u("https://box.lan/"), &u("https://box.lan:443/i.png")));
        assert!(!same_spot(&u("http://127.0.0.1:3000/"), &u("http://127.0.0.1:8745/")));
        assert!(!same_spot(&u("http://box.lan/"), &u("https://box.lan/")));
        let page = u("http://127.0.0.1:3000/app");
        assert_eq!(icon_address(r#""http://127.0.0.1:3000/favicon.ico""#, None, &page), Some(u("http://127.0.0.1:3000/favicon.ico")));
        assert_eq!(icon_address(r#""http://127.0.0.1:8745/x""#, None, &page), None);
        assert!(!icon_near(&u("http://127.0.0.1:8745/x"), &page));
        let first = u("http://127.0.0.1:3000/favicon.ico");
        assert!(hop_ok(&u("http://127.0.0.1:3000/real.ico"), std::slice::from_ref(&first), None));
        assert!(!hop_ok(&u("http://127.0.0.1:8745/x"), std::slice::from_ref(&first), None));
    }

    #[test]
    fn fix4_2_a_same_host_redirect_to_another_port_is_never_followed() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "the redirect reached another port of this machine");
    }

    // Council FIX-4, AFTER 3: the far request after a hand-off gets only what is left.
    #[test]
    fn fix4_3_the_far_request_gets_only_what_is_left() {
        let s = Duration::from_secs;
        assert_eq!(time_left(s(0), s(8)), Some(s(8)));
        assert_eq!(time_left(s(3), s(8)), Some(s(5)));
        assert_eq!(time_left(Duration::from_millis(7999), s(8)), Some(Duration::from_millis(1)));
        assert_eq!(time_left(s(8), s(8)), None);
        assert_eq!(time_left(s(9), s(8)), None);
    }

    // T-195 (after-list 89): a test exe that links the web view path must still load (it needs the app manifest).
    #[test]
    fn t195_the_test_exe_links_the_web_view_path_and_loads() {
        let reach: fn(&AppHandle, u32) -> Result<Webview, String> = view;
        std::hint::black_box(reach);
        let driver: fn(Act) -> Result<serde_json::Value, String> = drive;
        std::hint::black_box(driver);
    }
}

#[cfg(test)]
mod t074_tests {
    use super::*;

    #[test]
    fn brow008_the_probe_tells_the_engines_error_page_from_a_page_and_from_silence() {
        assert_eq!(probe_result("\"chrome-error://chromewebdata/\""), "error-page");
        assert_eq!(probe_result("\"https://example.com/a\""), "page");
        // A certificate failure lands on about:blank; a real New Tab is never probed.
        assert_eq!(probe_result("\"about:blank\""), "error-page");
        // A dead page's callback (if it comes at all) carries no string.
        assert_eq!(probe_result("null"), "no-answer");
        assert_eq!(probe_result(""), "no-answer");
        assert_eq!(probe_result("{}"), "no-answer");
    }

    #[test]
    fn row_954d_a_probe_the_engine_refused_to_send_is_no_answer_so_the_container_is_checked() {
        assert_eq!(probe_verdict(false, None), "no-answer");
        assert_eq!(probe_verdict(false, Some("\"https://example.com/\"")), "no-answer");
        assert_eq!(probe_verdict(true, None), "no-answer");
        assert_eq!(probe_verdict(true, Some("\"https://example.com/\"")), "page");
    }

    #[test]
    fn brow008_the_failure_kind_names_what_failed() {
        use std::io::ErrorKind as K;
        assert_eq!(failure_kind(false, None, None), "unknown-host");
        assert_eq!(failure_kind(false, Some(K::ConnectionRefused), None), "unknown-host");
        assert_eq!(failure_kind(true, Some(K::ConnectionRefused), None), "refused");
        assert_eq!(failure_kind(true, Some(K::TimedOut), None), "timeout");
        assert_eq!(failure_kind(true, Some(K::Other), None), "unreachable");
        assert_eq!(failure_kind(true, None, Some("error sending request / certificate verify failed: self signed")), "certificate");
        assert_eq!(failure_kind(true, None, Some("The certificate chain was issued by an authority that is not trusted.")), "certificate");
        assert_eq!(failure_kind(true, None, Some("connection reset by peer")), "unknown");
        assert_eq!(failure_kind(true, None, None), "unknown");
    }

    #[test]
    fn brow008_the_https_switch_changes_the_scheme_only_and_never_for_local_or_https() {
        assert_eq!(https_twin(&parse("http://example.com/a?b=1#c").unwrap()), Some("https://example.com/a?b=1#c".into()));
        assert_eq!(https_twin(&parse("http://example.com:8080/").unwrap()), Some("https://example.com:8080/".into()));
        assert_eq!(https_twin(&parse("https://example.com/").unwrap()), None);
        assert_eq!(https_twin(&parse("http://localhost:3000/").unwrap()), None);
        assert_eq!(https_twin(&parse("http://127.0.0.1:9/").unwrap()), None);
        assert_eq!(https_twin(&parse("http://[::1]:9/").unwrap()), None);
    }

    #[test]
    fn brow008_a_closed_local_port_is_refused_and_local_and_an_open_one_is_reached() {
        // Real sockets on this machine: a port nothing listens on, then one that does.
        // APP-070: the check is a HEAD through the approved near client, not a socket of its own.
        let clients = icon_clients(None, system_lookup).unwrap();
        // A released ephemeral port can be taken by another process before the HEAD: try a fresh one.
        let mut tries = Vec::new();
        let url = loop {
            let gone = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = gone.local_addr().unwrap().port();
            drop(gone);
            let url = parse(&format!("http://127.0.0.1:{port}/")).unwrap();
            assert!(!lookup(&url).is_empty());
            let f = tauri::async_runtime::block_on(head_with(&clients, &url, true, DIAGNOSE_WAIT)).unwrap_err();
            let (tcp, tls) = failed_parts(false, &f);
            if failure_kind(true, tcp, tls.as_deref()) == "refused" {
                break url;
            }
            tries.push(f);
            assert!(tries.len() < 5, "no closed port was refused: {tries:?}");
        };
        assert!(local_host(&url));
        assert_eq!(https_twin(&url), None);
        // A server that answers: the HEAD gets its status and length, and the kind stays unknown.
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = parse(&format!("http://127.0.0.1:{}/", open.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut s, _) = open.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1234\r\nConnection: close\r\n\r\n").unwrap();
        });
        assert_eq!(tauri::async_runtime::block_on(head_with(&clients, &url, true, DIAGNOSE_WAIT)), Ok(Answer { status: 200, length: Some(1234) }));
        server.join().unwrap();
        assert_eq!(failure_kind(true, None, None), "unknown");
        // A name that cannot exist (RFC 6761 .invalid) never resolves.
        assert!(lookup(&parse("http://no-such-host.invalid/").unwrap()).is_empty());
    }

    #[test]
    fn app070_a_failed_probe_is_split_into_the_connection_and_the_handshake() {
        let f = |text: &str, timeout, io| Failed { text: text.into(), timeout, io };
        use std::io::ErrorKind as K;
        // A certificate the OS does not trust is the handshake's, even when a socket error carries it.
        assert!(failed_parts(true, &f("error sending request / The certificate chain was issued by an authority that is not trusted", false, Some(K::Other))).1.is_some());
        assert_eq!(failure_kind(true, None, Some("x509: certificate signed by unknown authority")), "certificate");
        assert_eq!(failed_parts(true, &f("operation timed out", true, None)), (Some(K::TimedOut), None));
        assert_eq!(failed_parts(false, &f("connect error", false, Some(K::ConnectionRefused))), (Some(K::ConnectionRefused), None));
        assert_eq!(failed_parts(true, &f("handshake failure", false, None)), (None, Some("handshake failure".into())));
        assert_eq!(failed_parts(false, &f("bad response", false, None)), (None, None));
        let (tcp, tls) = failed_parts(true, &f("operation timed out", true, None));
        assert_eq!(failure_kind(true, tcp, tls.as_deref()), "timeout");
    }

    #[test]
    fn app070_a_public_only_probe_never_reaches_this_machine() {
        // The far client's own lookup drops local addresses, so a HEAD to a loopback address through
        // it never connects (a name rebound to this machine is caught the same way).
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = open.local_addr().unwrap().port();
        let clients = icon_clients(None, |_| Ok(vec![IpAddr::from([127, 0, 0, 1])])).unwrap();
        let url = parse(&format!("http://rebound.example.com:{port}/")).unwrap();
        assert!(tauri::async_runtime::block_on(head_with(&clients, &url, false, DIAGNOSE_WAIT)).is_err());
    }

    #[test]
    fn t074_the_diagnosis_serialises_for_the_pane() {
        let d = Diagnosis { kind: "refused", local: true, https: None };
        assert_eq!(serde_json::to_string(&d).unwrap(), r#"{"kind":"refused","local":true,"https":null}"#);
    }

    #[test]
    fn brow049_050_the_page_script_records_logs_holds_requests_and_answers_dialogs() {
        // BROW-049: console and network recorders live in the always-injected script so page-load
        // traffic is seen; BROW-050: offline, headers, credentials, geolocation, media, dialogs.
        for needle in ["\"__kxEmu\"", "window.__kxLog", "window.__kxDialog", "Kolux emulates offline", "navigator.geolocation", "matchMedia", "prefers-color-scheme", "Authorization", "L.held", "getEntriesByType", "unhandledrejection", "window.alert", "window.confirm", "window.prompt", "maxTouchPoints"] {
            assert!(CHORD_SCRIPT.contains(needle), "{needle}");
        }
        assert_eq!(emu_script(r#"{"offline":true}"#), r#"window.__kxEmu && window.__kxEmu({"offline":true})"#);
        assert_eq!(emu_script("not json); alert(1"), "window.__kxEmu && window.__kxEmu(null)");
        assert_eq!(
            emu_script_for("https://a.test", r#"{"auth":"Basic x","authOrigin":"https://a.test"}"#, r#"{"auth":null}"#),
            r#"window.__kxEmu && window.__kxEmu(location.origin === "https://a.test" ? {"auth":"Basic x","authOrigin":"https://a.test"} : {"auth":null})"#
        );
    }

    #[test]
    fn brow033_the_proxy_setting_is_empty_for_the_system_proxy_an_http_or_socks5_address_or_refused_unquoted() {
        assert_eq!(proxy_of(None), Ok(None));
        assert_eq!(proxy_of(Some("  ")), Ok(None));
        assert_eq!(proxy_of(Some("http://127.0.0.1:8080")).unwrap().map(|u| u.to_string()), Some("http://127.0.0.1:8080/".into()));
        assert_eq!(proxy_of(Some("socks5://user:pw-secret@proxy.test:1080")).unwrap().map(|u| u.port()), Some(Some(1080)));
        for bad in ["ftp://user:pw-secret@proxy.test", "proxy.test:8080", "http://", "not a url"] {
            let e = proxy_of(Some(bad)).unwrap_err();
            assert!(e.contains("http:// or socks5://") && !e.contains("secret") && !e.contains("proxy.test"), "{bad}: {e}");
        }
    }

    // T-657 (DT-C93)
    #[test]
    fn t657_a_burst_of_menu_picks_that_open_tabs_is_capped_by_the_family_allowance() {
        let now = Instant::now();
        let tabs = Mutex::new(Allowance::default());
        let pick = |what: &str, u: &str| menu_of(&format!("kolux-chord:pick?what={what}&u={u}")).unwrap();
        let kolux = pick("open-kolux", "https%3A%2F%2Fexample.com%2F");
        let default = pick("open-default", "https%3A%2F%2Fexample.com%2F");
        for i in 0..TABS_ALLOWED {
            let v = if i % 2 == 0 { &kolux } else { &default };
            assert!(pick_allowed(v, None, &tabs, now), "pick {i}");
        }
        assert!(!pick_allowed(&kolux, None, &tabs, now));
        assert!(!pick_allowed(&default, None, &tabs, now));
        // Picks that open nothing, and the right-click itself, never take from it.
        assert!(pick_allowed(&pick("copy-link", "https%3A%2F%2Fexample.com%2F"), None, &tabs, now));
        assert!(pick_allowed(&menu_of("kolux-chord:menu?x=1&y=2").unwrap(), None, &tabs, now));
        // An address no tab may open, or none at all, is refused and takes nothing.
        let fresh = Mutex::new(Allowance::default());
        assert!(!pick_allowed(&pick("open-kolux", "javascript%3Aalert(1)"), None, &fresh, now));
        assert!(!pick_allowed(&menu_of("kolux-chord:pick?what=open-default").unwrap(), None, &fresh, now));
        assert!(pick_allowed(&kolux, None, &fresh, now));
    }

    // T-661 (DT-C97): no browser module opens the system browser itself; a sized window from a page
    // that has not finished loading is handed to the pane, which asks the user first.
    #[test]
    fn t661_the_system_browser_is_never_opened_on_a_pages_word_and_a_click() {
        let src = include_str!("browser.rs");
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut seen = 0;
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !(name.starts_with("browser") && name.ends_with(".rs")) {
                continue;
            }
            let m = std::fs::read_to_string(e.path()).unwrap();
            for call in [["open", "_external("].concat(), ["system", "_open("].concat()] {
                assert!(!m.contains(&call), "{name} calls {call}");
            }
            seen += 1;
        }
        assert!(seen > 20, "only {seen} browser modules found");
        let newwin = &src[src.find(".on_new_window(move |url, features|").unwrap()..src.find(".on_navigation(move |url|").unwrap()];
        let system = &newwin[newwin.find("popup::Route::System =>").unwrap()..];
        let system = &system[..system.find("popup::Route::Tab").unwrap()];
        assert!(system.contains("emit(LEAVE_EVENT") && system.contains("NewWindowResponse::Deny"), "{system}");
        assert_eq!(LEAVE_EVENT, "browser-leave");
    }

    // T-661: certificate Trust (and every other app command) is out of a page's reach. Tauri refuses an
    // app command from a remote page unless a capability names it under `remote`, so none may.
    #[test]
    fn t661_no_capability_reaches_a_page_so_only_koluxs_own_ui_can_trust_a_certificate() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut seen = 0;
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let text = std::fs::read_to_string(e.path()).unwrap();
            let cap: serde_json::Value = serde_json::from_str(&text).unwrap();
            let name = e.file_name().to_string_lossy().into_owned();
            assert!(cap.get("remote").is_none(), "{name} grants remote pages");
            let labels = |k: &str| cap.get(k).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|s| s.as_str()).collect::<Vec<_>>()).unwrap_or_default();
            for l in labels("windows").into_iter().chain(labels("webviews")) {
                assert!(["main", "tower"].contains(&l), "{name} names {l}");
            }
            seen += 1;
        }
        assert!(seen >= 2, "main and tower capabilities read: {seen}");
    }

    #[test]
    fn t657_a_query_field_cannot_turn_a_pick_into_something_the_allowance_skips() {
        let now = Instant::now();
        let tabs = Mutex::new(Allowance::default());
        let sly = menu_of("kolux-chord:pick?kind=menu&what=open-kolux&u=https%3A%2F%2Fexample.com%2F").unwrap();
        assert_eq!(sly["kind"], "pick");
        let taken = (0..50).filter(|_| pick_allowed(&sly, None, &tabs, now)).count();
        assert_eq!(taken, TABS_ALLOWED);
    }

    #[test]
    fn t657_link_requests_a_page_sent_on_its_own_use_up_nothing() {
        let now = Instant::now();
        let tabs = Mutex::new(Allowance::default());
        let link = Url::parse("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F").unwrap();
        // Deciding the navigation takes nothing; only the user-started action does (link_opens).
        for _ in 0..100 {
            assert_eq!(navigation(&link, None, true), Nav::Link("https://example.com/".into(), true));
        }
        for i in 0..TABS_ALLOWED {
            assert!(link_opens("https://example.com/", None, &tabs, now), "user link {i}");
        }
        assert!(!link_opens("https://example.com/", None, &tabs, now));
        // Only links and the menu wait for the engine's word.
        assert!(needs_word(link.as_str()) && needs_word("kolux-chord:menu?x=1&y=2") && needs_word("kolux-chord:pick?what=copy-link&u=x"));
        assert!(!needs_word("kolux-chord:back") && !needs_word("kolux-chord:key?k=a") && !needs_word("https://example.com/"));
    }

    #[test]
    fn t657_windows_links_and_menus_wait_for_the_engines_word_and_app_scripts_run_quietly() {
        let src = include_str!("browser.rs");
        let newwin = &src[src.find(".on_new_window(move |url, features|").unwrap()..src.find(".on_navigation(move |url|").unwrap()];
        assert!(newwin.find("popup::window_started(id, &url)").unwrap() < newwin.find("new_window(&url").unwrap());
        let nav = &src[src.find(".on_navigation(move |url|").unwrap()..src.find(".on_page_load(").unwrap()];
        assert_eq!(nav.matches("popup::when_started(id, url.as_str()").count(), 2);
        assert!(nav.contains("pick_allowed(&v") && nav.contains("link_opens(&link"));
        let load = &src[src.find(".on_page_load(").unwrap()..src.find(".on_document_title_changed(").unwrap()];
        assert!(!load.contains(".eval("), "load scripts go through engine::quiet_eval");
        assert!(!load.contains("eval_with_callback"));
        let go = &src[src.find("\"back\" | \"forward\" => step_history").unwrap()..];
        let go = &go[..go.find("\n}").unwrap()];
        assert!(go.contains("engine::quiet_eval(&v, script, None)") && !go.contains("v.eval("));
        // The pane's probe and Back/Forward run often or on their own; a toolkit eval there lends the page a gesture.
        for name in ["fn browser_probe(", "fn step_history(", "fn drive("] {
            let body = &src[src.find(name).unwrap()..];
            let body = &body[..body.find("\n}").unwrap()];
            assert!(!body.contains(".eval(") && !body.contains("eval_with_callback("), "{name} runs quietly");
        }
        let engine = include_str!("browser_engine.rs");
        assert!(engine.contains("popup::window_word(id, &uri, user)") && engine.contains("popup::request_word(id, &uri, user)"));
        assert!(engine.contains("crate::browser::needs_word(&uri)") && engine.contains("IsRedirected"));
        assert!(engine.contains("\"Runtime.evaluate\""));
    }
}
