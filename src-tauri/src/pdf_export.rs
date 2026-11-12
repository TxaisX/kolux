//! T-316-b (EDIT-018): a rendered markdown note becomes a PDF through WebView2's own PrintToPdf.
//! The note's HTML (its pictures already data: URIs, put there by the caller) is wrapped in a
//! page that may load nothing from outside, written to a temp file, opened in a hidden page of
//! its own, printed, and the PDF is copied to the path the user chose. The hidden page is closed
//! on every path, and a file is never replaced unless the caller says so.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tauri::AppHandle;

/// The largest note HTML taken (pictures are inline, so this is mostly picture bytes).
pub const HTML_MAX: usize = 48 * 1024 * 1024;
const LOAD_WAIT: Duration = Duration::from_secs(30);
const PRINT_WAIT: Duration = Duration::from_secs(60);

/// What the export needs from a hidden page; the app's window toolkit stands behind it, a test fakes it.
pub trait Page {
    /// Waits until the page has finished loading.
    fn loaded(&self, wait: Duration) -> Result<(), String>;
    /// Prints the page to `out`; whether the engine reported success.
    fn print(&self, out: &Path, wait: Duration) -> Result<bool, String>;
    /// Closes the page for good.
    fn close(&self);
}

/// Opens a hidden page on a local file, with no way to the network.
pub trait Host {
    fn open(&self, file: &Path) -> Result<Box<dyn Page>, String>;
}

/// The default file name offered for a note: its title (or Untitled when it has none) with
/// characters Windows refuses folded to dashes, ending in .pdf.
pub fn default_name(title: &str) -> String {
    let t = title.trim();
    let t = if t.len() >= 4 && t[t.len() - 4..].eq_ignore_ascii_case(".pdf") { &t[..t.len() - 4] } else { t };
    let clean: String = t.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '-' } else { c }).take(80).collect();
    let clean = clean.trim_matches(|c: char| c == '.' || c.is_whitespace());
    format!("{}.pdf", if clean.is_empty() { "Untitled" } else { clean })
}

/// The path a PDF may be written to: absolute, no `..`, ending in .pdf, in a folder that exists,
/// and not an existing file unless `overwrite`.
pub fn check_target(path: &str, overwrite: bool) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("no file was chosen for the PDF".into());
    }
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(format!("{path}: the PDF's path must be absolute"));
    }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(format!("{path}: the PDF's path may not contain .."));
    }
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) || p.file_stem().is_none() {
        return Err(format!("{path}: the file must end in .pdf"));
    }
    if !p.parent().is_some_and(Path::is_dir) {
        return Err(format!("{path}: the folder does not exist"));
    }
    if p.is_dir() {
        return Err(format!("{path}: that is a folder"));
    }
    if p.exists() && !overwrite {
        return Err(format!("{path}: a file with that name already exists"));
    }
    Ok(p)
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The page that gets printed. Its policy lets pictures and fonts come only from data: addresses
/// and nothing run, so a note cannot reach the network or run a script while it is printed.
pub fn document(html: &str, title: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'\">\
<title>{}</title><style>@page{{margin:18mm}}body{{font:14px/1.55 \"Segoe UI\",system-ui,sans-serif;color:#111;background:#fff}}\
img{{max-width:100%}}pre{{white-space:pre-wrap;word-break:break-word}}table{{border-collapse:collapse}}td,th{{border:1px solid #bbb;padding:3px 8px}}</style>\
</head><body>{}</body></html>",
        escape(title),
        html
    )
}

