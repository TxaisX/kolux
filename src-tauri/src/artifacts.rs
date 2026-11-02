//! The Artifacts library (SKILL-036, VIEW-012): HTML pages kept in the app's own folder so they
//! can be viewed with no network. Each entry is a folder holding the page and the files it points
//! to by relative path, plus one line in `library.json`. The viewer loads entries through the
//! `kolux-artifact` scheme, which serves only that entry's files.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

pub const SCHEME: &str = "kolux-artifact";
/// Where the web view puts the scheme: Windows' web view reaches custom schemes over http.
const ORIGIN: &str = if cfg!(windows) { "http://kolux-artifact.localhost" } else { "kolux-artifact://localhost" };
const MAX_PAGE: u64 = 10 * 1024 * 1024;
/// A single file that is not a page (an image, a video, an audio track, a document, a PDF) is kept
/// whole, so it gets a larger cap than one page; the viewer plays or shows the kinds it can and
/// hands the rest to the system.
const MAX_FILE: u64 = 100 * 1024 * 1024;
const MAX_ASSETS: usize = 100;
const MAX_ASSET: u64 = 10 * 1024 * 1024;
const MAX_TOTAL: u64 = 50 * 1024 * 1024;
/// Script hosts whose files are fetched into an entry so it still runs offline (SKILL-035). Each
/// ends in '/'; `cdn_url` judges a parsed address against them, never a string prefix.
const CDNS: [&str; 5] = ["https://cdnjs.cloudflare.com/", "https://cdn.jsdelivr.net/npm/", "https://unpkg.com/", "https://cdn.tailwindcss.com/", "https://code.jquery.com/"];
const MAX_SCRIPTS: usize = 16;
const MAX_SCRIPT: usize = 5 * 1024 * 1024;
/// The most one ranged answer carries. A browser asks `bytes=0-` for every media load and after each
/// seek, then often drops the connection once it has the header, so a 100 MB clip is not read into
/// memory on the web view's thread for each; Content-Range tells it the real length and it asks
/// again from where the answer ended.
const CHUNK: u64 = 8 * 1024 * 1024;

/// Where a page came from: a file added by hand, or a Claude publish (one entry per URL).
pub struct Origin {
    pub origin: String,
    pub source: &'static str,
    pub project: Option<String>,
    pub session: Option<String>,
    /// When it was added or published, in milliseconds since 1970: an older publish never replaces a newer one.
    pub at: u64,
}

impl Origin {
    pub fn hand(src: &Path) -> Origin {
        Origin { origin: src.to_string_lossy().into_owned(), source: "hand", project: None, session: None, at: now_ms() }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Stable for one origin, so adding or publishing the same page again refreshes its entry.
    pub id: String,
    pub title: String,
    /// "hand" for Add artifact, "claude" for a page a Claude session published or a file it wrote.
    pub source: String,
    /// "page", "image", "text", "pdf" or "other": what the stored file is, so the viewer knows
    /// whether it can show it itself. An entry written before this field existed is a page.
    #[serde(default = "kind_page")]
    pub kind: String,
    /// The file path (or, for a publish, the URL) the page came from: one entry per origin.
    pub origin: String,
    pub project: Option<String>,
    pub session: Option<String>,
    /// Milliseconds since 1970.
    pub added: u64,
    pub size: u64,
    /// The stored page's path inside the entry's folder, with forward slashes.
    pub page: String,
    /// "ok", "unavailable" (on a network share, never read) or "remote" (a machine this one cannot read).
    pub state: String,
    /// The origin file's own (modified ms, length) when it was stored, so the workspace scan can tell
    /// the exact file it holds from a changed one; `size` holds a page's assets and scripts too. None
    /// for an entry stored before this field existed, or one whose file was never read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamp: Option<(u64, u64)>,
}

/// The removed entries the workspace scan must not bring back: origin -> the file's (modified ms,
/// length) at removal. A later rewrite has a new stamp and is imported again. Kept beside
/// library.json in its own file, so the index keeps its shape for an older build.
const REMOVED: &str = "removed.json";

/// An entry as the library page gets it: whether its stored page is still on disk.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    #[serde(flatten)]
    entry: Entry,
    stored: bool,
}

pub struct Library {
    dir: PathBuf,
    lock: Mutex<()>,
}

/// An origin that is a Windows path is written one way before it is hashed, so the same file reached as
/// `c:/Users/me/a.html`, `C:\Users\me\a.html` or `\\?\C:\Users\me\a.html` is one entry, not two. The
/// usual form (upper-case drive letter, backslashes) is the one kept, so ids already stored do not
/// change. A URL or a Unix path is left alone.
fn normalized_origin(origin: &str) -> std::borrow::Cow<'_, str> {
    let o = origin.strip_prefix(r"\\?\").unwrap_or(origin);
    let b = o.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\') {
        return format!("{}{}", (b[0] as char).to_ascii_uppercase(), o[1..].replace('/', "\\")).into();
    }
    origin.into()
}

