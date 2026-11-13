// APP-014: spelling suggestions for the app's own right-click menu in text fields.
// WebView2 raises ContextMenuRequested with its default items; the enabled "spellCheck" commands are the
// suggestions. In an editable spot of the main page, once the page has said it is listening, we take them,
// hide the engine's own menu and hand the words to the page, which draws the menu in the app's style.
// Anywhere else (iframes, page not ready, read errors before the hide) the engine's menu stays.
// Other platforms have no such hook, so the page gets no suggestions there and draws the edit actions only.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg_attr(not(windows), allow(dead_code))]
pub const SUGGESTIONS_EVENT: &str = "edit-menu-suggestions";
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_SUGGESTIONS: usize = 5;

/// True once the engine hook is in place; the page leaves the engine's menu alone only then.
static HOOKED: AtomicBool = AtomicBool::new(false);
/// True while the page's menu host is mounted and listening; the engine's menu is hidden only then.
static READY: AtomicBool = AtomicBool::new(false);

/// `seq` counts the requests we handled, so the page can drop an answer that belongs to an earlier right-click.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Suggestions {
    pub words: Vec<String>,
    pub seq: u64,
}

/// One of the engine's default menu items, reduced to what the suggestion filter needs.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub label: String,
    /// A plain command (not a separator, submenu, check box or radio).
    pub command: bool,
    pub enabled: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn is_suggestion(e: &Entry) -> bool {
    e.name == "spellCheck" && e.command && e.enabled
}

/// The suggestion words among the engine's default items. Only enabled command items count, and the run
/// ends at the first separator or submenu after the first suggestion (where "Add to dictionary" sits).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn suggestion_words(items: &[Entry]) -> Vec<String> {
    items
        .iter()
        .skip_while(|e| !is_suggestion(e))
        .take_while(|e| e.command)
        .filter(|e| is_suggestion(e))
        // The label carries an ampersand where a keyboard accelerator goes; "&&" is a literal one.
        .map(|e| e.label.replace("&&", "\u{0}").replace('&', "").replace('\u{0}', "&"))
        .filter(|w| !w.trim().is_empty())
        .take(MAX_SUGGESTIONS)
        .collect()
}

/// Whether we replace the engine's menu: an editable spot of the main page, with the page listening.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn takes_over(editable: bool, main_frame: bool, ready: bool) -> bool {
    editable && main_frame && ready
}

/// The page calls this once its menu host is listening (and with false when it goes away). It returns
/// whether the engine hook is in place, i.e. whether the page should leave the engine's event to us.
#[tauri::command]
pub fn edit_menu_ready(ready: bool) -> bool {
    READY.store(ready, Ordering::Relaxed);
    HOOKED.load(Ordering::Relaxed)
}

#[cfg(windows)]
pub fn install(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(w) = app.get_webview_window("main") else { return };
    let app = app.clone();
    let _ = w.with_webview(move |pw| imp::hook(&pw.controller(), app));
}

