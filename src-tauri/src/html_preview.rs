//! BROW-039: a worktree's HTML document previewed in the user's own browser. The file's folder is
//! served from a loopback port (http://127.0.0.1:<port>/<token>/<file>). One token per folder; a
//! path may not leave its folder.
//! T-159 (BROW-040): the fence. A preview serves only the documents opened (`granted` stays off now
//! that the in-app pane and its Allow folder chip are gone); every path is checked before it is
//! joined (no parent steps, roots, drive prefixes, backslash or NUL tricks) and after (the real
//! file, links followed, must lie under the real folder), and a file past FILE_MAX is explained.
//! T-659 (DT-C95, X-sec.3, R07-browser.4): each folder's token is 128 random bits from the
//! system, kept in memory for the run; the server answers only requests addressed to its own
//! loopback host and port; a preview is made, and its folder allowed, only for a folder inside a
//! project or workspace open in Kolux (one already made stays served for the run).
//! ponytail: a thread per connection and whole files in memory; a worktree's own documents are small.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Debug)]
pub struct Preview {
    pub token: String,
    pub root: PathBuf,
    /// The documents opened from this folder: all a preview may read until `granted`.
    pub files: Vec<String>,
    pub granted: bool,
}

static PREVIEWS: Mutex<Vec<Preview>> = Mutex::new(Vec::new());
static PORT: OnceLock<u16> = OnceLock::new();
/// The most a request line and its headers may take.
const REQUEST_MAX: usize = 8 * 1024;
/// The largest file a preview serves; a worktree document past it is explained instead.
pub const FILE_MAX: u64 = 32 * 1024 * 1024;
pub const EXTENSIONS: &[&str] = &["html", "htm"];

fn port() -> Result<u16, String> {
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("preview port: {e}"))?;
    let p = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for s in listener.incoming().flatten() {
            std::thread::spawn(move || serve(s));
        }
    });
    Ok(*PORT.get_or_init(|| p))
}

/// X-sec.3: a folder's token, 128 bits from the system's random source; nobody can work it out
/// from the folder's path.
fn fresh_token() -> Result<String, String> {
    let mut b = [0u8; 16];
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
        // SAFETY: no algorithm handle with the system-preferred flag, as documented; the buffer is ours, 16 bytes.
        let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), b.as_mut_ptr(), b.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        if status != 0 {
            return Err(format!("preview token: the system's random source failed ({status:#x})"));
        }
    }
    #[cfg(not(windows))]
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b)).map_err(|e| format!("preview token: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// T-659 (DT-C95): is `root` one of `folders` or inside one? Both sides are compared as real paths;
/// a folder that is not a full path, or not there, holds nothing.
pub fn inside(root: &Path, folders: &[String]) -> bool {
    let real: Vec<String> = folders.iter().map(|f| Path::new(f.trim())).filter(|f| f.is_absolute()).filter_map(|f| f.canonicalize().ok()).map(|c| plain(&c)).collect();
    crate::ports::deepest_workspace(&plain(root), &real).is_some()
}

/// T-659 (DT-C95): is `wt` a worktree of `project`'s own repository? Its `.git` file must name a
/// folder under `<project>/.git/worktrees`. A path Git lists is not enough on its own: a repository
/// can list any folder, and a plain-folder project inside a bigger repository would list that one.
/// ponytail: a project that is itself a linked worktree accepts none of its siblings; Kolux's own
/// workspaces are in its workspaces folders, which count without this.
fn linked_to(project: &Path, wt: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(wt.join(".git")) else { return false };
    let Some(dir) = text.lines().find_map(|l| l.strip_prefix("gitdir:")).map(str::trim) else { return false };
    let dir = if Path::new(dir).is_absolute() { PathBuf::from(dir) } else { wt.join(dir) };
    match (dir.canonicalize(), project.join(".git").join("worktrees").canonicalize()) {
        (Ok(d), Ok(w)) => d.starts_with(&w) && d != w,
        _ => false,
    }
}

/// T-659 (DT-C95): does `root` lie inside a folder the user opened in Kolux? First every project
/// (Git or plain folder) and the workspaces folders, with no Git; then the worktrees Git lists for
/// a project that are its own (`linked_to`).
pub fn opened(app: &tauri::AppHandle) -> impl Fn(&Path) -> bool + '_ {
    use tauri::Manager;
    move |root| {
        let Some(store) = app.try_state::<Mutex<crate::state::Store>>() else { return false };
        if inside(root, &crate::links::roots(&store)) {
            return true;
        }
        let Some(git) = app.try_state::<crate::git::Git>() else { return false };
        let projects = store.lock().map(|s| crate::projects::load_projects(&s)).unwrap_or_default();
        projects.iter().any(|p| {
            let own: Vec<String> = git.worktrees(Path::new(&p.path)).unwrap_or_default().into_iter().map(|w| w.path).filter(|w| linked_to(Path::new(&p.path), Path::new(w))).collect();
            inside(root, &own)
        })
    }
}

/// X-sec.3: the request names this server: one Host line, 127.0.0.1:<port> or localhost:<port>.
/// A page on another name that was pointed at the loopback (DNS rebinding) is refused.
pub fn host_ok(head: &str, port: u16) -> bool {
    let hosts: Vec<&str> = head.lines().skip(1).take_while(|l| !l.is_empty()).filter_map(|l| l.split_once(':')).filter(|(k, _)| k.eq_ignore_ascii_case("host")).map(|(_, v)| v.trim()).collect();
    let ours = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    matches!(hosts.as_slice(), [h] if ours.iter().any(|o| h.eq_ignore_ascii_case(o)))
}

/// Is this path an HTML document on disk?
pub fn is_document(path: &str) -> bool {
    let p = Path::new(path);
    p.is_file() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.contains(&e.to_lowercase().as_str()))
}

