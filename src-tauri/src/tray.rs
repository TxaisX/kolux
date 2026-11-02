//! APP-008 / STAT-047: the tray icon. Its menu is Open Kolux and Quit; on Windows a left click
//! opens the window; an amber dot appears when a bell rang, an agent finished or a usage alert fired
//! while the window was hidden or minimised, and clears once the window is shown; development
//! copies carry DEV and the branch they run from in the icon and the tooltip, kept when the
//! attention icon is swapped in; Linux gets no tray icon.
//! APP-007: with the option on, the main window's close button hides Kolux to the tray instead (the
//! page's close handler asks `tray_close_requested` first; no other window's close counts); Quit from the
//! tray and File > Exit go through the same close with a quit flag, so unsaved text is still asked about
//! and every pane stops (ACCT-051). Should the page never answer that close (a hung webview), tray Quit
//! still ends Kolux after `QUIT_FALLBACK`.
//! The real icon needs tauri's `tray-icon` feature, switched on through this crate's `tray`
//! feature (Cargo.toml is the coordinator's file: `evidence/tray-T-248-d-Cargo.toml.patch`).
//! Without it `install` puts nothing in the tray and every model function still builds and tests.


use crate::menu::Os;
#[cfg(any(debug_assertions, test))]
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// The tray icon's id, for the lookups that swap its icon.
pub const TRAY_ID: &str = "kolux";

pub const OPEN_ID: &str = "tray.open";
pub const QUIT_ID: &str = "tray.quit";

/// The tray's menu, in order: (id, label).
pub fn items() -> [(&'static str, &'static str); 2] {
    [(OPEN_ID, "Open Kolux"), (QUIT_ID, "Quit")]
}

/// Settings key of the macOS menu bar icon switch (SET-041): on unless a saved `false`. Only macOS reads it.
pub const MENU_BAR_ICON_FIELD: &str = "menuBarIcon";

/// Windows and macOS get a tray icon; Linux does not. On macOS the icon is the menu bar icon, which
/// is on by default and goes only when the saved settings say `false` (Windows ignores the switch).
pub fn has_tray(os: Os, settings: &serde_json::Value) -> bool {
    match os {
        Os::Linux => false,
        Os::Mac => settings.get(MENU_BAR_ICON_FIELD) != Some(&serde_json::Value::Bool(false)),
        _ => true,
    }
}

/// On Windows a left-click opens the app; elsewhere a click opens the menu.
pub fn left_click_opens(os: Os) -> bool {
    os == Os::Windows
}

/// The hover text: the app name, and for a development copy "DEV" and the branch it runs from.
pub fn tooltip(dev: bool, branch: Option<&str>) -> String {
    match (dev, branch.map(str::trim).filter(|b| !b.is_empty())) {
        (false, _) => "Kolux".into(),
        (true, Some(b)) => format!("Kolux DEV ({b})"),
        (true, None) => "Kolux DEV".into(),
    }
}

/// Something that may want the user's attention.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ping {
    Bell,
    AgentFinished,
    /// USAGE-009: a usage alert, sent or held back, lights the dot while the window is hidden.
    UsageAlert,
}

/// The attention dot: set by a ping while the window is hidden, cleared when it is shown.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Dot {
    pub on: bool,
    hidden: bool,
}

impl Dot {
    pub fn window_hidden(&mut self) {
        self.hidden = true;
    }
    /// STAT-047: a minimised window is out of sight like a hidden one.
    pub fn window_minimised(&mut self) {
        self.hidden = true;
    }
    pub fn window_shown(&mut self) {
        self.hidden = false;
        self.on = false;
    }
    /// A ping lights the dot only while the window is hidden; the return says whether it changed.
    pub fn ping(&mut self, _what: Ping) -> bool {
        let was = self.on;
        if self.hidden {
            self.on = true;
        }
        was != self.on
    }
    /// One agent event with the window's current state: the dot learns whether the window is out of
    /// sight, then takes the ping. `Some(on)` says the icon must be repainted and with what; `None`
    /// says nothing changed.
    pub fn report(&mut self, hidden: bool, what: Ping) -> Option<bool> {
        let was = self.on;
        if hidden {
            self.window_hidden();
        } else {
            self.window_shown();
        }
        self.ping(what);
        // measured across the whole report: a dot that was on and goes off because the window is back
        // is a change too, and the icon is repainted with the model's new state, never a fixed "on"
        (was != self.on).then_some(self.on)
    }
}

/// On Windows only a released left click opens the window; a right click, and any click
/// elsewhere, is the menu.
pub fn click_opens(os: Os, left: bool, released: bool) -> bool {
    left_click_opens(os) && left && released
}

/// APP-008: the branch a Git HEAD file names; a detached HEAD shows the short commit.
#[cfg(any(debug_assertions, test))]
pub fn branch_from_head(head: &str) -> Option<String> {
    let head = head.trim();
    if head.is_empty() {
        return None;
    }
    match head.strip_prefix("ref: refs/heads/") {
        Some(b) => Some(b.trim().to_string()),
        None => Some(head.chars().take(7).collect()),
    }
}

