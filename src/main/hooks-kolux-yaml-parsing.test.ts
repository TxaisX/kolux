import { describe, expect, it, vi } from 'vitest'
import { parseKoluxYaml } from './hooks'

// Mock fs used by loadHooks
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  chmodSync: vi.fn()
}))

describe('parseKoluxYaml', () => {
  it('parses YAML with setup script only', () => {
    const yaml = `scripts:\n  setup: |\n    echo "setting up"\n    npm install\n`
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {
        setup: 'echo "setting up"\nnpm install'
      }
    })
  })

  it('parses a project requirement to finish setup before agent startup', () => {
    const yaml = [
      'setupAgentStartupPolicy: wait-for-setup',
      'scripts:',
      '  setup: node install-project-skills.mjs'
    ].join('\n')

    expect(parseKoluxYaml(yaml)).toEqual({
      scripts: { setup: 'node install-project-skills.mjs' },
      setupAgentStartupPolicy: 'wait-for-setup'
    })
  })

  it('parses YAML with archive script only', () => {
    const yaml = `scripts:\n  archive: |\n    echo "archiving"\n`
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {
        archive: 'echo "archiving"'
      }
    })
  })

  it('parses YAML with both setup and archive', () => {
    const yaml = [
      'scripts:',
      '  setup: |',
      '    echo "setup"',
      '    npm install',
      '  archive: |',
      '    echo "archive"',
      '    rm -rf node_modules'
    ].join('\n')
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {
        setup: 'echo "setup"\nnpm install',
        archive: 'echo "archive"\nrm -rf node_modules'
      }
    })
  })

  it('returns null when there is no scripts block', () => {
    const yaml = `other:\n  key: value\n`
    expect(parseKoluxYaml(yaml)).toBeNull()
  })

  it('parses YAML with inline scalar scripts', () => {
    const yaml = `scripts:\n  setup: npm install\n  archive: sleep 5\n`
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {
        setup: 'npm install',
        archive: 'sleep 5'
      }
    })
  })

  it('returns null when scripts block has no setup or archive', () => {
    const yaml = `scripts:\n  unknown: |\n    echo "nope"\n`
    expect(parseKoluxYaml(yaml)).toBeNull()
  })

  it('handles multiline block scalar scripts', () => {
    const yaml = ['scripts:', '  setup: |', '    line1', '    line2', '    line3'].join('\n')
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {
        setup: 'line1\nline2\nline3'
      }
    })
  })

  it('stops parsing when it hits another top-level key', () => {
    const yaml = ['scripts:', '  setup: |', '    echo "setup"', 'other:', '  key: value'].join('\n')
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {
        setup: 'echo "setup"'
      }
    })
  })

  it('returns null for empty string', () => {
    expect(parseKoluxYaml('')).toBeNull()
  })

  it('parses a top-level issueCommand block scalar', () => {
    const yaml = [
      'issueCommand: |',
      '  claude -p "Read issue #{{issue}}"',
      '  codex exec "Review docs/design-{{issue}}.md"'
    ].join('\n')
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {},
      issueCommand:
        'claude -p "Read issue #{{issue}}"\ncodex exec "Review docs/design-{{issue}}.md"'
    })
  })

  it('parses issueCommand alongside scripts', () => {
    const yaml = [
      'scripts:',
      '  setup: |',
      '    pnpm install',
      'issueCommand: |',
      '  claude -p "Read issue #{{issue}}"'
    ].join('\n')
    const result = parseKoluxYaml(yaml)
    expect(result).toEqual({
      scripts: {
        setup: 'pnpm install'
      },
      issueCommand: 'claude -p "Read issue #{{issue}}"'
    })
  })

  it('parses default terminal tabs from kolux.yaml', () => {
    const yaml = [
      'defaultTabs:',
      '  - title: Claude',
      '    color: "#f97316"',
      '    command: claude',
      '  - title: LocalHost',
      '    color: "#9ca3af"',
      '    command: pnpm dev',
      '  - title: Notes'
    ].join('\n')

    expect(parseKoluxYaml(yaml)).toEqual({
      scripts: {},
      defaultTabs: [
        { title: 'Claude', color: '#f97316', command: 'claude' },
        { title: 'LocalHost', color: '#9ca3af', command: 'pnpm dev' },
        { title: 'Notes' }
      ]
    })
  })

  it('drops invalid default tab entries and unsafe color values', () => {
    const yaml = [
      'defaultTabs:',
      '  - title: Server',
      '    color: "red"',
      '    command: pnpm dev',
      '  - 42',
      '  - title: ""'
    ].join('\n')

    expect(parseKoluxYaml(yaml)).toEqual({
      scripts: {},
      defaultTabs: [{ title: 'Server', command: 'pnpm dev' }]
    })
  })

  it('parses environmentRecipes from kolux.yaml', () => {
    const yaml = [
      'environmentRecipes:',
      '  - id: cloud-sandbox',
      '    name: Cloud Sandbox',
      '    checkoutMode: provisioned-root',
      '    description: Starts a per-workspace VM.',
      '    create: ./scripts/kolux-vm/start-cloud-sandbox.sh',
      '    suspend: ./scripts/kolux-vm/suspend-cloud-sandbox.sh',
      '    resume: ./scripts/kolux-vm/resume-cloud-sandbox.sh',
      '    destroy: ./scripts/kolux-vm/destroy-cloud-sandbox.sh'
    ].join('\n')

    expect(parseKoluxYaml(yaml)).toEqual({
      scripts: {},
      environmentRecipes: [
        {
          id: 'cloud-sandbox',
          name: 'Cloud Sandbox',
          checkoutMode: 'provisioned-root',
          description: 'Starts a per-workspace VM.',
          create: './scripts/kolux-vm/start-cloud-sandbox.sh',
          suspend: './scripts/kolux-vm/suspend-cloud-sandbox.sh',
          resume: './scripts/kolux-vm/resume-cloud-sandbox.sh',
          destroy: './scripts/kolux-vm/destroy-cloud-sandbox.sh'
        }
      ]
    })
  })

  it('rejects environment recipes with an unknown checkout mode', () => {
    const yaml = [
      'environmentRecipes:',
      '  - id: cloud-sandbox',
      '    name: Cloud Sandbox',
      '    checkoutMode: magic',
      '    create: ./scripts/create.sh'
    ].join('\n')

    expect(parseKoluxYaml(yaml)).toEqual({
      scripts: {},
      environmentRecipeDiagnostics: [
        {
          index: 0,
          field: 'checkoutMode',
          message:
            'Recipe "cloud-sandbox" checkoutMode must be "kolux-worktree" or "provisioned-root".'
        }
      ]
    })
  })

  it('parses legacy environmentRecipes command and cleanup aliases', () => {
    const yaml = [
      'environmentRecipes:',
      '  - id: manual-sandbox',
      '    name: Manual Sandbox',
      '    command: ./scripts/kolux-vm/start-manual-sandbox.sh',
      '    cleanup: none'
    ].join('\n')

    expect(parseKoluxYaml(yaml)).toEqual({
      scripts: {},
      environmentRecipes: [
        {
          id: 'manual-sandbox',
          name: 'Manual Sandbox',
          create: './scripts/kolux-vm/start-manual-sandbox.sh',
          destroyDisabled: true
        }
      ]
    })
  })

  it('drops invalid and duplicate environmentRecipes', () => {
    const yaml = [
      'environmentRecipes:',
      '  - id: cloud-sandbox',
      '    name: Cloud Sandbox',
      '    create: ./scripts/kolux-vm/start-cloud-sandbox.sh',
      '  - id: cloud-sandbox',
      '    name: Duplicate Cloud Sandbox',
      '    create: ./scripts/kolux-vm/start-duplicate.sh',
      '  - id: missing-create',
      '    name: Missing Create',
      '  - name: Missing Id',
      '    create: ./scripts/kolux-vm/start-missing-id.sh',
      '  - id: "Cloud Sandbox"',
      '    name: Unsafe Id',
      '    create: ./scripts/kolux-vm/start-unsafe-id.sh',
      '  - 42'
    ].join('\n')

    expect(parseKoluxYaml(yaml)).toEqual({
      scripts: {},
      environmentRecipes: [
        {
          id: 'cloud-sandbox',
          name: 'Cloud Sandbox',
          create: './scripts/kolux-vm/start-cloud-sandbox.sh'
        }
      ],
      environmentRecipeDiagnostics: [
        {
          index: 1,
          field: 'id',
          message: 'Duplicate recipe id "cloud-sandbox". Recipe ids must be unique.'
        },
        { index: 2, field: 'create', message: 'Recipe "missing-create" is missing create.' },
        { index: 3, field: 'id', message: 'Recipe id is required.' },
        {
          index: 4,
          field: 'id',
          message:
            'Invalid recipe id "Cloud Sandbox". Use 1-64 lowercase letters, numbers, dots, underscores, or hyphens, starting with a letter or number.'
        },
        { index: 5, message: 'Recipe entry must be a mapping.' }
      ]
    })
  })

  it('parses worktree.sharedDirectories from kolux.yaml', () => {
    const result = parseKoluxYaml(
      ['worktree:', '  sharedDirectories:', '    - node_modules', '    - .cache'].join('\n')
    )

    expect(result?.worktree?.sharedDirectories).toEqual(['node_modules', '.cache'])
  })

  it('normalizes and dedupes sharedDirectories entries', () => {
    const result = parseKoluxYaml(
      [
        'worktree:',
        '  sharedDirectories:',
        '    - node_modules/',
        '    - ./node_modules',
        '    - "  .cache  "'
      ].join('\n')
    )

    expect(result?.worktree?.sharedDirectories).toEqual(['node_modules', '.cache'])
  })

  it('drops unsafe sharedDirectories entries', () => {
    const result = parseKoluxYaml(
      [
        'worktree:',
        '  sharedDirectories:',
        '    - ../escape',
        '    - /etc',
        '    - .git',
        '    - .git/hooks',
        '    - cache/.git/hooks',
        '    - node_modules'
      ].join('\n')
    )

    expect(result?.worktree?.sharedDirectories).toEqual(['node_modules'])
  })

  // Why: `resolve()` collapses `.` when the link is created, but Git reports the
  // collapsed path — keeping the raw entry would leave a link that every later
  // comparison misses, which is the permanently-dirty worktree this feature fixes.
  it('drops sharedDirectories entries that still need path collapsing', () => {
    const result = parseKoluxYaml(
      [
        'worktree:',
        '  sharedDirectories:',
        '    - apps/./web/node_modules',
        '    - apps//web/.cache',
        '    - node_modules'
      ].join('\n')
    )

    expect(result?.worktree?.sharedDirectories).toEqual(['node_modules'])
  })

  it('returns null when sharedDirectories is the only key and holds nothing usable', () => {
    expect(parseKoluxYaml('worktree:\n  sharedDirectories: []\n')).toBeNull()
    expect(parseKoluxYaml('worktree:\n  sharedDirectories: node_modules\n')).toBeNull()
  })

  it('keeps sharedDirectories alongside other kolux.yaml keys', () => {
    const result = parseKoluxYaml(
      [
        'scripts:',
        '  setup: pnpm install',
        'worktree:',
        '  sharedDirectories:',
        '    - .cache'
      ].join('\n')
    )

    expect(result?.scripts.setup).toBe('pnpm install')
    expect(result?.worktree?.sharedDirectories).toEqual(['.cache'])
  })
})

