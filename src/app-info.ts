// What the Rust side reports about this running app (see the `app_info` command in src-tauri).
export type AppInfo = { version: string; profileDir: string; startCount: number };

/** `needing` panes waiting on the user lead the title as "(2) ", so the taskbar shows it from another app. */
export function windowTitle(info: AppInfo | null, needing = 0): string {
  const name = info ? `Kolux ${info.version}` : "Kolux";
  return needing > 0 ? `(${needing}) ${name}` : name;
}