/// Where a checkout keeps its HEAD: inside `.git` when that is a folder, or inside the folder a
/// `.git` file names (a worktree), read relative to the checkout.
#[cfg(any(debug_assertions, test))]
pub fn git_head_file(checkout: &Path) -> Option<PathBuf> {
    let dot_git = checkout.join(".git");
    let dir = if dot_git.is_dir() {
        dot_git
    } else {
        let text = std::fs::read_to_string(&dot_git).ok()?;
        let target = text.lines().find_map(|l| l.strip_prefix("gitdir:")).map(str::trim)?;
        checkout.join(target)
    };
    let head = dir.join("HEAD");
    head.is_file().then_some(head)
}

/// A development copy runs from its source tree: the branch of the checkout that holds src-tauri.
fn dev_branch() -> Option<String> {
    // Only a debug build knows its source path; a release binary carries no build-machine path.
    #[cfg(debug_assertions)]
    if tauri::is_dev() {
        let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?;
        let head = git_head_file(checkout)?;
        return branch_from_head(&std::fs::read_to_string(head).ok()?);
    }
    None
}

/// The attention dot's colour (amber) and the DEV marker's (blue), as RGBA.
pub const AMBER: [u8; 4] = [245, 166, 35, 255];
pub const DEV_MARK: [u8; 4] = [59, 130, 246, 255];
const RING: [u8; 4] = [24, 24, 24, 255];

/// The icon's pixels with, when asked, the amber dot in the bottom-right corner (a dark ring keeps
/// it visible on a light icon) and the DEV marker, a square in the top-left corner. Both fit any
/// icon size; a request for neither returns the pixels unchanged.
pub fn paint(rgba: &[u8], w: u32, h: u32, dot: bool, dev: bool) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let (wi, hi) = (w as i64, h as i64);
    let mut set = |x: i64, y: i64, c: [u8; 4]| {
        if x >= 0 && y >= 0 && x < wi && y < hi {
            let i = ((y * wi + x) * 4) as usize;
            if i + 4 <= out.len() {
                out[i..i + 4].copy_from_slice(&c);
            }
        }
    };
    if dev {
        let side = (wi / 4).max(1);
        for y in 0..side {
            for x in 0..side {
                set(x, y, DEV_MARK);
            }
        }
    }
    if dot {
        let r = (wi / 4).max(1);
        let (cx, cy) = (wi - r - 1, hi - r - 1);
        for y in (cy - r - 1)..=(cy + r + 1) {
            for x in (cx - r - 1)..=(cx + r + 1) {
                let d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                if d2 <= r * r {
                    set(x, y, AMBER);
                } else if d2 <= (r + 1) * (r + 1) {
                    set(x, y, RING);
                }
            }
        }
    }
    out
}

/// SET-041: the tray icon's pixels for the chosen app icon: the variant's colours (same outline), then
/// the dot and the DEV corner on top, so they stay visible on every choice.
pub fn tray_pixels(choice: crate::app_look::IconChoice, rgba: &[u8], w: u32, h: u32, dot: bool, dev: bool) -> Vec<u8> {
    paint(&crate::app_look::variant(choice, rgba, w), w, h, dot, dev)
}

/// STAT-048: the taskbar badge. Windows has no badge count, so the count is painted onto an overlay
/// icon: an amber disc with the number in white, "99+" past the cap. Since the 2026-10-20 merge of
/// main the one registered command is `badge::badge_set` (single digit, plain disc above 9); this
/// two-digit painter is unregistered and kept only until it is folded in or dropped (kolux-rs-after.md).
#[cfg_attr(not(test), allow(dead_code))] // only tests reach it; folded in or dropped in the bug-fix phase (kolux-rs-after.md)
pub const BADGE_SIZE: u32 = 32;
#[cfg_attr(not(test), allow(dead_code))] // only tests reach it; folded in or dropped in the bug-fix phase (kolux-rs-after.md)
pub const WHITE: [u8; 4] = [255, 255, 255, 255];
#[cfg_attr(not(test), allow(dead_code))] // only tests reach it; folded in or dropped in the bug-fix phase (kolux-rs-after.md)
const BADGE_CAP: u32 = 99;

/// What the badge says for this many workspaces: nothing at zero, the number, or "99+".
#[cfg_attr(not(test), allow(dead_code))] // only tests reach it; folded in or dropped in the bug-fix phase (kolux-rs-after.md)
pub fn badge_text(count: u32) -> Option<String> {
    match count {
        0 => None,
        n if n > BADGE_CAP => Some(format!("{BADGE_CAP}+")),
        n => Some(n.to_string()),
    }
}

/// A 3x5 pixel glyph for each character the badge can show, one row per byte (3 low bits).
#[cfg_attr(not(test), allow(dead_code))] // only tests reach it; folded in or dropped in the bug-fix phase (kolux-rs-after.md)
fn glyph(c: char) -> [u8; 5] {
    match c {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b001, 0b001, 0b001],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        _ => [0; 5],
    }
}

