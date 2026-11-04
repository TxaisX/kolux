//! The thin glue to WebView2's own events and calls, reached through webview2-com (a direct
//! dependency since the coordinator's 2026-10-20 decision, pinned to the version wry builds).
//!
//! Glue only: every decision is a pure function elsewhere and tested there (certificates in
//! browser_certs.rs), but for the frame rule (`frame_ok`, T-607), a pure function kept at the end
//! of this file beside its tests. The glue itself runs in no unit test (it needs a live web view),
//! so it is proved live: see the LIVE PROOF PENDING steps in evidence/T-158.txt and T-607.txt.
//!
//! - T-158 (BROW-024): every page answers the engine's server-certificate-error event with
//!   `certs::on_engine`: allow for an approved local certificate, cancel for everything else,
//!   never the engine's default error page (which has its own click-through).
//! - T-251 (CLI-047): `kolux screenshot` / `full-screenshot` take a picture through the engine's
//!   DevTools call (Page.captureScreenshot), `kolux pdf` prints through the engine's PrintToPdf.
//!   Both are started on the main thread and waited for on the command line's own thread.
//! - T-286-b (APP-040): the engine's process-failed event, from every browser page and the app's
//!   own view, becomes a crash record when it is a real crash (browser_crash.rs decides).
//! - T-272-d: the engine's accelerator-key event records each real key pressed in a page, so a
//!   keyboard chord that page's script sends counts only after a real press there (browser_holder.rs).
//! - T-239-b (BROW-025): at every navigation start a page (and a popup) is given desktop Firefox
//!   with no client hints on the sign-in hosts, its own identity elsewhere, unless its profile is
//!   in native mode (`profiles::firefox_at` decides).
//! - T-272-b (BROW-032): a page's permission requests are answered by `permissions::answer`; a
//!   refusal is told to its pane (PERMISSION_EVENT) with the permission named.
//! - After-list 285 (BROW-040): a preview is denied every permission request, and its embedded
//!   frames load only from its own folder (`preview::frame_may_load`, per frame start).
//! - T-607 (L1-tauri.1, R07-browser.1): in every tab and sign-in popup a frame of Kolux's own
//!   address, or of any address a tab may not go to, is cancelled at its start (`frame_ok`).
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Url, Webview};

#[cfg(windows)]
mod imp {
    use crate::browser::certs;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use std::sync::mpsc::Sender;
    use crate::browser::{cookies, crash, holder, permissions, popup, preview, profiles};
    use cookies::Entry;
    use tauri::webview::cookie::SameSite;
    use std::path::PathBuf;
    use webview2_com::{AcceleratorKeyPressedEventHandler, CallDevToolsProtocolMethodCompletedHandler, ClearServerCertificateErrorActionsCompletedHandler, DownloadStartingEventHandler, GetCookiesCompletedHandler, NavigationStartingEventHandler, PermissionRequestedEventHandler, PrintToPdfCompletedHandler, ProcessFailedEventHandler, ServerCertificateErrorDetectedEventHandler, WebResourceRequestedEventHandler};
    use webview2_com::WindowCloseRequestedEventHandler;
    use crate::browser::selfclose::Engine;
    use std::sync::Arc;
    use windows::core::{w, Interface, BOOL, HSTRING, PWSTR};
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

