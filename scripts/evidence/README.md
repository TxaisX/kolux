# Evidence harness

Proof screenshots for `evidence/<task>.png` come from the running app, never from the screen. Start the app with `pnpm tauri dev`, then from Windows PowerShell:
- `.\scripts\evidence\shot.ps1 -Out evidence\T-00x.png` captures the Kolux window by PrintWindow (the window paints itself into the file, so nothing else on screen is caught); `-Grow 200` enlarges the window first.
- `.\scripts\evidence\type.ps1 -Click "120,140" -Text "hello`n" -Out evidence\after.png` posts a click and keystrokes straight to the app's web view child window and captures afterwards; the shared keyboard and mouse are never used, so nothing lands in another program.
- Coordinates are client pixels of the web view, top-left origin; take a plain shot first to find them.
- Posted keystrokes only reach the page while the app window is in front (seen in T-004: the web view drops them otherwise). Bring it forward first with `(New-Object -ComObject WScript.Shell).AppActivate($pid)`, where `$pid` is the Kolux process id (`(Get-Process | Where-Object MainWindowTitle -like "Kolux*").Id`), then run `type.ps1`.
- `node scripts/evidence/cdp.mjs main type "example.com" enter` (also `key l 2` for a chord, `eval "<js>"` to read the DOM, `focus "<selector>"`, `list`) drives the app over its own WebView2 debugging port: start the dev app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` first. Unlike posted keystrokes this works while another window holds the foreground and can press chords; the mods number is Alt=1, Ctrl=2, Shift=8 added together. Capture with `shot.ps1` as before.
- Shots are taken dark on the New look at 1920 wide. A fresh profile starts that way on its own (T-418: no saved look means New, no saved mode means Dark, both written down at first start); a profile that already chose keeps its choice, so set `uiLook` to `new` and `appearanceMode` to `dark` in its `settings.json` before shooting.

## Launching smoke or a prove run beside other lanes (round 2, 2026-11-12)

- **The identifier must carry the suffix.** `smoke.mjs` and every prove script wipe and reuse a scratch profile only
  when the identifier ends in the suffix they were given (`app-launch.mjs`: `refusing to wipe the profile of X`). For
  `smoke.mjs` that is `.smoke`, so `--identifier com.txaisxiong.kolux.c1.smoke` works and
  `com.txaisxiong.kolux.c1` is refused unless the run is `--attach`. Prove scripts default to `.prove`
  (`PROVE_SUFFIX` overrides it; a slot from `scripts/stress/run-all.mjs` sets `.o2-<n>` to match its identifier).
- **Give every run its own ports.** `--port` / `--cdp` for smoke; `PROVE_PORT` / `PROVE_CDP` (and `PROVE_BASE`,
  `PROVE_LOGS`, `PROVE_IDENTIFIER`, `PROVE_SUFFIX`) for prove scripts. None of them should be the default 1420/1431 or
  9240/9290 while another lane runs.
- **Focus.** `focusField()` retries for 5 s on the first on-screen match, so a field inside a sidebar form that is still
  mounting, or a window that is off-screen, no longer fails the run on the first attempt.
- **Vitest and `?raw` contract tests.** A source-text test that imports `./X.tsx?raw` reads Vite's transform cache: after
  editing `X.tsx` a second run in the same `node_modules/.vite` can see the old text and fail on correct code (seen in
  lane o3-rune, 2026-11-12). **One flag is the workaround: `npx vitest run --no-fsModuleCache`** stops Vitest reusing the
  transform, so no cache clear is needed (round 4, vitest 5.1.0: `--help` lists `--fsModuleCache` default `true`, and
  `--clearCache` wipes it without running tests). `scripts/raw-cache-probe.test.mjs` fails if a `?raw` import ever
  disagrees with the file on disk, which is this bug's signature. The permanent fix is still for those tests to read with
  `node:fs` like `src/usage/usageStatusUx.test.ts` already does for `styles.css`.