/// The overlay badge's pixels (RGBA, BADGE_SIZE square): an amber disc with `text` centred in white.
#[cfg_attr(not(test), allow(dead_code))] // only tests reach it; folded in or dropped in the bug-fix phase (kolux-rs-after.md)
pub fn paint_badge(text: &str) -> (Vec<u8>, u32, u32) {
    let size = BADGE_SIZE as i64;
    let mut out = vec![0u8; (BADGE_SIZE * BADGE_SIZE * 4) as usize];
    let mut set = |x: i64, y: i64, c: [u8; 4]| {
        if x >= 0 && y >= 0 && x < size && y < size {
            let i = ((y * size + x) * 4) as usize;
            out[i..i + 4].copy_from_slice(&c);
        }
    };
    let (c, r) = (size / 2, size / 2 - 1);
    for y in 0..size {
        for x in 0..size {
            let (dx, dy) = (x - c, y - c);
            if dx * dx + dy * dy <= r * r {
                set(x, y, AMBER);
            }
        }
    }
    let chars: Vec<char> = text.chars().take(3).collect();
    let scale = if chars.len() >= 3 { 2 } else { 3 };
    let gap = scale;
    let total_w = chars.len() as i64 * 3 * scale + (chars.len() as i64 - 1).max(0) * gap;
    let (x0, y0) = ((size - total_w) / 2, (size - 5 * scale) / 2);
    for (n, ch) in chars.iter().enumerate() {
        let gx = x0 + n as i64 * (3 * scale + gap);
        for (row, bits) in glyph(*ch).iter().enumerate() {
            for col in 0..3 {
                if bits & (0b100 >> col) != 0 {
                    for sy in 0..scale {
                        for sx in 0..scale {
                            set(gx + col * scale + sx, y0 + row as i64 * scale + sy, WHITE);
                        }
                    }
                }
            }
        }
    }
    (out, BADGE_SIZE, BADGE_SIZE)
}

/// The tray's state, shared by the pings and the window events.
#[derive(Default)]
pub struct TrayState {
    dot: Mutex<Dot>,
}

/// Puts Kolux's icon in the tray on Windows and macOS. Nothing happens on Linux, or in a build
/// without the `tray` feature. Called from the app's setup (lib.rs, the coordinator's file:
/// `evidence/tray-T-248-d-lib.rs.patch`), which logs an error and goes on: the icon is optional.
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Manager;
    app.manage(TrayState::default());
    #[cfg(feature = "tray")]
    if has_tray(Os::current(), &real::saved_settings(app)) {
        real::install(app)?;
    }
    Ok(())
}

/// Is the main window out of sight: hidden, or minimised to the taskbar?
fn window_hidden(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.get_webview_window(MAIN_LABEL).map(|w| !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false)).unwrap_or(true)
}

/// A bell, a finished agent or a usage alert: the dot lights only while the window is out of sight, and
/// the icon is repainted with the model's new state (so a window brought back without a focus event
/// loses its dot on the next event instead of keeping a stale one).
pub fn ping(app: &tauri::AppHandle, what: Ping) {
    use tauri::Manager;
    let Some(state) = app.try_state::<TrayState>() else { return };
    let hidden = window_hidden(app);
    let repaint = state.dot.lock().map(|mut d| d.report(hidden, what));
    if let Ok(Some(on)) = repaint {
        refresh(app, on);
    }
}

/// The window came back (shown, restored or focused): the dot clears. Called when the main window
/// gains focus (the same lib.rs patch).
pub fn window_shown(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(state) = app.try_state::<TrayState>() else { return };
    let was_on = state.dot.lock().map(|mut d| {
        let was = d.on;
        d.window_shown();
        was
    });
    if matches!(was_on, Ok(true)) {
        refresh(app, false);
    }
}

/// The main window was minimised: the dot learns the window is out of sight, so the next ping lights it
/// even before that ping re-reads the window. Called from the lib.rs resize hook
/// (`evidence/tray-T-248-c-lib.rs.patch`); a restore comes back through `window_shown`.
pub fn window_minimised(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(state) = app.try_state::<TrayState>() else { return };
    let _ = state.dot.lock().map(|mut d| d.window_minimised());
}

/// Open Kolux from the tray: the main window is shown, restored and focused, and the dot clears.
pub fn open_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    window_shown(app);
}

/// How long tray Quit waits for the page to answer the close before ending Kolux anyway.
pub const QUIT_FALLBACK: Duration = Duration::from_secs(5);

/// Quit from the tray: the same path as File > Exit. The quit flag is set, the window is brought back
/// (so the unsaved-changes question can be seen) and asked to close; the page's close handler then
/// writes what is pending, asks about unsaved text (VIEW-107) and destroys the window, whose Destroyed
/// step stops every pane and child process (ACCT-051). Never `app.exit` straight while the page is
/// responsive: that would skip the question and drop a pending layout write. Without a main window there
/// is nothing to ask: plain exit.
/// The guaranteed way out (ACCT-051): a page that never answers the close (a hung webview, say under a
/// runaway terminal burst) would otherwise hold Kolux open for ever, since Tauri leaves the window up
/// while a page-side close listener exists. So after `QUIT_FALLBACK` the quit's own generation is checked:
/// still pending means the page never called `tray_close_requested`, and `app.exit(0)` ends Kolux
/// (RunEvent::Exit still stops every pane). A page that answered has consumed the flag, so a user sitting
/// at the question is left alone, and a later quit has a newer generation, so it is never mistaken for
/// this one.
pub fn quit(app: &tauri::AppHandle) {
    use tauri::Manager;
    let generation = begin_quit();
    match app.get_webview_window(MAIN_LABEL) {
        Some(w) => {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            let _ = w.close();
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(QUIT_FALLBACK);
                if quit_fallback_due(generation) {
                    app.exit(0);
                }
            });
        }
        None => app.exit(0),
    }
}