    /// Hooks a new page's engine events (called once, on the main thread, as the page is made).
    pub fn attach(id: u32, controller: &ICoreWebView2Controller) {
        // T-272-d: every real key the engine reports in this page (before the page sees it) is
        // recorded, so a chord the page's script sends counts only after a real press there.
        let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let (mut kind, mut vk) = (COREWEBVIEW2_KEY_EVENT_KIND::default(), 0u32);
            // SAFETY: KeyEventKind and VirtualKey only write plain values; Handled is left alone,
            // so the page still gets the key.
            if unsafe { args.KeyEventKind(&mut kind) }.is_ok() && unsafe { args.VirtualKey(&mut vk) }.is_ok() {
                holder::engine_key(id, kind.0, vk);
            }
            Ok(())
        }));
        let mut key_token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        if unsafe { controller.add_AcceleratorKeyPressed(&keys, &mut key_token) }.is_ok() {
            holder::watch(id);
        }
        // T-607 (L1-tauri.1): no frame of Kolux's own address in any tab, and while this tab shows a
        // preview, frames only from the preview's own folder (after-list 285, BROW-040).
        frames(controller, Some(id), crate::browser::APP.get().and_then(crate::browser::app_origin));
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        // T-657 (DT-C93): the engine's word on whether the user started each new window and each
        // of the page's own `kolux-chord:` requests (a click or key behind it, not a timer). The
        // toolkit's new-window handler runs later (it defers to the message loop), so the word is
        // there first; for a request, `popup::Meet` pairs the two in either order. Both handlers
        // only read the event: what happens to it stays the toolkit handler's call.
        let nav = NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: Uri writes a CoTaskMem string `take` frees; IsUserInitiated a plain value.
            let uri = unsafe { take(|p| args.Uri(p)) };
            if crate::browser::needs_word(&uri) {
                // A redirect is the server's doing, not the user's, whatever started the first load.
                let (mut user, mut redirect) = (BOOL::default(), BOOL::default());
                let user = unsafe { args.IsUserInitiated(&mut user) }.is_ok() && user.as_bool();
                let user = user && unsafe { args.IsRedirected(&mut redirect) }.is_ok() && !redirect.as_bool();
                popup::request_word(id, &uri, user);
            }
            Ok(())
        }));
        let mut nav_token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_NavigationStarting(&nav, &mut nav_token) };
        let window = webview2_com::NewWindowRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: as above.
            let uri = unsafe { take(|p| args.Uri(p)) };
            let mut user = BOOL::default();
            let user = unsafe { args.IsUserInitiated(&mut user) }.is_ok() && user.as_bool();
            popup::window_word(id, &uri, user);
            Ok(())
        }));
        let mut window_token = 0i64;
        // SAFETY: as above.
        let _ = unsafe { core.add_NewWindowRequested(&window, &mut window_token) };
        if let Ok(core14) = core.cast::<ICoreWebView2_14>() {
            let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                // SAFETY: RequestUri and ToPemEncoding write CoTaskMem strings `take` frees.
                let uri = unsafe { take(|p| args.RequestUri(p)) };
                let pem = unsafe { args.ServerCertificate() }.map(|c| unsafe { take(|p| c.ToPemEncoding(p)) }).unwrap_or_default();
                let fp = if pem.is_empty() { String::new() } else { certs::fingerprint(&pem) };
                let action = match certs::TRUST.lock() {
                    Ok(mut t) => certs::on_engine(&mut t, id, &uri, &fp),
                    Err(_) => certs::EngineAction::Cancel,
                };
                let a = match action {
                    certs::EngineAction::AlwaysAllow => COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                    certs::EngineAction::Cancel => COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL,
                };
                // SAFETY: SetAction only records the answer on the event's arguments.
                unsafe { args.SetAction(a) }
            }));
            let mut token = 0i64;
            // SAFETY: the handler lives as long as the engine holds it; the token is written once.
            let _ = unsafe { core14.add_ServerCertificateErrorDetected(&handler, &mut token) };
        }
    }

    /// T-607 (L1-tauri.1, R07-browser.1): every frame a page in this view starts loading is checked
    /// by `frame_ok` and cancelled when it fails, so no page can frame Kolux's own screen with its
    /// command bridge; in tab `fenced` (a preview) the preview's own fence decides too
    /// (`preview::frame_may_load`, after-list 285). `dev` is the dev server the app runs from.
    pub fn frames(controller: &ICoreWebView2Controller, fenced: Option<u32>, dev: Option<tauri::Url>) {
        // SAFETY: CoreWebView2 hands back the view's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let handler = NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: Uri writes a CoTaskMem string `take` frees; SetCancel only records the answer.
            let uri = unsafe { take(|p| args.Uri(p)) };
            if !super::frame_ok(&uri, dev.as_ref()) || fenced.is_some_and(|id| !preview::frame_may_load(id, &uri)) {
                unsafe { args.SetCancel(true) }?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_FrameNavigationStarting(&handler, &mut token) };
    }

    /// T-286-b (APP-040): hooks a view's process-failed event; each failure is read as far as the
    /// runtime goes (kind; reason, exit code and process on newer runtimes; the faulting module on
    /// newer still) and handed to `crash::report` with the memory reading taken now.
    pub fn watch_failures(source: crash::Source, controller: &ICoreWebView2Controller, dir: PathBuf, built: Option<Arc<Engine>>) {
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
            let open = match source {
                // Row 954 (c): a report from an engine that was destroyed (its flag, or its container window
                // already gone, whichever order the engine raised them in) is that destroy, not a crash. Only
                // THIS engine's reports are hidden: a failure in the rebuilt tab always counts.
                crash::Source::Page(id) => crate::browser::tabs().iter().any(|t| t.id == id) && !built.as_ref().is_some_and(|e| e.destroyed() || e.container().is_some_and(|c| !holder::window_exists(c))),
                crash::Source::App => true,
            };
            let when = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            crash::report(&dir, &f, source, open, crash::memory_now(), when);
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_ProcessFailed(&handler, &mut token) };
    }

    /// Row 954 (b): observes the tab's close request. wry's own handler is registered first and
    /// destroys the tab's window, and the event cannot be vetoed, so the pane is told to build the
    /// tab again (browser_selfclose.rs decides). That wry runs first, and that this handler runs at
    /// all after the destroy, is UNVERIFIED (WebView2 documents no handler order): the probe's
    /// `IsWindow` check on the container is the order-independent fallback, and `engine` dedupes both.
    pub fn watch_self_close(id: u32, controller: &ICoreWebView2Controller, app: tauri::AppHandle, engine: Arc<Engine>) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let handler = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
            crate::browser::selfclose::destroyed(&app, id, &engine);
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_WindowCloseRequested(&handler, &mut token) };
    }

    /// Forgets the engine's remembered certificate allowances for one page's engine.
    pub fn clear(controller: &ICoreWebView2Controller) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        if let Ok(core14) = core.cast::<ICoreWebView2_14>() {
            let done = ClearServerCertificateErrorActionsCompletedHandler::create(Box::new(|_| Ok(())));
            // SAFETY: the completion handler is kept alive by the engine until it runs.
            let _ = unsafe { core14.ClearServerCertificateErrorActions(&done) };
        }
    }

    /// The engine's own identity, read from the first page before anything changes it (every page
    /// runs on the same engine, so one reading serves all).
    static STOCK: std::sync::OnceLock<String> = std::sync::OnceLock::new();

    /// T-239-b (BROW-025): a page in a profile's normal mode shows desktop Firefox with no client
    /// hints on the sign-in hosts and its own identity everywhere else. Decided again at every
    /// navigation start (each redirect hop starts one) by `profiles::firefox_at`.
    pub fn identity(controller: &ICoreWebView2Controller, spoof: bool) {
        // SAFETY: CoreWebView2 and Settings hand back the page's engine and its settings.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let Ok(settings) = (unsafe { core.Settings() }).and_then(|s| s.cast::<ICoreWebView2Settings2>()) else { return };
        // SAFETY: UserAgent writes a CoTaskMem string `take` frees.
        let here = unsafe { take(|p| settings.UserAgent(p)) };
        let firefox = profiles::firefox_identity();
        let stock = STOCK.get_or_init(|| if here == firefox { String::new() } else { here.clone() }).clone();
        if !spoof || stock.is_empty() {
            return;
        }
        let (fx, own) = (HSTRING::from(firefox.as_str()), HSTRING::from(stock.as_str()));
        let nav = NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: Uri writes a CoTaskMem string `take` frees.
            let uri = unsafe { take(|p| args.Uri(p)) };
            let on = profiles::firefox_at(&uri, true);
            let ua = if on { &fx } else { &own };
            // SAFETY: SetUserAgent and the header calls only record values on the engine and on
            // this navigation's request.
            unsafe {
                let _ = settings.SetUserAgent(ua);
                if let Ok(h) = args.RequestHeaders() {
                    let _ = h.SetHeader(w!("User-Agent"), ua);
                    if on {
                        for name in profiles::CLIENT_HINTS {
                            let _ = h.RemoveHeader(&HSTRING::from(*name));
                        }
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_NavigationStarting(&nav, &mut token) };
        // The sign-in hosts' own requests (scripts, frames, fetches) lose their client hints too.
        for host in profiles::SIGN_IN_HOSTS {
            // SAFETY: the filter only names which requests the event below reports.
            let _ = unsafe { core.AddWebResourceRequestedFilter(&HSTRING::from(format!("https://{host}/*")), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL) };
        }
        let req = WebResourceRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: Request and Uri hand back the request and a CoTaskMem string `take` frees;
            // RemoveHeader only edits the outgoing request's headers.
            unsafe {
                let Ok(r) = args.Request() else { return Ok(()) };
                if profiles::sign_in_host(&take(|p| r.Uri(p))) {
                    if let Ok(h) = r.Headers() {
                        for name in profiles::CLIENT_HINTS {
                            let _ = h.RemoveHeader(&HSTRING::from(*name));
                        }
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_WebResourceRequested(&req, &mut token) };
        let script = HSTRING::from(profiles::no_hints_script());
        // SAFETY: the script is copied by the engine; no completion handler is needed.
        let _ = unsafe { core.AddScriptToExecuteOnDocumentCreated(&script, None::<&ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>) };
    }

    /// T-272-b (BROW-032): answers each permission request of a page by `permissions::answer`; a
    /// refusal reaches the page's pane as a notice naming the permission.
    pub fn permissions(id: u32, controller: &ICoreWebView2Controller, app: tauri::AppHandle) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            // SAFETY: PermissionKind only writes a plain value; SetState only records the answer.
            unsafe { args.PermissionKind(&mut kind) }?;
            match permissions::answer_for(kind.0, preview::is_preview(id)) {
                permissions::Answer::Engine => {}
                permissions::Answer::DenyQuiet => unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) }?,
                permissions::Answer::Deny(text) => {
                    unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) }?;
                    crate::browser::notices::send(&app, id, crate::browser::PERMISSION_EVENT, serde_json::json!({ "id": id, "text": text }), Some(text.to_string()));
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_PermissionRequested(&handler, &mut token) };
    }

    thread_local! {
        /// T-734 (DT-C170): the engine's handle on each download a page started, so Cancel can reach
        /// it. Main thread only: the engine's objects live there.
        static DOWNLOAD_OPS: std::cell::RefCell<Vec<(u32, ICoreWebView2DownloadOperation)>> = const { std::cell::RefCell::new(Vec::new()) };
    }

    fn in_progress(op: &ICoreWebView2DownloadOperation) -> bool {
        let mut s = COREWEBVIEW2_DOWNLOAD_STATE::default();
        // SAFETY: State only writes a plain value.
        unsafe { op.State(&mut s) }.is_ok() && s == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS
    }

    /// T-734 (DT-C170): keeps the engine's handle on each download the page starts; ended ones go when the next one starts.
    pub fn downloads(id: u32, controller: &ICoreWebView2Controller) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }).and_then(|c| c.cast::<ICoreWebView2_4>()) else { return };
        let handler = DownloadStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: DownloadOperation hands back the engine's object for this download.
            let op = unsafe { args.DownloadOperation() }?;
            DOWNLOAD_OPS.with_borrow_mut(|ops| {
                ops.retain(|(_, o)| in_progress(o));
                ops.push((id, op));
            });
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_DownloadStarting(&handler, &mut token) };
    }

    /// T-734 (DT-C170): cancels tab `id`'s running download written to `path`; whether one was found.
    pub fn cancel_download(id: u32, path: &str, tx: Sender<Result<bool, String>>) {
        // SAFETY: ResultFilePath writes a CoTaskMem string, which `take` frees.
        let op = DOWNLOAD_OPS.with_borrow(|ops| ops.iter().find(|(t, o)| *t == id && in_progress(o) && unsafe { take(|p| o.ResultFilePath(p)) }.replace('/', "\\").eq_ignore_ascii_case(&path.replace('/', "\\"))).map(|(_, o)| o.clone()));
        let _ = tx.send(match op {
            // SAFETY: Cancel stops the download.
            Some(op) => unsafe { op.Cancel() }.map(|_| true).map_err(|e| e.message()),
            None => Ok(false),
        });
    }

    /// One DevTools call on the page's engine; its JSON answer (or why not) goes to `tx`.
    pub fn devtools(controller: &ICoreWebView2Controller, method: &str, params: &str, tx: Sender<Result<String, String>>) {
        let fail = tx.clone();
        let start = move || -> windows::core::Result<()> {
            // SAFETY: CoreWebView2 hands back the page's engine object.
            let core = unsafe { controller.CoreWebView2() }?;
            let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |r, json| {
                let _ = tx.send(r.map(|_| json).map_err(|e| e.message()));
                Ok(())
            }));
            // SAFETY: the strings outlive the call; the engine keeps the handler until it runs.
            unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params), &done) }
        };
        if let Err(e) = start() {
            let _ = fail.send(Err(e.message()));
        }
    }

    /// T-657: runs the app's own `script` in the page without a user gesture; `done` gets its
    /// value as JSON text (as the toolkit's eval hands it), and nothing when it failed.
    pub fn quiet_eval(controller: &ICoreWebView2Controller, script: &str, done: Option<Box<dyn FnOnce(String) + Send>>) {
        let params = serde_json::json!({ "expression": script, "returnByValue": true }).to_string();
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |r, json| {
            // Like the toolkit's eval, every finished call answers: "null" for no value or a failure,
            // so Back/Forward still falls back to the tab's trail and `kolux eval` does not time out.
            // A script that threw answers "null" too, as the toolkit's eval does.
            let value = r
                .ok()
                .and_then(|_| serde_json::from_str::<serde_json::Value>(&json).ok())
                .filter(|v| v.get("exceptionDetails").is_none())
                .and_then(|v| v.pointer("/result/value").cloned());
            if let Some(done) = done {
                done(value.map_or_else(|| "null".to_string(), |v| v.to_string()));
            }
            Ok(())
        }));
        // SAFETY: the strings outlive the call; the engine keeps the handler until it runs.
        let _ = unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from("Runtime.evaluate"), &HSTRING::from(params), &handler) };
    }

    /// The engine prints the page to `path`; whether it succeeded (or why not) goes to `tx`.
    pub fn print_pdf(controller: &ICoreWebView2Controller, path: &str, tx: Sender<Result<bool, String>>) {
        let fail = tx.clone();
        let start = move || -> windows::core::Result<()> {
            // SAFETY: CoreWebView2 hands back the page's engine object.
            let core = unsafe { controller.CoreWebView2() }?.cast::<ICoreWebView2_7>()?;
            let done = PrintToPdfCompletedHandler::create(Box::new(move |r, ok| {
                let _ = tx.send(r.map(|_| ok).map_err(|e| e.message()));
                Ok(())
            }));
            // SAFETY: the path outlives the call; no settings means the engine's defaults.
            unsafe { core.PrintToPdf(&HSTRING::from(path), None::<&ICoreWebView2PrintSettings>, &done) }
        };
        if let Err(e) = start() {
            let _ = fail.send(Err(e.message()));
        }
    }

    fn cookie_manager(controller: &ICoreWebView2Controller) -> windows::core::Result<ICoreWebView2CookieManager> {
        // SAFETY: CoreWebView2 and CookieManager hand back the page's engine objects.
        unsafe { controller.CoreWebView2() }?.cast::<ICoreWebView2_2>().and_then(|c| unsafe { c.CookieManager() })
    }

    /// An engine cookie with its domain exactly as stored (leading dot kept; the cookie crate drops it).
    fn entry_of(c: &ICoreWebView2Cookie) -> windows::core::Result<Entry> {
        let mut same = COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX;
        let (mut http_only, mut secure, mut session) = (BOOL::default(), BOOL::default(), BOOL::default());
        let mut expires = 0.0;
        // SAFETY: the getters write plain values, or CoTaskMem strings `take` frees.
        unsafe {
            c.SameSite(&mut same)?;
            c.IsHttpOnly(&mut http_only)?;
            c.IsSecure(&mut secure)?;
            c.IsSession(&mut session)?;
            c.Expires(&mut expires)?;
        }
        let same_site = match same {
            COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT => Some(SameSite::Strict),
            COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE => Some(SameSite::None),
            _ => Some(SameSite::Lax),
        };
        Ok(Entry {
            // SAFETY: Name, Value, Domain and Path write CoTaskMem strings `take` frees.
            name: unsafe { take(|p| c.Name(p)) },
            value: unsafe { take(|p| c.Value(p)) },
            domain: unsafe { take(|p| c.Domain(p)) },
            path: unsafe { take(|p| c.Path(p)) },
            secure: secure.as_bool(),
            http_only: http_only.as_bool(),
            same_site,
            expires: if session.as_bool() || expires < 0.0 { None } else { Some(expires as i64) },
        })
    }

    fn cookie_to_engine(m: &ICoreWebView2CookieManager, e: &Entry) -> windows::core::Result<ICoreWebView2Cookie> {
        // SAFETY: the strings outlive the call; CreateCookie hands back a new engine cookie.
        let c = unsafe { m.CreateCookie(&HSTRING::from(e.name.as_str()), &HSTRING::from(e.value.as_str()), &HSTRING::from(cookies::engine_domain(e)), &HSTRING::from(e.path.as_str())) }?;
        // SAFETY: the setters only record plain values on the cookie object.
        unsafe {
            if let Some(at) = e.expires {
                c.SetExpires(at as f64)?;
            }
            c.SetIsHttpOnly(e.http_only)?;
            c.SetIsSecure(e.secure)?;
            if let Some(s) = e.same_site {
                c.SetSameSite(match s {
                    SameSite::Strict => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT,
                    SameSite::None => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE,
                    SameSite::Lax => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX,
                })?;
            }
        }
        Ok(c)
    }

    /// Every cookie of the page's profile with its domain kept as stored; the list goes to `tx`.
    pub fn cookies(controller: &ICoreWebView2Controller, tx: Sender<Result<Vec<Entry>, String>>) {
        let fail = tx.clone();
        let start = move || -> windows::core::Result<()> {
            let m = cookie_manager(controller)?;
            let done = GetCookiesCompletedHandler::create(Box::new(move |r, list| {
                let read = || -> windows::core::Result<Vec<Entry>> {
                    r?;
                    let Some(list) = list else { return Ok(Vec::new()) };
                    let mut n = 0;
                    // SAFETY: Count and GetValueAtIndex only read the engine's list.
                    unsafe { list.Count(&mut n) }?;
                    Ok((0..n).filter_map(|i| unsafe { list.GetValueAtIndex(i) }.ok().and_then(|c| entry_of(&c).ok())).collect())
                };
                let _ = tx.send(read().map_err(|e| e.message()));
                Ok(())
            }));
            // SAFETY: a null address asks for every cookie; the engine keeps the handler until it runs.
            unsafe { m.GetCookies(windows::core::PCWSTR::null(), &done) }
        };
        if let Err(e) = start() {
            let _ = fail.send(Err(e.message()));
        }
    }

    /// Adds or replaces one cookie in the page's profile (`delete`: removes it), scope kept exactly.
    pub fn put_cookie(controller: &ICoreWebView2Controller, e: &Entry, delete: bool, tx: Sender<Result<(), String>>) {
        let run = || -> windows::core::Result<()> {
            let m = cookie_manager(controller)?;
            let c = cookie_to_engine(&m, e)?;
            // SAFETY: the engine takes its own cookie object back.
            unsafe { if delete { m.DeleteCookie(&c) } else { m.AddOrUpdateCookie(&c) } }
        };
        let _ = tx.send(run().map_err(|e| e.message()));
    }
}

