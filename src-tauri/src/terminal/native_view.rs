//! Native terminal (Txais, 2026-11-12; NATIVE-TERMINAL.md, option c): a pane's terminal drawn by the
//! Windows Terminal engine instead of xterm.js in the web view. Kolux keeps its own ConPTY session
//! (pty.rs and the terminal service, unchanged); this module only puts a native child window, made by
//! `Microsoft.Terminal.Control.dll` (the engine behind Windows Terminal's WPF control, MIT licensed), over
//! the pane's spot in the main window, hands it the session's output, and sends what is typed into it
//! back to the session. Behind the `terminalNative` setting, off by default until proven.
//!
//! The engine is loaded at run time, never linked: no DLL means `available` says why and the pane keeps
//! xterm. The DLL is found through `KOLUX_TERMINAL_CONTROL_DLL`, else beside the Kolux executable.
//! Spike: spikes/native-terminal (round 1) proved the calls below with our own ConPTY, resize and DPI.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// A pane's spot in the main window's client area, in physical pixels.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Kolux's look for a native view (`TerminalSetTheme`): the active terminal colours as Windows COLORREFs
/// (0x00BBGGRR, made by nativeView.ts from the same theme xterm draws with), the terminal font's first family
/// and its size in points, and the engine's cursor shape. The window's DPI is read here, not sent.
#[derive(serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    pub background: u32,
    pub foreground: u32,
    pub selection: u32,
    pub cursor_style: u32,
    pub table: [u32; 16],
    pub font: String,
    pub size: i16,
}

impl Look {
    /// Values the engine accepts: colours without stray high bits, a known cursor shape, a readable size.
    pub(crate) fn clean(mut self) -> Look {
        let rgb = |c: u32| c & 0x00FF_FFFF;
        self.background = rgb(self.background);
        self.foreground = rgb(self.foreground);
        self.selection = rgb(self.selection);
        for c in &mut self.table {
            *c = rgb(*c);
        }
        if self.cursor_style > 6 {
            self.cursor_style = 2;
        }
        self.size = self.size.clamp(4, 72);
        if self.font.trim().is_empty() {
            self.font = "Cascadia Mono".into();
        }
        self
    }
}

/// What the engine hands back minus its answers to the cursor question (ESC [ row ; col R). The pane's xterm takes
/// the same output and answers that question itself, so the engine's answer is a second one, and the console host
/// passes an answer nobody waits for on to the shell as a key: F3, which PowerShell takes as "search for the next
/// key typed" (on GitHub's windows-latest runner the first line typed into a native pane lost its first letter).
/// Typed keys never look like this: the engine sends them in win32-input-mode (ESC [ .. _), which ConPTY turns on.
pub(crate) fn without_cursor_reports(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let (mut i, mut from) = (0, 0);
    while i < b.len() {
        if b[i] == 0x1b && b.get(i + 1) == Some(&b'[') {
            let digits = |at: usize| b[at..].iter().take_while(|c| c.is_ascii_digit()).count();
            let row = digits(i + 2);
            if row > 0 && b.get(i + 2 + row) == Some(&b';') {
                let col = digits(i + 3 + row);
                if col > 0 && b.get(i + 3 + row + col) == Some(&b'R') {
                    out.push_str(&text[from..i]);
                    i += 4 + row + col;
                    from = i;
                    continue;
                }
            }
        }
        i += 1;
    }
    out.push_str(&text[from..]);
    out
}

/// Bytes held back from the previous chunk because they end mid-character. Output arrives in chunks cut
/// anywhere, but the engine takes UTF-16 text, so a character split across two chunks waits for its tail.
pub(crate) fn take_text(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_owned();
            pending.clear();
            out
        }
        Err(e) if e.error_len().is_none() => {
            // An incomplete character at the end: send what is whole, keep the tail (at most 3 bytes).
            let cut = e.valid_up_to();
            let out = String::from_utf8_lossy(&pending[..cut]).into_owned();
            pending.drain(..cut);
            out
        }
        Err(_) => {
            // A broken byte in the middle: show it as U+FFFD the way xterm does, keep nothing.
            let out = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            out
        }
    }
}