/// The preview of a document: its address, folder and file name. T-659 (DT-C95): the document's
/// folder must be one `open` holds (`opened`); one token per folder for the run.
pub fn add(path: &str, open: &dyn Fn(&Path) -> bool) -> Result<Value, String> {
    if !is_document(path) {
        return Err(format!("{path} is not an HTML document on disk (.html or .htm)"));
    }
    let real = Path::new(path).canonicalize().map_err(|e| format!("{path}: {e}"))?;
    let root = real.parent().ok_or("the document has no folder")?.to_path_buf();
    if !open(&root) {
        return Err(format!("{} is not inside a project or workspace open in Kolux; a preview shows only documents from one", plain(&real)));
    }
    let file = real.file_name().unwrap_or_default().to_string_lossy().to_string();
    let port = port()?;
    let (token, granted) = {
        let mut p = PREVIEWS.lock().map_err(|e| e.to_string())?;
        match p.iter_mut().find(|p| p.root == root) {
            Some(p) => {
                if !p.files.contains(&file) {
                    p.files.push(file.clone());
                }
                (p.token.clone(), p.granted)
            }
            None => {
                let token = fresh_token()?;
                p.push(Preview { token: token.clone(), root: root.clone(), files: vec![file.clone()], granted: false });
                (token, false)
            }
        }
    };
    let url = format!("http://127.0.0.1:{port}/{token}/{}", encode(&file));
    Ok(json!({ "url": url, "folder": plain(&root), "file": file, "path": plain(&real), "granted": granted }))
}

/// A preview address taken apart: its token and the rest (the file, query and fragment).
#[cfg(test)]
fn split(url: &str, port: u16) -> Option<(&str, &str)> {
    url.strip_prefix(&format!("http://127.0.0.1:{port}/"))?.split_once('/')
}

/// The folder path a request's rest names, or why it may not: a parent step (`..`, in either
/// slash), a root (`/x`, `\x`), a drive or `\\?\` prefix, or a NUL. The rest is already decoded.
/// Pure; `respond` canonicalizes the result and checks it again against the real folder, so a
/// link or junction inside the folder cannot lead out either.
pub fn fenced(root: &Path, rest: &str) -> Result<PathBuf, &'static str> {
    if rest.contains('\0') {
        return Err("a preview stays in its folder (NUL in the path)");
    }
    let rest = rest.trim_start_matches('/');
    for part in rest.split(['/', '\\']) {
        if part == ".." {
            return Err("a preview stays in its folder (no parent steps)");
        }
    }
    let p = Path::new(rest);
    if p.components().any(|c| matches!(c, Component::Prefix(_) | Component::RootDir | Component::ParentDir)) || rest.starts_with('\\') || rest.contains(':') {
        return Err("a preview stays in its folder (no absolute paths)");
    }
    Ok(root.join(rest))
}