/// APP-007: the setting for "closing the window hides Kolux to the tray" (Windows; off by default).
/// The Notifications page saves the same key (src/settings/notifications.ts CLOSE_TO_TRAY_FIELD).
pub const CLOSE_TO_TRAY_FIELD: &str = "closeToTray";
/// The store key that remembers the once-only explanation was shown.
pub const CLOSE_EXPLAINED_KEY: &str = "tray.closeExplained";
/// The main window's label; only its close request can hide to the tray or carry a quit.
pub const MAIN_LABEL: &str = "main";

/// The quit flag with a generation count. `begin` (tray Quit, File > Exit) marks a quit under way and
/// numbers it; `take` consumes it on the close request that follows (one-shot, so a quit cancelled at
/// the unsaved-changes question leaves no trace); `fallback_due(generation)` tells the timer that tray
/// Quit started whether ITS quit is still unanswered: true only while that very generation is pending.
#[derive(Debug, Default)]
pub struct QuitFlag {
    pending: u64,
    last: u64,
}

impl QuitFlag {
    /// A quit is under way: returns its generation.
    pub fn begin(&mut self) -> u64 {
        self.last += 1;
        self.pending = self.last;
        self.last
    }
    /// Reads the flag for the close request being handled and clears it.
    pub fn take(&mut self) -> bool {
        std::mem::take(&mut self.pending) != 0
    }
    /// Is the quit numbered `generation` still waiting for the page? A consumed flag (the page answered,
    /// perhaps with the unsaved-changes question) or a newer quit means no.
    pub fn fallback_due(&self, generation: u64) -> bool {
        generation != 0 && self.pending == generation
    }
}

/// Set by `begin_quit` (tray Quit, File > Exit), consumed by `take_quitting` on the close request that
/// follows; a real quit is never turned into a hide.
static QUITTING: Mutex<QuitFlag> = Mutex::new(QuitFlag { pending: 0, last: 0 });

/// A quit is under way (tray Quit, File > Exit): the close request that follows is a real quit, never a
/// hide. Returns the quit's generation for `quit_fallback_due`.
pub fn begin_quit() -> u64 {
    QUITTING.lock().map(|mut q| q.begin()).unwrap_or(0)
}

/// Reads the quit flag for the close request being handled and clears it.
pub fn take_quitting() -> bool {
    QUITTING.lock().map(|mut q| q.take()).unwrap_or(false)
}

/// Is the quit numbered `generation` still unanswered by the page?
pub fn quit_fallback_due(generation: u64) -> bool {
    QUITTING.lock().map(|q| q.fallback_due(generation)).unwrap_or(false)
}

/// Does `tray_close_requested` act for a window with this label? Only the main window's close can hide
/// to the tray or carry a quit; any other window's call changes nothing.
pub fn handles_close_request(label: &str) -> bool {
    label == MAIN_LABEL
}

/// Does this close click hide the window instead of closing it? Only on Windows, only with the option
/// saved as a real `true`, only while a tray icon is there to bring the window back, and never while a
/// quit is under way.
pub fn close_hides(os: Os, settings: &serde_json::Value, quitting: bool, icon_present: bool) -> bool {
    matches!(os, Os::Windows) && settings.get(CLOSE_TO_TRAY_FIELD) == Some(&serde_json::Value::Bool(true)) && !quitting && icon_present
}

/// Is there a tray icon that could bring a hidden window back? Only with the `tray` feature and a
/// successful `install`.
fn icon_present(app: &tauri::AppHandle) -> bool {
    #[cfg(feature = "tray")]
    {
        app.tray_by_id(TRAY_ID).is_some()
    }
    #[cfg(not(feature = "tray"))]
    {
        let _ = app;
        false
    }
}

/// T-324-b (APP-007, review a8c1d430 AFTER 5): should Settings show the close-to-tray switch? Only
/// where closing can hide the window (Windows) and an icon exists to bring it back; otherwise the
/// switch would promise something the app cannot do.
pub fn close_switch_available(os: Os, icon_present: bool) -> bool {
    matches!(os, Os::Windows) && icon_present
}

/// The Notifications page asks before it draws the close-to-tray switch.
/// Registered by `evidence/fix-other-fix-T-324-b-lib.rs.patch`.
#[tauri::command]
pub fn tray_close_switch_available(app: tauri::AppHandle) -> bool {
    close_switch_available(Os::current(), icon_present(&app))
}

/// Is the first-time explanation still owed? `stored` is the CLOSE_EXPLAINED_KEY value.
pub fn explain_due(stored: Option<&str>) -> bool {
    matches!(stored, None | Some(""))
}

