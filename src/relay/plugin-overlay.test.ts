import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginOverlayManager, sweepRetiredOpenCodeOverlays } from './plugin-overlay'
import { resolvePiSourceAgentDir } from './plugin-overlay-env'

describe('PluginOverlayManager', () => {
  let homeDir: string
  let manager: PluginOverlayManager

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'plugin-overlay-'))
    manager = new PluginOverlayManager({ homeDir })
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('reports no source until install runs', () => {
    expect(manager.hasPiSource()).toBe(false)
    expect(manager.materializePi('tab-1:0')).toBeNull()
  })

  it('installs Pi extension into the real agent extensions dir', () => {
    manager.setSources({ piExtensionSource: '// pi extension' })
    const result = manager.materializePi('tab-2:0')
    expect(result?.sourceAgentDir).toBeDefined()
    const file = join(result!.sourceAgentDir!, 'extensions', 'kolux-agent-status.ts')
    expect(result?.statusExtensionPath).toBe(file)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('@kolux-managed-pi-extension')
  })

  it("does not overwrite a user's same-named remote Pi extension file", () => {
    const piAgentDir = join(homeDir, '.pi', 'agent')
    const extensionFile = join(piAgentDir, 'extensions', 'kolux-agent-status.ts')
    mkdirSync(join(piAgentDir, 'extensions'), { recursive: true })
    writeFileSync(extensionFile, 'user-owned remote status extension')

    manager.setSources({ piExtensionSource: '// pi extension' })
    expect(manager.materializePi('tab-user-owned-pi:0')).toBeNull()
    expect(readFileSync(extensionFile, 'utf8')).toBe('user-owned remote status extension')
  })

  it('uses the kind-specific Pi-compatible extension source when available', () => {
    manager.setSources({
      piExtensionSource: '// pi extension',
      ompExtensionSource: '// omp extension'
    })

    const piResult = manager.materializePi('tab-kind-pi:0', undefined, 'pi')
    const ompResult = manager.materializePi('tab-kind-omp:0', undefined, 'omp')

    expect(piResult?.sourceAgentDir).toBeDefined()
    expect(ompResult?.sourceAgentDir).toBeDefined()
    expect(
      readFileSync(join(piResult!.sourceAgentDir!, 'extensions', 'kolux-agent-status.ts'), 'utf8')
    ).toContain('// pi extension')
    expect(
      readFileSync(join(ompResult!.sourceAgentDir!, 'extensions', 'kolux-agent-status.ts'), 'utf8')
    ).toContain('// omp extension')
  })

  it('uses only the Prime-specific source in the default Prime agent dir', () => {
    manager.setSources({ piExtensionSource: '// pi extension' })
    expect(manager.materializePi('tab-prime-missing:0', undefined, 'prime-agent')).toBeNull()

    manager.setSources({ primeAgentExtensionSource: '// prime extension' })
    const result = manager.materializePi('tab-prime:0', undefined, 'prime-agent')
    expect(result?.sourceAgentDir).toBe(join(homeDir, '.prime', 'agent'))
    expect(readFileSync(result!.statusExtensionPath!, 'utf8')).toContain('// prime extension')
    expect(readFileSync(result!.statusExtensionPath!, 'utf8')).not.toContain('// pi extension')
  })

  it('installs Kolux status extension into the remote default Pi agent dir', () => {
    const piAgentDir = join(homeDir, '.pi', 'agent')
    mkdirSync(join(piAgentDir, 'skills', 'my-skill'), { recursive: true })
    mkdirSync(join(piAgentDir, 'extensions', 'user-ext'), { recursive: true })
    writeFileSync(join(piAgentDir, 'auth.json'), 'secret token')
    writeFileSync(join(piAgentDir, 'skills', 'my-skill', 'SKILL.md'), 'critical user skill')
    writeFileSync(join(piAgentDir, 'extensions', 'user-ext', 'ext.ts'), 'user extension')
    writeFileSync(
      join(piAgentDir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'amazon-bedrock',
        hideThinkingBlock: false,
        terminal: {
          showImages: false,
          clearOnShrink: false
        }
      })
    )

    manager.setSources({ piExtensionSource: '// pi extension' })
    const result = manager.materializePi('tab-pi:0')
    const dir = result?.sourceAgentDir

    expect(dir).toBeDefined()
    expect(readFileSync(join(dir!, 'auth.json'), 'utf8')).toBe('secret token')
    expect(readFileSync(join(dir!, 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe(
      'critical user skill'
    )
    expect(readFileSync(join(dir!, 'extensions', 'user-ext', 'ext.ts'), 'utf8')).toBe(
      'user extension'
    )
    expect(readdirSync(join(dir!, 'extensions')).sort()).toEqual([
      'kolux-agent-status.ts',
      'user-ext'
    ])
    expect(JSON.parse(readFileSync(join(dir!, 'settings.json'), 'utf8'))).toEqual({
      defaultProvider: 'amazon-bedrock',
      hideThinkingBlock: false,
      terminal: {
        showImages: false,
        clearOnShrink: false
      }
    })
    expect(JSON.parse(readFileSync(join(piAgentDir, 'settings.json'), 'utf8'))).toEqual({
      defaultProvider: 'amazon-bedrock',
      hideThinkingBlock: false,
      terminal: {
        showImages: false,
        clearOnShrink: false
      }
    })
  })

  it('mirrors a preexisting remote Pi agent dir instead of the default', () => {
    const defaultAgentDir = join(homeDir, '.pi', 'agent')
    const customAgentDir = join(homeDir, 'custom-pi-agent')
    mkdirSync(defaultAgentDir, { recursive: true })
    mkdirSync(join(customAgentDir, 'extensions'), { recursive: true })
    writeFileSync(join(defaultAgentDir, 'auth.json'), 'default token')
    writeFileSync(join(customAgentDir, 'auth.json'), 'custom token')
    writeFileSync(join(customAgentDir, 'extensions', 'custom.ts'), 'custom extension')

    manager.setSources({ piExtensionSource: '// pi extension' })
    const result = manager.materializePi('tab-custom-pi:0', customAgentDir)
    const dir = result?.sourceAgentDir

    expect(dir).toBeDefined()
    expect(readFileSync(join(dir!, 'auth.json'), 'utf8')).toBe('custom token')
    expect(readFileSync(join(dir!, 'extensions', 'custom.ts'), 'utf8')).toBe('custom extension')
    expect(readFileSync(join(dir!, 'extensions', 'kolux-agent-status.ts'), 'utf8')).toContain(
      '// pi extension'
    )
  })

  it('leaves lazy OMP agent.db in the real remote home on the relay', () => {
    manager.setSources({ piExtensionSource: '// pi extension' })
    const sourceDir = join(homeDir, '.omp', 'agent')
    const first = manager.materializePi('tab-relay-omp-sqlite:0', undefined, 'omp')

    expect(first?.sourceAgentDir).toBe(sourceDir)
    const sourcePath = join(sourceDir, 'agent.db')
    const content = 'agent.db relay credentials'

    expect(existsSync(sourcePath)).toBe(false)
    expect(existsSync(join(homeDir, '.kolux-relay', 'omp-overlays'))).toBe(false)
    expect(existsSync(join(sourceDir, 'history.db'))).toBe(false)
    writeFileSync(sourcePath, content)

    expect(readFileSync(sourcePath, 'utf8')).toBe(content)

    const second = manager.materializePi('tab-relay-omp-sqlite:0', undefined, 'omp')

    expect(second?.sourceAgentDir).toBe(first?.sourceAgentDir)
    expect(readFileSync(join(second!.sourceAgentDir!, 'agent.db'), 'utf8')).toBe(content)
  })

  // Why: per-agent source dir. The renderer picks Pi or OMP per
  // launch, and the relay must use the right `~/.<kind>/agent` source —
  // disk-presence guessing (always-Pi or first-exists) shadows the other
  // agent's user extensions when both dirs exist on the remote disk.
  describe('per-agent default source dir (no cross-agent fallback)', () => {
    function seedAgentDir(dotDir: '.pi' | '.omp', tag: string): string {
      const agentDir = join(homeDir, dotDir, 'agent')
      mkdirSync(join(agentDir, 'extensions', `${tag}-ext`), { recursive: true })
      writeFileSync(join(agentDir, 'extensions', `${tag}-ext`, 'ext.ts'), `${tag} extension`)
      writeFileSync(join(agentDir, 'auth.json'), `${tag} token`)
      return agentDir
    }

    it('launching pi with both ~/.pi/agent and ~/.omp/agent present installs into ~/.pi/agent', () => {
      seedAgentDir('.pi', 'pi')
      seedAgentDir('.omp', 'omp')

      manager.setSources({ piExtensionSource: '// pi extension' })
      const result = manager.materializePi('tab-relay-pi-both:0', undefined, 'pi')
      const dir = result?.sourceAgentDir

      expect(dir).toBe(join(homeDir, '.pi', 'agent'))
      expect(readFileSync(join(dir!, 'auth.json'), 'utf8')).toBe('pi token')
      const extensions = readdirSync(join(dir!, 'extensions')).sort()
      expect(extensions).toContain('pi-ext')
      expect(extensions).toContain('kolux-agent-status.ts')
      expect(extensions).not.toContain('omp-ext')
    })

    it('launching omp with both ~/.pi/agent and ~/.omp/agent present installs into ~/.omp/agent', () => {
      seedAgentDir('.pi', 'pi')
      seedAgentDir('.omp', 'omp')

      manager.setSources({ piExtensionSource: '// pi extension' })
      const result = manager.materializePi('tab-relay-omp-both:0', undefined, 'omp')
      const dir = result?.sourceAgentDir

      expect(dir).toBe(join(homeDir, '.omp', 'agent'))
      // Even though ~/.pi/agent exists, the OMP launch MUST mirror OMP's
      // source dir. Cross-agent fallback would silently shadow the user's
      // OMP extensions on the remote.
      expect(readFileSync(join(dir!, 'auth.json'), 'utf8')).toBe('omp token')
      const extensions = readdirSync(join(dir!, 'extensions')).sort()
      expect(extensions).toContain('omp-ext')
      expect(extensions).toContain('kolux-agent-status.ts')
      expect(extensions).not.toContain('pi-ext')
    })

    it('launching omp when only ~/.pi/agent exists does NOT mirror Pi state', () => {
      // Why: missing OMP source dir on the remote must create only OMP's
      // own extension dir. Pi state must never cross-pollinate in.
      seedAgentDir('.pi', 'pi')
      expect(existsSync(join(homeDir, '.omp'))).toBe(false)
      expect(existsSync(join(homeDir, '.prime'))).toBe(false)

      manager.setSources({ piExtensionSource: '// pi extension' })
      const result = manager.materializePi('tab-relay-omp-empty:0', undefined, 'omp')
      const dir = result?.sourceAgentDir

      expect(dir).toBe(join(homeDir, '.omp', 'agent'))
      // Pi-only home must NOT leak into the OMP home.
      expect(existsSync(join(dir!, 'auth.json'))).toBe(false)
      const extensions = readdirSync(join(dir!, 'extensions')).sort()
      expect(extensions).toEqual(['kolux-agent-status.ts'])
    })

    it('bare-shell prep does not create missing remote agent homes (#10196)', () => {
      expect(existsSync(join(homeDir, '.pi'))).toBe(false)
      expect(existsSync(join(homeDir, '.omp'))).toBe(false)
      manager.setSources({
        piExtensionSource: '// pi extension',
        ompExtensionSource: '// omp extension',
        primeAgentExtensionSource: '// prime extension'
      })

      expect(
        manager.materializePi('tab-bare-pi:0', undefined, 'pi', {
          materializeDefaultHome: false
        })
      ).toBeNull()
      const bareOmp = manager.materializePi('tab-bare-omp:0', undefined, 'omp', {
        materializeDefaultHome: false
      })
      // Why: bare OMP keeps status via ~/.kolux-relay/… without SOURCE_AGENT_DIR or ~/.omp.
      expect(bareOmp?.sourceAgentDir).toBeUndefined()
      expect(bareOmp?.statusExtensionPath).toEqual(
        expect.stringContaining(join('.kolux-relay', 'omp-managed-status-extension'))
      )
      expect(existsSync(bareOmp!.statusExtensionPath!)).toBe(true)
      expect(readFileSync(bareOmp!.statusExtensionPath!, 'utf8')).toContain('// omp extension')
      expect(existsSync(join(homeDir, '.pi'))).toBe(false)
      expect(existsSync(join(homeDir, '.omp'))).toBe(false)
      expect(
        manager.materializePi('tab-bare-prime:0', undefined, 'prime-agent', {
          materializeDefaultHome: false
        })
      ).toBeNull()
      expect(existsSync(join(homeDir, '.prime'))).toBe(false)
    })
  })

  it('does not override a missing preexisting Pi agent dir', () => {
    manager.setSources({ piExtensionSource: '// pi extension' })

    expect(manager.materializePi('tab-missing-pi:0', join(homeDir, 'missing-pi'))).toBeNull()
  })

  it('clearOverlay does not delete real Pi/OMP agent homes', () => {
    manager.setSources({
      piExtensionSource: 'pi',
      ompExtensionSource: 'omp'
    })
    const piDir = manager.materializePi('tab-3:0', undefined, 'pi')!.sourceAgentDir!
    const ompDir = manager.materializePi('tab-3:0', undefined, 'omp')!.sourceAgentDir!
    expect(piDir).not.toBe(ompDir)
    expect(existsSync(piDir)).toBe(true)
    expect(existsSync(ompDir)).toBe(true)

    manager.clearOverlay('tab-3:0')

    expect(existsSync(piDir)).toBe(true)
    expect(existsSync(ompDir)).toBe(true)
  })
})

