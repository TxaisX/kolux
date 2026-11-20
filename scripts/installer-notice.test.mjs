// T-786 (P3-15, DT-C220): the installer's Windows 10 notice. The hook file is compiled with the NSIS that Tauri
// caches (the harness includes the real src-tauri/installer-hooks.nsh) and its two decisions run on mocked
// inputs: a build number below 22000 is due a notice, and /UPDATE on the command line skips it.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooks = path.join(root, "src-tauri", "installer-hooks.nsh");
const harness = path.join(root, "scripts", "installer-notice-harness.nsi");
const makensis = path.join(process.env.LOCALAPPDATA ?? "", "tauri", "NSIS", "Bin", "makensis.exe");
const text = fs.readFileSync(hooks, "utf8");

describe("installer Windows 10 notice", () => {
  it("is wired into the pre-install hook and answers itself in a silent install", () => {
    expect(text).toMatch(/!macro NSIS_HOOK_PREINSTALL\s+!insertmacro KOLUX_WIN10_NOTICE/);
    expect(text).toMatch(/MessageBox MB_OK\|MB_ICONINFORMATION "[^"]*Windows 11[^"]*Windows 10[^"]*" \/SD IDOK/);
    expect(text).toContain('"${BUILD}" < 22000');
  });

  it("the retired command line: install and uninstall take its PATH entry and files away and never add the bin folder", () => {
    expect(text).toMatch(/!macro NSIS_HOOK_POSTINSTALL[\s\S]*?!insertmacro KOLUX_CLI_LEFTOVERS\s+!macroend/);
    expect(text).toMatch(/!macro NSIS_HOOK_PREUNINSTALL\s+!insertmacro KOLUX_CLI_LEFTOVERS\s+!macroend/);
    expect(text).toMatch(/!macro KOLUX_CLI_LEFTOVERS\s+!insertmacro KOLUX_PATH_REMOVE\s+Delete "\$INSTDIR\\bin\\kolux\.exe"\s+Delete "\$INSTDIR\\bin\\kolux\.cmd"\s+RMDir "\$INSTDIR\\bin"/);
    const post = text.slice(text.indexOf("!macro NSIS_HOOK_POSTINSTALL"));
    expect(post.slice(0, post.indexOf("!macroend"))).not.toContain("KOLUX_PATH_ADD");
    // The app no longer answers --uninstall-path: run, it would open the window.
    expect(text).not.toContain('${MAINBINARYNAME}.exe" --uninstall-path');
  });

  it.runIf(process.platform === "win32" && fs.existsSync(makensis))("decides from the build number and /UPDATE as the harness expects", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t786-"));
    try {
      fs.copyFileSync(hooks, path.join(dir, "installer-hooks.nsh"));
      fs.copyFileSync(harness, path.join(dir, "harness.nsi"));
      execFileSync(makensis, ["-V1", "/DHOOKS=installer-hooks.nsh", "harness.nsi"], { cwd: dir, stdio: "pipe", windowsHide: true });
      execFileSync(path.join(dir, "t786-harness.exe"), ["/S"], { cwd: dir, stdio: "pipe", windowsHide: true });
      const lines = fs.readFileSync(path.join(dir, "t786-result.txt"), "utf8").split(/\r?\n/).filter(Boolean);
      const cases = lines.filter((l) => l.includes("expect="));
      expect(cases.length).toBe(8);
      for (const l of cases) {
        const got = /(?:due|update)=(\d)/.exec(l)?.[1];
        const want = /expect=(\d)/.exec(l)?.[1];
        expect({ l, got }).toEqual({ l, got: want });
      }
      expect(lines.at(-1)).toBe("notice macro ran to the end");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