/// FNV-1a: a short id that stays the same for the same origin on every run and every build.
fn id_of(origin: &str) -> String {
    let origin = normalized_origin(origin);
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in origin.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A page on a network share is never opened. WSL's own shares count as this machine.
pub fn on_network_share(path: &Path) -> bool {
    let s = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    if let Some(rest) = s.strip_prefix("\\\\?\\") {
        return rest.starts_with("unc\\") && !(rest.starts_with("unc\\wsl$\\") || rest.starts_with("unc\\wsl.localhost\\"));
    }
    if s.starts_with("\\\\") {
        return !(s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\"));
    }
    mapped_network_drive(&s)
}

#[cfg(windows)]
fn mapped_network_drive(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 2 || b[1] != b':' {
        return false;
    }
    let root: Vec<u16> = format!("{}:\\", b[0] as char).encode_utf16().chain([0]).collect();
    // SAFETY: a NUL-terminated wide string that lives across the call.
    unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(root.as_ptr()) == 4 } // DRIVE_REMOTE
}

#[cfg(not(windows))]
fn mapped_network_drive(_s: &str) -> bool {
    false // ponytail: network mounts on macOS and Linux are not told apart yet
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

fn kind_page() -> String {
    "page".into()
}

/// What a stored file is, from its extension. Only a page is copied with the files it points to
/// and made offline; the rest are kept whole and shown by the viewer when it can render them.
pub fn kind_of(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default().as_str() {
        "html" | "htm" => "page",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" | "ico" => "image",
        "mp4" | "webm" | "mov" | "m4v" | "ogv" | "mkv" | "avi" => "video",
        "mp3" | "wav" | "m4a" | "ogg" | "oga" | "flac" | "aac" | "opus" => "audio",
        "md" | "txt" | "csv" | "log" | "json" => "text",
        "pdf" => "pdf",
        _ => "other",
    }
}

/// The file types an agent's new file is kept from. Anything else it writes is source, not an
/// artifact, and stays out of the library.
pub const KEPT: &[&str] = &[
    "html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "md", "txt", "csv",
    "docx", "xlsx", "pptx", "zip",
    "mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi",
    "mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "opus",
];

/// A file in a workspace's explicit `artifacts/` folder is a deliverable by definition, so every
/// top-level file counts there even when the same extension would be source elsewhere. Dotfiles and
/// half-written downloads are not deliverables.
fn is_workspace_file(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    if name.starts_with('.') {
        return false;
    }
    let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    !matches!(ext.as_str(), "tmp" | "part" | "crdownload" | "lock")
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
}

/// The page's title element, tidied and cut to 200 characters; None when there is no usable one.
pub fn title_of(html: &str) -> Option<String> {
    let low = html.to_ascii_lowercase();
    let open = low.find("<title")?;
    let start = open + low[open..].find('>')? + 1;
    let end = start + low[start..].find("</title")?;
    let t = unescape(&html[start..end]).split_whitespace().collect::<Vec<_>>().join(" ");
    (!t.is_empty()).then(|| t.chars().take(200).collect())
}

fn pct(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap_or(b'%'));
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The relative paths the page points to through src, href and poster attributes, without query
/// or fragment. Absolute URLs, root paths, data and other schemes, and fragment-only links are left
/// out. ponytail: CSS url() and srcset are not followed; add them when a page needs them offline.
pub fn relative_refs(html: &str) -> Vec<String> {
    let low = html.to_ascii_lowercase();
    let b = html.as_bytes();
    let mut out = Vec::new();
    for name in ["src", "href", "poster"] {
        let pat = format!("{name}=");
        let mut from = 0;
        while let Some(k) = low[from..].find(&pat) {
            let at = from + k;
            from = at + pat.len();
            if at == 0 || !b[at - 1].is_ascii_whitespace() {
                continue;
            }
            let mut i = from;
            let (q, start) = match b.get(i) {
                Some(&c) if c == b'"' || c == b'\'' => {
                    i += 1;
                    (Some(c), i)
                }
                _ => (None, i),
            };
            while i < b.len() && (if let Some(q) = q { b[i] != q } else { !b[i].is_ascii_whitespace() && b[i] != b'>' }) {
                i += 1;
            }
            let v = unescape(html[start..i].trim());
            let v = v.split(['?', '#']).next().unwrap_or("").to_string();
            let scheme = v.find(':').is_some_and(|c| !v[..c].contains('/'));
            if v.is_empty() || scheme || v.starts_with('/') || v.starts_with('\\') {
                continue;
            }
            out.push(pct(&v));
        }
    }
    out
}

/// A path inside an entry's folder from forward-slash parts; None if a part would climb out.
fn inside(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = base.to_path_buf();
    for part in rel.split(['/', '\\']).filter(|s| !s.is_empty() && *s != ".") {
        if matches!(Path::new(part).components().next(), Some(Component::Normal(_))) && Path::new(part).components().count() == 1 {
            p.push(part);
        } else {
            return None;
        }
    }
    Some(p)
}

/// Whether `url` is a script on one of CDNS: https, no user name before the host, exactly that
/// host, and a path under the listed one. A look-alike host (cdn.tailwindcss.com.evil.example), a
/// user name that makes the real host another (cdn.tailwindcss.com@evil.example), plain http and
/// a jsdelivr path outside /npm/ are not, so the scan never fetches from a host outside the list.
pub fn cdn_url(url: &str) -> bool {
    let Ok(u) = tauri::Url::parse(url.trim()) else { return false };
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() || u.port().is_some() {
        return false;
    }
    let Some(host) = u.host_str() else { return false };
    CDNS.iter().filter_map(|c| tauri::Url::parse(c).ok()).any(|c| c.host_str() == Some(host) && u.path().starts_with(c.path()))
}

/// The spans of script src values that point at an allow-listed CDN (`cdn_url`).
pub fn cdn_scripts(html: &str) -> Vec<(usize, usize)> {
    let low = html.to_ascii_lowercase();
    let b = html.as_bytes();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(k) = low[from..].find("<script") {
        let open = from + k;
        let close = low[open..].find('>').map_or(low.len(), |c| open + c);
        from = open + 7;
        let Some(at) = (open..close.saturating_sub(4)).find(|&i| b[i].is_ascii_whitespace() && low[i + 1..].starts_with("src=")) else { continue };
        let mut i = at + 5;
        let q = b.get(i).copied().filter(|&c| c == b'"' || c == b'\'');
        if q.is_some() {
            i += 1;
        }
        let start = i;
        while i < close && (if let Some(q) = q { b[i] != q } else { !b[i].is_ascii_whitespace() }) {
            i += 1;
        }
        if cdn_url(&unescape(&html[start..i])) {
            out.push((start, i));
        }
    }
    out
}

/// Copies of the page's CDN scripts under `cdn/`, and the page pointing at them; None when none
/// was fetched. A script that cannot be fetched keeps its original address.
fn vendor_scripts(html: &str, tmp: &Path, fetch: &dyn Fn(&str) -> Option<Vec<u8>>, total: &mut u64) -> Option<String> {
    let mut page = html.to_string();
    let mut fetched = false;
    for (n, (start, end)) in cdn_scripts(html).into_iter().take(MAX_SCRIPTS).enumerate().collect::<Vec<_>>().into_iter().rev() {
        let Some(body) = fetch(&unescape(&html[start..end])).filter(|b| b.len() <= MAX_SCRIPT) else { continue };
        if *total + body.len() as u64 > MAX_TOTAL || fs::create_dir_all(tmp.join("cdn")).is_err() || fs::write(tmp.join("cdn").join(format!("{n}.js")), &body).is_err() {
            continue;
        }
        *total += body.len() as u64;
        page.replace_range(start..end, &format!("cdn/{n}.js"));
        fetched = true;
    }
    fetched.then_some(page)
}

/// `b` with the saved proxy plan applied (T-323-b, APP-032). The error never carries the address.
fn proxied(plan: &crate::resources::app_http::Plan, b: reqwest::ClientBuilder) -> Result<reqwest::ClientBuilder, String> {
    use crate::resources::app_proxy::Route;
    let b = match &plan.route {
        Route::Default => b,
        Route::Direct => b.no_proxy(),
        Route::Via(p) => b.proxy(reqwest::Proxy::all(p.as_str()).map_err(|_| "the network proxy setting cannot be used by this build; app traffic that needs it stays off until it is cleared".to_string())?),
    };
    Ok(if plan.http1 { b.http1_only() } else { b })
}

/// The most redirects one script fetch follows (`follow_cdn_redirect`).
const MAX_REDIRECTS: usize = 5;

/// Whether a script fetch that began at `first` follows a redirect to `next`, `hops` requests in:
/// only to an address `cdn_url` accepts (https, no user name, a listed path) on the very host the
/// fetch began on, and only for a few hops. The CDNs answer their own documented tags this way
/// (cdn.tailwindcss.com sends 302 to /3.4.17, unpkg a version range to the exact version), so
/// refusing every redirect would leave those pages needing the network; a redirect to another
/// host, even a listed one, off the list, or down to plain http, is never followed.
fn follow_cdn_redirect(first: &str, next: &str, hops: usize) -> bool {
    let host = |u: &str| tauri::Url::parse(u).ok().and_then(|u| u.host_str().map(str::to_owned));
    hops <= MAX_REDIRECTS && cdn_url(next) && host(first).is_some() && host(first) == host(next)
}

/// Fetches one CDN script for an entry, within the size cap; None on any failure. Only an address
/// `cdn_url` accepts is asked for, a redirect is followed only to another such address
/// (`follow_cdn_redirect`; a stopped one answers 3xx, which is not a success), and the body is read a chunk at a time and dropped the moment it passes the cap, so a reply without
/// a Content-Length cannot fill memory for the whole 20 s timeout first.
pub fn fetch_script(app: &tauri::AppHandle, url: &str) -> Option<Vec<u8>> {
    if !cdn_url(url) {
        return None;
    }
    // T-323-b (APP-032): through the saved proxy; a setting that cannot be used fetches nothing.
    let plan = crate::resources::app_http::plan_for(app, &url.parse().ok()?).ok()?;
    let builder = proxied(&plan, reqwest::Client::builder().redirect(reqwest::redirect::Policy::custom(|a| {
        let first = a.previous().first().map_or("", |u| u.as_str());
        if follow_cdn_redirect(first, a.url().as_str(), a.previous().len()) {
            a.follow()
        } else {
            a.stop()
        }
    }))).ok()?;
    tauri::async_runtime::block_on(async {
        let client = builder.timeout(std::time::Duration::from_secs(20)).build().ok()?;
        let mut r = client.get(url).send().await.ok()?;
        if !r.status().is_success() || r.content_length().is_some_and(|n| n > MAX_SCRIPT as u64) {
            return None;
        }
        let mut body = Vec::new();
        while let Some(chunk) = r.chunk().await.ok()? {
            if body.len() + chunk.len() > MAX_SCRIPT {
                return None;
            }
            body.extend_from_slice(&chunk);
        }
        Some(body)
    })
}

/// Whether a Windows reparse tag is a cloud-files placeholder: IO_REPARSE_TAG_CLOUD (0x9000001A) and
/// CLOUD_1 to CLOUD_F (0x9000_x01A), the tags OneDrive Files On-Demand puts on a file, fully on the
/// disk or not. Only these are kept as the file itself. A symlink (0xA000000C) or a junction
/// (0xA0000003) names another file; any other tag (deduplication, WOF, app-exec links, a tag this
/// code has never seen) is refused too, because it is unknown what opening it reaches. Pure, so it
/// is tested everywhere.
#[cfg_attr(not(windows), allow(dead_code))]
fn reparse_is_cloud_file(tag: u32) -> bool {
    tag & 0xFFFF_0FFF == 0x9000_001A
}

/// Whether the real path of an opened file is acceptable: not on a network share, and (when the caller
/// names a root) under it.
fn real_path_ok(real: &Path, root: Option<&Path>) -> bool {
    !on_network_share(real) && root.is_none_or(|r| path_under(real, r))
}

/// `real` is `root` or inside it. Windows paths differ by case only, so they are compared in lower case.
fn path_under(real: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let lower = |p: &Path| PathBuf::from(p.to_string_lossy().to_lowercase());
        lower(real).starts_with(lower(root))
    }
    #[cfg(not(windows))]
    {
        real.starts_with(root)
    }
}

/// One source file, opened once and judged by its handle, so what is checked is what is copied. Its
/// real path is read from the handle too (GetFinalPathNameByHandleW), after every link on the way has
/// been followed or swapped, and has to be local and, when `root` is given, under it: a junction in
/// the middle of the path, or one swapped in after the path was checked, cannot reach a network share
/// or a file outside the workspace (T-624 round 3): a
/// link where the file should be is refused at open (O_NOFOLLOW; on Windows the reparse point is
/// opened itself and refused unless its tag is a cloud placeholder), a folder or device is not a file,
/// and a hard link to a file elsewhere (a second name for the same data, which no path check can
/// see) is refused by its link count. The metadata is the handle's (fstat), never a second look at
/// the path. On Windows a cloud placeholder (a OneDrive file) is opened again without
/// the reparse flag so the cloud filter can bring it down, and read only if that second handle is
/// the same file as the first (same volume and file index), so a link swapped in between is refused.
fn open_source(path: &Path, name: &str, root: Option<&Path>) -> Result<(fs::File, fs::Metadata), String> {
    let mut opts = fs::File::options();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        opts.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = opts.open(path).map_err(|e| format!("could not read {name}: {e}"))?;
    #[cfg(windows)]
    let file = {
        let tag = windows_file::reparse_tag(&file).map_err(|e| format!("could not read {name}: {e}"))?;
        match tag {
            None => file,
            Some(tag) if !reparse_is_cloud_file(tag) => return Err(format!("{name} is a link, not a file")),
            Some(_) => {
                let again = fs::File::open(path).map_err(|e| format!("could not read {name}: {e}"))?;
                if windows_file::identity(&file).is_none() || windows_file::identity(&file) != windows_file::identity(&again) {
                    return Err(format!("{name} changed while it was being read"));
                }
                again
            }
        }
    };
    #[cfg(windows)]
    {
        let real = windows_file::final_path(&file).ok_or_else(|| format!("could not read {name}: its real path is unknown"))?;
        if !real_path_ok(&real, root) {
            return Err(format!("{name} is on a network share or outside the folder it has to stay in, so it is not kept"));
        }
    }
    // The handle's real path is a Windows call; the other platforms keep the O_NOFOLLOW check above.
    #[cfg(not(windows))]
    let _ = root;
    let md = file.metadata().map_err(|e| format!("could not read {name}: {e}"))?;
    if !md.is_file() {
        return Err(format!("could not read {name}: it is not a file"));
    }
    if links_of(&file, &md) > 1 {
        return Err(format!("{name} is a hard link to another file, so it is not kept"));
    }
    Ok((file, md))
}

/// How many names a file has; a count that could not be read is treated as more than one.
fn link_count(n: Option<u64>) -> u64 {
    n.unwrap_or(u64::MAX)
}

#[cfg(unix)]
fn links_of(_file: &fs::File, md: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    link_count(Some(md.nlink()))
}

#[cfg(windows)]
fn links_of(file: &fs::File, _md: &fs::Metadata) -> u64 {
    link_count(windows_file::info(file).map(|i| i.nNumberOfLinks as u64))
}

/// What a Windows file handle says about itself.
#[cfg(windows)]
mod windows_file {
    use std::fs;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{FileAttributeTagInfo, GetFileInformationByHandle, GetFinalPathNameByHandleW, GetFileInformationByHandleEx, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO};

    pub fn info(file: &fs::File) -> Option<BY_HANDLE_FILE_INFORMATION> {
        // SAFETY: an open handle and a zeroed struct of the documented size, which the call fills.
        unsafe {
            let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
            (GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) != 0).then_some(info)
        }
    }

    /// The handle's real path (`\\?\C:\...`, or `\\?\UNC\...` on a share), with every link resolved.
    pub fn final_path(file: &fs::File) -> Option<std::path::PathBuf> {
        use std::os::windows::ffi::OsStringExt;
        let mut buf = vec![0u16; 1024];
        loop {
            // SAFETY: an open handle and a buffer of the length passed; flags 0 are VOLUME_NAME_DOS | FILE_NAME_NORMALIZED.
            let n = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle() as _, buf.as_mut_ptr(), buf.len() as u32, 0) } as usize;
            if n == 0 {
                return None;
            }
            if n < buf.len() {
                buf.truncate(n);
                return Some(std::ffi::OsString::from_wide(&buf).into());
            }
            buf.resize(n + 1, 0);
        }
    }

    /// The volume and file index: the same pair is the same file, whatever path reached it.
    pub fn identity(file: &fs::File) -> Option<(u32, u32, u32)> {
        info(file).map(|i| (i.dwVolumeSerialNumber, i.nFileIndexHigh, i.nFileIndexLow))
    }

    /// The handle's reparse tag, or None when it is not a reparse point.
    pub fn reparse_tag(file: &fs::File) -> std::io::Result<Option<u32>> {
        // SAFETY: an open handle and a zeroed FILE_ATTRIBUTE_TAG_INFO, with its size passed, for the
        // FileAttributeTagInfo class, which fills exactly that struct.
        unsafe {
            let mut tag: FILE_ATTRIBUTE_TAG_INFO = std::mem::zeroed();
            if GetFileInformationByHandleEx(file.as_raw_handle() as _, FileAttributeTagInfo, &mut tag as *mut _ as *mut core::ffi::c_void, std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32) == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok((tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0).then_some(tag.ReparseTag))
        }
    }
}

/// Copies at most `cap` bytes of `file` into `to` and returns how many; a file that grew past the
/// cap after its length was read is an error, never a cut-short copy.
fn copy_capped(file: &mut fs::File, to: &Path, cap: u64, name: &str) -> Result<u64, String> {
    let mut dest = fs::File::create(to).map_err(|e| e.to_string())?;
    let n = std::io::copy(&mut file.by_ref().take(cap + 1), &mut dest).map_err(|e| format!("could not read {name}: {e}"))?;
    if n > cap {
        drop(dest);
        let _ = fs::remove_file(to);
        return Err(format!("{name} is larger than {} MB", cap / (1024 * 1024)));
    }
    Ok(n)
}

