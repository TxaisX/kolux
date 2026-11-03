//! APP-009 / T-248-a: the native menu bar (File, Edit, View, Window, Help; the app menu in place of
//! File on macOS). The page owns the truth: every time the screen, the chrome switches or a shortcut
//! change, it sends `menu_sync` the state it shows and the menu is rebuilt from it, so the ticks and
//! the accelerators always agree with Settings (SET-020, SET-009). On Windows and Linux the menu
//! opens from the Kolux mark (`menu_popup`); on macOS it is the app menu bar. A click on an item either acts
//! here (reload, developer tools, full screen, minimise, maximise, exit) or comes back
//! to the page as a `menu-action` event carrying the item id, which is the keymap action id where
//! one exists (`app.settings`, `sidebar.left.toggle`, ...), so the page runs the same code as the
//! shortcut. T-248-b: the Help items, the native-accelerator list the Shortcuts page judges clashes
//! against (SET-010) and the main window's navigation guard (APP-015, `navigation`).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// The page event a menu click becomes when the page, not this file, carries it out.
pub const EVENT: &str = "menu-action";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Windows,
    Mac,
    Linux,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(target_os = "windows") {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// What the page shows right now; the menu is a picture of it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MenuState {
    /// "agents", "board", "terminals", "tower", "floor" or "space" (SCREENS; UX lane C added Space so it is reachable outside the palette); any other screen leaves every item unticked.
    pub screen: String,
    pub status_bar_visible: bool,
    pub tasks_button: bool,
    pub automations_button: bool,
    pub title_bar_app_name: bool,
    /// The Classic look has no screen switcher, so View drops Workspace View (T-049-b).
    pub classic: bool,
    /// Menu item id -> accelerator text in the menu's own spelling ("CmdOrCtrl+Comma").
    pub accelerators: HashMap<String, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stock {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Maximize,
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
}

impl Stock {
    /// The chord macOS gives this stock item, in the keymap's spelling, and the name the Shortcuts
    /// page uses for it (SET-010: a chord that collides with a native menu accelerator is a clash).
    pub fn chord(self) -> Option<(&'static str, &'static str)> {
        Some(match self {
            Stock::Undo => ("Mod+Z", "Undo"),
            Stock::Redo => ("Mod+Shift+Z", "Redo"),
            Stock::Cut => ("Mod+X", "Cut"),
            Stock::Copy => ("Mod+C", "Copy"),
            Stock::Paste => ("Mod+V", "Paste"),
            Stock::SelectAll => ("Mod+A", "Select All"),
            Stock::Minimize => ("Mod+M", "Minimize"),
            Stock::Hide => ("Mod+H", "Hide Kolux"),
            Stock::HideOthers => ("Mod+Alt+H", "Hide Others"),
            Stock::Quit => ("Mod+Q", "Quit Kolux"),
            Stock::Maximize | Stock::About | Stock::Services | Stock::ShowAll => return None,
        })
    }
}

/// A chord the system menu owns, for the Shortcuts page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NativeChord {
    pub chord: &'static str,
    pub name: &'static str,
}

/// What `menu_sync` hands back: every accelerator the menu items hold, and the chords of the stock
/// items the system menu owns. Only a platform with an attached menu bar (macOS) has any: the
/// popup menu of Windows and Linux never catches a key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Synced {
    pub accelerators: Vec<String>,
    pub native: Vec<NativeChord>,
}