/// Hooks a new page's engine events (main thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn attach(id: u32, pw: &tauri::webview::PlatformWebview) {
    imp::attach(id, &pw.controller());
}

/// T-239-b (BROW-025): a page shows desktop Firefox on the sign-in hosts unless its profile is in
/// native mode (main thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn identity(pw: &tauri::webview::PlatformWebview, spoof: bool) {
    imp::identity(&pw.controller(), spoof);
}

/// T-272-b (BROW-032): a page's permission requests are answered by the permission rules (main
/// thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn permissions(id: u32, pw: &tauri::webview::PlatformWebview, app: AppHandle) {
    imp::permissions(id, &pw.controller(), app);
}

/// T-272-b (BROW-032, after-list 718): a popup's permission requests are answered by the same
/// rules as its opener tab's page, and a refusal's notice goes to the opener's pane (`tab`).
pub fn popup_permissions(w: &tauri::WebviewWindow, tab: u32, app: AppHandle) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::permissions(tab, &pw.controller(), app));
    #[cfg(not(windows))]
    let _ = (w, tab, app);
}

/// T-607 (L1-tauri.1): a sign-in popup's frames follow the tabs' rule (`frame_ok`); `dev` is the dev
/// server the app runs from.
pub fn popup_frames(w: &tauri::WebviewWindow, dev: Option<Url>) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::frames(&pw.controller(), None, dev));
    #[cfg(not(windows))]
    let _ = (w, dev);
}

