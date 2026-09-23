import { join } from 'node:path'

// fork (TxaisX/kolux#19522): the relocated daemon must carry every native addon its bundle
// bare-requires, not just node-pty. Without @vscode/windows-process-tree the host loses the native
// process table and spawns a PowerShell CIM scan every ~2s (35 powershell.exe/min).
const DAEMON_NATIVE_ADDONS = [
  { name: 'node-pty', optional: false },
  { name: '@vscode/windows-process-tree', optional: true },
  { name: 'windows-native-registry', optional: true }
] as const

type AddonCopyOp = {
  sourcePath: string
  destRel: string
  kind: 'dir'
  optional: boolean
  filter: (sourcePath: string) => boolean
}

/** Copy ops for the addon trees under resources/node_modules, mirrored so require() resolves them. */
export function daemonNativeAddonCopyOps(
  resourcesPath: string,
  appDir: string,
  toPosixRelative: (from: string, to: string) => string,
  filter: (sourcePath: string) => boolean
): AddonCopyOp[] {
  return DAEMON_NATIVE_ADDONS.map(({ name, optional }) => {
    const dir = join(resourcesPath, 'node_modules', name)
    return { sourcePath: dir, destRel: toPosixRelative(appDir, dir), kind: 'dir', optional, filter }
  })
}
