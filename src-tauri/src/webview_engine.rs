//! The thin glue to WebView2's own events and calls, reached through webview2-com (a direct
//! dependency since the coordinator's 2026-10-20 decision, pinned to the version wry builds).
//!
//! Glue only: every decision is a pure function elsewhere and tested there. The glue itself runs in
//! no unit test (it needs a live web view).
//!
//! - T-286-b (APP-040): the engine's process-failed event from the app's own view becomes a crash
//!   record when it is a real crash (engine_crash.rs decides).
use std::path::PathBuf;

#[cfg(windows)]
mod imp {
    use crate::engine_crash as crash;
    use std::path::PathBuf;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::ProcessFailedEventHandler;
    use windows::core::{Interface, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;

    /// A string the engine hands over in memory the caller frees; empty when it hands none.
    ///
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

    /// Hooks the view's process-failed event (called once, on the main thread).
    pub fn watch_failures(controller: &ICoreWebView2Controller, dir: PathBuf) {
        // SAFETY: CoreWebView2 hands back the view's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            // SAFETY: the getters below only write plain values or CoTaskMem strings `take` frees.
            unsafe { args.ProcessFailedKind(&mut kind) }?;
            let mut f = crash::Failure { kind: kind.0, ..Default::default() };
            if let Ok(a2) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                let (mut reason, mut code) = (COREWEBVIEW2_PROCESS_FAILED_REASON::default(), 0i32);
                if unsafe { a2.Reason(&mut reason) }.is_ok() {
                    f.reason = Some(reason.0);
                }
                if unsafe { a2.ExitCode(&mut code) }.is_ok() {
                    f.exit_code = Some(code);
                }
                f.process = unsafe { take(|p| a2.ProcessDescription(p)) };
            }
            if let Ok(a3) = args.cast::<ICoreWebView2ProcessFailedEventArgs3>() {
                f.module = unsafe { take(|p| a3.FailureSourceModulePath(p)) };
            }
            let when = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            crash::report(&dir, &f, crash::memory_now(), when);
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_ProcessFailed(&handler, &mut token) };
    }
}

/// T-286-b (APP-040): the app's own view reports its engine's process failures (an interface
/// process crash is a crash). Called once at startup.
pub fn watch_app_failures(w: &tauri::WebviewWindow, dir: PathBuf) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::watch_failures(&pw.controller(), dir));
    #[cfg(not(windows))]
    let _ = (w, dir);
}