impl Library {
    pub fn new(dir: PathBuf) -> Library {
        Library { dir, lock: Mutex::new(()) }
    }

    fn index(&self) -> PathBuf {
        self.dir.join("library.json")
    }

    fn read(&self) -> Vec<Entry> {
        fs::read(self.index()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write(&self, list: &[Entry]) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
        crate::files::write_text(&self.index(), &String::from_utf8_lossy(&text))
    }

    /// The removed origins the scan must leave alone (see REMOVED). Callers hold `lock`.
    pub fn removed(&self) -> HashMap<String, (u64, u64)> {
        fs::read(self.dir.join(REMOVED)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write_removed(&self, map: &HashMap<String, (u64, u64)>) {
        if map.is_empty() {
            let _ = fs::remove_file(self.dir.join(REMOVED));
            return;
        }
        if let Ok(text) = serde_json::to_vec_pretty(map) {
            let _ = fs::create_dir_all(&self.dir);
            let _ = crate::files::write_text(&self.dir.join(REMOVED), &String::from_utf8_lossy(&text));
        }
    }

    /// Forgets the tombstones of `origins` (a file stored again, or one that is gone).
    fn forget_removed(&self, origins: &[String]) {
        let mut map = self.removed();
        let before = map.len();
        map.retain(|k, _| !origins.contains(k));
        if map.len() != before {
            self.write_removed(&map);
        }
    }

    /// Newest first.
    pub fn list(&self) -> Vec<Listed> {
        let _g = self.lock.lock();
        let mut list = self.read();
        list.sort_by_key(|a| std::cmp::Reverse(a.added));
        list.into_iter().map(|e| Listed { stored: e.state == "ok" && self.dir.join(&e.id).join(&e.page).is_file(), entry: e }).collect()
    }

    /// Stores a page and the files it points to by relative path inside its own folder, under the
    /// caps, plus copies of the scripts it loads from the allow-listed CDNs (`fetch` gets one).
    /// A file that is not a page (an image, a document, a PDF) is stored whole, on its own.
    /// A page on a network share gets an "unavailable" entry without being read, and a path this
    /// machine cannot read (a WSL or SSH machine's) a "remote" one. The newest store of an origin
    /// replaces the old one; an older one is ignored, except that a store naming the Claude session
    /// that wrote the file replaces a newer workspace-scan one (the 3 s scan can reach the file before
    /// the Write capture does). A scan's refresh of an entry someone else made keeps who made it: its
    /// source, session and project.
    pub fn add(&self, src: &Path, from: Origin, fetch: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<Entry, String> {
        self.add_in(src, from, fetch, None)
    }

    pub fn add_in(&self, src: &Path, mut from: Origin, fetch: &dyn Fn(&str) -> Option<Vec<u8>>, root: Option<&Path>) -> Result<Entry, String> {
        let id = id_of(&from.origin);
        if let Some(old) = self.read().into_iter().find(|e| e.id == id) {
            if old.added > from.at && !(old.source == "workspace" && from.session.is_some()) {
                return Ok(old);
            }
            if from.source == "workspace" && old.source != "workspace" {
                from.source = if old.source == "claude" { "claude" } else { "hand" };
                from.session = old.session;
                from.project = old.project;
            }
        }
        let name = file_name(src);
        let kind = kind_of(src);
        let mut entry = Entry { id: id.clone(), title: name.clone(), source: from.source.into(), kind: kind.into(), origin: from.origin, project: from.project, session: from.session, added: from.at, size: 0, page: name.clone(), state: "unavailable".into(), stamp: None };
        if !src.is_absolute() {
            entry.state = "remote".into();
        } else if !on_network_share(src) {
            let (mut file, md) = open_source(src, &name, root)?;
            let len = md.len();
            let cap = if kind == "page" { MAX_PAGE } else { MAX_FILE };
            if len > cap {
                return Err(format!("{name} is larger than {} MB", cap / (1024 * 1024)));
            }
            entry.stamp = Some((modified_of(&md), len));
            let tmp = self.dir.join(format!(".new-{id}"));
            let _ = fs::remove_dir_all(&tmp);
            fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
            let mut size = len;
            if kind == "page" {
                let mut html = Vec::with_capacity(len as usize);
                file.by_ref().take(MAX_PAGE + 1).read_to_end(&mut html).map_err(|e| format!("could not read {name}: {e}"))?;
                if html.len() as u64 > MAX_PAGE {
                    return Err(format!("{name} is larger than {} MB", MAX_PAGE / (1024 * 1024)));
                }
                let text = String::from_utf8_lossy(&html);
                if let Some(t) = title_of(&text) {
                    entry.title = t;
                }
                size = self.copy_assets(src, &text, &name, &tmp, html.len() as u64);
                let page = vendor_scripts(&text, &tmp, fetch, &mut size);
                fs::write(tmp.join(&name), page.as_ref().map_or(&html[..], |p| p.as_bytes())).map_err(|e| e.to_string())?;
            } else {
                copy_capped(&mut file, &tmp.join(&name), MAX_FILE, &name)?;
            }
            entry.size = size;
            let dest = self.dir.join(&id);
            let _ = fs::remove_dir_all(&dest);
            fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
            entry.state = "ok".into();
        }
        let _g = self.lock.lock();
        let mut list = self.read();
        list.retain(|e| e.id != id);
        list.push(entry.clone());
        self.write(&list)?;
        // Stored again by hand, by a Claude Write or by the scan: an earlier remove no longer applies.
        self.forget_removed(std::slice::from_ref(&entry.origin));
        Ok(entry)
    }

    /// Copies what the page points to; returns the stored size. Nothing outside the page's folder,
    /// and each asset is opened once and copied from that handle (`open_source`), so a link put in
    /// its place after the path was checked is not followed.
    fn copy_assets(&self, src: &Path, html: &str, page: &str, tmp: &Path, mut total: u64) -> u64 {
        let Some(folder) = src.parent().and_then(|p| fs::canonicalize(p).ok()) else { return total };
        let mut seen = std::collections::HashSet::from([page.to_string()]);
        for r in relative_refs(html) {
            if seen.len() > MAX_ASSETS {
                break;
            }
            let Ok(real) = fs::canonicalize(folder.join(&r)) else { continue };
            let Ok(rel) = real.strip_prefix(&folder) else { continue }; // outside the page's own folder
            let rel = rel.to_string_lossy().replace('\\', "/");
            let Ok((mut file, md)) = open_source(&real, &rel, Some(&folder)) else { continue };
            if md.len() > MAX_ASSET || total + md.len() > MAX_TOTAL || !seen.insert(rel.clone()) {
                continue;
            }
            let Some(to) = inside(tmp, &rel) else { continue };
            if to.parent().is_some_and(|p| fs::create_dir_all(p).is_ok()) {
                if let Ok(n) = copy_capped(&mut file, &to, MAX_ASSET, &rel) {
                    total += n;
                }
            }
        }
        total
    }

    /// Drops the entry and its stored copy. When its origin is a file that is still there, the scan
    /// is told not to bring that exact file back (REMOVED); a URL origin leaves no such note. Only
    /// an entry the library read ("ok") is looked at again: an "unavailable" one sits on a network
    /// share, which the library never touches (DT-R21; a stat there can block for the share's
    /// timeout), and a "remote" one is on a machine this one cannot read; neither has a stamp to
    /// note, and the scan never imports from either.
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _g = self.lock.lock();
        let mut list = self.read();
        let gone: Vec<Entry> = list.iter().filter(|e| e.id == id).cloned().collect();
        list.retain(|e| e.id != id);
        self.write(&list)?;
        if id.bytes().all(|c| c.is_ascii_hexdigit()) && !id.is_empty() {
            let _ = fs::remove_dir_all(self.dir.join(id));
        }
        let mut removed = self.removed();
        let mut noted = false;
        for e in gone.into_iter().filter(|e| e.state == "ok") {
            let path = Path::new(&e.origin);
            if path.is_absolute() && !on_network_share(path) {
                if let Some(meta) = fs::metadata(path).ok().filter(|m| m.is_file()) {
                    removed.insert(e.origin.clone(), (modified_ms(path), meta.len()));
                    noted = true;
                }
            }
        }
        if noted {
            self.write_removed(&removed);
        }
        Ok(())
    }

    /// A stored file for the viewer: `/<id>/<path>`, never outside that entry's folder.
    pub fn open(&self, url_path: &str) -> Option<(PathBuf, &'static str)> {
        let path = pct(url_path);
        let (id, rest) = path.trim_start_matches('/').split_once('/')?;
        if id.len() != 16 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let file = inside(&self.dir.join(id), rest)?;
        file.is_file().then(|| (file, mime(rest)))
    }

    /// The whole stored file, for a page or a small one-shot read.
    pub fn file(&self, url_path: &str) -> Option<(Vec<u8>, &'static str)> {
        let (file, kind) = self.open(url_path)?;
        Some((fs::read(file).ok()?, kind))
    }
}

/// The folder a workspace keeps its finished artifacts in: `<workspace>/artifacts`.
pub const WORKSPACE_DIR: &str = "artifacts";

/// The most files one workspace's `artifacts/` folder brings into the library, and the most bytes
/// of them it keeps there. A cloned repository can hold thousands of small files, or many large
/// copies of one blob, there; past these the rest is left out and the page says so once.
pub const MAX_WORKSPACE_FILES: usize = 200;
pub const MAX_WORKSPACE_BYTES: u64 = 1024 * 1024 * 1024;

/// Every file directly in `<workspace>/artifacts`, in a stable order, whatever its extension, and
/// whether there were more than MAX_WORKSPACE_FILES (only the first that many by name are listed).
/// Subfolders are not entries: they hold a page's own assets (copied with the page) or a test run's
/// screenshots, not a second deliverable. The scan never leaves the folder: a link or junction where
/// the folder should be is not followed (read_dir would follow it; symlink_metadata's is_dir is false
/// for one, the idiom files::list_templates uses), a linked file inside it is not a file, and each
/// file's real path has to sit under the workspace's. A dotfile or a half-written download is not an
/// artifact.
pub fn workspace_files(workspace: &Path) -> (Vec<PathBuf>, bool) {
    let dir = workspace.join(WORKSPACE_DIR);
    if !fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir()) {
        return (Vec::new(), false);
    }
    let Ok(real_ws) = fs::canonicalize(workspace) else { return (Vec::new(), false) };
    let mut out: Vec<PathBuf> = fs::read_dir(&dir).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|kind| kind.is_file())).map(|e| e.path()).filter(|p| is_workspace_file(p)).collect();
    out.sort();
    let over = out.len() > MAX_WORKSPACE_FILES;
    out.truncate(MAX_WORKSPACE_FILES);
    // Real paths last, so a folder of thousands of names costs one stat each only for those kept.
    out.retain(|path| fs::canonicalize(path).is_ok_and(|real| real.starts_with(&real_ws)));
    (out, over)
}

fn modified_of(md: &fs::Metadata) -> u64 {
    md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).map(|m| modified_of(&m)).unwrap_or(0)
}

/// Last (modified, size) seen for each workspace file, so the page's 3 s scan does not re-add a file
/// that has not changed. One map for the app's life; the library is the durable record.
static SCANNED: OnceLock<Mutex<HashMap<String, (u64, u64)>>> = OnceLock::new();

/// What one scan did: how many entries it stored or refreshed, and one reason per file it could
/// not keep (over the cap, unreadable), so the page can tell the user once.
#[derive(Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scanned {
    pub changed: usize,
    pub skipped: Vec<String>,
}