/// Which terminal each native view shows and which write slot it holds. Slot numbers are what the
/// engine's write callback (which carries no user data) is told apart by.
#[derive(Default)]
pub(crate) struct Slots {
    by_slot: Vec<Option<u32>>,
}

impl Slots {
    pub(crate) fn take(&mut self, id: u32, max: usize) -> Option<usize> {
        if let Some(i) = self.by_slot.iter().position(|s| *s == Some(id)) {
            return Some(i);
        }
        if let Some(i) = self.by_slot.iter().position(Option::is_none) {
            self.by_slot[i] = Some(id);
            return Some(i);
        }
        if self.by_slot.len() < max {
            self.by_slot.push(Some(id));
            return Some(self.by_slot.len() - 1);
        }
        None
    }
    pub(crate) fn give_back(&mut self, id: u32) {
        for s in &mut self.by_slot {
            if *s == Some(id) {
                *s = None;
            }
        }
    }
    pub(crate) fn id_at(&self, slot: usize) -> Option<u32> {
        self.by_slot.get(slot).copied().flatten()
    }
}

/// At most this many panes draw natively at once (one write callback per slot).
pub(crate) const MAX_VIEWS: usize = 16;

static SLOTS: Mutex<Slots> = Mutex::new(Slots { by_slot: Vec::new() });

#[cfg(windows)]
pub(crate) use win::{attach, available, detach, feed, has, place, seed, set_look};

#[cfg(not(windows))]
mod off {
    use super::{Look, Rect};
    pub(crate) fn set_look(_: u32, _: Look) -> Result<Option<(u16, u16)>, String> {
        Ok(None)
    }
    pub(crate) fn available() -> Result<String, String> {
        Err("the native terminal is Windows only".into())
    }
    pub(crate) fn attach(_: &tauri::AppHandle, _: &tauri::WebviewWindow, _: u32, _: Rect, _: Option<Look>) -> Result<(u16, u16), String> {
        available().map(|_| (0, 0))
    }
    pub(crate) fn place(_: u32, _: Option<Rect>) -> Result<Option<(u16, u16)>, String> {
        Ok(None)
    }
    pub(crate) fn detach(_: u32) {}
    pub(crate) fn feed(_: u32, _: &[u8], _: u64) {}
    pub(crate) fn has(_: u32) -> bool {
        false
    }
    pub(crate) fn seed(_: u32, _: impl FnOnce() -> Option<(u64, Vec<u8>)>) {}
}
#[cfg(not(windows))]
pub(crate) use off::{attach, available, detach, feed, has, place, seed, set_look};