describe('sweepRetiredOpenCodeOverlays', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'plugin-overlay-sweep-'))
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('removes a leftover opencode-overlays dir and leaves a sentinel outside it', () => {
    const leftoverDir = join(homeDir, '.kolux-relay', 'opencode-overlays', 'deadbeef')
    mkdirSync(leftoverDir, { recursive: true })
    writeFileSync(join(leftoverDir, 'kolux-opencode-status.js'), 'stale')
    const sentinelDir = join(homeDir, '.kolux-relay', 'pi-overlays')
    mkdirSync(sentinelDir, { recursive: true })
    const sentinel = join(sentinelDir, 'sentinel.txt')
    writeFileSync(sentinel, 'keep')

    sweepRetiredOpenCodeOverlays({ homeDir })

    expect(existsSync(join(homeDir, '.kolux-relay', 'opencode-overlays'))).toBe(false)
    expect(existsSync(sentinel)).toBe(true)
  })

  it('is a no-op when no relay ever left an overlay behind', () => {
    expect(() => sweepRetiredOpenCodeOverlays({ homeDir })).not.toThrow()
  })
})

describe('resolvePiSourceAgentDir', () => {
  it('uses only the selected kind source shadow when resolving inherited overlays', () => {
    const env = {
      HOME: mkdtempSync(join(tmpdir(), 'plugin-overlay-env-')),
      PI_CODING_AGENT_DIR: '/tmp/parent-kolux-pi-overlay',
      KOLUX_PI_CODING_AGENT_DIR: '/tmp/parent-kolux-pi-overlay',
      KOLUX_PI_SOURCE_AGENT_DIR: '/user/.pi/agent'
    }
    try {
      expect(resolvePiSourceAgentDir(env, undefined, 'pi')).toBe('/user/.pi/agent')
      expect(resolvePiSourceAgentDir(env, undefined, 'omp')).toBeUndefined()
    } finally {
      rmSync(env.HOME, { recursive: true, force: true })
    }
  })

  it('keeps explicit PI_CODING_AGENT_DIR values when they are not Kolux overlays', () => {
    const env = {
      HOME: mkdtempSync(join(tmpdir(), 'plugin-overlay-env-')),
      PI_CODING_AGENT_DIR: '/user/custom-omp-agent',
      KOLUX_PI_SOURCE_AGENT_DIR: '/user/.pi/agent'
    }
    try {
      expect(resolvePiSourceAgentDir(env, undefined, 'omp')).toBe('/user/custom-omp-agent')
    } finally {
      rmSync(env.HOME, { recursive: true, force: true })
    }
  })
})