/// T-239-b (BROW-025): a popup follows the mode of its tab's profile. A popup opened straight onto
/// a sign-in host already starts as Firefox (its builder sets that); this keeps every later hop
/// right.
pub fn popup_identity(w: &tauri::WebviewWindow, spoof: bool) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::identity(&pw.controller(), spoof));
    #[cfg(not(windows))]
    let _ = (w, spoof);
}

/// T-286-b (APP-040): a browser page's engine reports its process failures (main thread, from
/// `browser_open`'s web view callback); `dir` is the profile folder holding the crash store.
#[cfg(windows)]
pub fn watch_page_failures(id: u32, pw: &tauri::webview::PlatformWebview, dir: Option<PathBuf>, built: std::sync::Arc<super::selfclose::Engine>) {
    if let Some(dir) = dir {
        imp::watch_failures(super::crash::Source::Page(id), &pw.controller(), dir, Some(built));
    }
}

/// Row 954 (b): a tab (never a popup) hears its page's close request (main thread, from
/// `browser_open`'s web view callback). Off Windows there is no such hook: the engine there
/// closes a tab's view without telling Kolux, and `NO_CLOSE_SCRIPT` is the only guard.
#[cfg(windows)]
pub fn watch_self_close(id: u32, pw: &tauri::webview::PlatformWebview, app: AppHandle, built: std::sync::Arc<super::selfclose::Engine>) {
    imp::watch_self_close(id, &pw.controller(), app, built);
}