/// Every stock item in `nodes` that owns a chord.
pub fn native_chords(os: Os, nodes: &[Node]) -> Vec<NativeChord> {
    fn walk(nodes: &[Node], out: &mut Vec<NativeChord>) {
        for n in nodes {
            match n {
                Node::Stock(s) => out.extend(s.chord().map(|(chord, name)| NativeChord { chord, name })),
                Node::Sub { items, .. } => walk(items, out),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    if attaches_bar(os) {
        walk(nodes, &mut out);
    }
    out
}

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Item { id: &'static str, label: &'static str, accel: Option<String> },
    Check { id: &'static str, label: &'static str, checked: bool, accel: Option<String> },
    Stock(Stock),
    Sep,
    Sub { label: &'static str, items: Vec<Node> },
}

/// The screens the View menu picks between (T-054): the switcher's four in its cycle order (VIEW-002), then Floor,
/// which has no sidebar item and is reached from the palette and this menu (VIEW-013, DT-08; T-610). None of the five
/// carries a chord (DT-C68): the page sends no accelerator under these ids (chromeItems.ts MENU_SHORTCUT_IDS).
pub const SCREENS: [(&str, &str, &str); 6] = [("screen.agents", "Agents", "agents"), ("screen.board", "Board", "board"), ("screen.terminals", "Terminals", "terminals"), ("screen.tower", "Tower", "tower"), ("screen.floor", "Floor", "floor"), ("screen.space", "Space", "space")];

/// The whole menu bar for one platform and one page state.
pub fn spec(os: Os, s: &MenuState) -> Vec<Node> {
    let acc = |id: &str| s.accelerators.get(id).filter(|a| !a.is_empty()).cloned();
    let item = |id: &'static str, label: &'static str| Node::Item { id, label, accel: acc(id) };
    let check = |id: &'static str, label: &'static str, checked: bool| Node::Check { id, label, checked, accel: acc(id) };
    let mut bar = Vec::new();
    if os == Os::Mac {
        bar.push(Node::Sub {
            label: "Kolux",
            items: vec![
                Node::Stock(Stock::About),
                item("help.checkUpdates", "Check for Updates..."),
                Node::Sep,
                item("app.settings", "Settings..."),
                Node::Sep,
                Node::Stock(Stock::Services),
                Node::Sep,
                Node::Stock(Stock::Hide),
                Node::Stock(Stock::HideOthers),
                Node::Stock(Stock::ShowAll),
                Node::Sep,
                Node::Stock(Stock::Quit),
            ],
        });
    } else {
        bar.push(Node::Sub { label: "File", items: vec![item("app.settings", "Settings..."), Node::Sep, item("file.exit", "Exit")] });
    }
    // Windows' stock Edit items replay Ctrl+key into whatever has focus, so in a terminal Copy with
    // no selection would send Ctrl+C to the agent. There the page carries out edit.* with its
    // terminal-aware copy, paste and select-all; macOS keeps the stock items.
    let edit = if os == Os::Mac {
        vec![Node::Stock(Stock::Undo), Node::Stock(Stock::Redo), Node::Sep, Node::Stock(Stock::Cut), Node::Stock(Stock::Copy), Node::Stock(Stock::Paste), Node::Stock(Stock::SelectAll)]
    } else {
        vec![item("edit.undo", "Undo"), item("edit.redo", "Redo"), Node::Sep, item("edit.cut", "Cut"), item("edit.copy", "Copy"), item("edit.paste", "Paste"), item("edit.selectAll", "Select All")]
    };
    bar.push(Node::Sub { label: "Edit", items: edit });
    let screens = SCREENS.iter().map(|(id, label, screen)| check(id, label, s.screen == *screen)).collect();
    bar.push(Node::Sub {
        label: "View",
        items: [if s.classic { vec![] } else { vec![Node::Sub { label: "Workspace View", items: screens }] }, vec![Node::Sub {
                label: "Appearance",
                items: vec![
                    item("sidebar.left.toggle", "Toggle Left Sidebar"),
                    item("sidebar.right.toggle", "Toggle Right Sidebar"),
                    Node::Sep,
                    check("set.statusBarVisible", "Show Status Bar", s.status_bar_visible),
                    check("set.tasksButton", "Show Tasks Button", s.tasks_button),
                    check("set.automationsButton", "Show Automations Button", s.automations_button),
                    check("set.titleBarAppName", "Show Titlebar App Name", s.title_bar_app_name),
                ],
            }],
            // One reload, carried out by the page so unsaved editor text is asked about first (keys/commands.ts
            // forceReload); Developer Tools only where they open (a debug build).
            vec![Node::Sep, item("app.forceReload", "Force Reload")],
            if cfg!(debug_assertions) { vec![item("view.devtools", "Toggle Developer Tools")] } else { vec![] },
            vec![Node::Sep,
            item("zoom.reset", "Actual Size"),
            item("zoom.in", "Zoom In"),
            item("zoom.out", "Zoom Out"),
            Node::Sep,
            item("view.fullscreen", "Toggle Full Screen")],
        ]
        .concat(),
    });
    bar.push(Node::Sub { label: "Window", items: vec![Node::Stock(Stock::Minimize), Node::Stock(Stock::Maximize)] });
    // APP-009: Help holds Explore Kolux, Getting Started and Report Crash (the crash report card, T-183) everywhere;
    // About and Check for Updates sit here on Windows and Linux, and in the app menu on macOS.
    let mut help = vec![item("help.explore", "Explore Kolux"), item("help.gettingStarted", "Getting Started"), item("help.reportCrash", "Report Crash")];
    if os != Os::Mac {
        // VIEW-106: About is the app's own panel (Safe Graphics Mode, GPU status), opened by the page; macOS keeps the stock About in its app menu.
        help.extend([Node::Sep, item("help.about", "About Kolux RS"), item("help.checkUpdates", "Check for Updates")]);
    }
    bar.push(Node::Sub { label: "Help", items: help });
    bar
}

/// Where a click goes: carried out here, or handed to the page.
#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    DevTools,
    FullScreen,
    Exit,
    Page(String),
}

/// zoom.* goes to the page, which keeps the one saved interface zoom (SET-019).
pub fn route(id: &str) -> Route {
    match id {
        "view.devtools" => Route::DevTools,
        "view.fullscreen" => Route::FullScreen,
        "file.exit" => Route::Exit,
        other => Route::Page(other.to_string()),
    }
}

/// Every accelerator the menu holds (`menu_sync` hands it to the page).
pub fn accelerators(nodes: &[Node]) -> Vec<String> {
    let mut out = Vec::new();
    for n in nodes {
        match n {
            Node::Item { accel: Some(a), .. } | Node::Check { accel: Some(a), .. } => out.push(a.clone()),
            Node::Sub { items, .. } => out.extend(accelerators(items)),
            _ => {}
        }
    }
    out
}

/// APP-015: what the main window does when something tries to move it to an address.
// ponytail: only the tools.rs hunk (evidence/chrome-T-248-b-tools.rs.patch) calls these; until the
// coordinator lands it the non-test build has no caller, so dead_code is allowed. Drop the attribute
// with the hunk.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Nav {
    /// The app's own page (or its dev server): the window goes there.
    Allow,
    /// A web or mail address: the window stays and the default browser opens it.
    External,
    /// Anything else (a file on some host, a data address, a script): nothing happens.
    Block,
}

/// The one origin the app's own pages are served from on this platform (never a list of several).
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Own {
    /// `tauri://localhost`: macOS and Linux.
    Tauri,
    /// `http://tauri.localhost`: Windows, the window config's default (no `useHttpsScheme`).
    Http,
    /// `https://tauri.localhost`: Windows with `useHttpsScheme` set in the window config.
    Https,
}

impl Own {
    /// `https` is the window config's `use_https_scheme`; it only changes Windows.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn for_platform(os: Os, https: bool) -> Own {
        match (os, https) {
            (Os::Windows, true) => Own::Https,
            (Os::Windows, false) => Own::Http,
            _ => Own::Tauri,
        }
    }

    fn scheme_host(self) -> (&'static str, &'static str) {
        match self {
            Own::Tauri => ("tauri", "localhost"),
            Own::Http => ("http", "tauri.localhost"),
            Own::Https => ("https", "tauri.localhost"),
        }
    }
}

