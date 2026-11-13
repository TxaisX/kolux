//! SET-034: the Notifications page's test button and its link to the system's own notification
//! settings. The page chooses the sound: a tone Kolux plays itself (the toast is then silent so only
//! one sound plays), the system's default sound, or silence when the volume is 0. STAT-043: the same
//! choice covers the real notifications (`show`), and a custom sound file is read here after its
//! type is checked.

use serde_json::{json, Value};

/// `reg query` output for PushNotifications\ToastEnabled: Windows' "Get notifications from apps"
/// switch. Only an explicit 0 counts as off; a missing value means the switch was never touched.
pub fn toasts_off(reg_output: &str) -> bool {
    reg_output.lines().any(|l| l.contains("ToastEnabled") && l.split_whitespace().last() == Some("0x0"))
}

/// Has the user switched app notifications off for the whole system?
fn blocked() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications", "/v", "ToastEnabled"])
            .creation_flags(crate::winproc::no_window()) // CREATE_NO_WINDOW
            .output();
        out.map(|o| toasts_off(&String::from_utf8_lossy(&o.stdout))).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// STAT-043: one desktop notification. `sound` true lets the system's default sound play with it;
/// false keeps the toast silent (Kolux plays its own tone or file, or the volume is 0). An agent's
/// notification also pings the tray (APP-008 / STAT-047): the dot lights while the window is out of
/// sight, whether or not the toast itself gets through.
pub fn show(app: &tauri::AppHandle, title: String, body: String, sound: bool) -> Result<(), String> {
    crate::tray::ping(app, crate::tray::Ping::AgentFinished);
    show_plain(app, title, body, sound)
}

/// STAT-044: how many event ids (with the pane each was raised for) are remembered; the oldest go
/// first, so a burst never grows the memory.
pub const TARGETS_MAX: usize = 64;

/// The events already shown, newest last, each with the pane that raised it.
#[derive(Default)]
pub struct Targets(std::collections::VecDeque<(String, Option<String>)>);

impl Targets {
    /// Remembers the event; false when this id was already shown (the same event never appears twice).
    pub fn record(&mut self, id: &str, pane: Option<&str>) -> bool {
        if self.0.iter().any(|(i, _)| i == id) {
            return false;
        }
        self.0.push_back((id.to_string(), pane.map(str::to_string)));
        while self.0.len() > TARGETS_MAX {
            self.0.pop_front();
        }
        true
    }
    /// The pane a shown notification was raised for.
    pub fn pane(&self, id: &str) -> Option<String> {
        self.0.iter().find(|(i, _)| i == id).and_then(|(_, p)| p.clone())
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.0.len()
    }
}

fn targets() -> &'static std::sync::Mutex<Targets> {
    static T: std::sync::OnceLock<std::sync::Mutex<Targets>> = std::sync::OnceLock::new();
    T.get_or_init(|| std::sync::Mutex::new(Targets::default()))
}

/// STAT-044 / STAT-047: one agent event's notification. `id` is the event's fixed identity (a repeat
/// is dropped here as well as in the page), `pane` the pane that raised it (what a click focuses),
/// `kind` "bell" for a terminal bell. The tray dot lights before the toast, so a blocked toast still
/// marks the hidden window.
#[tauri::command]
pub fn notify_event(app: tauri::AppHandle, title: String, body: String, sound: Option<bool>, id: String, pane: Option<String>, kind: Option<String>) -> Result<Value, String> {
    let fresh = targets().lock().map(|mut t| t.record(&id, pane.as_deref())).unwrap_or(true);
    if !fresh {
        return Ok(json!({ "shown": false, "duplicate": true }));
    }
    let ping = if kind.as_deref() == Some("bell") { crate::tray::Ping::Bell } else { crate::tray::Ping::AgentFinished };
    crate::tray::ping(&app, ping);
    show_for_event(&app, title, body, sound.unwrap_or(true), &id)?;
    Ok(json!({ "shown": true, "duplicate": false }))
}

