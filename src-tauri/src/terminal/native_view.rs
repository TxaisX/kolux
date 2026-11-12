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
pub(crate) use win::{attach, available, detach, feed, place};

#[cfg(not(windows))]
mod off {
    use super::Rect;
    pub(crate) fn available() -> Result<String, String> {
        Err("the native terminal is Windows only".into())
    }
    pub(crate) fn attach(_: &tauri::AppHandle, _: &tauri::WebviewWindow, _: u32, _: Rect) -> Result<(u16, u16), String> {
        available().map(|_| (0, 0))
    }
    pub(crate) fn place(_: u32, _: Option<Rect>) -> Result<Option<(u16, u16)>, String> {
        Ok(None)
    }
    pub(crate) fn detach(_: u32) {}
    pub(crate) fn feed(_: u32, _: &[u8]) {}
}
#[cfg(not(windows))]
pub(crate) use off::{attach, available, detach, feed, place};

#[cfg(windows)]
mod win {
    use super::{take_text, Rect, HashMap, Mutex, OnceLock, MAX_VIEWS, SLOTS};
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use tauri::Manager;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE};

    type Hwnd = *mut c_void;
    #[repr(C)]
    struct TilSize {
        x: i32,
        y: i32,
    }
    type WriteCb = unsafe extern "system" fn(*const u16);

    /// The engine's flat C API (the same entry points the WPF control's NativeMethods.cs calls).
    type CreateFn = unsafe extern "system" fn(Hwnd, *mut Hwnd, *mut *mut c_void) -> i32;
    type SendOutputFn = unsafe extern "system" fn(*mut c_void, *const u16);
    type TriggerResizeFn = unsafe extern "system" fn(*mut c_void, i32, i32, *mut TilSize) -> i32;
    type RegisterWriteFn = unsafe extern "system" fn(*mut c_void, WriteCb);
    type DestroyFn = unsafe extern "system" fn(*mut c_void);
    struct Engine {
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
        let mut dims = TilSize { x: 0, y: 0 };
        unsafe {
            SetWindowPos(hwnd as Hwnd, HWND_TOP, r.x, r.y, r.w.max(1), r.h.max(1), SWP_NOACTIVATE | SWP_SHOWWINDOW);
            (e.trigger_resize)(term as *mut c_void, r.w.max(1), r.h.max(1), &mut dims);
        }
        let (cols, rows) = (dims.x.clamp(1, u16::MAX as i32) as u16, dims.y.clamp(1, u16::MAX as i32) as u16);
        if let Some(app) = APP.get() {
            let _ = app.state::<super::super::Terminals>().resize(id, cols, rows);
        }
        Ok((cols, rows))
    }

    pub(crate) fn attach(app: &tauri::AppHandle, window: &tauri::WebviewWindow, id: u32, r: Rect) -> Result<(u16, u16), String> {
        let e = engine()?;
        let _ = APP.set(app.clone());
        if let Some((hwnd, term)) = views().lock().map_err(|e| e.to_string())?.get(&id).map(|v| (v.hwnd, v.term)) {
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
        views().lock().map_err(|e| e.to_string())?.insert(id, View { hwnd, term, pending: Vec::new() });
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

    /// Output for terminal `id`: drawn by its native view, if it has one.
    pub(crate) fn feed(id: u32, data: &[u8]) {
        let Some(map) = VIEWS.get() else { return };
        let Ok(mut map) = map.lock() else { return };
        let Some(v) = map.get_mut(&id) else { return };
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