#[cfg(windows)]
mod win {
    use super::{take_text, HashMap, Look, Mutex, OnceLock, Rect, MAX_VIEWS, SLOTS};
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use tauri::Manager;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindowVisible, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE};

    type Hwnd = *mut c_void;
    #[repr(C)]
    struct TilSize {
        x: i32,
        y: i32,
    }
    type WriteCb = unsafe extern "system" fn(*const u16);
    /// The engine's TerminalTheme as v1.25 lays it out (read from the WPF control's own struct: no selection alpha).
    #[repr(C)]
    struct TerminalTheme {
        default_background: u32,
        default_foreground: u32,
        default_selection_background: u32,
        cursor_style: u32,
        color_table: [u32; 16],
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetDpiForWindow(hwnd: Hwnd) -> u32;
    }

    /// The engine's flat C API (the same entry points the WPF control's NativeMethods.cs calls).
    type CreateFn = unsafe extern "system" fn(Hwnd, *mut Hwnd, *mut *mut c_void) -> i32;
    type SendOutputFn = unsafe extern "system" fn(*mut c_void, *const u16);
    type TriggerResizeFn = unsafe extern "system" fn(*mut c_void, i32, i32, *mut TilSize) -> i32;
    type RegisterWriteFn = unsafe extern "system" fn(*mut c_void, WriteCb);
    type DestroyFn = unsafe extern "system" fn(*mut c_void);
    // The font size is a 32-bit int in the engine (its PDB: `TerminalSetTheme(void*, _TerminalTheme, const wchar_t*,
    // int fontSize, int newDpi)`), though the WPF control declares it short. Passed as i16 its upper half was
    // whatever the register held, and the engine drew text many times too big (seen on GitHub's windows-latest).
    type SetThemeFn = unsafe extern "system" fn(*mut c_void, TerminalTheme, *const u16, i32, i32);
    type DpiChangedFn = unsafe extern "system" fn(*mut c_void, i32);
    struct Engine {
        set_theme: SetThemeFn,
        dpi_changed: DpiChangedFn,
        create: CreateFn,
        send_output: SendOutputFn,
        trigger_resize: TriggerResizeFn,
        register_write: RegisterWriteFn,
        destroy: DestroyFn,
    }

    fn dll_path() -> std::path::PathBuf {
        if let Some(p) = std::env::var_os("KOLUX_TERMINAL_CONTROL_DLL") {
            return p.into();
        }
        let exe = std::env::current_exe().unwrap_or_default();
        exe.parent().map(|d| d.join("Microsoft.Terminal.Control.dll")).unwrap_or_default()
    }

    fn engine() -> Result<&'static Engine, String> {
        static ENGINE: OnceLock<Result<Engine, String>> = OnceLock::new();
        ENGINE
            .get_or_init(|| unsafe {
                let path = dll_path();
                let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
                let module = LoadLibraryW(wide.as_ptr());
                if module.is_null() {
                    return Err(format!("the Windows Terminal engine was not found at {}", path.display()));
                }
                macro_rules! sym {
                    ($name:literal, $ty:ty) => {
                        match GetProcAddress(module, concat!($name, "\0").as_ptr()) {
                            Some(f) => std::mem::transmute::<unsafe extern "system" fn() -> isize, $ty>(f),
                            None => return Err(format!("the engine at {} has no {}", path.display(), $name)),
                        }
                    };
                }
                Ok(Engine {
                    set_theme: sym!("TerminalSetTheme", SetThemeFn),
                    dpi_changed: sym!("TerminalDpiChanged", DpiChangedFn),
                    create: sym!("CreateTerminal", CreateFn),
                    send_output: sym!("TerminalSendOutput", SendOutputFn),
                    trigger_resize: sym!("TerminalTriggerResize", TriggerResizeFn),
                    register_write: sym!("TerminalRegisterWriteCallback", RegisterWriteFn),
                    destroy: sym!("DestroyTerminal", DestroyFn),
                })
            })
            .as_ref()
            .map_err(Clone::clone)
    }

    pub(crate) fn available() -> Result<String, String> {
        engine().map(|_| dll_path().display().to_string())
    }

    struct View {
        hwnd: usize,
        term: usize,
        pending: Vec<u8>,
        /// The last spot the pane asked for, so a new look (another font size) refits the session's grid.
        rect: Option<Rect>,
        /// The DPI the engine last drew at; a move to another monitor is seen at the next placement.
        dpi: u32,
        /// Output already drawn from the session's snapshot: chunks with a count up to this are skipped.
        /// A new view drops everything until it is seeded, so nothing lands twice or out of order.
        floor: u64,
    }
    static VIEWS: OnceLock<Mutex<HashMap<u32, View>>> = OnceLock::new();
    fn views() -> &'static Mutex<HashMap<u32, View>> {
        VIEWS.get_or_init(|| Mutex::new(HashMap::new()))
    }
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    /// Typing in a native view: the engine encodes the keys (win32-input-mode, as for Windows Terminal)
    /// and hands them here; they go to the session like typing in xterm, off the UI thread because a
    /// write can block while the program is slow to read.
    fn typed(slot: usize, data: *const u16) {
        if data.is_null() {
            return;
        }
        let text = unsafe {
            let mut n = 0;
            while *data.add(n) != 0 {
                n += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(data, n))
        };
        let text = super::without_cursor_reports(&text);
        if text.is_empty() {
            return;
        }
        let Some(id) = super::SLOTS.lock().ok().and_then(|s| s.id_at(slot)) else { return };
        let Some(app) = APP.get().cloned() else { return };
        std::thread::spawn(move || {
            let _ = app.state::<super::super::Terminals>().write(id, &text);
        });
    }
    macro_rules! slot_fns {
        ($($n:literal),*) => { [$({ unsafe extern "system" fn f(d: *const u16) { typed($n, d) } f as WriteCb }),*] };
    }
    static WRITE_FNS: [WriteCb; MAX_VIEWS] = slot_fns!(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);

    fn on_main<T: Send + 'static>(app: &tauri::AppHandle, job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = tx.send(job());
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }

    /// Moves, sizes and shows the view, then fits the session to the grid the engine chose.
    fn fit(id: u32, hwnd: usize, term: usize, r: Rect) -> Result<(u16, u16), String> {
        let e = engine()?;
        // The window moved to a monitor with another scale: the engine re-lays its font for it before the grid is read.
        let dpi = unsafe { GetDpiForWindow(hwnd as Hwnd) };
        let moved = views().lock().ok().and_then(|mut v| {
            let view = v.get_mut(&id)?;
            view.rect = Some(r);
            let changed = dpi != 0 && view.dpi != 0 && view.dpi != dpi;
            if dpi != 0 {
                view.dpi = dpi;
            }
            Some(changed)
        });
        if moved == Some(true) {
            unsafe { (e.dpi_changed)(term as *mut c_void, dpi as i32) };
        }
        let mut dims = TilSize { x: 0, y: 0 };
        // TerminalTriggerResize sizes the engine's window with SetWindowPos(.., 0, 0, w, h, 0), which also moves it to
        // the parent's top-left corner (seen live, round 3: the pane drew over the sidebar). So it runs first and the
        // window is put on the pane's spot after it.
        unsafe {
            (e.trigger_resize)(term as *mut c_void, r.w.max(1), r.h.max(1), &mut dims);
            SetWindowPos(hwnd as Hwnd, HWND_TOP, r.x, r.y, r.w.max(1), r.h.max(1), SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
        let (cols, rows) = (dims.x.clamp(1, u16::MAX as i32) as u16, dims.y.clamp(1, u16::MAX as i32) as u16);
        if let Some(app) = APP.get() {
            let _ = app.state::<super::super::Terminals>().resize(id, cols, rows);
        }
        Ok((cols, rows))
    }

    /// Hands the engine Kolux's colours, font and the window's DPI. On the main thread, as the WPF control does.
    fn apply(app: &tauri::AppHandle, hwnd: usize, term: usize, look: Look) -> Result<u32, String> {
        let e = engine()?;
        on_main(app, move || unsafe {
            let dpi = match GetDpiForWindow(hwnd as Hwnd) {
                0 => 96,
                d => d,
            };
            let font: Vec<u16> = look.font.encode_utf16().chain([0]).collect();
            let theme = TerminalTheme {
                default_background: look.background,
                default_foreground: look.foreground,
                default_selection_background: look.selection,
                cursor_style: look.cursor_style,
                color_table: look.table,
            };
            (e.set_theme)(term as *mut c_void, theme, font.as_ptr(), i32::from(look.size), dpi as i32);
            dpi
        })
    }

    /// A new Kolux look for a live view (theme switched, font changed): drawn at once, and the session refitted
    /// when the cell size changed the grid.
    pub(crate) fn set_look(id: u32, look: Look) -> Result<Option<(u16, u16)>, String> {
        let Some(app) = APP.get() else { return Ok(None) };
        let Some((hwnd, term, rect)) = views().lock().map_err(|e| e.to_string())?.get(&id).map(|v| (v.hwnd, v.term, v.rect)) else { return Ok(None) };
        let dpi = apply(app, hwnd, term, look.clean())?;
        if let Some(v) = views().lock().map_err(|e| e.to_string())?.get_mut(&id) {
            v.dpi = dpi;
        }
        match rect {
            Some(r) if unsafe { IsWindowVisible(hwnd as Hwnd) } != 0 => fit(id, hwnd, term, r).map(Some),
            _ => Ok(None),
        }
    }

    pub(crate) fn attach(app: &tauri::AppHandle, window: &tauri::WebviewWindow, id: u32, r: Rect, look: Option<Look>) -> Result<(u16, u16), String> {
        let e = engine()?;
        let _ = APP.set(app.clone());
        if let Some((hwnd, term)) = views().lock().map_err(|e| e.to_string())?.get(&id).map(|v| (v.hwnd, v.term)) {
            if let Some(look) = look {
                apply(app, hwnd, term, look.clean())?;
            }
            return fit(id, hwnd, term, r);
        }
        let slot = SLOTS.lock().map_err(|e| e.to_string())?.take(id, MAX_VIEWS).ok_or("too many native terminal panes are open")?;
        let parent = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let made = on_main(app, move || unsafe {
            let mut hwnd: Hwnd = std::ptr::null_mut();
            let mut term: *mut c_void = std::ptr::null_mut();
            let hr = (e.create)(parent as Hwnd, &mut hwnd, &mut term);
            if hr < 0 || term.is_null() {
                return Err(format!("the engine could not make a terminal (0x{hr:08X})"));
            }
            (e.register_write)(term, WRITE_FNS[slot]);
            Ok((hwnd as usize, term as usize))
        })
        .and_then(|r| r);
        let (hwnd, term) = match made {
            Ok(v) => v,
            Err(err) => {
                SLOTS.lock().map_err(|e| e.to_string())?.give_back(id);
                return Err(err);
            }
        };
        // Kolux's look goes on before the first placement, so the pane never shows the engine's own colours.
        let dpi = match look {
            Some(look) => apply(app, hwnd, term, look.clean()).unwrap_or(0),
            None => 0,
        };
        views().lock().map_err(|e| e.to_string())?.insert(id, View { hwnd, term, pending: Vec::new(), rect: None, dpi, floor: u64::MAX });
        fit(id, hwnd, term, r)
    }

    /// Moves the view to `r`, or hides it (another tab, a closed card, a modal over the pane) for `None`.
    pub(crate) fn place(id: u32, r: Option<Rect>) -> Result<Option<(u16, u16)>, String> {
        let Some((hwnd, term)) = views().lock().map_err(|e| e.to_string())?.get(&id).map(|v| (v.hwnd, v.term)) else { return Ok(None) };
        match r {
            Some(r) => fit(id, hwnd, term, r).map(Some),
            None => {
                unsafe { ShowWindow(hwnd as Hwnd, SW_HIDE) };
                Ok(None)
            }
        }
    }

    pub(crate) fn detach(id: u32) {
        let gone = views().lock().ok().and_then(|mut v| v.remove(&id));
        if let Ok(mut s) = SLOTS.lock() {
            s.give_back(id);
        }
        let (Some(v), Ok(e), Some(app)) = (gone, engine(), APP.get()) else { return };
        // DestroyTerminal destroys the HWND, which only its own (main) thread may do.
        let _ = app.run_on_main_thread(move || unsafe { (e.destroy)(v.term as *mut c_void) });
    }

    /// Is terminal `id` drawn by a native view that already has its first picture?
    pub(crate) fn has(id: u32) -> bool {
        VIEWS.get().and_then(|m| m.lock().ok().map(|m| m.get(&id).is_some_and(|v| v.floor != u64::MAX))).unwrap_or(false)
    }

    /// A new view's first picture: the session's recent output (`snap` gives its count and bytes), so the
    /// prompt printed before the switch shows at once instead of a blank pane until the next output.
    /// Taken under the view lock, so no chunk is drawn both here and by `feed`.
    pub(crate) fn seed(id: u32, snap: impl FnOnce() -> Option<(u64, Vec<u8>)>) {
        let Some(map) = VIEWS.get() else { return };
        let Ok(mut map) = map.lock() else { return };
        let Some(v) = map.get_mut(&id) else { return };
        let (seq, bytes) = snap().unwrap_or((0, Vec::new()));
        v.floor = seq;
        v.pending.clear();
        let text = take_text(&mut v.pending, &bytes);
        if text.is_empty() {
            return;
        }
        let wide: Vec<u16> = text.encode_utf16().chain([0]).collect();
        if let Ok(e) = engine() {
            unsafe { (e.send_output)(v.term as *mut c_void, wide.as_ptr()) };
        }
    }

    /// Output for terminal `id` (`seq`: its output count after this chunk): drawn by its native view, if it has one.
    pub(crate) fn feed(id: u32, data: &[u8], seq: u64) {
        let Some(map) = VIEWS.get() else { return };
        let Ok(mut map) = map.lock() else { return };
        let Some(v) = map.get_mut(&id) else { return };
        if seq <= v.floor {
            return;
        }
        let text = take_text(&mut v.pending, data);
        if text.is_empty() {
            return;
        }
        let wide: Vec<u16> = text.encode_utf16().chain([0]).collect();
        if let Ok(e) = engine() {
            unsafe { (e.send_output)(v.term as *mut c_void, wide.as_ptr()) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_engines_cursor_answers_stay_out_of_the_session_and_keys_go_through() {
        assert_eq!(without_cursor_reports("\x1b[1;1R"), "");
        assert_eq!(without_cursor_reports("\x1b[12;80R\x1b[3;4R"), "");
        assert_eq!(without_cursor_reports("a\x1b[1;1Rb"), "ab");
        // win32-input-mode keys (G down, G up) and other sequences are left alone.
        let keys = "\x1b[71;34;71;1;8;1_\x1b[71;34;71;0;8;1_";
        assert_eq!(without_cursor_reports(keys), keys);
        assert_eq!(without_cursor_reports("\x1b[I\x1b[?1;2c\x1b[1R\x1b[;1R"), "\x1b[I\x1b[?1;2c\x1b[1R\x1b[;1R");
        assert_eq!(without_cursor_reports("dir\r"), "dir\r");
    }

    #[test]
    fn a_character_split_across_chunks_waits_for_its_tail() {
        let mut p = Vec::new();
        let rocket = "🚀".as_bytes();
        assert_eq!(take_text(&mut p, &[b'a', rocket[0], rocket[1]]), "a");
        assert_eq!(p.len(), 2);
        assert_eq!(take_text(&mut p, &rocket[2..]), "🚀");
        assert!(p.is_empty());
    }

    #[test]
    fn a_broken_byte_shows_as_a_replacement_and_nothing_is_held() {
        let mut p = Vec::new();
        assert_eq!(take_text(&mut p, b"x\xffy"), "x\u{fffd}y");
        assert!(p.is_empty());
    }

    #[test]
    fn a_look_is_cleaned_to_what_the_engine_accepts() {
        let look = Look { background: 0xFF11_2233, foreground: 0x00CC_CCCC, selection: 0x8000_0000, cursor_style: 9, table: [0xFFFF_FFFF; 16], font: " ".into(), size: 400 }.clean();
        assert_eq!(look.background, 0x0011_2233);
        assert_eq!(look.selection, 0);
        assert_eq!(look.table, [0x00FF_FFFF; 16]);
        assert_eq!(look.cursor_style, 2);
        assert_eq!(look.font, "Cascadia Mono");
        assert_eq!(look.size, 72);
    }

    #[test]
    fn a_look_reads_the_camel_case_fields_the_pane_sends() {
        let v = serde_json::json!({ "background": 1, "foreground": 2, "selection": 3, "cursorStyle": 6, "table": vec![0u32; 16], "font": "Cascadia Mono", "size": 10 });
        let look: Look = serde_json::from_value(v).expect("look");
        assert_eq!(look.cursor_style, 6);
        assert_eq!(look.size, 10);
    }

    #[test]
    fn slots_are_reused_and_capped() {
        let mut s = Slots::default();
        assert_eq!(s.take(7, 2), Some(0));
        assert_eq!(s.take(7, 2), Some(0));
        assert_eq!(s.take(8, 2), Some(1));
        assert_eq!(s.take(9, 2), None);
        s.give_back(7);
        assert_eq!(s.id_at(0), None);
        assert_eq!(s.take(9, 2), Some(0));
        assert_eq!(s.id_at(0), Some(9));
    }
}
