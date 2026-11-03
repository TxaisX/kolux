//! SET-018: the font families installed on this machine, read only when a font picker opens. On
//! Windows PowerShell lists them through .NET's InstalledFontCollection; elsewhere fontconfig's
//! `fc-list`. A failure is an error, and the interface falls back to its built-in list.

use std::process::Command;

/// One family per line in, a sorted list without blanks or repeats out (fc-list may give
/// "Family,Alias" on one line; the first name is kept).
pub(crate) fn tidy_fonts(raw: &str) -> Vec<String> {
    let mut names: Vec<String> = raw
        .lines()
        .filter_map(|l| l.split(',').next())
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
}

fn read_fonts() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new(crate::pty::system_program(crate::pty::WINDOWS_POWERSHELL)); // T-663
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
        ]);
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new(crate::pty::full_path_program("fc-list").ok_or("fc-list was not found on this computer")?); // T-663
        c.args([":", "family"]);
        c
    };
    let out = cmd.output().map_err(|e| format!("could not list fonts: {e}"))?;
    if !out.status.success() {
        return Err(format!("could not list fonts: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let fonts = tidy_fonts(&String::from_utf8_lossy(&out.stdout));
    if fonts.is_empty() {
        return Err("no fonts were listed".into());
    }
    Ok(fonts)
}

#[tauri::command]
pub async fn list_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(read_fonts).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_018_font_list_is_sorted_without_blanks_repeats_or_aliases() {
        let raw = "Segoe UI\r\n\r\nArial\ncascadia mono\nCascadia Mono\nDejaVu Sans,DejaVu Sans Condensed\n";
        assert_eq!(tidy_fonts(raw), ["Arial", "cascadia mono", "DejaVu Sans", "Segoe UI"]);
    }
}