/// The main window's close request, as the page's close handler reports it through
/// `tray_close_requested`: true when the window was hidden to the tray instead, so the page keeps the
/// window alive (preventDefault) and skips the unsaved-changes question (nothing is lost, Kolux keeps
/// running). The dot model learns the window is hidden, and the first time a notification says where
/// Kolux went. With `quitting` (tray Quit, File > Exit), with no tray icon, or with the option off,
/// nothing happens here and the close goes on as before.
pub fn on_close_requested(app: &tauri::AppHandle, quitting: bool) -> bool {
    use tauri::Manager;
    let Some(store) = app.try_state::<Mutex<crate::state::Store>>() else { return false };
    let Ok(settings) = store.lock().map(|s| s.settings()) else { return false };
    if !close_hides(Os::current(), &settings, quitting, icon_present(app)) {
        return false;
    }
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.hide();
    }
    if let Some(state) = app.try_state::<TrayState>() {
        if let Ok(mut d) = state.dot.lock() {
            d.window_hidden();
        }
    }
    let due = store
        .lock()
        .map(|s| {
            let stored = s.get(CLOSE_EXPLAINED_KEY).ok().flatten();
            let due = explain_due(stored.as_deref());
            if due {
                let _ = s.set(CLOSE_EXPLAINED_KEY, "1");
            }
            due
        })
        .unwrap_or(false);
    if due {
        let _ = crate::notifications::show_plain(app, "Kolux is still running".into(), "The window went to the tray. Open Kolux or Quit from the tray icon.".into(), false);
    }
    true
}

/// APP-007: the page's close handler (App.tsx, `evidence/tray-FIX-1-App.tsx.patch`) calls this first on
/// every close request of the main window and reads `{ hid, quitting }`: `hid` true means the window
/// went to the tray and the page must keep it alive and ask nothing; `quitting` says tray Quit or
/// File > Exit asked for this close (the flag is consumed here, so a quit cancelled at the question
/// leaves nothing behind). Registered by `evidence/tray-FIX-1-lib.rs.patch`. Tauri passes the calling
/// window: only the main window's call does anything; another window (the Tower) closing gets
/// `{ hid: false, quitting: false }` and leaves the quit flag alone.
#[tauri::command]
pub fn tray_close_requested(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    if !handles_close_request(window.label()) {
        return Ok(serde_json::json!({ "hid": false, "quitting": false }));
    }
    let quitting = take_quitting();
    let hid = on_close_requested(&app, quitting);
    Ok(serde_json::json!({ "hid": hid, "quitting": quitting }))
}

/// STAT-047: the page reports an agent event before any toast switch is consulted, so the dot lights
/// while the window is hidden even when that kind of toast is off. `kind` "bell" is a terminal bell.
#[tauri::command]
pub fn tray_ping(app: tauri::AppHandle, kind: Option<String>) {
    let what = if kind.as_deref() == Some("bell") { Ping::Bell } else { Ping::AgentFinished };
    ping(&app, what);
}

#[cfg(feature = "tray")]
fn refresh<R: tauri::Runtime>(app: &tauri::AppHandle<R>, dot: bool) {
    real::set_icon(app, dot);
}
#[cfg(not(feature = "tray"))]
fn refresh<R: tauri::Runtime>(_app: &tauri::AppHandle<R>, _dot: bool) {}

/// SET-041: the app icon choice changed. The tray icon is redrawn at once from the saved choice, with
/// the attention dot kept as the model has it. Nothing happens without a tray icon.
pub fn repaint<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    let dot = app.try_state::<TrayState>().and_then(|s| s.dot.lock().ok().map(|d| d.on)).unwrap_or(false);
    refresh(app, dot);
}

#[cfg(feature = "tray")]
mod real {
    use super::*;
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    /// The saved settings, read through the Store the way `app_look::apply_saved` does; empty before it opens.
    pub fn saved_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> serde_json::Value {
        use tauri::Manager;
        app.try_state::<Mutex<crate::state::Store>>().and_then(|s| s.lock().ok().map(|s| s.settings())).unwrap_or_default()
    }

    pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
        let [(open_id, open), (quit_id, quit_label)] = items();
        let open_item = MenuItem::with_id(app, open_id, open, true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, quit_id, quit_label, true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
        let os = Os::current();
        let mut tray = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            .tooltip(tooltip(tauri::is_dev(), dev_branch().as_deref()))
            .show_menu_on_left_click(!left_click_opens(os))
            .on_menu_event(|app, e| match e.id().as_ref() {
                OPEN_ID => open_window(app),
                QUIT_ID => quit(app),
                _ => {}
            })
            .on_tray_icon_event(move |tray, e| {
                if let TrayIconEvent::Click { button, button_state, .. } = e {
                    if click_opens(os, button == MouseButton::Left, button_state == MouseButtonState::Up) {
                        open_window(tray.app_handle());
                    }
                }
            });
        if let Some(icon) = icon(app, false) {
            tray = tray.icon(icon);
        }
        tray.build(app)?;
        Ok(())
    }