/// T-286-b (APP-040): the app's own view reports its engine's process failures (an interface
/// process crash is a crash). Called once at startup.
pub fn watch_app_failures(w: &tauri::WebviewWindow, dir: PathBuf) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::watch_failures(super::crash::Source::App, &pw.controller(), dir, None));
    #[cfg(not(windows))]
    let _ = (w, dir);
}

/// Starts `job` on the page's engine (main thread) and waits for its answer here; never called
/// from the main thread (the command line's requests run on their own).
#[cfg(windows)]
fn on_engine<T: Send + 'static>(v: &Webview, wait: Duration, job: impl FnOnce(&webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller, std::sync::mpsc::Sender<Result<T, String>>) + Send + 'static) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    v.with_webview(move |pw| job(&pw.controller(), tx)).map_err(|e| e.to_string())?;
    rx.recv_timeout(wait).map_err(|_| format!("the page's engine did not answer within {} s", wait.as_secs()))?
}

/// T-734 (DT-C170): the engine's handle on each download the page starts is kept for Cancel
/// (main thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn downloads(id: u32, pw: &tauri::webview::PlatformWebview) {
    imp::downloads(id, &pw.controller());
}

/// T-734 (DT-C170): cancels tab `id`'s running download written to `path`, waited for; whether
/// the engine still had it running.
pub fn cancel_download(v: &Webview, id: u32, path: String, wait: Duration) -> Result<bool, String> {
    #[cfg(windows)]
    {
        on_engine(v, wait, move |_, tx| imp::cancel_download(id, &path, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, id, path, wait);
        Err("cancelling a download needs WebView2 (Windows)".into())
    }
}

/// T-251 (CLI-047): one DevTools call on a page's engine, waited for; the answer's JSON text.
pub fn devtools(v: &Webview, method: &str, params: String, wait: Duration) -> Result<String, String> {
    #[cfg(windows)]
    {
        let method = method.to_string();
        on_engine(v, wait, move |c, tx| imp::devtools(c, &method, &params, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, method, params, wait);
        Err("page capture needs WebView2 (Windows)".into())
    }
}

/// T-657 (DT-C93): runs one of the app's own scripts in a page the way that gives the page no
/// user gesture. The toolkit's eval does give one (for about five seconds the engine calls the
/// page's popups and requests user-started), so the scripts the app runs on its own (on each load,
/// the shortcut list, the menu it draws) go this way. `done` gets the value as JSON text.
pub fn quiet_eval(v: &Webview, script: String, done: Option<Box<dyn FnOnce(String) + Send>>) {
    #[cfg(windows)]
    let _ = v.with_webview(move |pw| imp::quiet_eval(&pw.controller(), &script, done));
    #[cfg(not(windows))]
    match done {
        // The toolkit's callback may be called more than once in its type; `done` runs on the first.
        Some(done) => {
            let done = std::sync::Mutex::new(Some(done));
            drop(v.eval_with_callback(script, move |answer: String| {
                if let Some(done) = done.lock().ok().and_then(|mut d| d.take()) {
                    done(answer);
                }
            }));
        }
        None => drop(v.eval(script)),
    }
}

/// T-251 (CLI-047): the engine prints a page to a PDF file at `path`, waited for.
pub fn print_pdf(v: &Webview, path: &str, wait: Duration) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let path = path.to_string();
        on_engine(v, wait, move |c, tx| imp::print_pdf(c, &path, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, path, wait);
        Err("printing needs WebView2 (Windows)".into())
    }
}

/// After-list 612: the page profile's cookies with each domain as stored, leading dot kept (the
/// cookie crate's getter drops it, so host-only and domain cookies could not be told apart).
pub fn cookies(v: &Webview, wait: Duration) -> Result<Vec<super::cookies::Entry>, String> {
    #[cfg(windows)]
    {
        on_engine(v, wait, imp::cookies)
    }
    #[cfg(not(windows))]
    {
        let _ = (v, wait);
        Err("cookies need WebView2 (Windows)".into())
    }
}

/// After-list 612: adds or replaces one cookie, host-only or for subdomains as its domain says.
pub fn set_cookie(v: &Webview, e: super::cookies::Entry, wait: Duration) -> Result<(), String> {
    #[cfg(windows)]
    {
        on_engine(v, wait, move |c, tx| imp::put_cookie(c, &e, false, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, e, wait);
        Err("cookies need WebView2 (Windows)".into())
    }
}

/// After-list 612: removes the cookie of that name, domain (dot kept) and path.
pub fn delete_cookie(v: &Webview, e: super::cookies::Entry, wait: Duration) -> Result<(), String> {
    #[cfg(windows)]
    {
        on_engine(v, wait, move |c, tx| imp::put_cookie(c, &e, true, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, e, wait);
        Err("cookies need WebView2 (Windows)".into())
    }
}

/// T-158 (BROW-024): after Stop Trusting, every open page's engine forgets the allowances it
/// remembered, so the next visit to a no-longer-trusted site is asked again.
pub fn clear_certificate_allowances(app: &AppHandle) {
    for t in super::tabs() {
        if let Ok(v) = super::view(app, t.id) {
            #[cfg(windows)]
            let _ = v.with_webview(|pw| imp::clear(&pw.controller()));
            #[cfg(not(windows))]
            let _ = v;
        }
    }
}

/// T-607 (L1-tauri.1, R07-browser.1): whether a frame inside a browser tab or a sign-in popup may load
/// `uri`. Never Kolux's own address: on Windows the engine hands every frame Tauri's command bridge,
/// and Tauri grants a page at the app's own address every app command. So a frame goes only where a
/// tab may (`allowed`: http and https, never a `*.localhost` host, where the app, its IPC and its
/// custom schemes answer, nor the dev server the app runs from, `app`); of the rest, only the frames
/// a page makes of its own text load (`about:blank`, `about:srcdoc`, `data:`, which carry no origin
/// Tauri takes for its own) and a `blob:` of an allowed origin. Any other scheme, the app's own
/// (`tauri:`, `ipc:`, `asset:`) among them, is refused.
#[cfg_attr(not(windows), allow(dead_code))] // the frame hook is Windows-only
pub fn frame_ok(uri: &str, app: Option<&Url>) -> bool {
    let Ok(url) = Url::parse(uri) else { return false };
    let web = |u: &Url| super::allowed(u, app).is_ok() && !dev_alias(u, app);
    match url.scheme() {
        "http" | "https" => web(&url),
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        "data" => true,
        "blob" => url.path().starts_with("null/") || Url::parse(url.path()).is_ok_and(|inner| matches!(inner.scheme(), "http" | "https") && web(&inner)),
        _ => false,
    }
}

/// T-607b (review of PR #15): in a development build (`app` is the dev server, which `allowed` judges
/// by its own host only) the server also answers on the loopback addresses, so `127.0.0.1`, any
/// other 127.x address and `[::1]` at its port count as the app's own too. A release build has no
/// dev server, so nothing is refused here.
fn dev_alias(url: &Url, app: Option<&Url>) -> bool {
    let loopback = |u: &Url| {
        let host = u.host_str().unwrap_or_default().trim_end_matches('.');
        host.eq_ignore_ascii_case("localhost") || host.trim_start_matches('[').trim_end_matches(']').parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
    };
    app.is_some_and(|a| loopback(a) && loopback(url) && a.port_or_known_default() == url.port_or_known_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T-607 (L1-tauri.1, R07-browser.1): a frame of Kolux's own address is refused in every tab and
    /// sign-in popup (any `*.localhost` host, a custom scheme of the app's, the dev server it runs
    /// from), and so is any other address a tab may not go to; an ordinary third-party frame, and a
    /// frame a page makes of its own text, load.
    #[test]
    fn t607_a_frame_of_koluxs_own_address_is_refused_and_an_ordinary_frame_loads() {
        let dev = Url::parse("http://localhost:1420/").unwrap();
        for own in [
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "http://TAURI.LOCALHOST./",
            "http://ipc.localhost/plugin%3Aevent%7Clisten",
            "http://kolux-artifact.localhost/x",
            "tauri://localhost/",
            "ipc://localhost/cmd",
            "asset://localhost/C%3A%2Fx",
            "kolux-artifact://localhost/x",
            "blob:http://tauri.localhost/0b3c-uuid",
            "http://localhost:1420/",
            "file:///C:/Users/me/.ssh/id_rsa",
            "javascript:alert(1)",
            "edge://settings",
            "not an address",
        ] {
            assert!(!frame_ok(own, Some(&dev)), "refused: {own}");
        }
        for ok in [
            "https://www.youtube.com/embed/x",
            "https://accounts.google.com/o/oauth2/iframe",
            "http://localhost:5173/",
            "http://127.0.0.1:8080/",
            "about:blank",
            "about:srcdoc",
            "data:text/html,<p>hi</p>",
            "blob:https://example.com/0b3c-uuid",
            "blob:null/0b3c-uuid",
        ] {
            assert!(frame_ok(ok, Some(&dev)), "loads: {ok}");
        }
        assert!(frame_ok("http://localhost:1420/", None), "a release build has no dev server: a user's own server on that port loads");
    }

    /// T-607b (review of PR #15): in a development build the dev server also answers on the loopback
    /// addresses, so a frame of 127.0.0.1 or [::1] at its port is refused too; other ports load, and
    /// a release build (no dev server) loads them all.
    #[test]
    fn t607b_the_dev_servers_loopback_addresses_are_refused_in_a_development_build() {
        let dev = Url::parse("http://localhost:1420/").unwrap();
        for own in ["http://127.0.0.1:1420/", "http://127.0.0.1:1420/index.html", "http://[::1]:1420/", "https://127.0.0.1:1420/", "blob:http://127.0.0.1:1420/0b3c-uuid", "http://[::1]:1420/src/main.tsx"] {
            assert!(!frame_ok(own, Some(&dev)), "refused in a development build: {own}");
            assert!(frame_ok(own, None), "a release build has no dev server: {own} loads");
        }
        for ok in ["http://127.0.0.1:8080/", "http://[::1]:5173/", "http://127.0.0.1/"] {
            assert!(frame_ok(ok, Some(&dev)), "loads: {ok}");
        }
    }

    /// T-607: the rule is wired into every tab's frame hook (not only a preview's) and into every
    /// sign-in popup. The hooks cannot run in a unit test (no web view), so the guard is that both
    /// build paths call them.
    #[test]
    fn t607_every_tab_and_every_popup_hooks_the_frame_rule() {
        // The blob is LF; a Windows checkout with core.autocrlf is CRLF. Compare on one line ending,
        // or the search for the closing brace fails before any guard is read.
        let engine = include_str!("browser_engine.rs").replace("\r\n", "\n");
        let attach = &engine[engine.find("pub fn attach(id: u32, controller").expect("imp::attach")..];
        let attach = &attach[..attach.find("\n    }\n").unwrap()];
        assert!(attach.contains("frames(controller, Some(id), "), "every tab hooks the frame rule");
        let frames = &engine[engine.find("fn frames(").expect("imp::frames")..];
        let frames = &frames[..frames.find("\n    }\n").unwrap()];
        assert!(frames.contains("frame_ok(&uri, ") && frames.contains("SetCancel(true)"), "{frames}");
        let popup = include_str!("browser_popup.rs").replace("\r\n", "\n");
        let open = &popup[popup.find("pub fn open(").unwrap()..popup.find("pub fn close_for(").unwrap()];
        assert!(open.contains("engine::popup_frames(&w, "), "every sign-in popup hooks the frame rule");
    }
}
