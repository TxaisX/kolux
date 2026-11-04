// A browser tab (BROW-001, BROW-002, BROW-003, BROW-005, BROW-007, BROW-012, BROW-014, BROW-023). The page itself is a child web view the back end lays
// over this pane's body; this component only reports where the body is and whether it is on
// screen, so the page lives on untouched while its tab, workspace or screen is away. The header
// holds the address bar, which takes the cursor with its text selected as the tab opens, and
// the back / forward / reload toolbar; what the bar makes of typed text is in address.ts.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowRight, Close, FolderPlus, Globe, Refresh, Stop, Target } from "../chrome/icons";
import { menuStep } from "../terminal/LinkActionMenu";
import { useArm } from "./arm";
import { closeWarning, withChord } from "./tips";
import { BLANK, resolveAddress } from "./address";
import { chordPlan, openerRefocus, windowHasFocus } from "./chord";
import { type KeyEvent, keyEventInit, pageKeys, startsGrab } from "./keys";
import { type MenuEvent, menuAt, menuColours, menuContext, menuSpec } from "./menu";
import { dropPage, livePage } from "./pages";
import { useKeymap } from "../keys/KeymapContext";
import { backgroundBehind } from "./colour";
import "./browser.css";
import "./dragThroughInstall"; // BROW-052 / T-319-c: app drags cross the pages
import { can as canGo, fresh, started, type Pending } from "./history";
import { arrived, closed as menuClosed, fresh as freshMenu, type Hit, lines as suggestionLines, type Menu, move as menuMove, pick as menuPick, shown as menuShown, typed as menuTyped } from "./suggest";
import { busy as downloading, dismiss, type Download, fraction, reduce as reduceDownloads, type Row as DownloadRow, status as downloadStatus } from "./downloads";
import { type CertState, type Diagnosis, type Event as LoadEvent, fresh as freshHealth, type Health, type Overlay, overlayModel, overlayOf, PROBE_MS, type Probe, step, trustLabel } from "./loadState";
import { namesPane, openFirstPage, type ProfileEvent, reopenPage, takesBarFocus, type Why } from "./reopen";
import { SELF_CLOSE_EVENT, type SelfClosed, selfCloseNotice } from "./selfClose";
import { nextZoom, zoomPercent } from "./zoom";
import { iconAt, iconFound, type SiteIcon } from "./site";
import { zoomFactor } from "../settings/zoom";
import { notePage } from "../onboarding/guide";
import { CHROME_STEPS, type CookieReport, cookieReportText, type CookieSource, dismissHint, GOOGLE_NOTE, hintDismissed, importHintText, IMPORT_SOURCES, pickerFor } from "./cookies";
import { chipCommit } from "./preview";
import { type Leave, LEAVE_ARM_MS, leaveAsk, leaveReady, leaveText, sameOrigin } from "./leave";
import { documentPathOf, dropVerdict, openSource, openWithSystemApp, overPane, previewAddress } from "./previewActions";
import { addNote, MAX_NOTES, type Note, notesMarkdown, type Pick, readPicks, sameAddress } from "./annotate";
import type { SendTarget } from "../editor/notes";
import { DrawCanvas } from "./DrawCanvas";
import { type Grab, grabElement } from "./grabFlow";
import { GrabSheet } from "./GrabSheet";
import { capturePage, type Picture } from "./picture";
import { BLOCKED_SHOW_MS, type Blocked, blockedAgain, blockedLabel, NOTICE_MS } from "./popups";

/** `url`: the page or file the tab opens on instead of a blank page (SKILL-012 previews a kit result). */
/** `cwd`: the worktree this tab belongs to (BROW-042: agents there drive it); `targets` / `onSend`: the agent panes
 * a page note can go to and how it is pasted (BROW-037; App.tsx passes the review-notes send path). */
type Props = { id: number; url?: string; title?: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; cwd?: string | null; targets?: () => SendTarget[]; onSend?: (key: number, text: string) => Promise<void> | void; /** Came back from the saved layout: its first page opens in its own saved profile (row 977). */ restored?: boolean };

/** The pane body's place in the window, in CSS pixels, as the back end places the page. */
/** GIT-036: asks the window for a new browser tab at `url` in the focused split. The event and its
 *  one-line helpers live in ./openIn (cycle 3, first load: the checks list and the shortcut router ask
 *  for a page without loading this pane); they are re-exported here so every caller keeps its import. */
import { openInBrowser } from "./openIn";
export { OPEN_IN_BROWSER, openDetail, openInBrowser, type OpenInBrowser } from "./openIn";

/** T-241 (BROW-039): what a tab's address previews, when it is a worktree document of ours. */
type Preview = { folder: string; file: string; path: string; granted: boolean };
/** T-240 (BROW-034): the Viewport Size menu; the names are the compat list's, the sizes live in browser_cli.rs DEVICES. */
export const VIEWPORTS = ["Default", "Mobile S", "Mobile M", "Mobile L", "Tablet", "Laptop", "Laptop L", "Desktop"] as const;


/** T-241 (BROW-044): `kolux tab create` asks the window for a tab; one listener for the whole
 * window, started by the first pane, so a tab opens once however many panes there are. */
let bridge = false;
function startBridge() {
  if (bridge) return;
  bridge = true;
  listen<{ action: string; url?: string }>("browser-cli", (e) => {
    if (e.payload.action === "create") openInBrowser(e.payload.url ?? BLANK);
  }).catch(() => {
    bridge = false;
  });
}

type OverlayProps = { overlay: NonNullable<Overlay>; diag: Diagnosis | null; handler: boolean | null; trust: string | null; busy: boolean; connecting: boolean; onRetry: () => void; onTrust: () => void; onHttps: (url: string) => void; onOpen: (url: string) => void };

/** T-074 (BROW-008, BROW-009): what the user sees over a page that failed or crashed. */
function LoadOverlay({ overlay, diag, handler, trust, busy, connecting, onRetry, onTrust, onHttps, onOpen }: OverlayProps) {
  const m = overlayModel(overlay, diag, handler);
  return (
    <div className="load-overlay" role="alert" data-kind={overlay.kind}>
      <h2>{m.title}</h2>
      <p>{m.text}</p>
      {m.advice && <p className="advice">{m.advice}</p>}
      <div className="btn-row">
        <button className="btn" data-go="retry" disabled={busy} onClick={onRetry}>
          Retry
        </button>
        {trust && (
          <button className="btn" data-go="trust" disabled={busy} onClick={onTrust}>
            {trust}
          </button>
        )}
        {m.switchHttps && (
          <button className="btn" data-go="https" disabled={busy} onClick={() => onHttps(m.switchHttps!)}>
            Switch to HTTPS
          </button>
        )}
        {m.openExternally && (
          <button className="btn" data-go="external" disabled={busy} onClick={() => onOpen(overlay.url)}>
            Open Externally
          </button>
        )}
      </div>
      {connecting && (
        <p className="connecting" role="status">
          Connecting…
        </p>
      )}
    </div>
  );
}

function spot(el: HTMLElement) {
  // SET-019: the window places the page in unzoomed pixels, so a zoomed rect is scaled back.
  const r = el.getBoundingClientRect();
  const z = zoomFactor();
  return { x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z };
}