/// Imports every kept file under `<workspace>/artifacts`, one entry per file. A changed file
/// (a new modified time or length, even an older time: a restore from a backup) refreshes its
/// origin instead of adding a second entry; the exact file the library holds, or one the user
/// removed since, is left alone. `seen` is the caller's memory of files it has judged, so a file
/// that cannot be kept is reported once and tried again only when it changes.
pub fn scan_workspace(lib: &Library, workspace: &Path, project: Option<String>, fetch: &dyn Fn(&str) -> Option<Vec<u8>>, seen: &mut HashMap<String, (u64, u64)>) -> Scanned {
    scan_capped(lib, workspace, project, fetch, seen, MAX_WORKSPACE_BYTES)
}

/// `scan_workspace` with the byte cap passed in, so a test can reach it without a gigabyte of files.
/// The cap counts the folder's files the library already holds as well as the ones stored now, so a
/// later tick does not top the library up past it.
fn scan_capped(lib: &Library, workspace: &Path, project: Option<String>, fetch: &dyn Fn(&str) -> Option<Vec<u8>>, seen: &mut HashMap<String, (u64, u64)>, max_bytes: u64) -> Scanned {
    // The real folder, judged as a path on disk: an ancestor junction to a share is a share, whatever the typed path says.
    let Ok(real_ws) = fs::canonicalize(workspace) else { return Scanned::default() };
    if on_network_share(&real_ws) {
        return Scanned::default();
    }
    let project = project.filter(|p| !p.trim().is_empty()).or_else(|| workspace.file_name().map(|n| n.to_string_lossy().into_owned()));
    // Per stored origin: the file's stamp and the whole entry's stored size (page, copied assets and scripts).
    let known: HashMap<String, (Option<(u64, u64)>, u64)> = lib.list().into_iter().map(|e| (e.entry.origin, (e.entry.stamp, e.entry.size))).collect();
    let removed = {
        let _g = lib.lock.lock();
        lib.removed()
    };
    let mut out = Scanned::default();
    let (files, over) = workspace_files(workspace);
    if over {
        out.skipped.push(format!("the artifacts folder holds more than {MAX_WORKSPACE_FILES} files; only the first {MAX_WORKSPACE_FILES} by name are kept"));
    }
    // Everything this folder already has in the library counts first, whatever order the files come in.
    let mut kept: u64 = files.iter().filter_map(|f| known.get(f.to_string_lossy().as_ref())).map(|k| k.1).sum();
    let mut full = false;
    for file in files {
        let Ok(meta) = fs::metadata(&file) else { continue };
        let stamp = (modified_ms(&file), meta.len());
        let key = file.to_string_lossy().into_owned();
        if seen.get(&key) == Some(&stamp) {
            continue;
        }
        // The library already holds this exact file, or the user removed this exact file: move on.
        if known.get(&key).map(|k| k.0) == Some(Some(stamp)) || removed.get(&key) == Some(&stamp) {
            seen.insert(key, stamp);
            continue;
        }
        // Over the folder's byte cap: left out, not remembered in `seen`, so it is stored once room is made.
        let held = kept - known.get(&key).map_or(0, |k| k.1);
        if held + stamp.1 > max_bytes {
            if !full {
                full = true;
                out.skipped.push(format!("the artifacts folder holds more than {} MB; the files past that are not kept", max_bytes / (1024 * 1024)));
            }
            continue;
        }
        // Added now: `added` is when the entry was stored, the file's own time lives in its stamp.
        let from = Origin { origin: key.clone(), source: "workspace", project: project.clone(), session: None, at: now_ms() };
        match lib.add_in(&file, from, fetch, Some(&real_ws)) {
            Ok(entry) => {
                out.changed += 1;
                kept = held + entry.size;
            }
            Err(e) => {
                eprintln!("artifacts: could not keep {}: {e}", file.display());
                out.skipped.push(e);
            }
        }
        seen.insert(key, stamp);
    }
    // A removed file that is gone from the folder needs no note any more. A note never names a share
    // (remove skips them), and one that somehow does is left alone rather than stat'ed every tick.
    let gone: Vec<String> = removed.keys().filter(|k| !on_network_share(Path::new(k)) && !Path::new(k).is_file()).cloned().collect();
    if !gone.is_empty() {
        let _g = lib.lock.lock();
        lib.forget_removed(&gone);
    }
    out
}

/// Scans the active workspace's `artifacts/` folder. The Artifacts page calls this when it opens and
/// every few seconds, so a page an agent writes lands in the tab without Add artifact. A network
/// share is left alone (DT-R21); the library never reads one. Async and on a blocking worker, like
/// `artifact_add`: the scan copies files of up to MAX_FILE and fetches a page's CDN scripts with a
/// 20 s timeout each, none of which may hold the window's thread (and the path checks stat a drive
/// that may be gone). A tick that finds the last scan still running does nothing; the next retries.
#[tauri::command]
pub async fn artifacts_scan(app: tauri::AppHandle, path: String, project: Option<String>) -> Result<Scanned, String> {
    use tauri::{Emitter, Manager};
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = PathBuf::from(path);
        if !workspace.is_absolute() || !workspace.is_dir() || on_network_share(&workspace) {
            return Ok(Scanned::default());
        }
        let lib = app.state::<Library>();
        let scanned = {
            let mut seen = match SCANNED.get_or_init(Default::default).try_lock() {
                Ok(seen) => seen,
                Err(std::sync::TryLockError::WouldBlock) => return Ok(Scanned::default()),
                Err(std::sync::TryLockError::Poisoned(e)) => e.into_inner(),
            };
            scan_workspace(lib.inner(), &workspace, project, &|u| fetch_script(&app, u), &mut seen)
        };
        if scanned.changed > 0 {
            let _ = app.emit(crate::capture::EVENT, ());
        }
        Ok(scanned)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" | "md" | "log" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "pdf" => "application/pdf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "opus" => "audio/opus",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

/// Clicked links leave the viewer: a link to another stored file of the same entry navigates in
/// place, one to anywhere else on the scheme goes nowhere, and anything else is handed to the app,
/// which opens it in the system browser.
fn link_script(base: &str) -> String {
    format!(
        "<script>document.addEventListener(\"click\",function(e){{var a=e.target&&e.target.closest&&e.target.closest(\"a[href]\");if(!a)return;var u=new URL(a.getAttribute(\"href\"),location.href);if(u.protocol===location.protocol&&u.host===location.host){{if(u.pathname.indexOf({base:?})!==0)e.preventDefault();return}}e.preventDefault();parent.postMessage({{koluxOpen:u.href}},\"*\")}},true)</script>"
    )
}

/// What a `Range` header asks for.
#[derive(Debug, PartialEq)]
enum RangeAsk {
    /// No usable range: the whole file.
    Whole,
    /// These bytes, both ends inclusive and clamped to the file.
    Part(u64, u64),
    /// A start at or past the end of the file: 416.
    Past,
}

/// A `Range: bytes=start-end` request against a file of `total` bytes, clamped to the file. A
/// suffix (`bytes=-N`) asks for the last N bytes; malformed, reversed and multi-part ranges get the
/// whole file instead of an error, which every browser can still play; a start past the end is a 416.
fn parse_range(header: &str, total: u64) -> RangeAsk {
    let Some(spec) = header.trim().strip_prefix("bytes=") else { return RangeAsk::Whole };
    if spec.contains(',') || total == 0 {
        return RangeAsk::Whole;
    }
    let Some((a, b)) = spec.split_once('-') else { return RangeAsk::Whole };
    if a.trim().is_empty() {
        return match b.trim().parse::<u64>() {
            Ok(n) if n > 0 => RangeAsk::Part(total.saturating_sub(n), total - 1),
            _ => RangeAsk::Whole,
        };
    }
    let Ok(start) = a.trim().parse::<u64>() else { return RangeAsk::Whole };
    let end = if b.trim().is_empty() {
        None
    } else {
        match b.trim().parse::<u64>() {
            Ok(end) => Some(end),
            Err(_) => return RangeAsk::Whole,
        }
    };
    if end.is_some_and(|end| end < start) {
        return RangeAsk::Whole;
    }
    if start >= total {
        return RangeAsk::Past;
    }
    RangeAsk::Part(start, end.map_or(total - 1, |end| end.min(total - 1)))
}

fn read_range(file: &Path, start: u64, end: u64) -> Option<Vec<u8>> {
    let mut f = fs::File::open(file).ok()?;
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut body = vec![0; (end - start + 1) as usize];
    f.read_exact(&mut body).ok()?;
    Some(body)
}

/// The `kolux-artifact` scheme: the entry's files with a policy that lets the page load only them.
/// Media answers byte ranges, so a video or an audio track can seek without loading the whole file.
pub fn serve(lib: &Library, req: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::Response;
    let uri = req.uri();
    let path = uri.path();
    let Some((file, kind)) = lib.open(path) else {
        return Response::builder().status(404).header("Content-Type", "text/plain").body(b"not in this artifact".to_vec()).unwrap();
    };
    let total = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let wants_range = !kind.starts_with("text/html");
    let ask = if wants_range { req.headers().get("range").and_then(|v| v.to_str().ok()).map_or(RangeAsk::Whole, |v| parse_range(v, total)) } else { RangeAsk::Whole };
    if ask == RangeAsk::Past {
        return Response::builder().status(416).header("Content-Type", "text/plain").header("Content-Range", format!("bytes */{total}")).header("X-Content-Type-Options", "nosniff").body(Vec::new()).unwrap();
    }
    let range = match ask {
        RangeAsk::Part(start, end) => Some((start, end.min(start + CHUNK - 1))),
        _ => None,
    };
    let (mut body, status, content_range) = match range.and_then(|(start, end)| read_range(&file, start, end).map(|b| (start, end, b))) {
        Some((start, end, b)) => (b, 206, Some(format!("bytes {start}-{end}/{total}"))),
        None => (fs::read(&file).unwrap_or_default(), 200, None),
    };
    let id = path.trim_start_matches('/').split('/').next().unwrap_or("");
    let base = format!("/{id}/");
    if kind.starts_with("text/html") {
        // After the page, so a doctype stays first and the page keeps standards mode.
        body.extend_from_slice(link_script(&base).as_bytes());
    }
    let only = format!("{ORIGIN}{base}");
    let cdns = CDNS.map(|c| c.trim_end_matches('/')).join(" ");
    let csp = format!("default-src {only} 'unsafe-inline' 'unsafe-eval' data: blob:; script-src {only} 'unsafe-inline' 'unsafe-eval' data: blob: {cdns}; form-action 'none'");
    let mut out = Response::builder()
        .status(status)
        .header("Content-Type", kind)
        .header("Content-Length", body.len().to_string())
        .header("Accept-Ranges", "bytes")
        .header("Content-Security-Policy", csp)
        .header("X-Content-Type-Options", "nosniff");
    if let Some(cr) = content_range {
        out = out.header("Content-Range", cr);
    }
    out.body(body).unwrap()
}

#[tauri::command]
pub fn artifacts_list(lib: tauri::State<'_, Library>) -> Vec<Listed> {
    lib.list()
}

#[tauri::command]
pub async fn artifact_add(app: tauri::AppHandle, path: String) -> Result<Entry, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<Library>().add(Path::new(&path), Origin::hand(Path::new(&path)), &|u| fetch_script(&app, u))).await.map_err(|e| e.to_string())?
}

/// Off the window's thread like `artifact_add`: the remove stats the file it leaves a note for and
/// deletes the stored folder, which on a slow disk is not the window's wait.
#[tauri::command]
pub async fn artifact_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<Library>().remove(&id)).await.map_err(|e| e.to_string())?
}