#[cfg(not(windows))]
pub fn install(_app: &tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use super::{suggestion_words, takes_over, Entry, Suggestions, HOOKED, READY, SUGGESTIONS_EVENT};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use tauri::Emitter;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::ContextMenuRequestedEventHandler;
    use windows::core::{Interface, BOOL, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;

    static SEQ: AtomicU64 = AtomicU64::new(0);
    static LOGGED: AtomicBool = AtomicBool::new(false);

    /// SAFETY: `get` must be a WebView2 getter that writes a CoTaskMem string (or nothing).
    unsafe fn take(get: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
        let mut p = PWSTR::null();
        if get(&mut p).is_err() || p.is_null() {
            return String::new();
        }
        // SAFETY: the engine wrote a valid, nul-terminated CoTaskMem string; it is freed once.
        let s = unsafe { p.to_string() }.unwrap_or_default();
        unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
        s
    }

    /// The engine's default items; the raw kind and command id are logged once for the live proof.
    unsafe fn read_entries(args: &ICoreWebView2ContextMenuRequestedEventArgs) -> windows::core::Result<Vec<Entry>> {
        // SAFETY: plain reads from the event's objects, which live for the call.
        unsafe {
            let items = args.MenuItems()?;
            let mut count = 0u32;
            items.Count(&mut count)?;
            let mut out = Vec::new();
            let mut raw = Vec::new();
            for i in 0..count {
                let item = items.GetValueAtIndex(i)?;
                let (name, label) = (take(|p| item.Name(p)), take(|p| item.Label(p)));
                let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
                let mut enabled = BOOL(0);
                let mut id = 0i32;
                let _ = item.Kind(&mut kind);
                let _ = item.IsEnabled(&mut enabled);
                let _ = item.CommandId(&mut id);
                raw.push(format!("({name:?}, {label:?}, kind {}, enabled {}, id {id})", kind.0, enabled.as_bool()));
                out.push(Entry { name, label, command: kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND, enabled: enabled.as_bool() });
            }
            if !LOGGED.swap(true, Ordering::Relaxed) {
                eprintln!("kolux: edit menu raw items: {}", raw.join(" "));
            }
            Ok(out)
        }
    }

    pub fn hook(controller: &ICoreWebView2Controller, app: tauri::AppHandle) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        // The event needs the engine's 11th interface; an older runtime has none, so the page keeps its own menu.
        let Ok(core) = core.cast::<ICoreWebView2_11>() else { return };
        let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: plain reads from the event's objects, which live for the call.
            unsafe {
                let Ok(target) = args.ContextMenuTarget() else { return Ok(()) };
                let (mut editable, mut main_frame) = (BOOL(0), BOOL(0));
                if target.IsEditable(&mut editable).is_err() || target.IsRequestedForMainFrame(&mut main_frame).is_err() {
                    return Ok(());
                }
                if !takes_over(editable.as_bool(), main_frame.as_bool(), READY.load(Ordering::Relaxed)) {
                    return Ok(());
                }
                // Hide the engine's menu first: a failure after this point still shows exactly one menu (ours).
                if args.SetHandled(true).is_err() {
                    return Ok(());
                }
                let words = read_entries(&args).map(|e| suggestion_words(&e)).unwrap_or_default();
                let seq = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app.emit_to("main", SUGGESTIONS_EVENT, Suggestions { words, seq });
            }
            Ok(())
        }));
        let mut token = 0i64;
        // The handler lives as long as the webview, so the token is deliberately never kept for removal.
        // SAFETY: the engine keeps the handler; the token is written once.
        if unsafe { core.add_ContextMenuRequested(&handler, &mut token) }.is_ok() {
            HOOKED.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(name: &str, label: &str, command: bool, enabled: bool) -> Entry {
        Entry { name: name.into(), label: label.into(), command, enabled }
    }
    fn item(name: &str, label: &str) -> Entry {
        entry(name, label, true, true)
    }
    fn sep() -> Entry {
        entry("", "", false, true)
    }

    #[test]
    fn only_spell_check_items_become_suggestions_in_order() {
        let items = vec![item("cut", "Cu&t"), item("spellCheck", "hello"), item("spellCheck", "hallo"), item("paste", "&Paste"), item("spellCheck", "hell")];
        assert_eq!(suggestion_words(&items), vec!["hello", "hallo", "hell"]);
    }

    #[test]
    fn accelerator_ampersands_go_but_a_literal_one_stays() {
        assert_eq!(suggestion_words(&[item("spellCheck", "&and"), item("spellCheck", "R&&D")]), vec!["and", "R&D"]);
    }

    #[test]
    fn at_most_five_and_no_blank_ones() {
        let mut items: Vec<_> = (0..8).map(|i| item("spellCheck", &format!("w{i}"))).collect();
        items.insert(0, item("spellCheck", "  "));
        assert_eq!(suggestion_words(&items).len(), 5);
        assert!(suggestion_words(&[item("copy", "Copy")]).is_empty());
    }

    #[test]
    fn disabled_rows_submenus_and_separators_are_not_suggestions() {
        let items = vec![
            entry("spellCheck", "No suggestions", true, false),
            entry("spellCheck", "Spelling options", false, true),
            sep(),
            item("spellCheck", "hello"),
        ];
        assert_eq!(suggestion_words(&items), vec!["hello"]);
        assert!(suggestion_words(&items[..3]).is_empty());
    }

    #[test]
    fn the_run_stops_at_the_separator_before_add_to_dictionary() {
        let items = vec![item("spellCheck", "hello"), item("spellCheck", "hallo"), sep(), item("spellCheck", "Add to dictionary")];
        assert_eq!(suggestion_words(&items), vec!["hello", "hallo"]);
    }

    #[test]
    fn the_engine_menu_is_replaced_only_in_editable_main_frame_spots_with_the_page_ready() {
        assert!(takes_over(true, true, true));
        assert!(!takes_over(false, true, true));
        assert!(!takes_over(true, false, true), "a sandboxed iframe keeps the engine menu");
        assert!(!takes_over(true, true, false), "no page listening, no hiding");
    }

    #[test]
    fn ready_command_sets_and_clears_the_flag() {
        edit_menu_ready(true);
        assert!(READY.load(Ordering::Relaxed));
        edit_menu_ready(false);
        assert!(!READY.load(Ordering::Relaxed));
    }
}