export default function BrowserPane({ id, url, title, hidden = false, focused = false, onFocus, onClose, cwd = null, targets, onSend, restored = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const [address, setAddress] = useState("");
  // T-238-b (BROW-004): the drop-down under the bar; `typing` while the bar holds the user's own
  // text, so a page replacing the one underneath does not overwrite it. (BROW-013): the strip of
  // this tab's downloads.
  const [menu, setMenu] = useState<Menu>(freshMenu());
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const typing = useRef(false);
  const suggestTimer = useRef<number | undefined>(undefined);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [note, setNoteText] = useState<string | null>(null);
  // UX audit: a notice goes by itself after a while (it also has a close button); every setNote starts the clock,
  // even when the words are the same as the notice already showing.
  const [noteSeq, setNoteSeq] = useState(0);
  const setNote = useCallback((m: string | null) => {
    setNoteText(m);
    setNoteSeq((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [note, noteSeq, setNote]);
  // UX audit: Clear on the notes tray and Close on a tab that still has work in it ask for a second press.
  const [clearArmed, pressClear] = useArm();
  const [closeArmed, pressClose] = useArm();
  const cookieBtn = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [can, setCan] = useState({ back: false, forward: false });
  const canRef = useRef(can);
  canRef.current = can;
  const keymap = useKeymap();
  // ponytail: wry has no can-go-back, so history is tracked from this tab's own actions and the
  // page loads it sees (history.ts). The chords pressed inside the page come back through the
  // app (T-012-b-fix), so the web view never goes back on its own; a page's pushState still
  // drifts it. Upgrade when wry exposes navigation history.
  const hist = useRef(fresh());
  const pending = useRef<Pending>(null);
  // BROW-012: this tab's own zoom; the badge shows the level for a moment after each change.
  const zoom = useRef(1);
  const [badge, setBadge] = useState<string | null>(null);
  const badgeTimer = useRef<number | undefined>(undefined);
  // BROW-007: the find bar; `null` while closed.
  const [find, setFind] = useState<string | null>(null);
  // BROW-023: the site icon in the toolbar; the globe until the site gives one.
  const [icon, setIcon] = useState<SiteIcon>(null);
  const at = useRef("");
  const findBox = useRef<HTMLInputElement>(null);
  // BROW-037: notes on the page's elements. `picking` while the page picker runs; `draft` is a pick
  // waiting for its note; the tray empties when the page's address changes (annotate.ts).
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Pick | null>(null);
  const [sendMenu, setSendMenu] = useState<SendTarget[] | null>(null);
  const draftBox = useRef<HTMLTextAreaElement>(null);
  // T-241 (BROW-038): the page's picture while the drawing canvas covers the page.
  const [drawing, setDrawing] = useState<Picture | null>(null);
  // T-240 (BROW-035): grab mode: the picker runs and its next pick opens the details sheet (`grab`) instead of a note.
  const [grabMode, setGrabMode] = useState(false);
  const [grab, setGrab] = useState<Grab | null>(null);
  const grabbing = useRef(false);
  const focusMe = useRef(onFocus);
  focusMe.current = onFocus;
  const closeMe = useRef(onClose);
  closeMe.current = onClose;
  const [preview, setPreview] = useState<Preview | null>(null);
  // T-319-b (BROW-041): what is typed in the preview chip while it is open for typing.
  const [chipEdit, setChipEdit] = useState<string | null>(null);
  // UX audit: leaving the chip editor by Escape (or with focus nowhere) puts focus back on the chip's button, not on the page body.
  const chipSlot = useRef<HTMLSpanElement>(null);
  const chipBack = useRef(false);
  useEffect(() => {
    if (chipEdit !== null || !chipBack.current) return;
    chipBack.current = false;
    chipSlot.current?.querySelector<HTMLElement>(".preview-open")?.focus();
  }, [chipEdit]);
  // T-159 (BROW-040): the outside address a previewed document asked to open; offered, never followed.
  const [outbound, setOutbound] = useState<string | null>(null);
  // T-661 (DT-C97): a page's request to leave Kolux (system browser) or drop a certificate's trust,
  // asked in Kolux's own bar; the confirm counts only LEAVE_ARM_MS after each new ask (leaveReady, the
  // ask's own clock), and `armedLook` only greys the button until then (reset before paint). A tab that
  // goes behind drops its ask, so it never waits armed out of sight.
  const [leave, setLeave] = useState<Leave | null>(null);
  const [armedLook, setArmedLook] = useState(false);
  useLayoutEffect(() => {
    setArmedLook(false);
    if (!leave) return;
    const t = window.setTimeout(() => setArmedLook(true), LEAVE_ARM_MS);
    return () => window.clearTimeout(t);
  }, [leave]);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;
  useEffect(() => {
    if (hidden) setLeave(null);
  }, [hidden]);
  // T-272-c (BROW-016): tabs this tab's family asked for past its allowance, said in the toolbar.
  const [blocked, setBlocked] = useState<Blocked>(null);
  // T-272-b (BROW-032): the last permission a page here was refused, named in plain words.
  const [refused, setRefused] = useState<string | null>(null);
  const refusedTimer = useRef<number | undefined>(undefined);
  const blockedTimer = useRef<number | undefined>(undefined);
  // T-074 (BROW-008, BROW-009): the page's health. The engine says only started / finished, so the
  // pane probes the page (browser_probe) and feeds loadState's machine; the overlay it decides on
  // covers the pane body while the page itself is hidden under it (a child web view cannot be
  // covered by the app's own elements). `diag` is the back end's look at why the address failed.
  const health = useRef<Health>(freshHealth());
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  // After-list 21: whether the system has a program for the address (null until known).
  const [handler, setHandler] = useState<boolean | null>(null);
  // T-158 (BROW-024): whether the engine's certificate challenge for this local site waits here.
  const [cert, setCert] = useState<CertState | null>(null);
  // While an overlay action runs all its buttons are disabled together; the connecting indicator
  // waits a moment so a quick retry does not flicker.
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // BROW-009 / T-241: close the page and open it again at the pane's spot and colour, for a page
  // that cannot reload and for a tab whose profile changed (`profile` names the new one).
  // Row 954 (c): the id this pane is mounted for (null once unmounted) and its latest bounds sender,
  // so a rebuild that outlives the pane closes what it built, and the rebuilt page is put where the
  // pane is NOW (shown or hidden, size) instead of where it was when the rebuild began.
  const mountedFor = useRef<number | null>(null);
  const restoreSpent = useRef(false); // row 977: only the first open of a restored pane is a restore
  const focusedNow = useRef(focused); // row 979: the mount's async open reads the focus as it is when the open finishes
  focusedNow.current = focused;
  const sendBounds = useRef<(() => void) | null>(null);
  const reopen = (to: string, profile?: string, why: Why = "auto") => {
    const body = host.current;
    if (!body) return setBusy(false);
    const live = { alive: () => mountedFor.current === id, sync: () => sendBounds.current?.() };
    reopenPage(invoke, id, { url: to || BLANK, spot: spot(body), background: backgroundBehind(body), shown: body.clientWidth > 0 && body.clientHeight > 0, profile }, why, live).catch((err) => {
      setBusy(false);
      setNote(String(err));
      feed({ t: "openfailed" }); // H6: no overlay and no Retry otherwise
    });
  };
  const feed = (e: LoadEvent) => {
    const [h, action] = step(health.current, e);
    health.current = h;
    setOverlay(overlayOf(h));
    if (e.t === "started") {
      setBusy(false);
      setDiag(null);
      setHandler(null);
      setCert(null);
    }
    if (action === "reload") invoke("browser_go", { id, what: "reload" }).catch(() => {});
    if (action === "rebuild") reopen(h.url, undefined, e.t === "retry" ? "retry" : "auto");
    if (action === "overlay") {
      setBusy(false);
      // H3: a tab left closed has no use for its destroyed page, its handlers or its popups; Retry opens a new one.
      if (h.phase === "closed" && !h.openFailed) invoke("browser_close", { id }).catch(() => {});
      const at = h.url;
      invoke<boolean | null>("browser_external_handler", { url: at })
        .then((v) => health.current.url === at && setHandler(v))
        .catch(() => {});
      if (h.phase === "failed") {
        const { url } = h;
        invoke<Diagnosis>("browser_diagnose", { url })
          .then((d) => health.current.url === url && setDiag(d))
          .catch(() => {});
        invoke<CertState>("browser_cert", { id, url, action: "state" })
          .then((c) => health.current.url === url && setCert(c))
          .catch(() => {});
      }
    }
  };
  const retry = () => {
    setBusy(true);
    feed({ t: "retry" });
  };
  // The overlay's Trust: the back end approves only the challenge waiting in this tab, then the
  // page is tried again and the engine is told to allow that one certificate.
  const trustCert = () => {
    const { url } = health.current;
    setBusy(true);
    invoke<CertState>("browser_cert", { id, url, action: "trust" })
      .then(() => feed({ t: "retry" }))
      .catch((err) => {
        setBusy(false);
        setNote(String(err));
      });
  };
  useEffect(() => {
    if (!busy) return setConnecting(false);
    const t = window.setTimeout(() => setConnecting(true), 300);
    return () => window.clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    let alive = true;
    mountedFor.current = id;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      // T-283 (BROW-010): one wake signal for every pane; each rechecks its own page.
      unlisteners.push(await listen("browser-wake", () => feed({ t: "woke" })));
      unlisteners.push(
        await listen<{ id: number; event: string; url: string }>("browser-load", (e) => {
          if (e.payload.id !== id) return;
          feed(e.payload.event === "started" ? { t: "started", url: e.payload.url } : { t: "finished", url: e.payload.url });
          if (e.payload.event !== "started") {
            hist.current.busy = false;
            // BROW-012: the level holds through reloads and other sites; set it again in case the
            // engine reset it with the new document.
            if (zoom.current !== 1) invoke("browser_go", { id, what: "zoom", level: zoom.current }).catch(() => {});
            if (e.payload.event === "finished") notePage(e.payload.url); // ONB-015
            return setLoading(false);
          }
          const { url } = e.payload;
          const h = started(hist.current, pending.current, url);
          pending.current = null;
          hist.current = h;
          setCan(canGo(h));
          setLoading(true);
          setOutbound(null);
          setLeave(null);
          if (!typing.current) setAddress(url === BLANK ? "" : url); // BROW-004: typed text survives
          if (!sameAddress(at.current, url)) {
            setNotes([]);
            setDraft(null);
          }
          at.current = url;
          setIcon((i) => iconAt(i, url));
          invoke<Preview | null>("browser_preview_of", { url })
            .then((p) => alive && setPreview(p ?? null))
            .catch(() => setPreview(null));
        }),
      );
      // T-238-b (BROW-013): this tab's downloads, one event per change.
      unlisteners.push(
        await listen<Download>("browser-download", (e) => {
          if (e.payload.id !== id) return;
          setDownloads((rows) => reduceDownloads(rows, e.payload, Date.now()));
        }),
      );
      // BROW-014: a link the page opens as a new window, or Mod / middle click, becomes another tab
      // in this split; behind this one unless it asked for the front.
      unlisteners.push(
        await listen<{ id: number; url: string; front: boolean }>("browser-link", (e) => {
          if (e.payload.id !== id) return;
          openInBrowser(e.payload.url);
          // Council FIX-4: not while the user is in another program (the app's window is not focused).
          const { front } = e.payload;
          const appHasFocus = document.hasFocus();
          void windowHasFocus().then((w) => openerRefocus(front, appHasFocus, w) && setTimeout(() => focusMe.current?.(), 0));
        }),
      );
      // T-272-c: a page here asked for another tab after its family's allowance was used up.
      unlisteners.push(
        await listen<{ id: number }>("browser-blocked", (e) => {
          if (e.payload.id !== id) return;
          setBlocked((b) => blockedAgain(b, Date.now()));
          window.clearTimeout(blockedTimer.current);
          blockedTimer.current = window.setTimeout(() => setBlocked(null), BLOCKED_SHOW_MS);
        }),
      );
      // Row 954 (b): a page destroyed this tab's window; it is built again at its last address,
      // or stays closed when it keeps doing it. Either way the pane says so in one line.
      unlisteners.push(
        await listen<SelfClosed>(SELF_CLOSE_EVENT, (e) => {
          if (e.payload.id !== id) return;
          setNote(selfCloseNotice(e.payload));
          feed({ t: "selfclosed", reopen: e.payload.reopen });
        }),
      );
      // T-272-b (BROW-032): a page here was refused a permission; the toolbar names it.
      unlisteners.push(
        await listen<{ id: number; text: string }>("browser-permission", (e) => {
          if (e.payload.id !== id) return;
          setRefused(e.payload.text);
          window.clearTimeout(refusedTimer.current);
          refusedTimer.current = window.setTimeout(() => setRefused(null), BLOCKED_SHOW_MS);
        }),
      );
      // T-159 (BROW-040): a previewed document asked to leave its folder; the full address is
      // offered once and nothing opens until Open is clicked.
      unlisteners.push(
        await listen<{ id: number; url: string }>("browser-outbound", (e) => {
          if (e.payload.id === id) setOutbound(e.payload.url);
        }),
      );
      // T-661 (DT-C97): a sized window the page opened before its first load wants the system browser.
      unlisteners.push(
        await listen<{ id: number; url: string }>("browser-leave", (e) => {
          if (e.payload.id === id && !hiddenNow.current) setLeave(leaveAsk("system", e.payload.url));
        }),
      );
      unlisteners.push(
        await listen<{ id: number; page: string; icon: string }>("browser-icon", (e) => {
          if (e.payload.id === id) setIcon((i) => iconFound(i, at.current, e.payload.page, e.payload.icon));
        }),
      );
      // T-239 (BROW-017): a right-click inside the page, and the menu entry picked afterwards.
      unlisteners.push(
        await listen<MenuEvent>("browser-menu", (e) => {
          if (e.payload.id === id) void onMenu.current(e.payload);
        }),
      );
      // T-239 (BROW-018): an app shortcut pressed while the keyboard was inside the page.
      unlisteners.push(
        await listen<KeyEvent>("browser-key", (e) => {
          if (e.payload.id === id) void onKey.current(e.payload);
        }),
      );
      // T-241 (BROW-044): `kolux tab switch|close` name this pane.
      unlisteners.push(
        await listen<{ action: string; page?: number }>("browser-cli", (e) => {
          if (e.payload.page !== id) return;
          if (e.payload.action === "switch") focusMe.current?.();
          if (e.payload.action === "close") closeMe.current?.();
        }),
      );
      // T-241 (BROW-045): a profile change (or a deleted profile) names this pane; its page opens again in the new profile.
      unlisteners.push(
        await listen<ProfileEvent>("browser-profile", (e) => {
          if (namesPane(e.payload, id)) reopen(at.current, e.payload.profile);
        }),
      );
      startBridge();
      if (!alive) {
        unlisteners.forEach((u) => u()); // cleanup ran before these were registered (a dev double mount): they would feed every event twice
        return;
      }
      try {
        // T-241 (BROW-039): a tab the app opens on a document's path previews it (the loopback address is never shown).
        const doc = documentPathOf(url);
        const shownDoc = doc ? await previewAddress(doc, invoke) : null;
        if (shownDoc && "error" in shownDoc) setNote(shownDoc.error);
        const first = shownDoc && "url" in shownDoc ? { url: shownDoc.url } : url && !doc ? resolveAddress(url) : null;
        // A tab opened behind (its section hidden, so no size) starts off screen: its page may not
        // open tabs or send chords until it is shown (council FIX-2).
        const body = host.current!;
        const shown = body.clientWidth > 0 && body.clientHeight > 0;
        const restoring = await openFirstPage(invoke, id, { url: first && "url" in first ? first.url : BLANK, spot: spot(body), background: backgroundBehind(body), shown }, restored, restoreSpent);
        opened.current = true;
        if (alive) {
          setOpen(true);
          if (takesBarFocus(focusedNow.current, restoring)) bar.current?.focus(); // BROW-001: a tab the user just opened has the cursor in its address bar; a restored or unfocused pane never takes the keyboard
        }
        else invoke("browser_close", { id }).catch(() => {});
      } catch (err) {
        setNote(String(err));
      }
    })();
    return () => {
      alive = false;
      mountedFor.current = null;
      unlisteners.forEach((u) => u());
      if (opened.current) invoke("browser_close", { id }).catch(() => {});
    };
  }, [id]);

  // BROW-002: away means covered, never torn down. The page follows the body's spot whenever it
  // moves or changes size (a split, the sidebar, the window) and hides while the tab is away.
  useEffect(() => {
    if (!open) return;
    const el = host.current!;
    const send = (theme = false) => {
      // T-074: while the recovery overlay shows, the page is hidden so the overlay can cover it.
      const shown = !hidden && !overlay && !drawing && !grab && el.clientWidth > 0 && el.clientHeight > 0;
      const background = theme ? backgroundBehind(el) : undefined;
      invoke("browser_bounds", { id, spot: shown ? spot(el) : { x: 0, y: 0, w: 0, h: 0 }, shown, background }).catch(() => {});
    };
    send();
    sendBounds.current = () => send();
    const resized = () => send();
    const observer = new ResizeObserver(resized);
    observer.observe(el);
    window.addEventListener("resize", resized);
    // BROW-011: a theme change rewrites the root's style or mode; the page's loading surface takes
    // the new pane colour at once, so the next load in a light theme is light.
    let painted = JSON.stringify(backgroundBehind(el));
    const themed = new MutationObserver(() => {
      const now = JSON.stringify(backgroundBehind(el));
      if (now === painted) return;
      painted = now;
      send(true);
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-mode"] });
    return () => {
      sendBounds.current = null;
      observer.disconnect();
      themed.disconnect();
      window.removeEventListener("resize", resized);
    };
  }, [id, open, hidden, overlay, drawing, grab]);

  // T-074: the probe, about four times a second while the page is on screen (BROW-008), paused
  // while the tab is hidden or the overlay covers the page. One probe in flight at a time.
  useEffect(() => {
    if (!open || hidden || overlay) return;
    let inflight = false;
    const t = window.setInterval(async () => {
      if (inflight) return;
      inflight = true;
      try {
        feed({ t: "probe", answer: await invoke<Probe>("browser_probe", { id }) });
      } catch {
        feed({ t: "probe", answer: "no-answer" });
      } finally {
        inflight = false;
      }
    }, PROBE_MS);
    return () => window.clearInterval(t);
  }, [id, open, hidden, overlay]);

  // BROW-042: the command line's browser commands go to the worktree's tab on screen; this pane
  // says which worktree its tab belongs to and whether it is the one shown.
  useEffect(() => {
    if (!open) return;
    invoke("browser_tab", { id, worktree: cwd, shown: !hidden, url: at.current, title: title ?? "" }).catch(() => {});
  }, [id, open, hidden, cwd, loading, title]);

  // T-239 (BROW-018): the page is told which chords are the app's, from the live keymap (so a
  // customised binding counts), again after each load since a new document starts from the script's
  // own defaults.
  useEffect(() => {
    if (!open) return;
    invoke("browser_go", { id, what: "keys", text: JSON.stringify(pageKeys(keymap)) }).catch(() => {});
  }, [id, open, loading, keymap.bindings]);

  // T-239 (BROW-019, BROW-022): the window's registry of live pages, which the jump palette lists
  // and Reopen Closed Tab reads from; this pane's row leaves with it.
  useEffect(() => {
    livePage(id, { url: at.current, title: title ?? "", icon: icon?.src ?? null, cwd });
  }, [id, loading, title, icon, cwd]);
  useEffect(() => () => dropPage(id), [id]);

  // BROW-037: while picking, the page's picker is asked four times a second what was clicked; a
  // page that was replaced meanwhile gets the picker again. Escape in the page ends picking.
  useEffect(() => {
    if (!open || !picking) return;
    let inflight = false;
    const t = window.setInterval(async () => {
      if (inflight) return;
      inflight = true;
      try {
        const r = readPicks(await invoke("browser_annotate", { id, what: "poll" }));
        if (!r.active) await invoke("browser_annotate", { id, what: "start" });
        if (r.escape) setPicking(false);
        if (r.picks.length) {
          if (grabbing.current) grabPicked(r.picks[0]);
          else setDraft((d) => d ?? r.picks[0]);
        }
      } catch {
        setPicking(false);
      } finally {
        inflight = false;
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [id, open, picking]);
  useEffect(() => {
    if (draft) draftBox.current?.focus();
  }, [draft]);
  // T-240 (BROW-035): Grab ends with the picker (a pick, Esc in the page, or the Annotate button).
  useEffect(() => {
    if (!picking) {
      grabbing.current = false;
      setGrabMode(false);
    }
  }, [picking]);
  // The pick ends picking, then the element is cut out of the page's picture and the sheet covers the page.
  const grabPicked = (pick: Pick) => {
    grabbing.current = false;
    setPicking(false);
    grabElement(invoke, id, pick)
      .then(setGrab)
      .catch((err) => setNote(err instanceof Error ? err.message : String(err)));
  };
  const startGrab = () => {
    if (grabMode) return stopPicking();
    setNote(null);
    grabbing.current = true;
    setGrabMode(true);
    if (picking) return;
    invoke("browser_annotate", { id, what: "start" })
      .then(() => setPicking(true))
      .catch((err) => {
        grabbing.current = false;
        setGrabMode(false);
        setNote(String(err));
      });
  };
  const stopPicking = () => {
    setPicking(false);
    invoke("browser_annotate", { id, what: "stop" }).catch(() => {});
  };
  const togglePicking = () => {
    if (picking) return stopPicking();
    if (notes.length >= MAX_NOTES) return setNote(`The tray holds ${MAX_NOTES} notes; send or clear them first`);
    setNote(null);
    invoke("browser_annotate", { id, what: "start" })
      .then(() => setPicking(true))
      .catch((err) => setNote(String(err)));
  };
  // T-241 (BROW-038): Draw takes the page's picture (the page picker's outline would be in it, so picking
  // ends first) and the canvas covers the page; Close brings the page back.
  const startDraw = async () => {
    if (drawing) return;
    setNote(null);
    try {
      if (picking) {
        setPicking(false);
        await invoke("browser_annotate", { id, what: "stop" });
      }
      setDrawing(await capturePage(invoke, id));
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };
  // Enter keeps the note (Shift+Enter is a new line); Escape drops only this pick, picking stays on.
  const keepDraft = () => {
    if (!draft) return;
    const next = addNote(notes, draft, draftBox.current?.value ?? "");
    setDraft(null);
    if (!next) return;
    setNotes(next);
    if (next.length >= MAX_NOTES && picking) {
      stopPicking();
      setNote(`The tray is full (${MAX_NOTES} notes); send or clear them to pick more`);
    }
  };
  const openSend = () => {
    const list = targets?.() ?? [];
    if (!list.length) return setNote("No agent sessions in this workspace");
    setSendMenu(list);
  };
  const sendTo = (key: number) => {
    setSendMenu(null);
    const text = notesMarkdown(notes, title ?? "", at.current);
    if (!text) return;
    Promise.resolve(onSend?.(key, text))
      .then(() => setNotes([]))
      .catch((err) => setNote(String(err)));
  };

  // UX audit: a finished, failed or cancelled download stays in the strip until its Dismiss button is pressed
  // (it used to leave after 8 s, before anyone could see where the file went).
  // UX audit: Close on a tab with a running download or unsent notes warns first (a second press closes it).
  const closeTab = () => {
    const warning = closeWarning(downloading(downloads), notes.length);
    if (!warning) return closeMe.current?.();
    if (!closeArmed) setNote(warning);
    pressClose(() => closeMe.current?.());
  };

  // T-238-b (BROW-004): each keystroke asks the back end for ranked history hits; a late answer
  // for text the user has moved past is dropped by the model.
  const onTyped = (text: string) => {
    typing.current = true;
    setAddress(text);
    setMenu((m) => menuTyped(m, text));
    window.clearTimeout(suggestTimer.current);
    if (!text.trim()) return;
    suggestTimer.current = window.setTimeout(() => {
      invoke<Hit[]>("browser_suggest", { text })
        .then((hits) => setMenu((m) => arrived(m, text, hits)))
        .catch(() => {});
    }, 60);
  };
  const closeMenu = () => setMenu((m) => (m.open ? menuClosed(m) : m));

  // BROW-003: Enter reads the bar; an invalid address is said in the notice and the page stays.
  const navigateTo = (url: string) => {
    setNote(null);
    setBlocked(null); // T-272-c: the user's own navigation clears the note
    setRefused(null);
    typing.current = false;
    setMenu((m) => menuClosed(m));
    pending.current = null;
    feed({ t: "navigate", url }); // a new address gets its own recovery allowance (BROW-009)
    invoke("browser_navigate", { id, url }).catch((err) => setNote(String(err)));
  };
  // BROW-039: the chip's other actions; the front end says why when one cannot run.
  const sayIf = (p: Promise<string | null>) => void p.then((m) => m && setNote(m));
  // BROW-039: an HTML document dropped on this tab becomes its preview. The webview's drag events carry
  // physical pixels; the hit test needs the pointer inside this pane's box and on nothing laid over it.
  const dropped = useRef<(paths: string[]) => void>(() => {});
  dropped.current = (paths) => {
    const v = dropVerdict(paths);
    if (v.kind === "say") return setNote(v.text);
    void previewAddress(v.path, invoke).then((r) => ("url" in r ? navigateTo(r.url) : setNote(r.error)));
  };
  useEffect(() => {
    if (hidden) return;
    let live = true;
    let stop: UnlistenFn | undefined;
    getCurrentWebview()
      .onDragDropEvent(({ payload: p }) => {
        if (p.type !== "drop") return;
        const el = host.current?.closest(".pane");
        if (!el) return;
        const scale = window.devicePixelRatio || 1;
        const x = p.position.x / scale;
        const y = p.position.y / scale;
        const under = document.elementFromPoint(x, y);
        if (overPane(x, y, el.getBoundingClientRect()) && under !== null && el.contains(under)) dropped.current(p.paths);
      })
      .then((u) => (live ? (stop = u) : u()), () => {});
    return () => {
      live = false;
      stop?.();
    };
  }, [hidden]);
  // T-319-b (BROW-041): Enter in the chip: a web address turns this tab into that page (Back returns
  // to the preview, Forward goes to the page again); another document swaps the preview; the same
  // document does nothing. Escape or leaving the field puts the chip back unchanged.
  const commitChip = (current: string) => {
    const c = chipCommit(chipEdit ?? "", current);
    if (c.kind === "error") return setNote(c.error);
    setChipEdit(null);
    if (c.kind === "web") navigateTo(c.url);
    else if (c.kind === "document")
      invoke<{ url: string }>("browser_preview", { path: c.path })
        .then((r) => navigateTo(r.url))
        .catch((err) => setNote(String(err)));
  };
  const go = () => {
    const picked = menuPick(menuRef.current);
    if (picked) return navigateTo(picked.url);
    const r = resolveAddress(address);
    if ("error" in r) return setNote(r.error);
    navigateTo(r.url);
  };
  const switchHttps = (url: string) => {
    setBusy(true);
    navigateTo(url);
  };
  const openExternally = (url: string) => {
    setBusy(true);
    invoke("open_external", { url })
      .catch((err) => setNote(String(err)))
      .finally(() => setBusy(false));
  };
  const zoomBy = (how: "in" | "out" | "reset") => {
    zoom.current = nextZoom(zoom.current, how);
    invoke("browser_go", { id, what: "zoom", level: zoom.current }).catch((err) => setNote(String(err)));
    setBadge(zoomPercent(zoom.current));
    window.clearTimeout(badgeTimer.current);
    badgeTimer.current = window.setTimeout(() => setBadge(null), 1200);
  };
  const openFind = () => {
    setFind((f) => f ?? "");
    setTimeout(() => {
      findBox.current?.focus();
      findBox.current?.select();
    }, 0);
  };
  const findNext = (back: boolean) => {
    const text = findBox.current?.value ?? "";
    if (text) invoke("browser_go", { id, what: back ? "findBack" : "find", text }).catch((err) => setNote(String(err)));
  };
  // BROW-005: the toolbar; a reload is the same page, so it leaves the history alone.
  // T-240 (BROW-034): the chosen preset; it holds across loads because the backend re-applies it
  // on every load's start (cli::emu_state), so the pane only remembers the name.
  const [viewport, setViewport] = useState<string>(VIEWPORTS[0]);
  const pickViewport = (name: string) => {
    setViewport(name);
    invoke<string>("browser_viewport", { id, name: name === VIEWPORTS[0] ? null : name }).catch((err) => setNote(String(err)));
  };
  // T-240 (BROW-028): Import Cookies is a small menu: Google Chrome (guided: Chrome locks its own
  // cookie store to itself, so the user exports a cookies.txt file from inside Chrome and picks it)
  // or a file (cookies.txt or a JSON list). The entry is off while an import into this tab runs;
  // the report says what came in and what did not.
  const [cookieMenu, setCookieMenu] = useState<null | "menu" | "chrome">(null);
  const [importing, setImporting] = useState(false);
  // T-319-b (BROW-030): the import-logins hint, read from storage on the first render (never
  // flashes); it names the browsers found, or the supported sources until the app has looked.
  const [hintShown, setHintShown] = useState(() => !hintDismissed());
  const [found, setFound] = useState<string[] | null>(null);
  useEffect(() => {
    if (!hintShown) return;
    let alive = true;
    invoke<string[]>("browser_import_sources")
      .then((f) => alive && setFound(f))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hintShown]);
  const hideHint = () => {
    dismissHint();
    setHintShown(false);
  };
  const importCookies = async (source: CookieSource) => {
    const picked = await openDialog({ multiple: false, directory: false, ...pickerFor(source) }).catch(() => null);
    if (typeof picked !== "string") return;
    setCookieMenu(null);
    setImporting(true);
    try {
      const r = await invoke<CookieReport>("browser_cookies_import", { id, path: picked });
      setNote(cookieReportText(r)); // T-158 (BROW-029): Google advice only when Google rows were left out
      if (r.imported > 0) hideHint(); // BROW-030: logins came over, the hint has done its job
    } catch (err) {
      setNote(String(err));
    } finally {
      setImporting(false);
    }
  };

  const act = (what: "back" | "forward" | "reload" | "stop") => {
    // BROW-005 / BROW-008 / BROW-009: on a failed or crashed page every reload trigger is a Retry.
    if (what === "reload" && overlay) return retry();
    pending.current = what === "reload" ? "same" : what === "stop" ? null : what;
    invoke("browser_go", { id, what }).catch((err) => setNote(String(err)));
  };

  // T-239 (BROW-017): the right-click menu. The page says where the click was and what was under
  // it; menu.ts decides the entries and the corner (flipped near the pane's edges); the page draws
  // it and says which entry was picked. Both go through chordPlan, so a page script that fakes one
  // while the keyboard is in the app is ignored (council FIX-3/4).
  const onMenu = useRef(async (_p: MenuEvent) => {});
  onMenu.current = async (p) => {
    const plan = await chordPlan(id, p.kind);
    if (!plan.run) return;
    if (plan.focusPane) focusMe.current?.();
    if (p.kind === "menu") {
      const cs = await invoke<CertState>("browser_cert", { id, url: at.current, action: "state" }).catch(() => null);
      const spec = menuSpec(menuContext(p), canRef.current, at.current, menuAt(p), menuColours(host.current), !!cs?.trusted);
      void invoke("browser_go", { id, what: "menu", text: JSON.stringify(spec) }).catch(() => {});
      return;
    }
    const u = /^https?:/i.test(p.u ?? "") ? p.u! : "";
    if (p.what === "back" || p.what === "forward") act(p.what);
    else if (p.what === "open-kolux" && u) openInBrowser(u);
    // T-661 (DT-C97): the page draws this menu, so a pick is the page's word plus a click it may have
    // steered; leaving Kolux or dropping a certificate's trust is asked in Kolux's own bar first.
    else if (p.what === "open-default" && u) setLeave(leaveAsk("system", u));
    else if (p.what === "cert-revoke" && u && !(leave?.what === "revoke") && sameOrigin(u, at.current)) {
      // Asked only for the site on show, only when Kolux itself says it is trusted, one ask at a time, and
      // only if the tab is still on that page and in front once the state is back.
      const page = at.current;
      const cs = await invoke<CertState>("browser_cert", { id, url: u, action: "state" }).catch(() => null);
      if (cs?.trusted && at.current === page && !hiddenNow.current) setLeave(leaveAsk("revoke", u));
    }
  };
  const leaveConfirmed = (l: Leave) => {
    setLeave(null);
    if (l.what === "system") return void invoke("open_external", { url: l.url }).catch((err) => setNote(String(err)));
    invoke<CertState>("browser_cert", { id, url: l.url, action: "revoke" })
      .then((c) => {
        setNote(`${c.site ?? "This site"}: its certificate is no longer trusted`);
        act("reload");
      })
      .catch((err) => setNote(String(err)));
  };
  // T-239 (BROW-018): an app shortcut the page handed over is pressed again on the window, after
  // this split has taken focus (flushSync, so the app's key handler already sees it focused), and
  // the app's own key handling runs it, customised bindings included.
  const onKey = useRef(async (_p: KeyEvent) => {});
  onKey.current = async (p) => {
    const plan = await chordPlan(id, "key");
    if (!plan.run) return;
    if (plan.focusPane) flushSync(() => focusMe.current?.());
    // T-240 (BROW-035): Mod+C with nothing selected in the page (the page script checks) starts a grab here.
    if (startsGrab(keymap, p)) {
      if (open && !overlay && !drawing && !grab && !grabMode) startGrab();
      return;
    }
    window.dispatchEvent(new KeyboardEvent("keydown", keyEventInit(p)));
  };

  return (
    <section className={`pane browser${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${title ?? "New Tab"} pane`} onMouseDown={onFocus} data-kind="browser" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="Browser">
          {icon ? <img className="site-icon" src={icon.src} width={13} height={13} alt="" /> : <Globe size={13} />}
        </span>
        <span className="title">{title ?? "New Tab"}</span>
        <button className="ib" data-go="back" disabled={!can.back} onClick={() => act("back")} title={withChord("Back", keymap, "browser.back")} aria-label="Back">
          <ArrowLeft size={12} />
        </button>
        <button className="ib" data-go="forward" disabled={!can.forward} onClick={() => act("forward")} title={withChord("Forward", keymap, "browser.forward")} aria-label="Forward">
          <ArrowRight size={12} />
        </button>
        {loading ? (
          <button className="ib loading" data-go="stop" onClick={() => act("stop")} title="Stop loading" aria-label="Stop">
            <Stop size={12} />
          </button>
        ) : (
          <button className="ib" data-go="reload" onClick={() => act("reload")} title={withChord("Reload", keymap, "browser.reload")} aria-label="Reload">
            <Refresh size={12} />
          </button>
        )}
        {/* BROW-006: the slot keeps the bar's place in the toolbar; in a narrow pane the bar inside it
            is compact and, while focused, floats across the toolbar (browser.css). */}
        <span className="address-slot" ref={chipSlot}>
          {preview && chipEdit !== null ? (
            <input
              className="address chip-edit"
              aria-label="Web address or another document for this tab"
              placeholder="Web address or a document's path"
              value={chipEdit}
              autoFocus
              onChange={(e) => setChipEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitChip(preview.path);
                else if (e.key === "Escape") {
                  e.stopPropagation();
                  chipBack.current = true;
                  setChipEdit(null);
                }
              }}
              onBlur={(e) => {
                if (!e.relatedTarget) chipBack.current = true;
                setChipEdit(null);
              }}
            />
          ) : preview ? (
            // BROW-039: a previewed document shows where it is instead of its loopback address.
            // T-319-b (BROW-041): clicking it (not its buttons) opens it for typing an address.
            <span className="preview-chip" title={`${preview.path} (click to open a web address or another document here)`} onClick={(e) => !(e.target as HTMLElement).closest("button") && setChipEdit(preview.path)}>
              {/* UX audit: a real button, so the keyboard reaches it (Tab, Enter or Space) and Ctrl+L presses it. */}
              <button type="button" className="preview-open" data-go="chip-edit" aria-label={`${preview.file}: type another web address or document`} onClick={() => setChipEdit(preview.path)}>
                <span className="preview-folder">{preview.folder}</span>
                <span className="preview-sep">/</span>
                <b>{preview.file}</b>
              </button>
              <button type="button" className="ib preview-copy" title="Copy the file's path" aria-label="Copy path" onClick={() => void navigator.clipboard?.writeText(preview.path).catch(() => {})}>
                copy
              </button>
              <button type="button" className="ib preview-copy" title="Open the file in an editor tab" aria-label="Open source in the editor" onClick={() => sayIf(openSource(preview.path, cwd, emit))}>
                source
              </button>
              <button type="button" className="ib preview-copy" title="Open the file in the system's default app" aria-label="Open with the system app" onClick={() => sayIf(openWithSystemApp(preview.path, invoke))}>
                open
              </button>
              {/* T-159 (BROW-040): until allowed, the preview reads only its own document. T-733: and it can be taken back. */}
              <button
                type="button"
                className="ib preview-copy"
                aria-pressed={preview.granted}
                title={preview.granted ? `Stop this preview reading the other files in ${preview.folder}; it reads only the documents opened` : `Let this preview read the other files in ${preview.folder} (styles, scripts, images); it reads only its own document until then`}
                onClick={() => {
                  const on = !preview.granted;
                  (on ? invoke("browser_preview_grant", { url: at.current }) : invoke("browser_preview_revoke", { url: at.current }))
                    .then(() => {
                      setPreview((p) => (p ? { ...p, granted: on } : p));
                      return invoke("browser_go", { id, what: "reload" });
                    })
                    .catch((err) => setNote(String(err)));
                }}
              >
                {preview.granted ? "Stop allowing" : "Allow folder"}
              </button>
            </span>
          ) : null}
          <input
            ref={bar}
            className="address"
            style={preview ? { display: "none" } : undefined}
            aria-label="Address"
            placeholder="Address"
            value={menuShown(menu, address)}
            autoFocus
            role="combobox"
            aria-expanded={menu.open && menu.items.length > 0}
            aria-controls={`suggest-${id}`}
            aria-autocomplete="list"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              // BROW-004: leaving the bar (a click into the page takes the keyboard too) closes the
              // list and keeps the typed text; once the bar is left, the next load may show its address.
              closeMenu();
              typing.current = false;
            }}
            onChange={(e) => onTyped(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
              else if (e.key === "Escape") {
                e.preventDefault();
                closeMenu();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (!menu.open) return;
                e.preventDefault();
                setMenu((m) => menuMove(m, e.key === "ArrowDown" ? 1 : -1));
              }
            }}
          />
        </span>
        {badge && (
          <span className="zoom-badge" role="status" aria-label="Zoom">
            {badge}
          </span>
        )}
        {blockedLabel(blocked, blocked?.at ?? 0) && (
          <span className="zoom-badge" data-popups-blocked role="status" title="This page tried to open more tabs than it may; the rest were blocked">
            {blockedLabel(blocked, blocked?.at ?? 0)}
          </span>
        )}
        {refused && (
          <span className="zoom-badge" data-permission-refused role="status" title="This page asked for a permission the browser does not give">
            {refused}
          </span>
        )}
        {/* The app runs these for a chord pressed in the app or inside the page (App's browserAction
            clicks [data-go]): find (BROW-007) and zoom (BROW-012). */}
        <button hidden data-go="find" onClick={openFind} />
        <button hidden data-go="reloadAny" onClick={() => act("reload")} />
        <button hidden data-go="zoomIn" onClick={() => zoomBy("in")} />
        <button hidden data-go="zoomOut" onClick={() => zoomBy("out")} />
        <button hidden data-go="zoomReset" onClick={() => zoomBy("reset")} />
        <span className="right">
          {/* T-240 (BROW-034): the page at a device size; Default is the pane's own size again. */}
          <select className="viewport" value={viewport} onChange={(e) => pickViewport(e.target.value)} title="Viewport size" aria-label="Viewport size">
            {VIEWPORTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {hintShown && (
            <span className="import-hint">
              <button type="button" className="ib" onClick={() => setCookieMenu("menu")} title={`${importHintText(found)}. ${GOOGLE_NOTE}`}>
                {importHintText(found)}
              </button>
              <button type="button" className="ib" onClick={hideHint} title="Hide this hint for good" aria-label="Dismiss import hint">
                <Close size={10} />
              </button>
            </span>
          )}
          {/* T-240 (BROW-028): cookies from Google Chrome (guided export) or a file go into this tab's profile. */}
          <button ref={cookieBtn} className={`ib cookies${cookieMenu ? " on" : ""}`} onClick={() => setCookieMenu(cookieMenu ? null : "menu")} disabled={importing} title={importing ? "Importing cookies…" : `Import cookies from Google Chrome or a file. ${GOOGLE_NOTE}`} aria-label="Import cookies" aria-haspopup="menu" aria-expanded={cookieMenu !== null}>
            <FolderPlus size={12} />
          </button>
          {/* BROW-037: pick elements in the page and write notes on them for an agent. */}
          <button className={`ib${picking ? " on" : ""}`} data-go="annotate" onClick={togglePicking} title={picking ? "Stop picking elements" : "Annotate: pick elements and write notes for an agent"} aria-label="Annotate" aria-pressed={picking}>
            <Target size={12} />
          </button>
          {/* T-241 (BROW-038): draw boxes, arrows and text on a picture of the page and send it to an agent. */}
          <button className="ib txt" data-go="draw" onClick={startDraw} disabled={!open || !!overlay || !!drawing} title="Draw on a picture of the page and send it to an agent" aria-label="Draw on the page">
            Draw
          </button>
          {/* T-240 (BROW-035): grab one element: pick it, then see its details and picture and copy or send them. */}
          <button className={`ib txt${grabMode ? " on" : ""}`} data-go="grab" onClick={startGrab} disabled={!open || !!overlay || !!drawing || !!grab} title={grabMode ? "Stop picking an element" : "Grab an element: pick it to see its details and picture"} aria-label="Grab an element" aria-pressed={grabMode}>
            Grab
          </button>
          <button className={`ib${closeArmed ? " on" : ""}`} onClick={closeTab} title={closeArmed ? "Press again to close this tab anyway" : withChord("Close tab", keymap, "tab.close")} aria-label="Close tab">
            <Close size={12} />
          </button>
        </span>
      </header>
      {/* BROW-004: the drop-down sits in the pane's flow (a child web view cannot be covered), so
          the page below moves down while it is open. Mouse-down, not click, so the bar keeps focus. */}
      {menu.open && menu.items.length > 0 && (
        <ul className="suggest" id={`suggest-${id}`} role="listbox" aria-label="Suggestions">
          {menu.items.map((s, i) => {
            const [head, sub] = suggestionLines(s);
            return (
              <li
                key={`${s.kind}:${s.url}`}
                role="option"
                aria-selected={i === menu.cursor}
                className={`${s.kind}${i === menu.cursor ? " on" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  navigateTo(s.url);
                }}
              >
                <span className="head">{head}</span>
                {sub && <span className="sub">{sub}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {/* BROW-013: the tab's downloads, with bytes received and the total when known. */}
      {downloads.length > 0 && (
        <ul className="downloads" role="status" aria-label="Downloads">
          {downloads.map((d) => {
            const f = fraction(d);
            // T-734 (DT-C170): Cancel while it runs, Show in folder once it is done
            const act = d.state === "running" ? "Cancel" : d.state === "done" && d.path ? "Show in folder" : "";
            return (
              <li key={d.key} className={d.state} title={d.path}>
                <span className="name">{d.name}</span>
                <span className="state">{downloadStatus(d)}</span>
                {d.state === "running" && <progress max={1} value={f ?? undefined} aria-label="Download progress" />}
                {d.state === "done" && d.path && (
                  <button type="button" className="ib txt" data-go="open-download" onClick={() => sayIf(openWithSystemApp(d.path, invoke))} title="Open the file (a program is shown in its folder instead)" aria-label={`Open ${d.name}`}>
                    Open
                  </button>
                )}
                {act && (
                  <button type="button" className="ib txt" onClick={() => (act === "Cancel" ? invoke("browser_download_cancel", { key: d.key }) : invoke("browser_download_reveal", { key: d.key })).catch((e) => setNote(String(e)))} aria-label={`${act}: ${d.name}`}>
                    {act}
                  </button>
                )}
                {d.state !== "running" && (
                  <button className="ib" onClick={() => setDownloads((rows) => dismiss(rows, d.key))} title="Dismiss" aria-label="Dismiss">
                    <Close size={10} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {find !== null && (
        <div className="find-bar" role="search">
          <input
            ref={findBox}
            className="find"
            aria-label="Find in page"
            placeholder="Find in page"
            value={find}
            onChange={(e) => setFind(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") findNext(e.shiftKey);
              else if (e.key === "Escape") setFind(null);
            }}
          />
          <button className="ib" onClick={() => findNext(true)} title="Previous match (Shift+Enter)" aria-label="Previous match">
            <ArrowLeft size={12} />
          </button>
          <button className="ib" onClick={() => findNext(false)} title="Next match (Enter)" aria-label="Next match">
            <ArrowRight size={12} />
          </button>
          <button className="ib" onClick={() => setFind(null)} title="Close find (Escape)" aria-label="Close find">
            <Close size={12} />
          </button>
        </div>
      )}
      {(picking || draft || notes.length > 0) && (
        <div className="notes-tray" role="region" aria-label="Page notes">
          <div className="tray-head">
            <span className="hint">{picking ? "Click an element in the page" : "Notes for an agent"}</span>
            {notes.length > 0 && <span className="count">{notes.length}/{MAX_NOTES}</span>}
            {notes.length > 0 && (
              <button className="btn" data-go="send-notes" onClick={openSend}>
                Send to agent…
              </button>
            )}
            {notes.length > 0 && (
              <button className="btn" data-go="clear-notes" onClick={() => pressClear(() => setNotes([]))} title={clearArmed ? "Press again to drop all the notes" : "Drop all the notes"}>
                {clearArmed ? "Clear all?" : "Clear"}
              </button>
            )}
          </div>
          {draft && (
            <div className="draft">
              <code title={draft.path}>{draft.selector}</code>
              <textarea
                ref={draftBox}
                aria-label="Note on this element"
                placeholder="What about this element? Enter keeps it, Escape drops it"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    keepDraft();
                  } else if (e.key === "Escape") setDraft(null);
                }}
              />
              <button className="btn" onClick={keepDraft}>
                Add
              </button>
            </div>
          )}
          {notes.length > 0 && (
            <ol className="notes">
              {notes.map((n, i) => (
                <li key={i}>
                  <code title={n.pick.path}>{n.pick.selector}</code> {n.text}
                  <button className="ib" aria-label="Remove note" title="Remove note" onClick={() => setNotes(notes.filter((_, j) => j !== i))}>
                    <Close size={10} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {sendMenu && (
            <ul className="send-menu" role="menu" aria-label="Send notes to">
              {sendMenu.map((t) => (
                <li key={t.key}>
                  <button role="menuitem" onClick={() => sendTo(t.key)}>
                    {t.label} <small>{t.since}</small>
                  </button>
                </li>
              ))}
              <li>
                <button role="menuitem" onClick={() => setSendMenu(null)}>
                  Cancel
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
      {/* T-240 (BROW-028): in the pane's flow, like the suggestions (a child web view cannot be covered). */}
      {cookieMenu === "menu" && (
        <ul
          className="suggest cookie-menu"
          role="menu"
          aria-label="Import cookies"
          onKeyDown={(e) => {
            // UX audit: the menu is for the keyboard too: arrows move, Escape closes and gives focus back to its button.
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setCookieMenu(null);
              cookieBtn.current?.focus();
              return;
            }
            const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
            const to = menuStep(rows.length, rows.indexOf(document.activeElement as HTMLElement), e.key);
            if (to === null) return;
            e.preventDefault();
            rows[to]?.focus();
          }}
        >
          {IMPORT_SOURCES.map((s, i) => (
            <li key={s.source} role="none" className="item">
              <button
                type="button"
                role="menuitem"
                className="pick"
                autoFocus={i === 0}
                onClick={() => {
                  if (s.source === "chrome") setCookieMenu("chrome");
                  else void importCookies("file");
                }}
              >
                <span className="head">{s.label}</span>
              </button>
            </li>
          ))}
          <li className="sub-note" aria-disabled="true">
            <span className="sub">{GOOGLE_NOTE}</span>
          </li>
        </ul>
      )}
      {cookieMenu === "chrome" && (
        <div
          className="notice cookie-steps"
          role="dialog"
          aria-label="Import from Google Chrome"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setCookieMenu(null);
            cookieBtn.current?.focus();
          }}
        >
          <ol>
            {CHROME_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <button type="button" className="ib" autoFocus disabled={importing} onClick={() => void importCookies("chrome")}>
            Choose cookies.txt…
          </button>
          <button type="button" className="ib" onClick={() => setCookieMenu(null)}>
            Cancel
          </button>
        </div>
      )}
      {note && (
        <div className="notice" role="alert">
          <span>{note}</span>
          <button type="button" className="ib" data-go="dismiss-notice" onClick={() => setNote(null)} title="Dismiss" aria-label="Dismiss notice">
            <Close size={10} />
          </button>
        </div>
      )}
      {outbound && (
        <div
          className="notice preview-ask"
          role="alertdialog"
          aria-label="Open an outside address?"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setOutbound(null);
            if (focused) bar.current?.focus(); // BROW-001: only the focused pane's bar
          }}
        >
          <span>
            This preview wants to open <code>{outbound}</code>
          </span>
          <button
            type="button"
            className="ib"
            onClick={() => {
              const url = outbound;
              setOutbound(null);
              navigateTo(url);
            }}
          >
            Open
          </button>
          <button type="button" className="ib" autoFocus={focused} onClick={() => setOutbound(null)}>
            Cancel
          </button>
        </div>
      )}
      {leave && (
        <div
          className="notice preview-ask"
          role="alertdialog"
          aria-label={leaveText(leave).question}
          data-leave={leave.what}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setLeave(null);
            if (focused) bar.current?.focus(); // BROW-001: only the focused pane's bar
          }}
        >
          <span>
            {leaveText(leave).lead}
            <strong>{leave.host}</strong>
            {leaveText(leave).tail} <code>{leaveText(leave).shown}</code>
          </span>
          <button type="button" className="ib" data-leave-go disabled={!armedLook} onClick={() => leaveReady(leave) && leaveConfirmed(leave)}>
            {leaveText(leave).confirm}
          </button>
          <button type="button" className="ib" data-leave-cancel autoFocus={focused} onClick={() => setLeave(null)}>
            Cancel
          </button>
        </div>
      )}
      <div ref={host} className="pane-body">
        {drawing && (
          <DrawCanvas
            picture={drawing}
            title={title ?? ""}
            url={at.current}
            targets={targets}
            onSend={onSend}
            onClose={(done) => {
              setDrawing(null);
              if (done) setNote(done);
            }}
          />
        )}
        {grab && (
          <GrabSheet
            grab={grab}
            title={title ?? ""}
            url={at.current}
            targets={targets}
            onSend={onSend}
            onClose={(done) => {
              setGrab(null);
              if (done) setNote(done);
            }}
          />
        )}
        {overlay && <LoadOverlay overlay={overlay} diag={diag} handler={handler} trust={trustLabel(cert)} busy={busy} connecting={connecting} onRetry={retry} onTrust={trustCert} onHttps={switchHttps} onOpen={openExternally} />}
      </div>
    </section>
  );
}