/// Files the export made; removed whatever way it ends.
struct Scratch(Vec<PathBuf>);
impl Drop for Scratch {
    fn drop(&mut self) {
        for p in &self.0 {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Closes the hidden page when the export ends, by any way.
struct Closing(Box<dyn Page>);
impl Drop for Closing {
    fn drop(&mut self) {
        self.0.close();
    }
}

static NONCE: AtomicU32 = AtomicU32::new(0);

/// Prints `html` to the PDF at `path`; answers the path written.
pub fn export(host: &dyn Host, scratch: &Path, html: &str, title: &str, path: &str, overwrite: bool, waits: (Duration, Duration)) -> Result<PathBuf, String> {
    let target = check_target(path, overwrite)?;
    if html.len() > HTML_MAX {
        return Err("the note is too large to export as a PDF".into());
    }
    std::fs::create_dir_all(scratch).map_err(|e| format!("{}: {e}", scratch.display()))?;
    let stem = format!("note-{}-{}", std::process::id(), NONCE.fetch_add(1, Ordering::Relaxed));
    let (page_file, pdf_file) = (scratch.join(format!("{stem}.html")), scratch.join(format!("{stem}.pdf")));
    let _files = Scratch(vec![page_file.clone(), pdf_file.clone()]);
    std::fs::write(&page_file, document(html, title)).map_err(|e| format!("{}: {e}", page_file.display()))?;
    let page = Closing(host.open(&page_file)?);
    page.0.loaded(waits.0)?;
    if !page.0.print(&pdf_file, waits.1)? {
        return Err("the page's engine could not print the note".into());
    }
    let bytes = std::fs::read(&pdf_file).map_err(|e| format!("the engine wrote no PDF: {e}"))?;
    if !bytes.starts_with(b"%PDF") {
        return Err("the engine's file is not a PDF".into());
    }
    write_pdf(&target, &bytes, overwrite)?;
    Ok(target)
}

/// Writes the bytes; without `overwrite` the file is created new, so a file that appeared since
/// the check is never replaced.
fn write_pdf(target: &Path, bytes: &[u8], overwrite: bool) -> Result<(), String> {
    use std::io::Write;
    let fail = |e: std::io::Error| format!("{}: {e}", target.display());
    if overwrite {
        return std::fs::write(target, bytes).map_err(fail);
    }
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(fail)?;
    f.write_all(bytes).map_err(fail)
}

/// The app's hidden pages: an offscreen window with no taskbar entry, opened on a local file,
/// refusing every other address and every new window.
struct AppHost(AppHandle);

struct AppPage {
    win: tauri::WebviewWindow,
    done: std::sync::mpsc::Receiver<()>,
}

impl Host for AppHost {
    fn open(&self, file: &Path) -> Result<Box<dyn Page>, String> {
        use tauri::webview::{NewWindowResponse, PageLoadEvent};
        use tauri::{WebviewUrl, WebviewWindowBuilder};
        static WINDOWS: AtomicU32 = AtomicU32::new(0);
        let url = tauri::Url::from_file_path(file).map_err(|_| format!("{}: not a file address", file.display()))?;
        let (tx, done) = std::sync::mpsc::channel();
        let only = url.clone();
        let win = WebviewWindowBuilder::new(&self.0, format!("note-pdf-{}", WINDOWS.fetch_add(1, Ordering::Relaxed)), WebviewUrl::External(url))
            // Rows 955 / 959: the default data folder takes one set of browser arguments, the main window's.
            .additional_browser_args(&crate::resources::recovery::browser_args_now())
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .decorations(false)
            .position(-32000.0, -32000.0)
            .inner_size(900.0, 1200.0)
            .zoom_hotkeys_enabled(false)
            .on_navigation(move |u| *u == only)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_page_load(move |_, p| {
                if matches!(p.event(), PageLoadEvent::Finished) {
                    let _ = tx.send(());
                }
            })
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Box::new(AppPage { win, done }))
    }
}

impl Page for AppPage {
    fn loaded(&self, wait: Duration) -> Result<(), String> {
        self.done.recv_timeout(wait).map_err(|_| "the note did not finish loading for the PDF".to_string())
    }

    fn print(&self, out: &Path, wait: Duration) -> Result<bool, String> {
        crate::webview_engine::print_pdf(self.win.as_ref(), &out.to_string_lossy(), wait)
    }

    fn close(&self) {
        let _ = self.win.destroy();
    }
}

/// Prints the note's rendered HTML to the PDF at `path` (chosen with `browser_pick_pdf_path`).
/// `overwrite` is true only when the user has agreed to replace the file. Answers the path written.
#[tauri::command]
pub async fn browser_export_pdf(app: AppHandle, html: String, title: String, path: String, overwrite: bool) -> Result<String, String> {
    use tauri::Manager;
    let scratch = app.path().temp_dir().map_err(|e| e.to_string())?.join("kolux-note-pdf");
    tauri::async_runtime::spawn_blocking(move || {
        export(&AppHost(app), &scratch, &html, &title, &path, overwrite, (LOAD_WAIT, PRINT_WAIT)).map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The system save dialog for the note's PDF, offering `<title>.pdf` (Untitled.pdf without a
/// title) in `folder` when given; none when it is cancelled. The dialog itself asks before a
/// file is replaced.
#[tauri::command]
pub async fn browser_pick_pdf_path(app: AppHandle, title: String, folder: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut pick = app.dialog().file().set_title("Export as PDF").add_filter("PDF", &["pdf"]).set_file_name(default_name(&title));
    if let Some(dir) = folder.filter(|d| Path::new(d).is_dir()) {
        pick = pick.set_directory(dir);
    }
    // Off the async worker: the dialog blocks until closed (the plugin still builds it on the main thread).
    let picked = tauri::async_runtime::spawn_blocking(move || pick.blocking_save_file()).await.map_err(|e| e.to_string())?;
    let Some(chosen) = picked else { return Ok(None) };
    chosen.into_path().map(|p| Some(p.display().to_string())).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Log {
        opened: u32,
        closed: u32,
        printed_html: Option<String>,
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Fail {
        Open,
        Load,
        Print,
        Refused,
        NotPdf,
        NoFile,
        Good,
    }

    struct Fake(Arc<Mutex<Log>>, Fail);
    struct FakePage(Arc<Mutex<Log>>, Fail, PathBuf);

    impl Host for Fake {
        fn open(&self, file: &Path) -> Result<Box<dyn Page>, String> {
            if self.1 == Fail::Open {
                return Err("window toolkit refused".into());
            }
            self.0.lock().unwrap().opened += 1;
            Ok(Box::new(FakePage(self.0.clone(), self.1, file.to_path_buf())))
        }
    }
    impl Page for FakePage {
        fn loaded(&self, _: Duration) -> Result<(), String> {
            if self.1 == Fail::Load { Err("did not load".into()) } else { Ok(()) }
        }
        fn print(&self, out: &Path, _: Duration) -> Result<bool, String> {
            self.0.lock().unwrap().printed_html = std::fs::read_to_string(&self.2).ok();
            match self.1 {
                Fail::Print => Err("engine failed".into()),
                Fail::Refused => Ok(false),
                Fail::NotPdf => std::fs::write(out, b"hello").map(|_| true).map_err(|e| e.to_string()),
                Fail::NoFile => Ok(true),
                _ => std::fs::write(out, b"%PDF-1.7 fake").map(|_| true).map_err(|e| e.to_string()),
            }
        }
        fn close(&self) {
            self.0.lock().unwrap().closed += 1;
        }
    }

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-pdf316b-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn edit018_a_note_with_no_title_is_named_untitled() {
        assert_eq!(default_name(""), "Untitled.pdf");
        assert_eq!(default_name("   "), "Untitled.pdf");
        assert_eq!(default_name("..."), "Untitled.pdf");
        assert_eq!(default_name("Plan"), "Plan.pdf");
        assert_eq!(default_name("Plan.PDF"), "Plan.pdf");
        assert_eq!(default_name("a/b:c?"), "a-b-c-.pdf");
        assert_eq!(default_name(&"x".repeat(200)).len(), 84);
    }

    #[test]
    fn edit018_the_target_must_be_absolute_pdf_in_a_real_folder() {
        let d = dir("target");
        let ok = d.join("a.pdf");
        assert_eq!(check_target(&ok.to_string_lossy(), false).unwrap(), ok);
        for bad in ["", "  ", "a.pdf", "out\\a.pdf", "\\a.pdf", "./a.pdf"] {
            assert!(check_target(bad, false).is_err(), "{bad:?} must be refused");
        }
        assert!(check_target(&d.join("a.txt").to_string_lossy(), false).unwrap_err().contains(".pdf"));
        assert!(check_target(&d.join("no-such").join("a.pdf").to_string_lossy(), false).unwrap_err().contains("folder does not exist"));
        assert!(check_target(&format!("{}/../a.pdf", d.display()), false).unwrap_err().contains(".."));
        std::fs::create_dir_all(d.join("dir.pdf")).unwrap();
        assert!(check_target(&d.join("dir.pdf").to_string_lossy(), true).unwrap_err().contains("folder"));
    }

    #[test]
    fn edit018_an_existing_file_is_kept_unless_the_caller_says_so() {
        let d = dir("exists");
        let p = d.join("a.pdf");
        std::fs::write(&p, b"old").unwrap();
        assert!(check_target(&p.to_string_lossy(), false).unwrap_err().contains("already exists"));
        assert!(check_target(&p.to_string_lossy(), true).is_ok());
        assert!(write_pdf(&p, b"new", false).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), b"old");
        write_pdf(&p, b"new", true).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"new");
    }

    #[test]
    fn edit018_the_printed_page_may_load_nothing_from_outside() {
        let doc = document("<img src=\"data:image/png;base64,AAAA\">", "A <b> & \"c\"");
        assert!(doc.contains("default-src 'none'"));
        assert!(doc.contains("img-src data:"));
        assert!(!doc.contains("script-src") && !doc.contains("connect-src"));
        assert!(doc.contains("<title>A &lt;b&gt; &amp; &quot;c&quot;</title>"));
        assert!(doc.contains("data:image/png;base64,AAAA"));
        assert!(doc.find("Content-Security-Policy").unwrap() < doc.find("<body>").unwrap());
    }

    #[test]
    fn edit018_export_writes_the_pdf_closes_the_page_and_cleans_up() {
        let d = dir("good");
        let log = Arc::new(Mutex::new(Log::default()));
        let target = d.join("Untitled.pdf");
        let got = export(&Fake(log.clone(), Fail::Good), &d.join("s"), "<p>hi</p>", "", &target.to_string_lossy(), false, (Duration::from_secs(1), Duration::from_secs(1))).unwrap();
        assert_eq!(got, target);
        assert!(std::fs::read(&target).unwrap().starts_with(b"%PDF"));
        let l = log.lock().unwrap();
        assert_eq!((l.opened, l.closed), (1, 1));
        assert!(l.printed_html.as_deref().unwrap().contains("<p>hi</p>"));
        assert_eq!(std::fs::read_dir(d.join("s")).unwrap().count(), 0, "temp files are removed");
    }

    #[test]
    fn edit018_the_hidden_page_is_closed_on_every_error_path() {
        for (i, f) in [Fail::Load, Fail::Print, Fail::Refused, Fail::NotPdf, Fail::NoFile, Fail::Good].into_iter().enumerate() {
            let d = dir(&format!("err{i}"));
            let log = Arc::new(Mutex::new(Log::default()));
            let target = d.join("a.pdf");
            let host = Fake(log.clone(), f);
            let r = export(&host, &d.join("s"), "<p>x</p>", "t", &target.to_string_lossy(), false, (Duration::from_secs(1), Duration::from_secs(1)));
            let l = log.lock().unwrap();
            if f == Fail::Good {
                // success control: the page is still closed once
                assert!(r.is_ok());
            } else {
                assert!(r.is_err(), "case {i} must fail");
                assert!(!target.exists(), "no PDF is left behind on an error");
            }
            assert_eq!((l.opened, l.closed), (1, 1), "case {i}: opened once, closed once");
            assert_eq!(std::fs::read_dir(d.join("s")).unwrap().count(), 0, "case {i}: temp files removed");
        }
    }

    #[test]
    fn edit018_a_page_that_will_not_open_leaves_nothing_and_a_bad_target_opens_nothing() {
        let d = dir("open");
        let log = Arc::new(Mutex::new(Log::default()));
        let target = d.join("a.pdf");
        let t = target.to_string_lossy().to_string();
        let w = (Duration::from_secs(1), Duration::from_secs(1));
        assert!(export(&Fake(log.clone(), Fail::Open), &d.join("s"), "x", "t", &t, false, w).unwrap_err().contains("refused"));
        assert_eq!(std::fs::read_dir(d.join("s")).unwrap().count(), 0);
        assert!(export(&Fake(log.clone(), Fail::Good), &d.join("s"), "x", "t", "relative.pdf", false, w).is_err());
        std::fs::write(&target, b"old").unwrap();
        assert!(export(&Fake(log.clone(), Fail::Good), &d.join("s"), "x", "t", &t, false, w).unwrap_err().contains("already exists"));
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
        assert_eq!(log.lock().unwrap().opened, 0, "a refused target never opens a page");
        assert!(export(&Fake(log, Fail::Good), &d.join("s"), &"x".repeat(HTML_MAX + 1), "t", &d.join("b.pdf").to_string_lossy(), false, w).unwrap_err().contains("too large"));
    }

    #[test]
    fn edit018_overwrite_replaces_when_the_caller_says_so() {
        let d = dir("over");
        let target = d.join("a.pdf");
        std::fs::write(&target, b"old").unwrap();
        let log = Arc::new(Mutex::new(Log::default()));
        let w = (Duration::from_secs(1), Duration::from_secs(1));
        export(&Fake(log, Fail::Good), &d.join("s"), "x", "t", &target.to_string_lossy(), true, w).unwrap();
        assert!(std::fs::read(&target).unwrap().starts_with(b"%PDF"));
    }
}