/// Decides one navigation of the main window. `own` is the platform's real origin and `dev` the dev
/// server's address (a debug build passes it, a release build `None`). Only that exact scheme and host
/// are the app: the other platforms' forms of the app's origin are outside addresses here (a web
/// address goes to the browser, `tauri://` elsewhere is dropped), because an allowed page gets the
/// app's command access. The host and port are compared as parsed (case folded, no userinfo, no port,
/// no trailing dot, look-alike letters stay different), and `about:blank` is dropped like any other
/// non-web address.
#[cfg_attr(not(test), allow(dead_code))]
pub fn navigation(url: &tauri::Url, own: Own, dev: Option<&tauri::Url>) -> Nav {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let plain = url.username().is_empty() && url.password().is_none();
    let (own_scheme, own_host) = own.scheme_host();
    if url.scheme() == own_scheme && plain && url.port().is_none() && host == own_host {
        return Nav::Allow;
    }
    match url.scheme() {
        "http" | "https" => {
            let dev_server = plain
                && dev.is_some_and(|d| d.scheme() == url.scheme() && d.host_str().map(str::to_ascii_lowercase).as_deref() == Some(host.as_str()) && d.port_or_known_default() == url.port_or_known_default());
            if dev_server {
                Nav::Allow
            } else {
                Nav::External
            }
        }
        "mailto" => Nav::External,
        _ => Nav::Block,
    }
}

/// Decides one request to open a new window (`target=_blank`, `window.open`): a web or mail address
/// opens in the default browser (`External`, the same path as a navigation), everything else is denied
/// (`Block`). The app's own pages never open a second window, so this never answers `Allow`.
#[cfg_attr(not(test), allow(dead_code))]
pub fn new_window(url: &tauri::Url, own: Own, dev: Option<&tauri::Url>) -> Nav {
    match navigation(url, own, dev) {
        Nav::External => Nav::External,
        Nav::Allow | Nav::Block => Nav::Block,
    }
}

fn last() -> &'static Mutex<Option<MenuState>> {
    static LAST: OnceLock<Mutex<Option<MenuState>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

/// The window the menu was last opened in; clicks go back to it.
fn popped() -> &'static Mutex<String> {
    static POPPED: OnceLock<Mutex<String>> = OnceLock::new();
    POPPED.get_or_init(|| Mutex::new("main".into()))
}

/// Windows and Linux draw no native menu bar on Kolux's frameless window (the bar is attached but
/// never painted, and its accelerators would catch keys such as Ctrl+C before a terminal sees
/// them), so there the menu opens from the Kolux mark in the title bar and the page keeps every
/// shortcut. macOS keeps its always-present app menu bar.
pub fn attaches_bar(os: Os) -> bool {
    os == Os::Mac
}

use tauri::menu::{AboutMetadata, CheckMenuItemBuilder, IsMenuItem, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};

enum Built<R: Runtime> {
    Normal(tauri::menu::MenuItem<R>),
    Check(tauri::menu::CheckMenuItem<R>),
    Pre(PredefinedMenuItem<R>),
    Sub(Submenu<R>),
}

impl<R: Runtime> Built<R> {
    fn as_item(&self) -> &dyn IsMenuItem<R> {
        match self {
            Built::Normal(i) => i,
            Built::Check(i) => i,
            Built::Pre(i) => i,
            Built::Sub(i) => i,
        }
    }
}

