// T-195: tauri-build links its Windows resource (with the Common Controls v6 manifest) into bins only, so a test exe
// that links the web view path fails to load (STATUS_ENTRYPOINT_NOT_FOUND). The manifest is linked into every target
// instead, from the same XML; the resource keeps the icon and version info.
// Perf P3: heapType SegmentHeap puts the process on the Windows segment heap (Windows 10 2004+; older builds ignore
// the element), which keeps less memory committed for a long-running app that allocates and frees a lot.
const APP_MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <heapType xmlns="http://schemas.microsoft.com/SMI/2020/WindowsSettings">SegmentHeap</heapType>
    </windowsSettings>
  </application>
</assembly>
"#;

fn main() {
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let windows = if msvc { tauri_build::WindowsAttributes::new_without_app_manifest() } else { tauri_build::WindowsAttributes::new() };
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build failed");
    if msvc {
        let path = std::path::Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("app.manifest");
        std::fs::write(&path, APP_MANIFEST).expect("write the app manifest");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", path.display());
    }
}
