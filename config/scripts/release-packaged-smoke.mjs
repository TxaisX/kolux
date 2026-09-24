import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

if (process.platform !== 'win32') {
  throw new Error('The packaged release smoke test requires Windows.')
}

const repoRoot = resolve(import.meta.dirname, '..', '..')
const resources = join(repoRoot, 'dist', 'win-unpacked', 'resources')
const executable = join(repoRoot, 'dist', 'win-unpacked', 'Kolux.exe')
const cliEntry = join(resources, 'app.asar.unpacked', 'out', 'cli', 'index.js')
const migrationEntry = join(
  resources,
  'app.asar.unpacked',
  'out',
  'main',
  'startup',
  'pre-kolux-userdata-migration.js'
)
for (const file of [executable, cliEntry, migrationEntry]) {
  assert.ok(existsSync(file), `Missing packaged release file: ${file}`)
}

const smokeRoot = mkdtempSync(join(tmpdir(), 'kolux-release-smoke-'))
const smokeHome = join(smokeRoot, 'home')
const appData = join(smokeRoot, 'appdata')
const legacyProfile = join(appData, 'Nightshift')
const koluxProfile = join(appData, 'kolux')
mkdirSync(smokeHome)
mkdirSync(legacyProfile, { recursive: true })
writeFileSync(join(legacyProfile, 'nightshift-data.json'), '{"releaseSmoke":true}\n')

const env = {
  ...process.env,
  APPDATA: appData,
  USERPROFILE: smokeHome,
  HOME: smokeHome,
  ELECTRON_RUN_AS_NODE: '1',
  KOLUX_BACKGROUND_LAUNCH: '1'
}
const run = (args) =>
  execFileSync(executable, args, {
    encoding: 'utf8',
    env,
    timeout: 30_000,
    windowsHide: true
  }).trim()

try {
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
  assert.equal(run([cliEntry, '--version']), version)
  assert.match(run([cliEntry, '--help']), /Kolux/i)

  const migrate = `require(process.argv[1]).migrateLegacyNightshiftUserData(process.argv[2], { homeDir: process.argv[3] })`
  run(['-e', migrate, migrationEntry, koluxProfile, smokeHome])
  assert.deepEqual(JSON.parse(readFileSync(join(koluxProfile, 'kolux-data.json'), 'utf8')), {
    releaseSmoke: true
  })
  assert.ok(existsSync(join(koluxProfile, '.kolux-legacy-rename-migration-complete')))
  console.log('Packaged CLI and isolated legacy profile migration passed.')
} finally {
  const resolvedRoot = realpathSync(smokeRoot)
  const resolvedTemp = realpathSync(tmpdir())
  if (!resolvedRoot.startsWith(`${resolvedTemp}${sep}`)) {
    console.error(`Refusing to remove smoke directory outside temp: ${resolvedRoot}`)
    process.exitCode = 1
  } else {
    rmSync(resolvedRoot, { recursive: true, force: true })
  }
}