/// STAT-044: a notification was clicked: the window comes forward and the page is told which pane
/// to focus (`notification-click`, payload `{ pane }`). The answer is that pane, or nothing when the
/// event is unknown. The system's toast activation is what calls this once a backend reports it
/// (T-125-b); the model and the page side are in place.
#[tauri::command]
pub fn notification_clicked(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let pane = targets().lock().ok().and_then(|t| t.pane(&id));
    crate::tray::open_window(&app);
    if let Some(p) = &pane {
        let _ = tauri::Emitter::emit(&app, "notification-click", json!({ "pane": p }));
    }
    Ok(pane)
}

/// The key inside a toast's data that carries the event id back on a click.
const EVENT_KEY: &str = "eventId";

/// STAT-044 (row 168): the event a click on a toast belongs to; any other action, or a toast
/// that carries no event, answers none.
pub fn clicked_event(performed: &tauri_plugin_notification::ActionPerformed) -> Option<String> {
    if performed.action_id() != "tap" {
        return None;
    }
    performed.notification()?.extra().get(EVENT_KEY)?.as_str().map(String::from)
}

/// STAT-044 (row 168): once at start, a click on a system toast brings the window forward and
/// tells the page which pane raised it. Windows reports a click only while the toast is on screen.
pub fn watch_clicks(app: &tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let handle = app.clone();
    let _ = app.notification().on_action(move |performed| {
        if let Some(id) = clicked_event(performed) {
            let _ = notification_clicked(handle.clone(), id);
        }
    });
}

/// The toast alone, for the Notifications page's test button: no tray dot.
pub(crate) fn show_plain(app: &tauri::AppHandle, title: String, body: String, sound: bool) -> Result<(), String> {
    toast(app, title, body, sound, None)
}

/// An agent event's toast: a click on it reports `event` back (`watch_clicks`).
fn show_for_event(app: &tauri::AppHandle, title: String, body: String, sound: bool, event: &str) -> Result<(), String> {
    toast(app, title, body, sound, Some(event))
}

fn toast(app: &tauri::AppHandle, title: String, body: String, sound: bool, event: Option<&str>) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let mut n = app.notification().builder().title(title).body(body);
    if let Some(id) = event {
        n = n.extra(EVENT_KEY, id);
    }
    if sound {
        n = n.sound("Default");
    }
    n.show().map_err(|e| e.to_string())
}

/// The audio types a custom sound may be, with the byte check each one must pass.
const SOUND_TYPES: [&str; 8] = ["wav", "mp3", "ogg", "oga", "opus", "m4a", "aac", "flac"];
/// A custom sound is a short alert; anything bigger than this is not one.
const SOUND_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// STAT-043: does this file name's type, and the file's first bytes, say it is an allowed audio file?
pub fn sound_file_ok(name: &str, head: &[u8]) -> Result<(), String> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    if !SOUND_TYPES.contains(&ext.as_str()) {
        return Err(format!("not an allowed sound type; use one of: {}", SOUND_TYPES.join(", ")));
    }
    let sync = head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0; // an MPEG or AAC frame
    let ok = match ext.as_str() {
        "wav" => head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WAVE",
        "mp3" => head.starts_with(b"ID3") || sync,
        "aac" => sync || head.starts_with(b"ID3"),
        "ogg" | "oga" | "opus" => head.starts_with(b"OggS"),
        "flac" => head.starts_with(b"fLaC"),
        "m4a" => head.len() >= 8 && &head[4..8] == b"ftyp",
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(format!("the file does not look like a .{ext} sound"))
    }
}