/// The address `open_external` opens: a clean http, https or mailto link, in its parsed form. A control
/// character (the parser would quietly drop a tab or newline) or a double quote is refused before parsing.
fn external_url(url: &str) -> Result<String, String> {
    if url.chars().any(|c| c.is_control() || c == '"') {
        return Err("That link holds a character Kolux never opens".into());
    }
    let not_a_link = || format!("{url} is not a web or mail link");
    let parsed = tauri::Url::parse(url).map_err(|_| not_a_link())?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => {}
        "mailto" => {}
        _ => return Err(not_a_link()),
    }
    Ok(parsed.as_str().to_string())
}

/// Opens a web or mail link in the system's own handler; nothing else is let through, and no more than a
/// handful in a row (links::admit_browser_open). The command runs on a worker, never the window's thread.
#[tauri::command(async)]
pub fn open_external(url: String) -> Result<(), String> {
    let url = external_url(&url)?;
    crate::links::admit_browser_open()?;
    system_open(&url)
}

/// Hands `url` (a link or a full file path) to the system's own handler. Callers check it first:
/// `open_external` lets only web and mail links through, `links::open_path` reveals programs.
pub(crate) fn system_open(url: &str) -> Result<(), String> {
    if url.contains('\0') {
        return Err("That path holds a control character; Kolux never opens it".into());
    }
    #[cfg(windows)]
    {
        let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        let (verb, file) = (wide("open"), wide(url));
        use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
        // FIX-5 (council P2 P12): ShellExecute may hand the link to shell extensions that use COM, so
        // the calling thread joins COM for the call (the documented way) and leaves it again after.
        // A negative result (the thread already joined another way) means nothing to undo.
        // SAFETY: NUL-terminated wide strings that live across the call; every successful
        // CoInitializeEx is matched by one CoUninitialize on this thread.
        let r = unsafe {
            let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
            let r = windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1);
            if com >= 0 {
                CoUninitialize();
            }
            r
        };
        if (r as isize) <= 32 {
            return Err(format!("Windows could not open {url}"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(&url).spawn().map(|_| ()).map_err(|e| format!("could not open {url}: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_032_each_route_reaches_the_client() {
        use crate::resources::{app_http::Plan, app_proxy::Route};
        let u = |s: &str| tauri::Url::parse(s).unwrap();
        assert!(proxied(&Plan { route: Route::Via(u("http://p:8080")), http1: true }, reqwest::Client::builder()).unwrap().build().is_ok());
        for route in [Route::Default, Route::Direct] {
            assert!(proxied(&Plan { route, http1: false }, reqwest::Client::builder()).unwrap().build().is_ok());
        }
        // socks5 needs reqwest's socks feature, which this build leaves out: that stops the request.
        if let Err(e) = proxied(&Plan { route: Route::Via(u("socks5://me:SECRET@p:1080")), http1: false }, reqwest::Client::builder()) {
            assert!(!e.contains("SECRET") && !e.contains("socks5://"), "{e}");
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("krs-art-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn titles_and_refs() {
        assert_eq!(title_of("<html><TITLE id=t>\n A &amp; B </title>"), Some("A & B".into()));
        assert_eq!(title_of("<title> </title>"), None);
        assert_eq!(title_of(&format!("<title>{}</title>", "x".repeat(300))).unwrap().len(), 200);
        let refs = relative_refs("<img src=\"img/a%20b.png?v=1\"><link href='s.css'><a href=\"#top\"> <a href=\"https://x.io\"> <script src=/abs.js></script> <img data-src=\"no.png\"> <video poster=p.jpg> <a href=\"mailto:a@b\"> <img src=\"../out.png\">");
        assert_eq!(refs, ["img/a b.png", "../out.png", "s.css", "p.jpg"]);
    }

    #[test]
    fn network_shares_are_told_apart() {
        assert!(on_network_share(Path::new(r"\\server\share\a.html")));
        assert!(on_network_share(Path::new(r"\\?\UNC\server\share\a.html")));
        assert!(!on_network_share(Path::new(r"\\wsl$\Ubuntu\home\a.html")));
        assert!(!on_network_share(Path::new(r"\\wsl.localhost\Ubuntu\a.html")));
        assert!(!on_network_share(&std::env::temp_dir().join("a.html")));
    }

    #[test]
    fn stores_the_page_and_its_own_folder_only_and_refreshes_by_origin() {
        let root = temp_dir("store");
        let site = root.join("site");
        fs::create_dir_all(site.join("img")).unwrap();
        fs::write(root.join("secret.txt"), "no").unwrap();
        fs::write(site.join("img").join("a.png"), "png").unwrap();
        fs::write(site.join("page.html"), "<title>One</title><img src=\"img/a.png\"><img src=\"../secret.txt\">").unwrap();
        let lib = Library::new(root.join("lib"));
        let e = lib.add(&site.join("page.html"), Origin::hand(&site.join("page.html")), &|_| None).unwrap();
        assert_eq!((e.title.as_str(), e.state.as_str()), ("One", "ok"));
        assert!(lib.file(&format!("/{}/img/a.png", e.id)).is_some());
        assert!(lib.file(&format!("/{}/../secret.txt", e.id)).is_none());
        assert!(!root.join("lib").join(&e.id).join("secret.txt").exists());
        assert!(fs::read_dir(root.join("lib").join(&e.id)).unwrap().count() == 2);
        fs::write(site.join("page.html"), "<title>Two</title>").unwrap();
        let again = lib.add(&site.join("page.html"), Origin::hand(&site.join("page.html")), &|_| None).unwrap();
        assert_eq!(again.id, e.id);
        let list = lib.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].entry.title, "Two");
        assert!(!root.join("lib").join(&e.id).join("img").exists());
        assert!(lib.add(&site.join("missing.html"), Origin::hand(&site.join("missing.html")), &|_| None).is_err());
        assert_eq!(lib.list().len(), 1);
        lib.remove(&e.id).unwrap();
        assert!(lib.list().is_empty() && !root.join("lib").join(&e.id).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_that_is_not_a_page_is_kept_whole_and_typed() {
        let root = temp_dir("files");
        let shot = root.join("shot.png");
        fs::write(&shot, b"\x89PNG\r\n").unwrap();
        let lib = Library::new(root.join("lib"));
        let e = lib.add(&shot, Origin::hand(&shot), &|_| panic!("a file that is not a page fetches no script")).unwrap();
        assert_eq!((e.kind.as_str(), e.state.as_str(), e.size), ("image", "ok", 6));
        assert_eq!(e.title, "shot.png");
        let (body, kind) = lib.file(&format!("/{}/shot.png", e.id)).unwrap();
        assert_eq!((body.as_slice(), kind), (&b"\x89PNG\r\n"[..], "image/png"));
        // A document is kept the same way and reads as text.
        let doc = root.join("notes.md");
        fs::write(&doc, "# Plan").unwrap();
        assert_eq!(lib.add(&doc, Origin::hand(&doc), &|_| None).unwrap().kind, "text");
        // An entry written before kinds existed is still a page.
        let old: Entry = serde_json::from_str(r#"{"id":"a","title":"t","source":"hand","origin":"x","project":null,"session":null,"added":1,"size":1,"page":"a.html","state":"ok"}"#).unwrap();
        assert_eq!(old.kind, "page");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cdn_scripts_are_kept_offline_and_a_failed_fetch_keeps_the_address() {
        let html = "<script src=\"https://cdn.jsdelivr.net/npm/a@1/a.js\"></script><script src='https://evil.example/x.js'></script><script defer src=https://unpkg.com/b@2></script><script>var s='src=https://unpkg.com/c'</script><script src=\"https://cdnjs.cloudflare.com/ajax/libs/gone/1/g.js\"></script>";
        let spans: Vec<&str> = cdn_scripts(html).into_iter().map(|(a, b)| &html[a..b]).collect();
        assert_eq!(spans, ["https://cdn.jsdelivr.net/npm/a@1/a.js", "https://unpkg.com/b@2", "https://cdnjs.cloudflare.com/ajax/libs/gone/1/g.js"]);
        let root = temp_dir("cdn");
        let fetch = |u: &str| (!u.contains("gone")).then(|| format!("/* {u} */").into_bytes());
        let mut total = 0;
        let page = vendor_scripts(html, &root, &fetch, &mut total).unwrap();
        assert!(page.contains("src=\"cdn/0.js\"") && page.contains("src=cdn/1.js>"), "{page}");
        assert!(page.contains("https://cdnjs.cloudflare.com/ajax/libs/gone/1/g.js") && page.contains("https://evil.example/x.js"));
        assert_eq!(fs::read_to_string(root.join("cdn").join("1.js")).unwrap(), "/* https://unpkg.com/b@2 */");
        assert!(vendor_scripts("<script src=\"https://cdn.jsdelivr.net/npm/x\"></script>", &root, &|_| None, &mut total).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn video_audio_and_pdf_are_kept_and_media_ranges_are_clamped() {
        for (name, kind) in [("clip.mp4", "video"), ("clip.webm", "video"), ("track.mp3", "audio"), ("track.m4a", "audio"), ("paper.pdf", "pdf")] {
            assert_eq!(kind_of(Path::new(name)), kind, "{name}");
            assert!(KEPT.contains(&name.rsplit('.').next().unwrap()));
        }
        assert_eq!(kind_of(Path::new("data.json")), "text");
        assert!(!KEPT.contains(&"json"), "a project JSON is not auto-captured from a Write");
        assert!(is_workspace_file(Path::new("data.json")));
        assert!(is_workspace_file(Path::new("model.psd")), "any file in the artifacts folder counts");
        assert_eq!(mime("clip.mp4"), "video/mp4");
        assert_eq!(mime("track.mp3"), "audio/mpeg");
        assert_eq!(mime("paper.pdf"), "application/pdf");
        assert_eq!(parse_range("bytes=0-99", 1000), RangeAsk::Part(0, 99));
        assert_eq!(parse_range("bytes=100-", 1000), RangeAsk::Part(100, 999));
        assert_eq!(parse_range("bytes=-100", 1000), RangeAsk::Part(900, 999));
        assert_eq!(parse_range("bytes=0-2000", 1000), RangeAsk::Part(0, 999));
        assert_eq!(parse_range("bytes=1000-", 1000), RangeAsk::Past);
        assert_eq!(parse_range("bytes=10-5", 1000), RangeAsk::Whole);
        assert_eq!(parse_range("items=0-5", 1000), RangeAsk::Whole);
        assert_eq!(parse_range("bytes=0-5,10-15", 1000), RangeAsk::Whole);
        let root = temp_dir("range");
        let file = root.join("clip.mp4");
        fs::write(&file, (0..=255).collect::<Vec<u8>>()).unwrap();
        assert_eq!(read_range(&file, 10, 12), Some(vec![10, 11, 12]));
        assert_eq!(read_range(&file, 254, 300), None, "a range past the end is refused, never short");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn media_is_served_in_byte_ranges_from_the_artifact_scheme() {
        let root = temp_dir("serve");
        let lib = Library::new(root.join("lib"));
        let file = root.join("clip.mp4");
        fs::write(&file, (0..=255).collect::<Vec<u8>>()).unwrap();
        let e = lib.add(&file, Origin::hand(&file), &|_| None).unwrap();
        let uri = format!("http://kolux-artifact.localhost/{}/clip.mp4", e.id);
        let ranged = tauri::http::Request::builder().uri(&uri).header("range", "bytes=10-12").body(Vec::new()).unwrap();
        let r = serve(&lib, &ranged);
        assert_eq!(r.status(), 206);
        assert_eq!(r.headers().get("content-range").and_then(|v| v.to_str().ok()), Some("bytes 10-12/256"));
        assert_eq!(r.headers().get("accept-ranges").and_then(|v| v.to_str().ok()), Some("bytes"));
        assert_eq!(r.body().as_slice(), &[10, 11, 12]);
        let full = tauri::http::Request::builder().uri(&uri).body(Vec::new()).unwrap();
        let r = serve(&lib, &full);
        assert_eq!(r.status(), 200);
        assert_eq!(r.body().len(), 256);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn workspace_artifacts_are_found_imported_once_and_refreshed_on_change() {
        let root = temp_dir("workspace");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts").join("nested")).unwrap();
        fs::create_dir_all(ws.join("artifacts").join("node_modules")).unwrap();
        fs::write(ws.join("artifacts").join("a.html"), "<title>A</title>").unwrap();
        fs::write(ws.join("artifacts").join("nested").join("b.png"), b"png").unwrap();
        fs::write(ws.join("artifacts").join("notes.md"), "# Notes").unwrap();
        fs::write(ws.join("artifacts").join("data.json"), "{}").unwrap();
        fs::write(ws.join("artifacts").join("skip.exe"), "no").unwrap();
        fs::write(ws.join("artifacts").join("page.html.tmp"), "partial").unwrap();
        fs::write(ws.join("artifacts").join(".DS_Store"), "noise").unwrap();
        fs::write(ws.join("artifacts").join("node_modules").join("c.html"), "<title>C</title>").unwrap();

        let (files, over) = workspace_files(&ws);
        assert!(!over);
        assert_eq!(files.len(), 4, "every top-level file; a subfolder is not an entry: {files:?}");
        assert!(workspace_files(&root.join("missing")).0.is_empty());

        let lib = Library::new(root.join("lib"));
        let mut seen = std::collections::HashMap::new();
        let scan = |seen: &mut HashMap<String, (u64, u64)>| scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, seen);
        assert_eq!(scan(&mut seen), Scanned { changed: 4, skipped: vec![] });
        let first = lib.list();
        assert_eq!(first.len(), 4);
        assert!(first.iter().all(|e| e.entry.source == "workspace" && e.entry.project.as_deref() == Some("Project")));
        assert_eq!(scan(&mut seen).changed, 0, "an unchanged folder adds nothing");

        fs::write(ws.join("artifacts").join("a.html"), "<title>A2</title>").unwrap();
        assert_eq!(scan(&mut seen).changed, 1, "only the changed page is refreshed");
        let again = lib.list();
        assert_eq!(again.len(), 4);
        assert!(again.iter().any(|e| e.entry.title == "A2"));
        let mut fresh = std::collections::HashMap::new();
        assert_eq!(scan(&mut fresh).changed, 0, "a new app run does not re-add entries the library already holds");

        // A page with its own assets: the stored size counts the assets too, which must not read as a change.
        fs::write(ws.join("artifacts").join("nested").join("c.png"), b"pngpngpng").unwrap();
        fs::write(ws.join("artifacts").join("site.html"), "<title>Site</title><img src=\"nested/c.png\">").unwrap();
        assert_eq!(scan(&mut fresh).changed, 1);
        let site = lib.list().into_iter().find(|e| e.entry.title == "Site").unwrap();
        assert!(site.entry.size > fs::metadata(ws.join("artifacts").join("site.html")).unwrap().len(), "the stored size holds the page and its asset");
        let mut fresh = std::collections::HashMap::new();
        assert_eq!(scan(&mut fresh).changed, 0, "a new app run does not re-add a page whose stored size includes its assets");
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_artifacts_folder_is_not_followed() {
        let root = temp_dir("linked");
        let ws = root.join("Project");
        let outside = root.join("outside");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("id_rsa"), "SECRET").unwrap();
        std::os::unix::fs::symlink(&outside, ws.join("artifacts")).unwrap();
        assert!(workspace_files(&ws).0.is_empty(), "a linked artifacts/ folder is never followed");
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        assert_eq!(scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, &mut seen).changed, 0);
        assert!(lib.list().is_empty());
        // A real folder still yields its file, and a linked file inside it is not followed either.
        fs::remove_file(ws.join("artifacts")).unwrap();
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        fs::write(ws.join("artifacts").join("a.txt"), "ok").unwrap();
        std::os::unix::fs::symlink(outside.join("id_rsa"), ws.join("artifacts").join("key.txt")).unwrap();
        assert_eq!(workspace_files(&ws).0, vec![ws.join("artifacts").join("a.txt")]);
        assert!(open_source(&ws.join("artifacts").join("key.txt"), "key.txt", None).is_err(), "a link is refused at open, not only by its path");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_removed_workspace_file_stays_removed_until_it_changes() {
        let root = temp_dir("removed");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts").join("img")).unwrap();
        let a = ws.join("artifacts").join("a.html");
        fs::write(&a, "<title>A</title>").unwrap();
        let lib = Library::new(root.join("lib"));
        let scan = |seen: &mut HashMap<String, (u64, u64)>| scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, seen).changed;
        let mut seen = HashMap::new();
        assert_eq!(scan(&mut seen), 1);
        let id = lib.list()[0].entry.id.clone();
        lib.remove(&id).unwrap();
        assert_eq!(scan(&mut seen), 0, "the same run keeps it removed");
        assert!(lib.list().is_empty());
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 0, "the next app run must keep it removed too");
        assert!(lib.list().is_empty(), "a removed entry does not come back on the next launch");
        // A real rewrite is a new deliverable and is imported again.
        fs::write(&a, "<title>A rewritten</title>").unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 1, "a rewritten file is imported again");
        assert_eq!(lib.list()[0].entry.title, "A rewritten");
        // Removed again: a page with assets is kept removed by the file's own stamp, not the stored size.
        fs::write(ws.join("artifacts").join("img").join("p.png"), b"png").unwrap();
        fs::write(&a, "<title>With asset</title><img src=\"img/p.png\">").unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 1);
        lib.remove(&id).unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 0, "a removed page with assets stays removed");
        assert!(lib.list().is_empty());
        // Adding the same file by hand after a remove keeps it: the remove is forgotten.
        let hand = lib.add(&a, Origin::hand(&a), &|_| None).unwrap();
        assert_eq!(hand.id, id);
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 0);
        assert_eq!(lib.list().len(), 1, "a hand-added file is kept after an earlier remove");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_restored_file_with_an_older_mtime_is_refreshed() {
        let root = temp_dir("restored");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        let a = ws.join("artifacts").join("a.html");
        fs::write(&a, "<title>A</title>").unwrap();
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut seen).changed, 1);
        // Restored from a backup that kept the old time (cp -p, robocopy /COPY:DAT): older mtime, new content.
        fs::write(&a, "<title>Restored</title>").unwrap();
        let older = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        fs::File::options().write(true).open(&a).unwrap().set_modified(older).unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut fresh).changed, 1);
        let list = lib.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].entry.title, "Restored", "a restored file counted as changed must also be refreshed");
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut HashMap::new()).changed, 0, "and it is then known");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_that_cannot_be_kept_is_reported_once_and_not_retried() {
        let root = temp_dir("toobig");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        // A sparse file over the cap: nothing is written, only its length.
        fs::File::create(ws.join("artifacts").join("clip.mkv")).unwrap().set_len(MAX_FILE + 1).unwrap();
        fs::write(ws.join("artifacts").join("ok.txt"), "fine").unwrap();
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        let first = scan_workspace(&lib, &ws, None, &|_| None, &mut seen);
        assert_eq!(first, Scanned { changed: 1, skipped: vec!["clip.mkv is larger than 100 MB".into()] });
        assert_eq!(lib.list().len(), 1);
        let second = scan_workspace(&lib, &ws, None, &|_| None, &mut seen);
        assert_eq!(second, Scanned::default(), "the same unchanged file is neither retried nor reported again");
        // A change to the file is tried again.
        fs::File::options().write(true).open(ws.join("artifacts").join("clip.mkv")).unwrap().set_len(10).unwrap();
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut seen).changed, 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_scan_command_runs_off_the_window_thread() {
        // An AppHandle is not to be had in a unit test, so the shape is checked in the source: like
        // artifact_add, the scan is async and does its copies and fetches on a blocking worker, and a
        // tick that finds one running does nothing instead of queueing behind it.
        let src = include_str!("artifacts.rs");
        let src = &src[..src.find("#[cfg(test)]").unwrap()]; // the code, not this test's own words
        let at = src.find("pub async fn artifacts_scan(").expect("artifacts_scan must be an async command: it copies files and fetches scripts");
        let body = &src[at..at + 1200];
        assert!(body.contains("spawn_blocking"), "the scan runs on a blocking worker");
        assert!(body.contains("try_lock()"), "an overlapping tick does not wait");
    }

    #[test]
    fn one_entry_per_publish_url_newest_wins_and_remote_paths_are_not_read() {
        let root = temp_dir("publish");
        let page = root.join("p.html");
        let lib = Library::new(root.join("lib"));
        let from = |at: u64| Origin { origin: "https://claude.ai/artifact/abc".into(), source: "claude", project: Some("repo".into()), session: Some("s1".into()), at };
        fs::write(&page, "<title>First</title>").unwrap();
        lib.add(&page, from(1000), &|_| None).unwrap();
        fs::write(&page, "<title>Second</title>").unwrap();
        lib.add(&page, from(2000), &|_| None).unwrap();
        fs::write(&page, "<title>Replayed</title>").unwrap();
        lib.add(&page, from(1500), &|_| None).unwrap();
        let list = lib.list();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].entry.title.as_str(), list[0].entry.source.as_str(), list[0].entry.added), ("Second", "claude", 2000));
        let remote = if cfg!(windows) { "/home/me/site/page.html" } else { "C:\\site\\page.html" };
        let mut o = from(3000);
        o.origin = "https://claude.ai/artifact/remote".into();
        let e = lib.add(Path::new(remote), o, &|_| panic!("a remote page is never read")).unwrap();
        assert_eq!((e.state.as_str(), e.size), ("remote", 0));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_an_entry_the_library_never_read_leaves_its_origin_alone() {
        // An "unavailable" entry sits on a network share the library never reads (DT-R21). An existing
        // local file stands in for the share here, so a stat of it would succeed and leave a note.
        let root = temp_dir("unavail");
        let origin = root.join("share.html");
        fs::write(&origin, "<title>S</title>").unwrap();
        let lib = Library::new(root.join("lib"));
        let o = origin.to_string_lossy().into_owned();
        let e = Entry { id: id_of(&o), title: "S".into(), source: "hand".into(), kind: "page".into(), origin: o, project: None, session: None, added: 1, size: 0, page: "share.html".into(), state: "unavailable".into(), stamp: None };
        lib.write(std::slice::from_ref(&e)).unwrap();
        lib.remove(&e.id).unwrap();
        assert!(lib.list().is_empty());
        assert!(lib.removed().is_empty(), "an entry never read has no stamp to note, and its origin is not stat'ed");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cdn_addresses_are_judged_by_host_not_by_prefix() {
        for ok in ["https://cdn.tailwindcss.com/3.4.1", "https://cdn.tailwindcss.com", "https://CDN.jsdelivr.net/npm/a@1/a.js", "https://unpkg.com/b@2", "https://cdnjs.cloudflare.com/ajax/libs/x/1/x.js", "https://code.jquery.com/jquery-3.7.1.min.js"] {
            assert!(cdn_url(ok), "{ok}");
        }
        for bad in ["https://cdn.tailwindcss.com.evil.example/x.js", "https://cdn.tailwindcss.com@evil.example/x.js", "https://user:pw@cdn.tailwindcss.com/x.js", "http://unpkg.com/x", "https://cdn.jsdelivr.net/gh/x", "https://unpkg.com:8443/x", "https://evil.example/https://unpkg.com/x", "//unpkg.com/x", "unpkg.com/x"] {
            assert!(!cdn_url(bad), "{bad}");
        }
        let html = "<script src=\"https://cdn.tailwindcss.com.evil.example/x.js\"></script><script src=\"https://cdn.tailwindcss.com@evil.example/x.js\"></script><script src=\"http://unpkg.com/x\"></script><script src=\"https://cdn.jsdelivr.net/gh/x\"></script><script src=\"https://cdn.tailwindcss.com/3.4\"></script>";
        let spans: Vec<&str> = cdn_scripts(html).into_iter().map(|(a, b)| &html[a..b]).collect();
        assert_eq!(spans, ["https://cdn.tailwindcss.com/3.4"], "a look-alike host, a user name before the host, plain http and a jsdelivr path outside /npm/ are not CDN scripts");
    }

    #[cfg(unix)]
    #[test]
    fn a_hard_linked_file_is_not_kept_as_an_artifact_or_an_asset() {
        let root = temp_dir("hardlink");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts").join("img")).unwrap();
        fs::write(root.join("id_rsa"), "SECRET").unwrap();
        fs::hard_link(root.join("id_rsa"), ws.join("artifacts").join("key.txt")).unwrap();
        fs::hard_link(root.join("id_rsa"), ws.join("artifacts").join("img").join("k.png")).unwrap();
        fs::write(ws.join("artifacts").join("site.html"), "<title>Site</title><img src=\"img/k.png\">").unwrap();
        let lib = Library::new(root.join("lib"));
        let got = scan_workspace(&lib, &ws, None, &|_| None, &mut HashMap::new());
        assert_eq!(got, Scanned { changed: 1, skipped: vec!["key.txt is a hard link to another file, so it is not kept".into()] });
        let list = lib.list();
        assert_eq!(list.len(), 1);
        let stored = root.join("lib").join(&list[0].entry.id);
        assert!(!stored.join("img").join("k.png").exists(), "a page's hard-linked asset is left out");
        assert_eq!(fs::read_dir(&stored).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_cdn_redirect_is_followed_only_to_the_same_listed_cdn_host() {
        // cdn.tailwindcss.com answers 302 to /3.4.17 and unpkg answers 302 from a version range to the exact version.
        assert!(follow_cdn_redirect("https://cdn.tailwindcss.com/", "https://cdn.tailwindcss.com/3.4.17", 1));
        assert!(follow_cdn_redirect("https://cdn.tailwindcss.com/3.4.17", "https://cdn.tailwindcss.com/3.4.17?plugins=forms", 1));
        assert!(follow_cdn_redirect("https://unpkg.com/react@^18/umd/react.production.min.js", "https://unpkg.com/react@18.3.1/umd/react.production.min.js", 1));
        assert!(follow_cdn_redirect("https://unpkg.com/a@1", "https://unpkg.com/a@1.2.3/x.js", 5), "the fifth redirect is the last");
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "https://unpkg.com/a@1.2.3/x.js", 6), "a sixth is not followed");
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "https://unpkg.com/a@1.2.3/x.js", 100));
        // Off the list, or to a different listed host: refused.
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "https://evil.example/x.js", 1), "a host off the list");
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "https://unpkg.com.evil.example/x.js", 1), "a look-alike host");
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "https://unpkg.com@evil.example/x.js", 1), "a user name that changes the host");
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "https://cdn.jsdelivr.net/npm/a@1/x.js", 1), "a different listed host");
        assert!(!follow_cdn_redirect("https://cdn.jsdelivr.net/npm/a", "https://cdn.jsdelivr.net/gh/user/repo/x.js", 1), "a path outside the listed one");
        // Plain http, another port, no first address, or an unparsable one: refused.
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "http://unpkg.com/a@1.2.3/x.js", 1), "down to plain http");
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "https://unpkg.com:8443/a@1.2.3/x.js", 1), "another port");
        assert!(!follow_cdn_redirect("", "https://unpkg.com/a@1.2.3/x.js", 1));
        assert!(!follow_cdn_redirect("https://unpkg.com/a@1", "not a url", 1));
    }

    #[test]
    fn only_a_cloud_placeholder_reparse_tag_is_kept_as_a_file() {
        // OneDrive Files On-Demand (Known Folder Move): IO_REPARSE_TAG_CLOUD and CLOUD_1 .. CLOUD_F.
        for tag in [0x9000_001A_u32, 0x9000_101A, 0x9000_601A, 0x9000_F01A] {
            assert!(reparse_is_cloud_file(tag), "{tag:#x} is a cloud placeholder");
        }
        // Real links name another file: IO_REPARSE_TAG_SYMLINK and IO_REPARSE_TAG_MOUNT_POINT (a junction).
        assert!(!reparse_is_cloud_file(0xA000_000C), "a symlink is a link");
        assert!(!reparse_is_cloud_file(0xA000_0003), "a junction is a link");
        // Anything else is refused as well: deduplication, WOF, app-exec link, OneDrive's old tag, HSM, a tag never seen.
        for tag in [0x8000_0013_u32, 0x8000_0017, 0x8000_001B, 0x8000_0021, 0xC000_0004, 0x9000_001B, 0x9001_001A, 0xA000_001A, 0x1234_5678, 0] {
            assert!(!reparse_is_cloud_file(tag), "{tag:#x} is not kept");
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_or_symlink_on_windows_never_takes_the_scan_out_of_the_workspace() {
        let root = temp_dir("winlinks");
        let ws = root.join("Project");
        let outside = root.join("outside");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("id_rsa"), "SECRET").unwrap();
        // A junction where artifacts/ should be (mklink /J needs no privilege).
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(ws.join("artifacts")).arg(&outside).output().unwrap();
        assert!(made.status.success(), "mklink /J: {}", String::from_utf8_lossy(&made.stdout));
        assert!(workspace_files(&ws).0.is_empty(), "a junction artifacts/ folder is never followed");
        let lib = Library::new(root.join("lib"));
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut HashMap::new()).changed, 0);
        assert!(lib.list().is_empty());
        // `rmdir` removes the junction itself, not the folder it points at.
        fs::remove_dir(ws.join("artifacts")).unwrap();
        assert!(outside.join("id_rsa").exists());

        // A real folder holding a file symlink to a file outside (needs the symlink privilege; skipped without it).
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        fs::write(ws.join("artifacts").join("a.txt"), "ok").unwrap();
        let link = ws.join("artifacts").join("key.txt");
        if std::os::windows::fs::symlink_file(outside.join("id_rsa"), &link).is_ok() {
            assert_eq!(workspace_files(&ws).0, vec![ws.join("artifacts").join("a.txt")], "a linked file is not a file");
            assert!(open_source(&link, "key.txt", None).is_err(), "a symlink is refused at open, not only by its path");
        }
        // A plain file still opens (its handle has no reparse tag).
        assert!(open_source(&ws.join("artifacts").join("a.txt"), "a.txt", None).is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_scan_that_stores_a_file_first_does_not_lose_the_claude_session_that_wrote_it() {
        let root = temp_dir("scanfirst");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        let page = ws.join("artifacts").join("a.html");
        fs::write(&page, "<title>A</title>").unwrap();
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        assert_eq!(scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, &mut seen).changed, 1);
        // The Write capture comes in after, with the transcript's earlier time.
        let key = page.to_string_lossy().into_owned();
        let from = Origin { origin: key.clone(), source: "claude", project: Some("repo".into()), session: Some("s1".into()), at: 1000 };
        let e = lib.add(&page, from, &|_| None).unwrap();
        assert_eq!((e.source.as_str(), e.session.as_deref()), ("claude", Some("s1")));
        let list = lib.list();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].entry.source.as_str(), list[0].entry.session.as_deref(), list[0].entry.project.as_deref()), ("claude", Some("s1"), Some("repo")));
        // A later change picked up by the scan keeps who made the entry.
        fs::write(&page, "<title>A2</title>").unwrap();
        assert_eq!(scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, &mut seen).changed, 1);
        let list = lib.list();
        assert_eq!((list[0].entry.title.as_str(), list[0].entry.source.as_str(), list[0].entry.session.as_deref(), list[0].entry.project.as_deref()), ("A2", "claude", Some("s1"), Some("repo")));
        // An entry stored before stamps existed is refreshed by the first scan, keeping its source.
        let hand = ws.join("artifacts").join("b.html");
        fs::write(&hand, "<title>B</title>").unwrap();
        let mut old = lib.add(&hand, Origin::hand(&hand), &|_| None).unwrap();
        old.stamp = None;
        let mut all: Vec<Entry> = lib.list().into_iter().map(|l| l.entry).collect();
        all.retain(|x| x.id != old.id);
        all.push(old);
        lib.write(&all).unwrap();
        scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, &mut HashMap::new());
        let b = lib.list().into_iter().find(|l| l.entry.title == "B").unwrap();
        assert_eq!(b.entry.source, "hand");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn one_scan_keeps_at_most_the_file_and_byte_caps() {
        let root = temp_dir("caps");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        for i in 0..MAX_WORKSPACE_FILES + 5 {
            fs::write(ws.join("artifacts").join(format!("f{i:04}.txt")), "x").unwrap();
        }
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        let got = scan_workspace(&lib, &ws, None, &|_| None, &mut seen);
        assert_eq!(got.changed, MAX_WORKSPACE_FILES);
        assert_eq!(lib.list().len(), MAX_WORKSPACE_FILES);
        assert_eq!(got.skipped.len(), 1, "one reason for the whole folder: {:?}", got.skipped);
        assert!(got.skipped[0].contains(&format!("more than {MAX_WORKSPACE_FILES} files")), "{:?}", got.skipped);
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut seen).changed, 0, "the next tick adds nothing more");

        // The byte cap counts what the library already holds from this folder, so later ticks do not top it up.
        let root2 = temp_dir("bytecap");
        let ws2 = root2.join("Project");
        fs::create_dir_all(ws2.join("artifacts")).unwrap();
        for n in ["a", "b", "c", "d"] {
            fs::write(ws2.join("artifacts").join(format!("{n}.txt")), "0123456789").unwrap();
        }
        let lib2 = Library::new(root2.join("lib"));
        let mut seen2 = HashMap::new();
        let got = scan_capped(&lib2, &ws2, None, &|_| None, &mut seen2, 25);
        assert_eq!(got.changed, 2);
        assert_eq!(got.skipped.len(), 1, "{:?}", got.skipped);
        let again = scan_capped(&lib2, &ws2, None, &|_| None, &mut seen2, 25);
        assert_eq!(again.changed, 0, "the folder is still over the cap");
        assert_eq!(lib2.list().len(), 2);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&root2);
    }

    #[test]
    fn one_ranged_answer_is_never_more_than_a_chunk() {
        let root = temp_dir("chunk");
        let lib = Library::new(root.join("lib"));
        let big = root.join("big.mp4");
        fs::File::create(&big).unwrap().set_len(CHUNK + 1).unwrap();
        let e = lib.add(&big, Origin::hand(&big), &|_| None).unwrap();
        let uri = format!("http://kolux-artifact.localhost/{}/big.mp4", e.id);
        // A browser's first ask for a clip, and its ask after every seek, is open-ended.
        let open = tauri::http::Request::builder().uri(&uri).header("range", "bytes=0-").body(Vec::new()).unwrap();
        let r = serve(&lib, &open);
        assert_eq!(r.status(), 206);
        assert_eq!(r.body().len() as u64, CHUNK, "one ranged answer carries at most a chunk; the browser asks again from there");
        assert_eq!(r.headers().get("content-range").and_then(|v| v.to_str().ok()), Some(format!("bytes 0-{}/{}", CHUNK - 1, CHUNK + 1).as_str()));
        let rest = tauri::http::Request::builder().uri(&uri).header("range", format!("bytes={CHUNK}-")).body(Vec::new()).unwrap();
        let r = serve(&lib, &rest);
        assert_eq!((r.status().as_u16(), r.body().len()), (206, 1));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_remove_command_runs_off_the_window_thread() {
        let src = include_str!("artifacts.rs");
        let src = &src[..src.find("#[cfg(test)]").unwrap()];
        let at = src.find("pub async fn artifact_remove(").expect("artifact_remove must be an async command: it stats the removed file and deletes its stored folder");
        assert!(src[at..at + 400].contains("spawn_blocking"), "the remove runs on a blocking worker");
    }

    // ---- T-624 round 3 (PR #37 review) ----

    #[cfg(windows)]
    #[test]
    fn a_real_path_must_be_local_and_under_the_root() {
        let ok = |real: &str, root: Option<&str>| real_path_ok(Path::new(real), root.map(Path::new));
        assert!(ok(r"\\?\C:\ws\artifacts\a.txt", Some(r"\\?\C:\ws")));
        assert!(ok(r"\\?\c:\WS\artifacts\a.txt", Some(r"\\?\C:\ws")), "Windows paths differ by case only");
        assert!(ok(r"\\?\C:\anywhere\a.txt", None), "no root: only the share check applies");
        assert!(!ok(r"\\?\C:\other\a.txt", Some(r"\\?\C:\ws")));
        assert!(!ok(r"\\?\C:\ws2\a.txt", Some(r"\\?\C:\ws")), "a sibling that shares a name prefix is outside");
        assert!(!ok(r"\\?\UNC\server\share\a.txt", None), "a network share is never read");
        assert!(!ok(r"\\?\UNC\server\share\ws\a.txt", Some(r"\\?\UNC\server\share\ws")), "even when the root itself is on the share");
        assert!(ok(r"\\?\UNC\wsl.localhost\Ubuntu\home\a.txt", None), "WSL's own shares count as this machine");
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_in_the_path_never_takes_a_stored_file_out_of_the_workspace() {
        let root = temp_dir("junction-anc");
        let ws = root.join("Project");
        let outside = root.join("outside");
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "SECRET").unwrap();
        fs::write(ws.join("artifacts").join("a.txt"), "ok").unwrap();
        let real_ws = fs::canonicalize(&ws).unwrap();
        // A folder junction on the path (mklink /J needs no privilege): the last component is a plain file, so
        // the open itself follows the junction.
        let jn = root.join("jn");
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&jn).arg(&outside).output().unwrap();
        assert!(made.status.success(), "mklink /J: {}", String::from_utf8_lossy(&made.stdout));
        let through = jn.join("secret.txt");
        assert!(open_source(&through, "secret.txt", Some(&real_ws)).is_err(), "a file reached through a junction outside the workspace is refused at open");
        assert!(open_source(&through, "secret.txt", None).is_ok(), "a hand add of a file elsewhere on this PC is still allowed");
        assert!(open_source(&ws.join("artifacts").join("a.txt"), "a.txt", Some(&real_ws)).is_ok());

        // The same swap seen by the library: `artifacts` becomes a junction after the scan listed the file.
        let lib = Library::new(root.join("lib"));
        let swapped = root.join("Swapped");
        fs::create_dir_all(&swapped).unwrap();
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(swapped.join("artifacts")).arg(&outside).output().unwrap();
        assert!(made.status.success());
        let via = swapped.join("artifacts").join("secret.txt");
        let from = Origin { origin: via.to_string_lossy().into_owned(), source: "workspace", project: None, session: None, at: now_ms() };
        let real_swapped = fs::canonicalize(&swapped).unwrap();
        let err = lib.add_in(&via, from, &|_| None, Some(&real_swapped)).unwrap_err();
        assert!(err.contains("secret.txt"), "{err}");
        assert!(lib.list().is_empty(), "nothing from outside the workspace is stored");

        // A page's asset folder that is a junction to outside: the page is kept, the outside file is not copied.
        let ws2 = root.join("Project2");
        fs::create_dir_all(ws2.join("artifacts")).unwrap();
        fs::write(outside.join("x.js"), "SECRET()").unwrap();
        fs::write(ws2.join("artifacts").join("p.html"), "<title>P</title><script src=\"assets/x.js\"></script>").unwrap();
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(ws2.join("artifacts").join("assets")).arg(&outside).output().unwrap();
        assert!(made.status.success());
        let got = scan_workspace(&lib, &ws2, None, &|_| None, &mut HashMap::new());
        assert_eq!(got.changed, 1, "{:?}", got.skipped);
        let id = lib.list()[0].entry.id.clone();
        assert!(lib.open(&format!("/{id}/p.html")).is_some());
        assert!(lib.open(&format!("/{id}/assets/x.js")).is_none(), "an asset reached through a junction is not copied");
        // Unlink the junctions (rmdir removes the link, not the folder it points at).
        for j in [&jn, &swapped.join("artifacts"), &ws2.join("artifacts").join("assets")] {
            fs::remove_dir(j).unwrap();
        }
        assert!(outside.join("secret.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_scan_counts_every_stored_byte_toward_the_folder_cap() {
        let root = temp_dir("fullsize");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts").join("assets")).unwrap();
        fs::write(ws.join("artifacts").join("assets").join("s.bin"), vec![b'x'; 50]).unwrap();
        for n in ["p1", "p2", "p3", "p4"] {
            fs::write(ws.join("artifacts").join(format!("{n}.html")), "<script src=\"assets/s.bin\"></script>").unwrap();
        }
        // Each page is 36 bytes on its own and 86 with the asset copied beside it.
        let lib = Library::new(root.join("lib"));
        let got = scan_capped(&lib, &ws, None, &|_| None, &mut HashMap::new(), 200);
        let stored: u64 = lib.list().iter().map(|l| l.entry.size).sum();
        assert_eq!(got.changed, 2, "two pages (172 bytes) fit under 200, a third would be 258: {:?}", got.skipped);
        assert!(stored <= 200, "the library holds {stored} bytes from this folder");

        // Files stored on an earlier tick count before the scan reaches them in name order.
        let ws2 = root.join("Project2");
        fs::create_dir_all(ws2.join("artifacts")).unwrap();
        fs::write(ws2.join("artifacts").join("z.txt"), vec![b'z'; 90]).unwrap();
        let lib2 = Library::new(root.join("lib2"));
        let mut seen = HashMap::new();
        assert_eq!(scan_capped(&lib2, &ws2, None, &|_| None, &mut seen, 100).changed, 1);
        fs::write(ws2.join("artifacts").join("a.txt"), vec![b'a'; 20]).unwrap();
        let again = scan_capped(&lib2, &ws2, None, &|_| None, &mut seen, 100);
        assert_eq!(again.changed, 0, "z.txt already holds 90 of the 100 bytes, even though a.txt sorts first: {:?}", again.skipped);
        assert_eq!(lib2.list().len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_same_file_named_two_ways_is_one_entry() {
        // The id of a path that is already written the usual Windows way does not change.
        let old = |origin: &str| {
            let mut h: u64 = 0xcbf2_9ce4_8422_2325;
            for b in origin.bytes() {
                h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
            }
            format!("{h:016x}")
        };
        let usual = r"C:\Users\me\Project\artifacts\a.html";
        assert_eq!(id_of(usual), old(usual));
        assert_eq!(id_of("c:/Users/me/Project/artifacts/a.html"), id_of(usual));
        assert_eq!(id_of(r"c:\Users\me\Project\artifacts\a.html"), id_of(usual));
        assert_eq!(id_of(r"\\?\C:\Users\me\Project\artifacts\a.html"), id_of(usual));
        assert_ne!(id_of(r"C:\Users\me\Project\artifacts\b.html"), id_of(usual));
        // A publish URL or a Unix path is left exactly as it is.
        assert_eq!(id_of("https://example.com/a/b.html"), old("https://example.com/a/b.html"));
        assert_eq!(id_of("/home/me/a.html"), old("/home/me/a.html"));
    }

    #[test]
    fn a_range_that_starts_past_the_end_is_416() {
        let root = temp_dir("range416");
        let lib = Library::new(root.join("lib"));
        let file = root.join("clip.mp4");
        fs::write(&file, (0..=255).collect::<Vec<u8>>()).unwrap();
        let e = lib.add(&file, Origin::hand(&file), &|_| None).unwrap();
        let uri = format!("http://kolux-artifact.localhost/{}/clip.mp4", e.id);
        for start in ["256-", "256-300", "9999-"] {
            let req = tauri::http::Request::builder().uri(&uri).header("range", format!("bytes={start}")).body(Vec::new()).unwrap();
            let r = serve(&lib, &req);
            assert_eq!(r.status(), 416, "bytes={start}");
            assert_eq!(r.headers().get("content-range").and_then(|v| v.to_str().ok()), Some("bytes */256"));
            assert!(r.body().is_empty());
        }
        // Malformed and reversed asks still get the whole file, as before.
        for odd in ["bytes=10-5", "items=0-5", "bytes=0-5,10-15", "bytes=x-"] {
            let req = tauri::http::Request::builder().uri(&uri).header("range", odd).body(Vec::new()).unwrap();
            assert_eq!(serve(&lib, &req).status(), 200, "{odd}");
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_failed_link_count_is_treated_as_a_hard_link() {
        assert!(link_count(None) > 1, "when the query fails the file is refused, not trusted");
        assert_eq!(link_count(Some(1)), 1);
        assert_eq!(link_count(Some(3)), 3);
    }

    #[test]
    fn the_scheme_answers_with_nosniff_and_without_a_wildcard_origin() {
        let root = temp_dir("headers");
        let lib = Library::new(root.join("lib"));
        let file = root.join("a.html");
        fs::write(&file, "<title>A</title>").unwrap();
        let e = lib.add(&file, Origin::hand(&file), &|_| None).unwrap();
        let req = tauri::http::Request::builder().uri(format!("http://kolux-artifact.localhost/{}/a.html", e.id)).body(Vec::new()).unwrap();
        let r = serve(&lib, &req);
        assert_eq!(r.status(), 200);
        assert_eq!(r.headers().get("x-content-type-options").and_then(|v| v.to_str().ok()), Some("nosniff"));
        assert!(r.headers().get("access-control-allow-origin").is_none(), "no page needs to read the scheme cross-origin");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_external_lets_through_only_clean_web_and_mail_links() {
        assert_eq!(external_url("https://example.com/a?b=1").unwrap(), "https://example.com/a?b=1");
        assert_eq!(external_url("HTTP://Example.com").unwrap(), "http://example.com/", "the parsed form is what is opened");
        assert_eq!(external_url("mailto:me@example.com").unwrap(), "mailto:me@example.com");
        for bad in ["file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ms-msdt:/id", "https://example.com/\"quoted", "https://exa\tmple.com/", "https://example.com/\nx", "https://example.com/\0", "not a url", "", "https://"] {
            assert!(external_url(bad).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn the_artifact_scheme_is_answered_off_the_window_thread() {
        // The threading is proven by reading the code, not by running a window: the handler is the
        // asynchronous one, and the file read happens on a blocking worker before the responder is used.
        let lib = include_str!("lib.rs");
        let at = lib.find("register_asynchronous_uri_scheme_protocol(artifacts::SCHEME").expect("the scheme handler must be the asynchronous one");
        let body = &lib[at..at + 1200];
        assert!(body.contains("spawn_blocking") && body.contains("responder.respond"), "the read runs on a blocking worker and answers through the responder");
        assert!(!lib.contains(".register_uri_scheme_protocol(artifacts::SCHEME"));
    }
}