describe('hasUnrecognizedKoluxYamlKeys', () => {
  it('returns true when the file contains only keys this version does not handle', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.readFileSync).mockReturnValue('futureFeature: |\n  some config\n')

    const { hasUnrecognizedKoluxYamlKeys } = await import('./hooks')
    expect(hasUnrecognizedKoluxYamlKeys('/test/repo')).toBe(true)
  })

  it('returns true when an unknown key has no trailing space (block-value form)', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.readFileSync).mockReturnValue('futureFeature:\n  nested: value\n')

    const { hasUnrecognizedKoluxYamlKeys } = await import('./hooks')
    expect(hasUnrecognizedKoluxYamlKeys('/test/repo')).toBe(true)
  })

  it('returns true when the file mixes recognised and unrecognised keys', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.readFileSync).mockReturnValue(
      'scripts:\n  setup: |\n    pnpm install\nnewFeature: enabled\n'
    )

    const { hasUnrecognizedKoluxYamlKeys } = await import('./hooks')
    expect(hasUnrecognizedKoluxYamlKeys('/test/repo')).toBe(true)
  })

  it('returns false when the file contains only recognised keys', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.readFileSync).mockReturnValue(
      [
        'scripts:',
        '  setup: |',
        '    pnpm install',
        'issueCommand: |',
        '  claude -p "test"',
        'defaultTabs:',
        '  - title: Claude',
        'environmentRecipes:',
        '  - id: cloud-sandbox',
        '    name: Cloud Sandbox',
        '    create: ./scripts/kolux-vm/start-cloud-sandbox.sh',
        'worktree:',
        '  sharedDirectories:',
        '    - node_modules'
      ].join('\n')
    )

    const { hasUnrecognizedKoluxYamlKeys } = await import('./hooks')
    expect(hasUnrecognizedKoluxYamlKeys('/test/repo')).toBe(false)
  })

  it('returns false when the file is empty or has no top-level keys', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.readFileSync).mockReturnValue('# just a comment\n')

    const { hasUnrecognizedKoluxYamlKeys } = await import('./hooks')
    expect(hasUnrecognizedKoluxYamlKeys('/test/repo')).toBe(false)
  })

  it('returns false when the file cannot be read', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const { hasUnrecognizedKoluxYamlKeys } = await import('./hooks')
    expect(hasUnrecognizedKoluxYamlKeys('/test/repo')).toBe(false)
  })
})