/// STAT-043: the bytes of the user's custom sound file (base64), after the type and size checks.
/// The page decodes and plays it; nothing else is ever read through this command.
#[tauri::command]
pub fn notification_sound_load(path: String) -> Result<String, String> {
    use base64::Engine;
    use std::io::Read;
    let f = std::fs::File::open(&path).map_err(|e| format!("the sound file cannot be opened: {e}"))?;
    let meta = f.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("that is not a file".into());
    }
    if meta.len() > SOUND_MAX_BYTES {
        return Err("the sound file is larger than 10 MB".into());
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    f.take(SOUND_MAX_BYTES).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    sound_file_ok(&path, &bytes[..bytes.len().min(16)])?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Shows the sample notification. `sound` false makes the toast silent (Kolux's own tone plays, or
/// the volume is 0); true lets the system's default sound play with it.
#[tauri::command]
pub fn notification_test(app: tauri::AppHandle, sound: bool) -> Result<Value, String> {
    if blocked() {
        return Ok(json!({ "shown": false, "blocked": true }));
    }
    show_plain(&app, "Kolux".into(), "This is how a notification from Kolux looks and sounds.".into(), sound)?;
    Ok(json!({ "shown": true, "blocked": false }))
}

/// Opens the system's notification settings (a fixed address, never one from the page).
#[tauri::command]
pub fn open_notification_settings() -> Result<(), String> {
    #[cfg(windows)]
    let run = crate::winproc::command("explorer.exe").arg("ms-settings:notifications").spawn();
    #[cfg(target_os = "macos")]
    let run = crate::winproc::command("open").arg("x-apple.systempreferences:com.apple.preference.notifications").spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let run: std::io::Result<std::process::Child> = Err(std::io::Error::other("this system's notification settings cannot be opened from Kolux"));
    run.map(|_| ()).map_err(|e| e.to_string())
}

/// VIEW-111: the store key that says the first-run welcome notification has been answered.
pub const WELCOME_KEY: &str = "notifications.welcomeAnswered";
/// How long the system may take to show the welcome before it counts as unanswered.
const WELCOME_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

/// VIEW-111: what the first start does about notification permission.
#[derive(Debug, PartialEq)]
pub enum Welcome {
    /// Not a Mac: nothing is shown and nothing is probed.
    Unsupported,
    /// A Mac that has never answered: show the one welcome notification.
    Ask,
    /// Answered on an earlier start: never asked again.
    Answered,
}

pub fn welcome_step(macos: bool, saved: Option<&str>) -> Welcome {
    if !macos {
        Welcome::Unsupported
    } else if saved.is_some() {
        Welcome::Answered
    } else {
        Welcome::Ask
    }
}

/// VIEW-111: called once at start. On a Mac that has not answered, shows one welcome notification;
/// the system asks for permission when it first shows one. The answer is recorded only when the
/// system shows it in time, so a start where it does not may ask again later.
pub fn first_run_welcome(app: &tauri::AppHandle) {
    use tauri::Manager;
    watch_clicks(app);
    let Some(store) = app.try_state::<std::sync::Mutex<crate::state::Store>>() else { return };
    let saved = store.lock().ok().and_then(|s| s.get(WELCOME_KEY).ok().flatten());
    if welcome_step(cfg!(target_os = "macos"), saved.as_deref()) != Welcome::Ask {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        use tauri_plugin_notification::NotificationExt;
        let (tx, rx) = std::sync::mpsc::channel();
        let shower = app.clone();
        std::thread::spawn(move || {
            let shown = shower.notification().builder().title("Kolux").body("Kolux will tell you here when an agent needs you or finishes.").show().is_ok();
            let _ = tx.send(shown);
        });
        if rx.recv_timeout(WELCOME_WAIT) == Ok(true) {
            if let Some(store) = app.try_state::<std::sync::Mutex<crate::state::Store>>() {
                if let Ok(s) = store.lock() {
                    let _ = s.set(WELCOME_KEY, "1");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{sound_file_ok, toasts_off};

    #[test]
    fn stat043_a_custom_sound_must_be_an_allowed_audio_type_and_look_like_one() {
        let wav = b"RIFF\x24\x00\x00\x00WAVEfmt ";
        assert!(sound_file_ok("C:\\sounds\\Ding.WAV", wav).is_ok());
        assert!(sound_file_ok("a.mp3", b"ID3\x04\x00").is_ok());
        assert!(sound_file_ok("a.mp3", &[0xFF, 0xFB, 0x90]).is_ok());
        assert!(sound_file_ok("a.ogg", b"OggS\x00").is_ok());
        assert!(sound_file_ok("a.flac", b"fLaC\x00").is_ok());
        assert!(sound_file_ok("a.m4a", b"\x00\x00\x00\x18ftypM4A ").is_ok());
        // a disallowed type, no type, a renamed file and an empty read are all refused
        assert!(sound_file_ok("a.exe", wav).is_err());
        assert!(sound_file_ok("noext", wav).is_err());
        assert!(sound_file_ok("a.wav", b"MZ\x90\x00").is_err());
        assert!(sound_file_ok("a.mp3", b"").is_err());
        assert!(sound_file_ok("a.flac", wav).is_err());
    }

    #[test]
    fn stat043_the_load_command_refuses_a_missing_file_a_folder_and_a_wrong_type() {
        let dir = std::env::temp_dir().join(format!("kolux-stat043-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let good = dir.join("ding.wav");
        std::fs::write(&good, b"RIFF\x04\x00\x00\x00WAVEdata").unwrap();
        let bad = dir.join("evil.wav");
        std::fs::write(&bad, b"MZ not audio").unwrap();
        let txt = dir.join("note.txt");
        std::fs::write(&txt, b"RIFF....WAVE").unwrap();
        assert!(super::notification_sound_load(good.to_string_lossy().into()).is_ok());
        assert!(super::notification_sound_load(bad.to_string_lossy().into()).is_err());
        assert!(super::notification_sound_load(txt.to_string_lossy().into()).is_err());
        assert!(super::notification_sound_load(dir.join("gone.wav").to_string_lossy().into()).is_err());
        assert!(super::notification_sound_load(dir.to_string_lossy().into()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn view111_only_a_mac_that_never_answered_is_asked_once() {
        use super::{welcome_step, Welcome};
        assert_eq!(welcome_step(true, None), Welcome::Ask);
        assert_eq!(welcome_step(true, Some("1")), Welcome::Answered);
        assert_eq!(welcome_step(false, None), Welcome::Unsupported);
        assert_eq!(welcome_step(false, Some("1")), Welcome::Unsupported);
    }

    #[test]
    fn stat044_each_event_id_is_remembered_once_with_its_pane_and_the_memory_is_bounded() {
        use super::{Targets, TARGETS_MAX};
        let mut t = Targets::default();
        assert!(t.record("a:1", Some("p1")));
        assert!(!t.record("a:1", Some("p1")), "the same event never shows twice");
        assert_eq!(t.pane("a:1"), Some("p1".into()));
        assert_eq!(t.pane("nope"), None);
        for i in 0..(TARGETS_MAX * 2) {
            assert!(t.record(&format!("b:{i}"), Some("px")));
        }
        assert!(t.len() <= TARGETS_MAX, "a burst never grows the memory past its cap");
        assert_eq!(t.pane("a:1"), None, "the oldest are dropped first");
        assert_eq!(t.pane(&format!("b:{}", TARGETS_MAX * 2 - 1)), Some("px".into()), "the newest are kept");
        assert!(t.record("a:1", None), "an id dropped from memory may show again");
        assert_eq!(t.pane("a:1"), None, "an event without a pane has nothing to focus");
    }

    #[test]
    fn stat044_a_clicked_toast_names_its_event_and_no_other_action_does() {
        use super::{clicked_event, EVENT_KEY};
        let performed = |action: &str, extra: serde_json::Value| -> tauri_plugin_notification::ActionPerformed {
            serde_json::from_value(serde_json::json!({ "actionId": action, "notification": { "id": 1, "extra": extra } })).unwrap()
        };
        assert_eq!(clicked_event(&performed("tap", serde_json::json!({ EVENT_KEY: "done:7" }))), Some("done:7".into()));
        assert_eq!(clicked_event(&performed("dismiss", serde_json::json!({ EVENT_KEY: "done:7" }))), None, "only a click counts");
        assert_eq!(clicked_event(&performed("tap", serde_json::json!({}))), None, "a toast with no event (the test button) focuses nothing");
        let bare: tauri_plugin_notification::ActionPerformed = serde_json::from_value(serde_json::json!({ "actionId": "tap" })).unwrap();
        assert_eq!(clicked_event(&bare), None, "a click whose toast cannot be read is ignored");
    }

    #[test]
    fn only_an_explicit_zero_turns_app_notifications_off() {
        let off = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\r\n    ToastEnabled    REG_DWORD    0x0\r\n";
        assert!(toasts_off(off));
        assert!(!toasts_off(&off.replace("0x0", "0x1")));
        assert!(!toasts_off("ERROR: The system was unable to find the specified registry key or value."));
    }
}