fn build_node<R: Runtime, M: Manager<R>>(app: &M, n: &Node) -> tauri::Result<Built<R>> {
    Ok(match n {
        Node::Item { id, label, accel } => {
            let b = MenuItemBuilder::with_id(*id, *label);
            Built::Normal(match accel { Some(a) => b.accelerator(a), None => b }.build(app)?)
        }
        Node::Check { id, label, checked, accel } => {
            let b = CheckMenuItemBuilder::with_id(*id, *label).checked(*checked);
            Built::Check(match accel { Some(a) => b.accelerator(a), None => b }.build(app)?)
        }
        Node::Sep => Built::Pre(PredefinedMenuItem::separator(app)?),
        Node::Stock(s) => Built::Pre(match s {
            Stock::Undo => PredefinedMenuItem::undo(app, None)?,
            Stock::Redo => PredefinedMenuItem::redo(app, None)?,
            Stock::Cut => PredefinedMenuItem::cut(app, None)?,
            Stock::Copy => PredefinedMenuItem::copy(app, None)?,
            Stock::Paste => PredefinedMenuItem::paste(app, None)?,
            Stock::SelectAll => PredefinedMenuItem::select_all(app, None)?,
            Stock::Minimize => PredefinedMenuItem::minimize(app, None)?,
            Stock::Maximize => PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            Stock::About => {
                let info = app.package_info();
                let meta = AboutMetadata { name: Some("Kolux".into()), version: Some(info.version.to_string()), ..Default::default() };
                PredefinedMenuItem::about(app, Some("About Kolux"), Some(meta))?
            }
            Stock::Services => PredefinedMenuItem::services(app, None)?,
            Stock::Hide => PredefinedMenuItem::hide(app, None)?,
            Stock::HideOthers => PredefinedMenuItem::hide_others(app, None)?,
            Stock::ShowAll => PredefinedMenuItem::show_all(app, None)?,
            Stock::Quit => PredefinedMenuItem::quit(app, None)?,
        }),
        Node::Sub { label, items } => {
            let built = items.iter().map(|i| build_node(app, i)).collect::<tauri::Result<Vec<_>>>()?;
            let refs: Vec<&dyn IsMenuItem<R>> = built.iter().map(|b| b.as_item()).collect();
            Built::Sub(SubmenuBuilder::new(app, *label).items(&refs).build()?)
        }
    })
}

fn build_menu<R: Runtime, M: Manager<R>>(app: &M, nodes: &[Node]) -> tauri::Result<Menu<R>> {
    let built = nodes.iter().map(|n| build_node(app, n)).collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn IsMenuItem<R>> = built.iter().map(|b| b.as_item()).collect();
    Menu::with_items(app, &refs)
}

fn on_click<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    let label = popped().lock().unwrap_or_else(|e| e.into_inner()).clone();
    let Some(view) = app.get_webview_window(&label) else { return };
    match route(id) {
        Route::DevTools => {
            #[cfg(debug_assertions)]
            if view.is_devtools_open() {
                view.close_devtools();
            } else {
                view.open_devtools();
            }
        }
        Route::FullScreen => drop(view.set_fullscreen(!view.is_fullscreen().unwrap_or(false))),
        // The same path as the window's close button, so quitting stops every pane (ACCT-051); the quit flag
        // keeps close-to-tray (APP-007) from hiding the window instead, so the unsaved-changes question is asked.
        Route::Exit => {
            crate::tray::begin_quit();
            drop(view.close())
        }
        Route::Page(id) => drop(view.emit_to(view.label(), EVENT, serde_json::json!({ "id": id }))),
    }
}

fn listen_once<R: Runtime>(app: &tauri::AppHandle<R>) {
    static ON: OnceLock<()> = OnceLock::new();
    if ON.set(()).is_ok() {
        app.on_menu_event(|app, e| on_click(app, e.id().as_ref()));
    }
}

/// The page's menu state changed: keep it for the next time the menu opens (and on macOS rebuild
/// the app menu bar when it differs from the last one). Returns every accelerator the menu holds
/// and the chords its stock items own, which the Shortcuts page counts as clashes (SET-010).
#[tauri::command]
pub fn menu_sync<R: Runtime>(window: WebviewWindow<R>, state: MenuState) -> Result<Synced, String> {
    let os = Os::current();
    let nodes = spec(os, &state);
    let synced = Synced { accelerators: accelerators(&nodes), native: native_chords(os, &nodes) };
    let mut last = last().lock().unwrap_or_else(|e| e.into_inner());
    if last.as_ref() == Some(&state) {
        return Ok(synced);
    }
    listen_once(window.app_handle());
    if attaches_bar(os) {
        let menu = build_menu(&window, &nodes).map_err(|e| e.to_string())?;
        window.app_handle().set_menu(menu).map_err(|e| e.to_string())?;
    }
    *last = Some(state);
    Ok(synced)
}

