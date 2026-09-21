import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'

import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  readTextFileRemote,
  writeTextFileRemoteAtomic
} from '../agent-hooks/installer-utils-remote'
import {
  AMP_PLUGIN_FILE,
  AMP_PLUGIN_MARKER,
  getAmpPluginSource
} from './agent-status-plugin-source'
import {
  getPluginPath,
  getRemotePluginPath,
  isManagedPlugin,
  readLocalPluginState,
  statusFromState
} from './managed-plugin-install-status'

// Why: Amp loads every plugin file in the dir; a pre-rename kolux-agent-status.ts named
// nightshift-agent-status.ts would otherwise keep firing the managed hook a second time.
const PRE_RENAME_AMP_PLUGIN_FILE = 'nightshift-agent-status.ts'
const PRE_RENAME_AMP_PLUGIN_MARKER =
  'Managed by Nightshift. Do not edit; changes may be overwritten.'

function getLegacyPluginPath(): string {
  return join(dirname(getPluginPath()), PRE_RENAME_AMP_PLUGIN_FILE)
}

function sweepLegacyAmpPlugin(): void {
  const legacyPath = getLegacyPluginPath()
  if (!existsSync(legacyPath)) {
    return
  }
  try {
    const content = readFileSync(legacyPath, 'utf-8')
    if (content.includes(PRE_RENAME_AMP_PLUGIN_MARKER)) {
      unlinkSync(legacyPath)
    }
  } catch {
    // best effort
  }
}

function writeTextFileAtomic(filePath: string, content: string): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  if (existsSync(filePath)) {
    try {
      if (readFileSync(filePath, 'utf-8') === content) {
        return
      }
    } catch {
      // Fall through to the atomic write path.
    }
  }

  const tmpPath = join(dir, `.${Date.now()}-${randomUUID()}.tmp`)
  try {
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, filePath)
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // best effort
      }
    }
  }
}

export class AmpHookService {
  getStatus(): AgentHookInstallStatus {
    const pluginPath = getPluginPath()
    return statusFromState(pluginPath, readLocalPluginState(pluginPath))
  }

  install(): AgentHookInstallStatus {
    const pluginPath = getPluginPath()
    const state = readLocalPluginState(pluginPath)
    if (state.kind === 'unmanaged' || state.kind === 'error') {
      return statusFromState(pluginPath, state)
    }
    writeTextFileAtomic(pluginPath, getAmpPluginSource())
    sweepLegacyAmpPlugin()
    return this.getStatus()
  }

  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    const remotePluginPath = getRemotePluginPath(remoteHome)
    try {
      const existing = await readTextFileRemote(sftp, remotePluginPath)
      if (existing !== null && !isManagedPlugin(existing)) {
        return statusFromState(remotePluginPath, { kind: 'unmanaged' })
      }
      await writeTextFileRemoteAtomic(sftp, remotePluginPath, getAmpPluginSource())
      return {
        agent: 'amp',
        state: 'installed',
        configPath: remotePluginPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (error) {
      return {
        agent: 'amp',
        state: 'error',
        configPath: remotePluginPath,
        managedHooksPresent: false,
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  }

  remove(): AgentHookInstallStatus {
    sweepLegacyAmpPlugin()
    const pluginPath = getPluginPath()
    const state = readLocalPluginState(pluginPath)
    if (state.kind === 'managed') {
      unlinkSync(pluginPath)
      return this.getStatus()
    }
    return statusFromState(pluginPath, state)
  }
}

export const ampHookService = new AmpHookService()

export const _internals = {
  AMP_PLUGIN_FILE,
  AMP_PLUGIN_MARKER,
  getAmpPluginSource,
  getPluginPath,
  getRemotePluginPath,
  isManagedPlugin
}