    /// The chosen app icon (SET-041) with the DEV marker on a development copy and, when asked, the dot.
    fn icon<R: tauri::Runtime>(app: &tauri::AppHandle<R>, dot: bool) -> Option<Image<'static>> {
        let base = app.default_window_icon()?;
        let (w, h) = (base.width(), base.height());
        let choice = crate::app_look::icon_choice(&saved_settings(app));
        Some(Image::new_owned(tray_pixels(choice, base.rgba(), w, h, dot, tauri::is_dev()), w, h))
    }

    pub fn set_icon<R: tauri::Runtime>(app: &tauri::AppHandle<R>, dot: bool) {
        if let (Some(tray), Some(img)) = (app.tray_by_id(TRAY_ID), icon(app, dot)) {
            let _ = tray.set_icon(Some(img));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_008_menu_is_open_then_quit() {
        assert_eq!(items(), [("tray.open", "Open Kolux"), ("tray.quit", "Quit")]);
    }

    #[test]
    fn app_008_windows_and_macos_only_and_left_click_opens_on_windows() {
        assert!(has_tray(Os::Windows, &serde_json::json!({})) && has_tray(Os::Mac, &serde_json::json!({})) && !has_tray(Os::Linux, &serde_json::json!({})));
        assert!(left_click_opens(Os::Windows) && !left_click_opens(Os::Mac));
    }

    #[test]
    fn app_008_dev_copies_show_dev_and_the_branch() {
        assert_eq!(tooltip(false, Some("lane/chrome")), "Kolux");
        assert_eq!(tooltip(true, Some("lane/chrome")), "Kolux DEV (lane/chrome)");
        assert_eq!(tooltip(true, Some("  ")), "Kolux DEV");
        assert_eq!(tooltip(true, None), "Kolux DEV");
    }

    #[test]
    fn app_008_a_dev_copy_reads_its_branch_from_the_checkouts_git_head() {
        assert_eq!(branch_from_head("ref: refs/heads/lane/tray\n"), Some("lane/tray".into()));
        assert_eq!(branch_from_head("ref: refs/heads/main"), Some("main".into()));
        // a detached checkout shows the short commit
        assert_eq!(branch_from_head("0123456789abcdef0123456789abcdef01234567\n"), Some("0123456".into()));
        assert_eq!(branch_from_head(""), None);
        assert_eq!(branch_from_head("   "), None);
        let dir = std::env::temp_dir().join(format!("kolux-app008-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // a plain checkout keeps HEAD inside its .git folder
        let plain = dir.join("plain");
        std::fs::create_dir_all(plain.join(".git")).unwrap();
        std::fs::write(plain.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(git_head_file(&plain), Some(plain.join(".git").join("HEAD")));
        // a worktree's .git is a file pointing at the main repo's worktree folder
        let wt = dir.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::create_dir_all(dir.join("repo").join(".git").join("worktrees").join("wt")).unwrap();
        std::fs::write(dir.join("repo").join(".git").join("worktrees").join("wt").join("HEAD"), "ref: refs/heads/lane/tray\n").unwrap();
        std::fs::write(wt.join(".git"), "gitdir: ../repo/.git/worktrees/wt\n").unwrap();
        let head = git_head_file(&wt).expect("a worktree's HEAD is found through its .git file");
        assert_eq!(std::fs::read_to_string(&head).map(|h| branch_from_head(&h)).unwrap(), Some("lane/tray".into()));
        // no Git at all: no branch
        let none = dir.join("none");
        std::fs::create_dir_all(&none).unwrap();
        assert_eq!(git_head_file(&none), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn app_008_the_icon_gets_an_amber_dot_and_a_dev_marker_only_when_asked() {
        let (w, h) = (32u32, 32u32);
        let base = vec![0u8; (w * h * 4) as usize];
        let px = |img: &[u8], x: u32, y: u32| -> [u8; 4] {
            let i = ((y * w + x) * 4) as usize;
            [img[i], img[i + 1], img[i + 2], img[i + 3]]
        };
        assert_eq!(paint(&base, w, h, false, false), base, "nothing asked: the icon is untouched");
        let dot = paint(&base, w, h, true, false);
        assert_eq!(dot.len(), base.len());
        assert_eq!(px(&dot, 27, 27), AMBER, "the dot sits in the bottom-right corner");
        assert_eq!(px(&dot, 0, 0), [0, 0, 0, 0], "the top-left corner is untouched by the dot");
        assert_eq!(px(&dot, 16, 16), [0, 0, 0, 0], "the middle of the icon is untouched");
        let dev = paint(&base, w, h, false, true);
        assert_eq!(px(&dev, 2, 2), DEV_MARK, "the DEV marker sits in the top-left corner");
        assert_eq!(px(&dev, 27, 27), [0, 0, 0, 0], "no dot without a ping");
        let both = paint(&base, w, h, true, true);
        assert_eq!(px(&both, 2, 2), DEV_MARK, "the DEV marker stays when the attention icon is swapped in");
        assert_eq!(px(&both, 27, 27), AMBER);
        // a tiny icon still paints without going out of bounds
        let tiny = paint(&[0u8; 16], 2, 2, true, true);
        assert_eq!(tiny.len(), 16);
    }

    #[test]
    fn app_008_only_a_released_left_click_on_windows_opens_the_window() {
        assert!(click_opens(Os::Windows, true, true));
        assert!(!click_opens(Os::Windows, true, false), "the press alone does nothing; the release opens");
        assert!(!click_opens(Os::Windows, false, true), "a right click is the menu");
        assert!(!click_opens(Os::Mac, true, true), "on macOS a click opens the menu");
        assert!(!click_opens(Os::Linux, true, true));
    }

    #[test]
    fn stat048_the_badge_text_caps_large_counts_and_zero_clears() {
        assert_eq!(badge_text(0), None);
        assert_eq!(badge_text(1), Some("1".into()));
        assert_eq!(badge_text(42), Some("42".into()));
        assert_eq!(badge_text(99), Some("99".into()));
        assert_eq!(badge_text(100), Some("99+".into()));
        assert_eq!(badge_text(u32::MAX), Some("99+".into()));
    }

    #[test]
    fn stat048_the_overlay_badge_is_an_amber_disc_with_the_count_in_white() {
        let (px, w, h) = paint_badge("2");
        assert_eq!((w, h), (BADGE_SIZE, BADGE_SIZE));
        assert_eq!(px.len(), (w * h * 4) as usize);
        let at = |img: &[u8], x: u32, y: u32| -> [u8; 4] {
            let i = ((y * w + x) * 4) as usize;
            [img[i], img[i + 1], img[i + 2], img[i + 3]]
        };
        assert_eq!(at(&px, 0, 0), [0, 0, 0, 0], "the corners stay clear: it is a disc");
        assert_eq!(at(&px, w - 1, h - 1), [0, 0, 0, 0]);
        assert_eq!(at(&px, 2, h / 2), AMBER, "the disc's edge is amber");
        assert!(px.chunks(4).any(|p| p == WHITE), "the digit is drawn in white");
        assert_ne!(paint_badge("1").0, paint_badge("2").0, "different counts look different");
        let (three, ..) = paint_badge("99+");
        assert!(three.chunks(4).any(|p| p == WHITE), "three glyphs still fit the disc");
        assert_eq!(three.len(), px.len());
    }

    #[test]
    fn app_007_the_close_to_tray_switch_is_offered_only_on_windows_with_an_icon() {
        assert!(close_switch_available(Os::Windows, true));
        assert!(!close_switch_available(Os::Windows, false), "no icon: nothing could bring the window back");
        assert!(!close_switch_available(Os::Mac, true), "closing hides the window on Windows only");
        assert!(!close_switch_available(Os::Linux, true));
        assert!(!close_switch_available(Os::Linux, false));
    }

    #[test]
    fn app_007_close_hides_only_on_windows_with_the_option_on_and_never_while_quitting() {
        use serde_json::json;
        assert!(!close_hides(Os::Windows, &json!({}), false, true), "off by default");
        assert!(close_hides(Os::Windows, &json!({ CLOSE_TO_TRAY_FIELD: true }), false, true));
        assert!(!close_hides(Os::Windows, &json!({ CLOSE_TO_TRAY_FIELD: "yes" }), false, true), "only a real true");
        assert!(!close_hides(Os::Mac, &json!({ CLOSE_TO_TRAY_FIELD: true }), false, true), "a Windows option");
        assert!(!close_hides(Os::Linux, &json!({ CLOSE_TO_TRAY_FIELD: true }), false, true));
        assert!(!close_hides(Os::Windows, &json!({ CLOSE_TO_TRAY_FIELD: true }), true, true), "a real quit is never intercepted");
    }

    #[test]
    fn app_007_fix1_close_hides_only_while_a_tray_icon_can_bring_the_window_back() {
        use serde_json::json;
        let on = json!({ CLOSE_TO_TRAY_FIELD: true });
        assert!(close_hides(Os::Windows, &on, false, true), "option on, icon present, no quit: hide");
        assert!(!close_hides(Os::Windows, &on, false, false), "option on but no tray icon (feature off, or the icon failed to install): close, or nothing could bring the window back");
        assert!(!close_hides(Os::Windows, &on, true, true), "a quit under way closes even with the option on and the icon present");
    }

    #[test]
    fn app_007_fix1_the_quit_flag_belongs_to_the_one_close_that_follows_it() {
        assert!(!take_quitting(), "nothing under way at the start");
        begin_quit();
        assert!(take_quitting(), "the close request after tray Quit or File > Exit is a quit");
        assert!(!take_quitting(), "the flag is consumed: a quit cancelled at the unsaved-changes question does not turn the next close into a quit");
    }

    #[test]
    fn app_007_fix2_tray_quit_falls_back_to_exit_only_while_its_own_flag_is_still_pending() {
        let mut q = QuitFlag::default();
        assert!(!q.fallback_due(0), "no quit under way: nothing to fall back to");
        let first = q.begin();
        assert!(q.fallback_due(first), "the page never answered the close: the fallback must end Kolux");
        assert!(q.take(), "the page's close handler consumes the flag");
        assert!(!q.fallback_due(first), "consumed (the user may be sitting at the unsaved-changes question): the fallback does nothing");
        assert!(!q.take(), "one-shot");
        let again = q.begin();
        assert_ne!(again, first, "every quit gets its own generation");
        assert!(!q.fallback_due(first), "a newer quit is never mistaken for the old one");
        assert!(q.fallback_due(again), "the newer quit's own timer still fires");
    }

    #[test]
    fn stat_047_fix2_a_ping_with_the_window_back_repaints_the_dot_off() {
        let mut d = Dot::default();
        assert_eq!(d.report(true, Ping::AgentFinished), Some(true), "hidden: the dot comes on");
        assert!(d.on);
        // the window was restored without a focus event; the next agent event finds it visible
        assert_eq!(d.report(false, Ping::AgentFinished), Some(false), "shown: the icon is repainted WITHOUT the dot");
        assert!(!d.on);
        assert_eq!(d.report(false, Ping::Bell), None, "nothing changed: no repaint");
        assert_eq!(d.report(true, Ping::Bell), Some(true), "hidden again: on");
        assert_eq!(d.report(true, Ping::UsageAlert), None, "already on: no repaint");
    }

    #[test]
    fn app_007_fix2_only_the_main_windows_close_request_is_handled() {
        assert!(handles_close_request(MAIN_LABEL));
        assert!(handles_close_request("main"));
        assert!(!handles_close_request("tower"), "the Tower window's close never hides main or consumes the quit flag");
        assert!(!handles_close_request("Main"), "labels are exact");
        assert!(!handles_close_request(""));
    }

    #[test]
    fn app_007_the_explanation_shows_once() {
        assert!(explain_due(None));
        assert!(explain_due(Some("")));
        assert!(!explain_due(Some("1")));
        assert!(!explain_due(Some("2026-10-19")));
    }

    #[test]
    fn app_008_dot_lights_only_while_hidden_and_clears_when_shown() {
        let mut d = Dot::default();
        assert!(!d.ping(Ping::AgentFinished), "a ping with the window up leaves no dot");
        assert!(!d.on);
        d.window_hidden();
        assert!(d.ping(Ping::AgentFinished));
        assert!(d.on);
        assert!(!d.ping(Ping::Bell), "a second ping changes nothing");
        d.window_shown();
        assert!(!d.on);
        d.window_hidden();
        assert!(d.ping(Ping::Bell));
    }

    #[test]
    fn stat047_a_minimised_window_takes_the_dot_and_restoring_clears_it() {
        let mut d = Dot::default();
        d.window_minimised();
        assert!(d.ping(Ping::AgentFinished) && d.on);
        d.window_shown();
        assert!(!d.on);
        assert!(!d.ping(Ping::AgentFinished), "visible again: a finish leaves no dot");
    }
    // T-300 (SET-041): the tray follows the chosen app icon, and the macOS menu bar icon has a switch.
    fn sample_icon() -> (Vec<u8>, u32, u32) {
        let (w, h) = (32u32, 32u32);
        let mut px = Vec::new();
        for i in 0..(w * h) {
            let v = (i % 251) as u8;
            px.extend_from_slice(&[v, 255 - v, v / 2, if i % 7 == 0 { 0 } else { 255 }]);
        }
        (px, w, h)
    }

    #[test]
    fn set_041_the_tray_icon_takes_the_chosen_app_icon_colours() {
        use crate::app_look::{variant, IconChoice};
        let (base, w, h) = sample_icon();
        let blue = tray_pixels(IconChoice::Blue, &base, w, h, false, false);
        assert_eq!(blue, paint(&variant(IconChoice::Blue, &base, w), w, h, false, false));
        assert_ne!(blue, paint(&base, w, h, false, false), "Blue differs from the base icon");
        let alpha = |v: &[u8]| v.chunks(4).map(|p| p[3]).collect::<Vec<_>>();
        assert_eq!(alpha(&blue), alpha(&base), "the outline is byte for byte the same");
        assert_eq!(tray_pixels(IconChoice::Classic, &base, w, h, true, true), paint(&base, w, h, true, true), "Classic is today's output");
    }

    #[test]
    fn set_041_the_dot_and_the_dev_corner_stay_on_a_blue_tray_icon() {
        use crate::app_look::IconChoice;
        let (base, w, h) = sample_icon();
        let px = |img: &[u8], x: u32, y: u32| -> [u8; 4] {
            let i = ((y * w + x) * 4) as usize;
            [img[i], img[i + 1], img[i + 2], img[i + 3]]
        };
        let img = tray_pixels(IconChoice::Blue, &base, w, h, true, true);
        assert_eq!(px(&img, 27, 27), AMBER, "the dot is still painted");
        assert_eq!(px(&img, 2, 2), DEV_MARK, "the DEV corner is still painted");
        let plain = tray_pixels(IconChoice::Blue, &base, w, h, false, false);
        assert_ne!(px(&plain, 27, 27), AMBER);
        assert_ne!(px(&plain, 2, 2), DEV_MARK);
    }

    #[test]
    fn set_041_the_macos_menu_bar_icon_is_on_unless_saved_off() {
        use serde_json::json;
        assert!(has_tray(Os::Mac, &json!({})), "absent = on");
        assert!(has_tray(Os::Mac, &json!({ MENU_BAR_ICON_FIELD: true })));
        assert!(!has_tray(Os::Mac, &json!({ MENU_BAR_ICON_FIELD: false })));
        assert!(has_tray(Os::Mac, &json!({ MENU_BAR_ICON_FIELD: "off" })), "only a real false turns it off");
        assert!(has_tray(Os::Windows, &json!({ MENU_BAR_ICON_FIELD: false })), "Windows ignores the switch");
        assert!(!has_tray(Os::Linux, &json!({ MENU_BAR_ICON_FIELD: true })), "Linux never has a tray");
    }

}