/// Opens the whole menu (File, Edit, View, Window, Help) under the Kolux mark at (x, y), in the
/// window's own logical pixels. Its items show the in-app shortcuts as hints.
#[tauri::command]
pub fn menu_popup<R: Runtime>(window: WebviewWindow<R>, x: f64, y: f64) -> Result<(), String> {
    let state = last().lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default();
    let menu = build_menu(&window, &spec(Os::current(), &state)).map_err(|e| e.to_string())?;
    listen_once(window.app_handle());
    *popped().lock().unwrap_or_else(|e| e.into_inner()) = window.label().to_string();
    window.popup_menu_at(&menu, tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(nodes: &[Node]) -> Vec<&'static str> {
        nodes.iter().filter_map(|n| if let Node::Sub { label, .. } = n { Some(*label) } else { None }).collect()
    }
    fn sub<'a>(nodes: &'a [Node], label: &str) -> &'a [Node] {
        nodes.iter().find_map(|n| match n { Node::Sub { label: l, items } if *l == label => Some(items.as_slice()), _ => None }).unwrap_or_else(|| panic!("no {label} menu"))
    }
    fn ids(nodes: &[Node]) -> Vec<&'static str> {
        nodes.iter().filter_map(|n| match n { Node::Item { id, .. } | Node::Check { id, .. } => Some(*id), _ => None }).collect()
    }
    fn ticked(nodes: &[Node]) -> Vec<&'static str> {
        nodes.iter().filter_map(|n| match n { Node::Check { id, checked: true, .. } => Some(*id), _ => None }).collect()
    }
    fn state(screen: &str) -> MenuState {
        MenuState { screen: screen.into(), status_bar_visible: true, tasks_button: true, automations_button: false, title_bar_app_name: false, classic: false, accelerators: HashMap::new() }
    }

    #[test]
    fn app_009_windows_has_file_edit_view_window_help() {
        let bar = spec(Os::Windows, &state("terminals"));
        assert_eq!(labels(&bar), ["File", "Edit", "View", "Window", "Help"]);
        assert_eq!(ids(sub(&bar, "File")), ["app.settings", "file.exit"]);
        assert_eq!(sub(&bar, "Window"), [Node::Stock(Stock::Minimize), Node::Stock(Stock::Maximize)]);
        // Linux gets the same bar as Windows.
        assert_eq!(spec(Os::Linux, &state("terminals")), bar);
    }

    #[test]
    fn app_009_macos_app_menu_replaces_file_and_runs_hide_hide_others_show_all_in_order() {
        let bar = spec(Os::Mac, &state("terminals"));
        assert_eq!(labels(&bar), ["Kolux", "Edit", "View", "Window", "Help"]);
        let app = sub(&bar, "Kolux");
        assert_eq!(ids(app), ["help.checkUpdates", "app.settings"]);
        let stock: Vec<Stock> = app.iter().filter_map(|n| if let Node::Stock(s) = n { Some(*s) } else { None }).collect();
        assert_eq!(stock, [Stock::About, Stock::Services, Stock::Hide, Stock::HideOthers, Stock::ShowAll, Stock::Quit]);
    }

    #[test]
    fn app_009_macos_edit_is_stock_and_windows_linux_edit_goes_to_the_page_never_as_a_key_press() {
        let edit: Vec<Stock> = sub(&spec(Os::Mac, &state("agents")), "Edit").iter().filter_map(|n| if let Node::Stock(s) = n { Some(*s) } else { None }).collect();
        assert_eq!(edit, [Stock::Undo, Stock::Redo, Stock::Cut, Stock::Copy, Stock::Paste, Stock::SelectAll]);
        for os in [Os::Windows, Os::Linux] {
            let bar = spec(os, &state("agents"));
            let edit = sub(&bar, "Edit");
            assert!(!edit.iter().any(|n| matches!(n, Node::Stock(_))), "{os:?} must not replay Ctrl+key");
            assert_eq!(ids(edit), ["edit.undo", "edit.redo", "edit.cut", "edit.copy", "edit.paste", "edit.selectAll"]);
            for id in ids(edit) {
                assert_eq!(route(id), Route::Page(id.into()));
            }
        }
    }

    #[test]
    fn t049b_classic_drops_workspace_view_and_switching_the_look_rebuilds_the_menu() {
        let mut s = state("terminals");
        let new_look = spec(Os::Windows, &s);
        s.classic = true;
        let classic = spec(Os::Windows, &s);
        assert_ne!(classic, new_look);
        assert_eq!(labels(sub(&classic, "View")), ["Appearance"]);
        assert_eq!(labels(sub(&new_look, "View")), ["Workspace View", "Appearance"]);
    }

    #[test]
    fn t054_view_menu_ticks_exactly_the_current_screen_and_none_for_other_screens() {
        // T-610 / DT-08: the switcher's four and Floor; the Inbox (behind the bell) and the sidebar's screens tick nothing.
        for (screen, want) in [("agents", vec!["screen.agents"]), ("board", vec!["screen.board"]), ("terminals", vec!["screen.terminals"]), ("tower", vec!["screen.tower"]), ("floor", vec!["screen.floor"]), ("space", vec!["screen.space"]), ("inbox", vec![]), ("skills", vec![])] {
            let bar = spec(Os::Windows, &state(screen));
            let views = sub(sub(&bar, "View"), "Workspace View");
            assert_eq!(ids(views), ["screen.agents", "screen.board", "screen.terminals", "screen.tower", "screen.floor", "screen.space"]);
            assert_eq!(ticked(views), want, "screen {screen}");
        }
    }

    #[test]
    fn set_020_appearance_ticks_agree_with_each_settings_switch() {
        let mut s = state("terminals");
        let bar = spec(Os::Windows, &s);
        let look = sub(sub(&bar, "View"), "Appearance");
        assert_eq!(ids(look), ["sidebar.left.toggle", "sidebar.right.toggle", "set.statusBarVisible", "set.tasksButton", "set.automationsButton", "set.titleBarAppName"]);
        assert_eq!(ticked(look), ["set.statusBarVisible", "set.tasksButton"]);
        // Flipping the Automations button and hiding the status bar rebuild a different menu.
        s.automations_button = true;
        s.status_bar_visible = false;
        let again = spec(Os::Windows, &s);
        assert_ne!(again, bar);
        assert_eq!(ticked(sub(sub(&again, "View"), "Appearance")), ["set.tasksButton", "set.automationsButton"]);
    }

    #[test]
    fn set_009_a_changed_shortcut_shows_as_the_new_accelerator_and_an_empty_one_shows_none() {
        let mut s = state("terminals");
        s.accelerators.insert("app.settings".into(), "CmdOrCtrl+Comma".into());
        s.accelerators.insert("zoom.in".into(), "CmdOrCtrl+=".into());
        let file = spec(Os::Windows, &s);
        assert_eq!(sub(&file, "File")[0], Node::Item { id: "app.settings", label: "Settings...", accel: Some("CmdOrCtrl+Comma".into()) });
        s.accelerators.insert("app.settings".into(), "CmdOrCtrl+Shift+P".into());
        s.accelerators.insert("zoom.in".into(), String::new());
        let bar = spec(Os::Windows, &s);
        assert_eq!(sub(&bar, "File")[0], Node::Item { id: "app.settings", label: "Settings...", accel: Some("CmdOrCtrl+Shift+P".into()) });
        assert_eq!(accelerators(&bar), ["CmdOrCtrl+Shift+P"]);
    }

    #[test]
    fn set_019_menu_zoom_goes_to_the_page_so_the_saved_interface_zoom_stays_the_only_one() {
        for id in ["zoom.in", "zoom.out", "zoom.reset"] {
            assert_eq!(route(id), Route::Page(id.into()));
        }
    }

    #[test]
    fn app_009_native_items_act_here_and_the_rest_go_to_the_page_by_keymap_id() {
        assert_eq!(route("view.devtools"), Route::DevTools);
        assert_eq!(route("view.fullscreen"), Route::FullScreen);
        assert_eq!(route("file.exit"), Route::Exit);
        for id in ["app.settings", "app.forceReload", "screen.board", "sidebar.left.toggle", "set.tasksButton", "help.checkUpdates", "help.reportCrash"] {
            assert_eq!(route(id), Route::Page(id.into()));
        }
    }

    #[test]
    fn app_009_only_macos_attaches_a_native_bar_the_frameless_window_opens_it_from_the_mark() {
        assert!(attaches_bar(Os::Mac));
        assert!(!attaches_bar(Os::Windows) && !attaches_bar(Os::Linux));
    }

    #[test]
    fn app_009_help_holds_the_two_page_items_everywhere_and_about_and_updates_on_windows_and_linux() {
        for os in [Os::Windows, Os::Linux] {
            let bar = spec(os, &state("terminals"));
            let help = sub(&bar, "Help");
            assert_eq!(ids(help), ["help.explore", "help.gettingStarted", "help.reportCrash", "help.about", "help.checkUpdates"], "{os:?}");
            assert!(!help.contains(&Node::Stock(Stock::About)), "VIEW-106: the page draws About, not the stock dialog");
        }
        // macOS: About and Check for Updates are in the app menu, Help keeps the two page items.
        let mac = spec(Os::Mac, &state("terminals"));
        assert_eq!(ids(sub(&mac, "Help")), ["help.explore", "help.gettingStarted", "help.reportCrash"]);
        assert_eq!(sub(&mac, "Kolux")[0], Node::Stock(Stock::About));
    }

    #[test]
    fn app_009_help_clicks_go_to_the_page_by_item_id() {
        for id in ["help.reportCrash", "help.explore", "help.gettingStarted", "help.checkUpdates"] {
            assert_eq!(route(id), Route::Page(id.into()));
        }
    }

    #[test]
    fn set_010_only_a_macos_menu_bar_owns_chords_and_they_are_the_stock_items() {
        let s = state("terminals");
        for os in [Os::Windows, Os::Linux] {
            assert!(native_chords(os, &spec(os, &s)).is_empty(), "{os:?} popup menu catches no key");
        }
        let native = native_chords(Os::Mac, &spec(Os::Mac, &s));
        let chords: Vec<&str> = native.iter().map(|n| n.chord).collect();
        assert_eq!(chords, ["Mod+H", "Mod+Alt+H", "Mod+Q", "Mod+Z", "Mod+Shift+Z", "Mod+X", "Mod+C", "Mod+V", "Mod+A", "Mod+M"]);
        assert!(native.iter().any(|n| n.chord == "Mod+Q" && n.name == "Quit Kolux"));
        // Items the system gives no chord (About, Services, Show All, Zoom) are left out.
        assert_eq!(Stock::About.chord(), None);
        assert_eq!(Stock::Maximize.chord(), None);
    }

    #[test]
    fn set_010_the_synced_answer_serialises_for_the_page() {
        let native = native_chords(Os::Mac, &spec(Os::Mac, &state("agents")));
        let synced = Synced { accelerators: vec!["CmdOrCtrl+Comma".into()], native };
        let v = serde_json::to_value(&synced).unwrap();
        assert_eq!(v["accelerators"][0], "CmdOrCtrl+Comma");
        assert_eq!(v["native"][2], serde_json::json!({ "chord": "Mod+Q", "name": "Quit Kolux" }));
    }

    fn nav_with(os: Os, https: bool, url: &str, dev: Option<&str>) -> Nav {
        let dev = dev.map(|d| tauri::Url::parse(d).unwrap());
        navigation(&tauri::Url::parse(url).unwrap(), Own::for_platform(os, https), dev.as_ref())
    }

    fn nav(os: Os, url: &str) -> Nav {
        nav_with(os, false, url, None)
    }

    fn nav_dev(url: &str, dev: &str) -> Nav {
        nav_with(Os::Windows, false, url, Some(dev))
    }

    fn pop_up(os: Os, url: &str) -> Nav {
        new_window(&tauri::Url::parse(url).unwrap(), Own::for_platform(os, false), None)
    }

    #[test]
    fn app_015_the_origin_follows_the_platform_and_the_window_config() {
        assert_eq!(Own::for_platform(Os::Windows, false), Own::Http, "tauri.conf.json sets no useHttpsScheme, so Windows serves http");
        assert_eq!(Own::for_platform(Os::Windows, true), Own::Https);
        assert_eq!(Own::for_platform(Os::Mac, false), Own::Tauri);
        assert_eq!(Own::for_platform(Os::Mac, true), Own::Tauri, "the https flag only changes Windows");
        assert_eq!(Own::for_platform(Os::Linux, true), Own::Tauri);
    }

    #[test]
    fn app_015_each_platform_loads_only_the_origin_it_really_serves() {
        // Windows (no useHttpsScheme): exactly http://tauri.localhost.
        for own in ["http://tauri.localhost/", "http://tauri.localhost/index.html", "http://tauri.localhost/settings?x=1#y"] {
            assert_eq!(nav(Os::Windows, own), Nav::Allow, "{own}");
        }
        assert_eq!(nav(Os::Windows, "https://tauri.localhost/"), Nav::External, "https would reach whatever listens on the loopback address");
        assert_eq!(nav(Os::Windows, "tauri://localhost/"), Nav::Block, "an unregistered scheme on Windows");
        // Windows with useHttpsScheme: exactly https://tauri.localhost.
        assert_eq!(nav_with(Os::Windows, true, "https://tauri.localhost/", None), Nav::Allow);
        assert_eq!(nav_with(Os::Windows, true, "http://tauri.localhost/", None), Nav::External);
        assert_eq!(nav_with(Os::Windows, true, "tauri://localhost/", None), Nav::Block);
        // macOS and Linux: exactly tauri://localhost.
        for os in [Os::Mac, Os::Linux] {
            assert_eq!(nav(os, "tauri://localhost/"), Nav::Allow, "{os:?}");
            assert_eq!(nav(os, "tauri://localhost/index.html"), Nav::Allow, "{os:?}");
            assert_eq!(nav(os, "http://tauri.localhost/"), Nav::External, "{os:?}");
            assert_eq!(nav(os, "https://tauri.localhost/"), Nav::External, "{os:?}");
        }
    }

    #[test]
    fn app_015_a_web_address_goes_to_the_browser_and_nothing_else_loads_in_the_window() {
        for os in [Os::Windows, Os::Mac, Os::Linux] {
            for web in ["https://example.com/", "http://example.com:8080/x", "mailto:someone@example.com"] {
                assert_eq!(nav(os, web), Nav::External, "{os:?} {web}");
            }
            // about:blank would blank the app window, so it is dropped like any other non-web address.
            for bad in ["about:blank", "about:srcdoc", "file://server/share/page.html", "file:///C:/Windows/win.ini", "data:text/html,<script>1</script>", "javascript:alert(1)", "blob:https://tauri.localhost/1234", "ftp://example.com/x", "ms-msdt:/id", "kolux://x"] {
                assert_eq!(nav(os, bad), Nav::Block, "{os:?} {bad}");
            }
        }
    }

    #[test]
    fn app_015_addresses_dressed_up_as_the_apps_own_pages_never_match() {
        // The host is what is parsed, not what the text starts with.
        assert_eq!(nav(Os::Windows, "http://tauri.localhost@evil.example/"), Nav::External);
        assert_eq!(nav(Os::Windows, "http://tauri.localhost:9999/"), Nav::External);
        assert_eq!(nav(Os::Windows, "http://tauri.localhost.evil.example/"), Nav::External);
        assert_eq!(nav(Os::Windows, "http://user:pw@tauri.localhost/"), Nav::External);
        assert_eq!(nav(Os::Mac, "tauri://localhost.evil.example/"), Nav::Block);
        assert_eq!(nav(Os::Mac, "tauri://evil/"), Nav::Block);
        assert_eq!(nav(Os::Mac, "tauri://user@localhost/"), Nav::Block);
        assert_eq!(nav(Os::Mac, "tauri://localhost:9999/"), Nav::Block);
    }

    #[test]
    fn app_015_case_trailing_dot_idn_and_percent_encoding_resolve_the_way_the_parser_does() {
        // Host case never matters.
        assert_eq!(nav(Os::Windows, "http://TAURI.LOCALHOST/"), Nav::Allow);
        assert_eq!(nav(Os::Windows, "HTTP://Tauri.Localhost/"), Nav::Allow);
        assert_eq!(nav(Os::Mac, "tauri://LOCALHOST/"), Nav::Allow);
        assert_eq!(nav(Os::Linux, "TAURI://localhost/"), Nav::Allow);
        // A trailing dot is a different host (the DNS root form), so it is an outside address.
        assert_eq!(nav(Os::Windows, "http://tauri.localhost./"), Nav::External);
        assert_eq!(nav(Os::Mac, "tauri://localhost./"), Nav::Block);
        // Look-alike letters (Cyrillic a and o, fullwidth dot) are other hosts.
        assert_eq!(nav(Os::Windows, "http://t\u{430}uri.localhost/"), Nav::External);
        assert_eq!(nav(Os::Windows, "http://tauri.l\u{43e}calhost/"), Nav::External);
        assert_eq!(nav(Os::Windows, "http://tauri\u{ff0e}localhost.evil.example/"), Nav::External);
        assert_eq!(nav(Os::Mac, "tauri://l\u{43e}calhost/"), Nav::Block);
        // A percent-encoded dot decodes to the real host in a web address (so Allow is correct), and
        // an encoded letter in the opaque tauri host stays encoded, so it is not the app.
        assert_eq!(nav(Os::Windows, "http://tauri%2Elocalhost/"), Nav::Allow);
        assert_eq!(nav(Os::Mac, "tauri://local%68ost/"), Nav::Block);
    }

    #[test]
    fn app_015_only_a_debug_build_allows_its_own_dev_server_and_only_that_host_and_port() {
        let dev = "http://localhost:1441";
        assert_eq!(nav_dev("http://localhost:1441/", dev), Nav::Allow);
        assert_eq!(nav_dev("http://localhost:1441/some/page?x=1", dev), Nav::Allow);
        assert_eq!(nav_dev("http://localhost:3000/", dev), Nav::External);
        assert_eq!(nav_dev("https://localhost:1441/", dev), Nav::External);
        assert_eq!(nav_dev("http://127.0.0.1:1441/", dev), Nav::External);
        assert_eq!(nav_dev("http://localhost:1441@evil.example/", dev), Nav::External);
        // A release build passes no dev server, so the same address is an outside one.
        assert_eq!(nav(Os::Windows, "http://localhost:1441/"), Nav::External);
    }

    #[test]
    fn app_015_a_new_window_request_opens_web_and_mail_addresses_in_the_browser_and_denies_the_rest() {
        for os in [Os::Windows, Os::Mac, Os::Linux] {
            for web in ["https://example.com/", "http://example.com/x", "mailto:someone@example.com"] {
                assert_eq!(pop_up(os, web), Nav::External, "{os:?} {web}");
            }
            // The app's own page never opens a second app window, and nothing else opens at all.
            for own in ["tauri://localhost/", "http://tauri.localhost/", "https://tauri.localhost/"] {
                assert_ne!(pop_up(os, own), Nav::Allow, "{os:?} {own}");
            }
            for bad in ["about:blank", "file:///C:/x.html", "data:text/html,1", "javascript:alert(1)", "blob:https://example.com/1", "ftp://example.com/x", "ms-msdt:/id"] {
                assert_eq!(pop_up(os, bad), Nav::Block, "{os:?} {bad}");
            }
        }
        assert_eq!(pop_up(Os::Windows, "http://tauri.localhost/"), Nav::Block);
        assert_eq!(pop_up(Os::Mac, "tauri://localhost/"), Nav::Block);
        // The dev server is the app too in a debug build.
        let dev = tauri::Url::parse("http://localhost:1441").unwrap();
        assert_eq!(new_window(&tauri::Url::parse("http://localhost:1441/").unwrap(), Own::Http, Some(&dev)), Nav::Block);
    }

    #[test]
    fn ux_c_one_reload_through_the_page_and_devtools_only_in_a_debug_build() {
        for os in [Os::Windows, Os::Mac, Os::Linux] {
            let bar = spec(os, &state("terminals"));
            let view = ids(sub(&bar, "View"));
            assert_eq!(view.iter().filter(|i| i.contains("eload")).collect::<Vec<_>>(), [&"app.forceReload"], "{os:?}");
            assert_eq!(view.contains(&"view.devtools"), cfg!(debug_assertions), "{os:?}");
            assert!(ids(sub(&bar, "Help")).contains(&"help.reportCrash"), "{os:?}");
        }
        // The page asks about unsaved editor text before it reloads, so the click is never a native reload.
        assert_eq!(route("app.forceReload"), Route::Page("app.forceReload".into()));
    }

    #[test]
    fn menu_state_reads_the_pages_camel_case_and_tolerates_missing_fields() {
        let s: MenuState = serde_json::from_value(serde_json::json!({ "screen": "board", "statusBarVisible": true, "accelerators": { "app.settings": "CmdOrCtrl+Comma" } })).unwrap();
        assert_eq!(s.screen, "board");
        assert!(s.status_bar_visible && !s.tasks_button);
        assert_eq!(s.accelerators["app.settings"], "CmdOrCtrl+Comma");
    }
}
