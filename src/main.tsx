import React from "react";
import { saveChanged } from "./settings/saveChanged";
import ReactDOM from "react-dom/client";
import ScreenBoundary from "./recovery/ScreenBoundary";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyAppearance, cachedAppearance, followSystemMode, readAppearance } from "./theme";
import { stampLook } from "./settings/general";
import { applyLanguage, LANGUAGE_FIELD } from "./language";
import { registerBundledPacks } from "./i18n/packs";
import { applyZoom, ZOOM_FIELD } from "./settings/zoom";
import { applyText, followText } from "./terminal/text";
import { installMenuWheel } from "./settings/menuWheel";
import { LAYOUT_FIELD, restoreAsks, restoreLayout, stillThere, type SavedLayout } from "./terminal/layout";
import { sessionOrder } from "./sessions/restoreOrder";
import "./styles.css";
import { prefetch } from "./lazy/deferred";
import TowerWindow from "./tower/TowerWindow";
import { isTowerWindow } from "./tower/ownWindow";
import { showStartFailure } from "./tower/startFailed";

// SET-004: the window starts hidden (tauri.conf.json). The saved look goes on the root first, read
// from the settings (the last run's copy if they take too long), then the page draws, and only then
// is the window shown, so its first visible frame already has the saved colours and font.
async function start() {
  applyAppearance(cachedAppearance());
  followSystemMode();
  // T-546-c: the Tower's own window draws only the Tower; the panes, the settings and the layout stay the main window's.
  if (isTowerWindow(location.hash)) {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<TowerWindow />);
    return;
  }
  // FIX-4 (council d2 AFTER 8): the App module (and everything it imports) is loaded for the main
  // window only; the Tower window never evaluates it. The load starts now and runs beside the settings read.
  const loadApp = import("./App");
  // FIX-6 (council d2 AFTER 3): the load is awaited much later; a fast failure is already handled by then (the await below still throws).
  loadApp.catch(() => {});
  const reading = invoke<Record<string, unknown>>("get_settings").catch(() => null);
  const saved = await Promise.race([reading, new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  // SET-017 (T-210-c): the bundled language packs are known to the lookup (fetched only when their language is needed).
  registerBundledPacks();
  // SET-022 / SET-025: terminals open with the saved text settings and follow every save.
  followText(saved);
  const first = await settle(saved);
  const { default: App } = await loadApp;
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  // VIEW-107 (T-069-b): App is told whether the saved tabs are back, so a slow start saves no layout over
  // them; C26-R3-01: the key is gone, so one App lives for the window's life and a late restore is handed to
  // it (below). A key flip used to unmount that App and take every terminal it held with it.
  const draw = (s: Settled, read: boolean, late: SavedLayout | null = null) =>
    root.render(
      <React.StrictMode>
        <ScreenBoundary>
          <App initial={s.initial} layout={s.layout} read={read} late={late} />
        </ScreenBoundary>
      </React.StrictMode>,
    );
  draw(first, saved !== null);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      void getCurrentWindow().show().catch(() => {});
      // Cycle 3 (first load): the pages, the editor and the browser pane are read in the background now
      // that the first frame is up, so opening one stays as quick as it was while the start stays small.
      prefetch();
    }),
  );
  // T-597 (F05-app-shell-launch.2): a start that timed out keeps waiting; when the settings answer, the same
  // steps run on them and the saved tabs join the window already drawn (windowStore.ts). A tab opened in the
  // meantime stays: it was live work, and nothing unmounts it now (C26-R3-01).
  if (saved === null)
    void reading
      .then(async (late) => {
        if (!late) return; // never read: the window stays as drawn, writing no layout
        applyText(late);
        const settled = await settle(late);
        draw(settled, true, settled.layout);
      })
      .catch(() => {});
}

type Settled = { initial: Record<string, unknown>; layout: SavedLayout | null };

/** What the window takes from the settings before it draws: the look, the language, the zoom and the
 *  saved tabs (none when `saved` is null: the read timed out or failed). */
async function settle(saved: Record<string, unknown> | null): Promise<Settled> {
  // SET-037 / T-418: the look and a missing mode are written down on the first start (New, Dark),
  // and only from settings really read: after the timeout (`saved` null) nothing is written.
  const stamped = saved && stampLook(saved);
  if (stamped) void saveChanged(saved, stamped).catch(() => {});
  if (saved) applyAppearance(readAppearance(stamped || saved));
  // SET-017: the saved language is in force before the first frame draws.
  applyLanguage(saved?.[LANGUAGE_FIELD]);
  // SET-019: and so is the saved interface zoom.
  applyZoom(saved?.[ZOOM_FIELD]);
  // PROJ-067: the saved tabs come back, less those whose folder is gone.
  let layout = restoreLayout((stamped || saved || {})[LAYOUT_FIELD]);
  if (layout) {
    const dirs = [...new Set([...layout.panes.map((p) => p.cwd), layout.activeDir].filter((d): d is string => d !== null))];
    const kinds = await Promise.all(dirs.map((d) => invoke<string>("path_kind", { path: d }).catch(() => "missing")));
    layout = stillThere(layout, (d) => kinds[dirs.indexOf(d)] !== "missing");
    // TERM-106: the saved output of tabs no longer in the layout is cleaned up in the background.
    void invoke("terminal_prune_history", { keep: layout.panes.map((p) => p.key) }).catch(() => {});
    // SESS-030: an agent tab starts again on its standing start line (permission mode, the user's own
    // arguments and environment) plus its own resume command, built on the Rust side from the tab's
    // last session id (every catalogue agent, not only Claude Code and Codex); `resumed` drives the
    // TERM-107 mark. An agent no longer known keeps the bare line. restoreAsks skips plain shells.
    for (const p of sessionOrder(layout.panes)) { // after-list #723: asked in session order; the panes keep their saved order
      if (!restoreAsks(p)) continue;
      const line = await invoke<{ args: string[]; program: string | null; env: [string, string][]; resumed: boolean }>("agent_start_line", { id: p.agentId, extra: [], prompt: "", restore: true, session: p.session ?? null }).catch(() => null);
      if (line) Object.assign(p, { args: line.args, program: line.program ?? p.program, env: line.env, resumed: line.resumed });
      else p.resumed = false;
    }
  }
  return { initial: stamped || saved || {}, layout };
}

installMenuWheel(document);
// FIX-5 (council d2 AFTER 4): a start that fails (the App chunk did not load, a restore step threw)
// shows a message and the window instead of leaving the hidden window blank.
void start().catch((e) => showStartFailure(e, document, () => getCurrentWindow().show()));