fn plain(p: &Path) -> String {
    p.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

fn encode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~/".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            // A multi-byte character after the % is not a split point: get() keeps it from panicking.
            if let Some(v) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The answer to one GET: status, media type and body. Pure, so it is tested without a socket.
pub fn respond(previews: &[Preview], target: &str) -> (u16, &'static str, Vec<u8>) {
    respond_within(previews, target, FILE_MAX)
}

/// `respond` with the file size ceiling as a parameter (the tests use a small one).
pub fn respond_within(previews: &[Preview], target: &str, max: u64) -> (u16, &'static str, Vec<u8>) {
    let path = target.split(['?', '#']).next().unwrap_or_default();
    let Some((token, rest)) = path.trim_start_matches('/').split_once('/') else {
        return (404, "text/plain", b"not a preview address".to_vec());
    };
    let Some(p) = previews.iter().find(|p| p.token == token) else {
        return (404, "text/plain", b"no such preview".to_vec());
    };
    let file = match fenced(&p.root, &decode(rest)) {
        Ok(f) => f,
        Err(why) => return (403, "text/plain", why.as_bytes().to_vec()),
    };
    let file = if file.is_dir() { file.join("index.html") } else { file };
    let (real, root) = match (file.canonicalize(), p.root.canonicalize()) {
        (Ok(real), Ok(root)) if real.starts_with(&root) => (real, root),
        (Ok(_), Ok(_)) => return (403, "text/plain", b"a preview stays in its folder (the file leads outside it)".to_vec()),
        _ => return (404, "text/plain", b"not found".to_vec()),
    };
    // BROW-040: until the folder is allowed, only the documents opened are read.
    if !p.granted && !p.files.iter().any(|f| real.strip_prefix(&root).is_ok_and(|r| r == Path::new(f))) {
        return (403, "text/plain", b"this preview reads only its own document until its folder is allowed (Allow folder, next to the file's name)".to_vec());
    }
    match std::fs::metadata(&real).map(|m| m.len()) {
        Ok(len) if len > max => (413, "text/plain", format!("this file is {} MB; a preview serves files up to {} MB", len >> 20, max >> 20).into_bytes()),
        _ => match std::fs::read(&real) {
            Ok(bytes) => (200, mime(&real), bytes),
            Err(_) => (404, "text/plain", b"not found".to_vec()),
        },
    }
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("wasm") => "application/wasm",
        Some("pdf") => "application/pdf",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn serve(mut s: TcpStream) {
    let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < REQUEST_MAX {
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let mut words = head.lines().next().unwrap_or_default().split(' ');
    let port = PORT.get().copied().unwrap_or_default();
    let (status, kind, body) = match (words.next(), words.next()) {
        _ if !host_ok(&head, port) => (403, "text/plain", b"a preview answers only at its own loopback address".to_vec()),
        (Some("GET") | Some("HEAD"), Some(target)) => respond(&PREVIEWS.lock().map(|p| p.clone()).unwrap_or_default(), target),
        _ => (405, "text/plain", b"GET only".to_vec()),
    };
    let reason = match status {
        200 => "OK",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        _ => "Not Found",
    };
    let _ = write!(s, "HTTP/1.1 {status} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    if head.starts_with("GET") {
        let _ = s.write_all(&body);
    }
    let _ = s.flush();
}

/// The front end asks for a document's preview address (a drop or a menu); the command line goes
/// through `add` itself.
/// T-659: the open folders are read off the main thread (Git may list a project's worktrees).
#[tauri::command]
pub async fn browser_preview(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || add(&path, &opened(&app))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-preview-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("css")).unwrap();
        std::fs::write(dir.join("index.html"), "<link rel=stylesheet href=css/a.css><h1>Hi</h1>").unwrap();
        std::fs::write(dir.join("css").join("a.css"), "h1{color:red}").unwrap();
        std::fs::write(dir.join("a b.html"), "<p>space</p>").unwrap();
        dir
    }

    /// The site's index.html opened as a preview (token t1), its folder allowed or not.
    fn open(dir: &Path, granted: bool) -> Preview {
        Preview { token: "t1".into(), root: dir.to_path_buf(), files: vec!["index.html".into()], granted }
    }

    const SECRET: &[u8] = b"outside the folder";

    #[test]
    fn brow040_a_preview_reads_only_its_own_document_until_the_folder_is_allowed() {
        let dir = site("grant");
        let mut p = vec![open(&dir, false)];
        assert_eq!(respond(&p, "/t1/index.html").0, 200, "the document itself");
        assert_eq!(respond(&p, "/t1/").0, 200, "the folder answers with the opened index");
        let (s, _, body) = respond(&p, "/t1/css/a.css");
        assert_eq!(s, 403, "the stylesheet beside it is not read yet");
        assert!(String::from_utf8_lossy(&body).contains("Allow folder"), "the refusal explains itself");
        assert_eq!(respond(&p, "/t1/a%20b.html").0, 403, "another document in the folder is not read either");
        p[0].granted = true;
        assert_eq!(respond(&p, "/t1/css/a.css").0, 200);
        assert_eq!(respond(&p, "/t1/a%20b.html").0, 200);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn brow040_parent_steps_roots_prefixes_backslashes_and_nul_are_refused_before_the_join() {
        let root = Path::new("G:/w/site");
        for bad in ["../x", "a/../../x", "..\\x", "a\\..\\x", "..", "/../x", "\\x", "C:\\x", "C:x", "\\\\?\\C:\\x", "\\\\server\\share", "a\0b", "%2e%2e/x", "a%5c..%5cx"] {
            let rest = decode(bad);
            assert!(fenced(root, &rest).is_err(), "{bad:?} must be refused");
        }
        assert_eq!(fenced(root, "/a/b.css").unwrap(), root.join("a/b.css"), "a leading slash is the folder itself");
        assert_eq!(fenced(root, "a%2eb.css").unwrap(), root.join("a%2eb.css"), "an undecoded percent is a plain name (decoded once, upstream)");
    }

    #[test]
    fn brow040_a_link_or_junction_inside_the_folder_leads_nowhere_outside_it() {
        let dir = site("link");
        let outside = dir.parent().unwrap().join(format!("kolux-preview-outside-{}", std::process::id()));
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), SECRET).unwrap();
        std::fs::write(outside.join("index.html"), SECRET).unwrap();
        let p = vec![open(&dir, true)];
        // A sibling of the root is not under it, whichever way it is spelled.
        assert_eq!(respond(&p, "/t1/../kolux-preview-outside-x/secret.txt").0, 403);
        let link = dir.join("link");
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&outside, &link).is_ok()
            || std::process::Command::new("cmd").args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()]).output().is_ok_and(|o| o.status.success());
        #[cfg(not(windows))]
        let made = std::os::unix::fs::symlink(&outside, &link).is_ok();
        assert!(made, "a directory link or junction could not be made under the temp dir");
        assert_eq!(std::fs::read(link.join("secret.txt")).unwrap(), SECRET, "the link does reach outside on disk");
        let (s, _, body) = respond(&p, "/t1/link/secret.txt");
        assert_eq!(s, 403, "through the link the file lies outside the real folder");
        assert_ne!(body, SECRET);
        let (s, _, body) = respond(&p, "/t1/link/");
        assert_eq!(s, 403, "and so does its index");
        assert_ne!(body, SECRET);
        // A file link (needs a privilege on Windows; skipped when it cannot be made).
        let flink = dir.join("secret-link.txt");
        #[cfg(windows)]
        let fmade = std::os::windows::fs::symlink_file(outside.join("secret.txt"), &flink).is_ok();
        #[cfg(not(windows))]
        let fmade = std::os::unix::fs::symlink(outside.join("secret.txt"), &flink).is_ok();
        if fmade {
            let (s, _, body) = respond(&p, "/t1/secret-link.txt");
            assert_eq!(s, 403);
            assert_ne!(body, SECRET);
        } else {
            eprintln!("file symlink not made (no privilege): that case not exercised here");
        }
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn brow040_a_file_past_the_ceiling_is_explained_not_served() {
        let dir = site("large");
        let p = vec![open(&dir, true)];
        let (s, _, body) = respond_within(&p, "/t1/css/a.css", 4);
        assert_eq!(s, 413);
        assert!(String::from_utf8_lossy(&body).contains("up to 0 MB"), "{}", String::from_utf8_lossy(&body));
        assert_eq!(respond_within(&p, "/t1/css/a.css", 4096).0, 200);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn brow039_a_preview_serves_its_folder_and_nothing_outside_it() {
        let dir = site("serve");
        let p = vec![open(&dir, true)];
        let (s, k, b) = respond(&p, "/t1/index.html?x=1");
        assert_eq!((s, k), (200, "text/html; charset=utf-8"));
        assert!(b.starts_with(b"<link"));
        assert_eq!(respond(&p, "/t1/css/a.css").1, "text/css; charset=utf-8");
        assert_eq!(respond(&p, "/t1/").0, 200, "a folder answers with its index");
        assert_eq!(respond(&p, "/t1/a%20b.html").2, b"<p>space</p>");
        assert_eq!(respond(&p, "/t1/../secret.txt").0, 403);
        assert_eq!(respond(&p, "/t1/css/..%2F..%2Fsecret.txt").0, 403);
        assert_eq!(respond(&p, "/t1/missing.css").0, 404);
        assert_eq!(respond(&p, "/nope/index.html").0, 404);
        assert_eq!(respond(&p, "/t1").0, 404);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn brow039_a_document_gets_a_loopback_address_and_the_address_names_the_document() {
        let dir = site("add");
        let doc = dir.join("index.html").to_string_lossy().to_string();
        assert!(is_document(&doc));
        assert!(!is_document(&dir.join("css").join("a.css").to_string_lossy()));
        assert!(!is_document("https://example.com/index.html"));
        let open = [dir.to_string_lossy().to_string()];
        let v = add(&doc, &within(&open)).unwrap();
        let url = v["url"].as_str().unwrap();
        assert!(url.starts_with("http://127.0.0.1:") && url.ends_with("/index.html"), "{url}");
        assert_eq!(v["file"], "index.html");
        assert_eq!(split(url, *PORT.get().unwrap()).map(|(_, f)| f), Some("index.html"), "the address names the document");
        assert!(split("https://example.com/", *PORT.get().unwrap()).is_none());
        assert!(add(&dir.join("css").join("a.css").to_string_lossy(), &within(&open)).unwrap_err().contains("not an HTML document"));
        // The same folder keeps one token, so two documents share the port and prefix.
        let v2 = add(&dir.join("a b.html").to_string_lossy(), &within(&open)).unwrap();
        assert_eq!(v2["url"].as_str().unwrap().rsplit_once('/').unwrap().0, url.rsplit_once('/').unwrap().0);
        assert!(v2["url"].as_str().unwrap().ends_with("/a%20b.html"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t659_a_token_worked_out_from_the_folder_path_reaches_nothing() {
        let dir = site("guess");
        let open = [dir.to_string_lossy().to_string()];
        let url = add(&dir.join("index.html").to_string_lossy(), &within(&open)).unwrap()["url"].as_str().unwrap().to_string();
        let (token, _) = split(&url, *PORT.get().unwrap()).unwrap();
        assert!(token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit()), "{token}");
        // The old token: the fixed-key hash of the lower-cased real folder, the same on every run.
        let guessed = {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            dir.canonicalize().unwrap().to_string_lossy().to_lowercase().hash(&mut h);
            format!("{:016x}", h.finish())
        };
        assert_ne!(token, guessed);
        let all = PREVIEWS.lock().unwrap().clone();
        assert_eq!(respond(&all, &format!("/{guessed}/index.html")).0, 404, "a token worked out from the path gets nothing");
        assert_eq!(respond(&all, &format!("/{token}/index.html")).0, 200);
        assert_ne!(fresh_token().unwrap(), fresh_token().unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t659_a_request_addressed_to_another_host_name_is_refused() {
        let ok = |h: &str| host_ok(&format!("GET /t/x HTTP/1.1\r\n{h}\r\nAccept: */*\r\n\r\n"), 4000);
        assert!(ok("Host: 127.0.0.1:4000"));
        assert!(ok("host: LOCALHOST:4000"));
        for bad in ["Host: rebound.example:4000", "Host: 127.0.0.1:4001", "Host: 127.0.0.1", "Host: 127.0.0.1:4000.rebound.example", "Host: [::1]:4000", "X-Host: 127.0.0.1:4000", ""] {
            assert!(!ok(bad), "{bad}");
        }
        assert!(!host_ok("GET /t/x HTTP/1.1\r\nHost: 127.0.0.1:4000\r\nHost: rebound.example:4000\r\n\r\n", 4000), "two Host lines");
        assert!(!host_ok("GET /t/x HTTP/1.1\r\n\r\nHost: 127.0.0.1:4000\r\n", 4000), "a Host line after the headers is body");
        // Through the real server: the same request for an opened document, under two names.
        let dir = site("host");
        let open = [dir.to_string_lossy().to_string()];
        let url = add(&dir.join("index.html").to_string_lossy(), &within(&open)).unwrap()["url"].as_str().unwrap().to_string();
        let port = *PORT.get().unwrap();
        let path = url.split_once(&format!(":{port}")).unwrap().1.to_string();
        let ask = |host: String| {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(s, "GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
            out
        };
        assert!(ask(format!("rebound.example:{port}")).starts_with("HTTP/1.1 403"), "a rebound name gets 403");
        assert!(ask(format!("127.0.0.1:{port}")).starts_with("HTTP/1.1 200"), "the loopback address gets the document");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The open-folder test the commands use, for a fixed list of folders.
    fn within(folders: &[String]) -> impl Fn(&Path) -> bool + '_ {
        move |r| inside(r, folders)
    }

    #[test]
    fn t659_a_document_outside_every_open_folder_is_not_previewed() {
        let dir = site("fence");
        let doc = dir.join("index.html").to_string_lossy().to_string();
        let parent = dir.parent().unwrap().to_string_lossy().to_string();
        // A real folder whose name the document's folder only starts with ("…fence" vs "…fence-<pid>").
        let prefix = dir.parent().unwrap().join("kolux-preview-fence");
        std::fs::create_dir_all(&prefix).unwrap();
        let sibling = prefix.to_string_lossy().to_string();
        assert!(dir.to_string_lossy().starts_with(&*sibling), "the look-alike is a text prefix of the folder");
        assert!(add(&doc, &within(&[])).unwrap_err().contains("not inside a project or workspace"));
        assert!(add(&doc, &within(std::slice::from_ref(&sibling))).is_err(), "a folder whose name it only starts with does not hold it");
        assert!(add(&doc, &within(&[dir.join("css").to_string_lossy().to_string(), ".".into(), String::new()])).is_err(), "a subfolder, a relative path or nothing does not hold it");
        assert!(add(&doc, &within(&[parent])).is_ok(), "the open folder that holds it does");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir(&prefix);
    }

    #[test]
    fn t659_only_a_worktree_whose_git_file_points_back_into_the_project_counts() {
        let base = std::env::temp_dir().join(format!("kolux-preview-wt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let project = base.join("project");
        let other = base.join("other");
        for d in [project.join(".git/worktrees/x"), other.join(".git/worktrees/x"), base.join("good"), base.join("forged"), base.join("plain/.git"), base.join("none")] {
            std::fs::create_dir_all(d).unwrap();
        }
        let point = |wt: &str, at: &Path| std::fs::write(base.join(wt).join(".git"), format!("gitdir: {}\n", at.join(".git/worktrees/x").display())).unwrap();
        point("good", &project);
        point("forged", &other);
        assert!(linked_to(&project, &base.join("good")));
        assert!(!linked_to(&project, &base.join("forged")), "a worktree of another repository");
        assert!(!linked_to(&project, &base.join("plain")), "a main checkout (a .git folder), e.g. a repository the project sits in");
        assert!(!linked_to(&project, &base.join("none")), "a folder with no .git at all");
        assert!(!linked_to(&project, &base), "a parent of the project");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn t659_a_percent_before_a_multi_byte_character_does_not_panic() {
        assert_eq!(decode("%a\u{e9}x"), "%a\u{e9}x");
        assert_eq!(decode("a%20b"), "a b");
    }
}
