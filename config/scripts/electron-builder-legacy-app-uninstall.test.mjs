import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')

const readInstallerHooks = () => readFile(electronBuilderConfig.nsis.include, 'utf8')

// electron-builder derives the NSIS uninstall registry key as
// UUID.v5(appId, ELECTRON_BUILDER_NS_UUID) (app-builder-lib's NsisTarget.js). Reimplemented
// here (RFC 4122 ยง4.3) rather than importing app-builder-lib/builder-util-runtime, so this
// test does not depend on their internal module layout.
function uuidV5(name, namespaceHex) {
  const namespace = Buffer.from(namespaceHex.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1')
  hash.update(namespace)
  hash.update(name)
  const bytes = hash.digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const ELECTRON_BUILDER_NS_UUID = '50e065bc-3134-11e6-9bab-38c9862bdaf3'
// The retired Nightshift appId (c73b9e50:config/electron-builder.config.cjs); never changes.
const OLD_NIGHTSHIFT_APP_ID = 'com.txais.nightshift'

describe('Windows migration: silently uninstall a leftover Nightshift install', () => {
  it('computes the fixed old-Nightshift uninstall registry GUID the way this test file expects', () => {
    // Guard for the guard: pins the reimplemented algorithm against the one known-good vector
    // before trusting it to validate the .nsh constant below.
    expect(uuidV5(OLD_NIGHTSHIFT_APP_ID, ELECTRON_BUILDER_NS_UUID)).toBe(
      '13ea7d17-c314-5605-b7f3-d1177cb8ab25'
    )
  })

  it('pins the hard-coded registry key to that computed GUID', async () => {
    const hooks = await readInstallerHooks()
    const guid = uuidV5(OLD_NIGHTSHIFT_APP_ID, ELECTRON_BUILDER_NS_UUID)
    expect(hooks).toContain(
      `!define OLD_NIGHTSHIFT_UNINSTALL_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${guid}}"`
    )
  })

  it('runs in customInit, before any Kolux install file is written', async () => {
    const hooks = await readInstallerHooks()
    expect(hooks).toMatch(/!macro\s+customInit\b[\s\S]*!macroend/)
    // customInit must run ahead of customInstall in file order for the doc comment's claim
    // (no file-copy race) to mean anything.
    expect(hooks.indexOf('!macro customInit')).toBeLessThan(hooks.indexOf('!macro customInstall'))
  })

  it('stops a running old Nightshift the same way customUnInstall stops Kolux', async () => {
    const hooks = await readInstallerHooks()
    const customInit = hooks.match(/!macro\s+customInit\b([\s\S]*?)!macroend/)[1]
    expect(customInit).toMatch(/taskkill[^\n]*\/IM\s+"Nightshift\.exe"/)
    expect(customInit).toMatch(/\/FI\s+"USERNAME eq /)
  })

  it('reads QuietUninstallString from both HKCU and HKLM and never appends its own flags', async () => {
    const hooks = await readInstallerHooks()
    const customInit = hooks.match(/!macro\s+customInit\b([\s\S]*?)!macroend/)[1]
    expect(customInit).toMatch(
      /ReadRegStr\s+\$0\s+HKCU\s+"\$\{OLD_NIGHTSHIFT_UNINSTALL_KEY\}"\s+"QuietUninstallString"/
    )
    expect(customInit).toMatch(
      /ReadRegStr\s+\$0\s+HKLM\s+"\$\{OLD_NIGHTSHIFT_UNINSTALL_KEY\}"\s+"QuietUninstallString"/
    )
    expect(customInit).toMatch(/ExecWait\s+'\$0'/)
    // QuietUninstallString already carries /S - appending another flag here would run it twice.
    expect(customInit).not.toMatch(/ExecWait\s+'\$0[^']*\/S/)
  })

  // Why: the whole point is that Kolux's first-launch migration still finds %APPDATA%\Nightshift
  // afterward. Nightshift's own uninstaller only deletes it when electron-builder's
  // `deleteAppDataOnUninstall` is on, which Nightshift's config never set - so the migration
  // block itself must never touch APPDATA, or it would race that setting's absence.
  it('never touches %APPDATA%\\Nightshift itself', async () => {
    const hooks = await readInstallerHooks()
    const customInit = hooks.match(/!macro\s+customInit\b([\s\S]*?)!macroend/)[1]
    expect(customInit).not.toMatch(/APPDATA/i)
  })

  // Best-effort: a failed taskkill or a missing/failed old uninstaller must never stop the
  // Kolux install from proceeding.
  it('never aborts the Kolux install if the old-Nightshift cleanup fails', async () => {
    const hooks = await readInstallerHooks()
    const customInit = hooks.match(/!macro\s+customInit\b([\s\S]*?)!macroend/)[1]
    expect(customInit).not.toMatch(/\b(Abort|Quit)\b/)
  })

  // EDR posture (docs/reference/windows-edr-posture.md): no ExecutionPolicy Bypass, no
  // PowerShell hop, no cmd.exe /c carrying free text for this migration step.
  it('spawns the old uninstaller and taskkill directly, with no PowerShell or cmd.exe hop', async () => {
    const hooks = await readInstallerHooks()
    const customInit = hooks.match(/!macro\s+customInit\b([\s\S]*?)!macroend/)[1]
    expect(customInit).not.toMatch(/powershell|pwsh|cmd\.exe|ExecutionPolicy|EncodedCommand/i)
  })
})
