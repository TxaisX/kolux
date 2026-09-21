import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const readProject = (file) => readFileSync(join(projectDir, file), 'utf8')
const packageJson = JSON.parse(readProject('package.json'))

describe('Electron runtime package contract: release workflows', () => {
  it('pins the Windows release builder to the VS 2022 runner image', () => {
    const releaseWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/release-cut.yml'), 'utf8')
    )
    const windowsReleaseEntry = releaseWorkflow.jobs.build.strategy.matrix.include.find(
      ({ platform }) => platform === 'win'
    )

    expect(windowsReleaseEntry.os).toBe('windows-2022')
  })

  it('keeps release-cut signing provenance on GitHub-hosted runners', () => {
    const releaseWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/release-cut.yml'), 'utf8')
    )
    const buildMatrixRunners = releaseWorkflow.jobs.build.strategy.matrix.include.map(
      ({ os }) => os
    )
    const releaseWorkflowText = readFileSync(
      join(projectDir, '.github/workflows/release-cut.yml'),
      'utf8'
    )
    const macDispatchStep = releaseWorkflow.jobs['build-mac'].steps.find(
      (step) => step.name === 'Run isolated macOS release build'
    )

    expect(releaseWorkflowText).not.toContain('blacksmith-')
    expect(releaseWorkflow.jobs['build-mac']['runs-on']).toBe('ubuntu-latest')
    expect(releaseWorkflow.jobs['build-mac'].permissions.actions).toBe('write')
    expect(macDispatchStep.run).toBe('node config/scripts/run-release-mac-build-workflow.mjs')
    expect(macDispatchStep.env.RELEASE_MAC_BUILD_WORKFLOW).toBe('release-mac-build.yml')
    expect(macDispatchStep.env.RELEASE_MAC_BUILD_TAG).toBe('${{ needs.cut.outputs.tag }}')
    expect(buildMatrixRunners).not.toContain('blacksmith-6vcpu-macos-15')
    expect(releaseWorkflow.jobs['publish-release'].needs).toContain('build')
    expect(releaseWorkflow.jobs['publish-release'].needs).toContain('build-mac')
  })

  it('runs the macOS release build in an isolated Blacksmith workflow', () => {
    const releaseMacWorkflowText = readFileSync(
      join(projectDir, '.github/workflows/release-mac-build.yml'),
      'utf8'
    )
    const releaseMacWorkflow = parse(releaseMacWorkflowText)
    const buildMacJob = releaseMacWorkflow.jobs['build-mac']
    const checkoutStep = buildMacJob.steps.find((step) => step.name === 'Checkout')
    const publishStep = buildMacJob.steps.find(
      (step) => step.name === 'Publish release artifacts (macOS)'
    )

    expect(releaseMacWorkflow['run-name']).toBe(
      'Mac release build ${{ inputs.tag }} (${{ inputs.release_run_id }})'
    )
    expect(releaseMacWorkflow.on.workflow_dispatch.inputs.tag.required).toBe(true)
    expect(releaseMacWorkflow.on.workflow_dispatch.inputs.release_run_id.required).toBe(true)
    expect(buildMacJob['runs-on']).toBe('blacksmith-6vcpu-macos-15')
    expect(checkoutStep.with.ref).toBe('refs/tags/${{ inputs.tag }}')
    expect(publishStep.with.command).toContain('KOLUX_MAC_RELEASE=1')
    expect(publishStep.with.command).toContain('electron-builder')
    expect(publishStep.with.command).toContain('--mac --publish always')
    expect(releaseMacWorkflowText).not.toContain('signpath/')
    expect(releaseMacWorkflowText).not.toContain('SIGNPATH_')
  })

  it('publishes both Linux release matrix entries', () => {
    const releaseWorkflow = readFileSync(
      join(projectDir, '.github/workflows/release-cut.yml'),
      'utf8'
    )
    const parsedWorkflow = parse(releaseWorkflow)
    const publishLinuxStep = parsedWorkflow.jobs.build.steps.find(
      (step) => step.name === 'Publish release artifacts (Linux)'
    )

    expect(publishLinuxStep.if).toContain("matrix.platform == 'linux-x64'")
    expect(publishLinuxStep.if).toContain("matrix.platform == 'linux-arm64'")
    expect(publishLinuxStep.with.command).toBe('${{ matrix.release_command }}')
  })

  it('keeps Linux postinstall repairing Chromium sandbox permissions', () => {
    const afterInstallScript = readFileSync(
      join(projectDir, 'resources/linux/packaging/after-install.sh'),
      'utf8'
    )

    expect(afterInstallScript).toContain('chrome-sandbox')
    expect(afterInstallScript).toContain('chmod 4755 "$sandbox"')
    expect(afterInstallScript).not.toContain('chmod 0755 "$sandbox"')
    expect(afterInstallScript).toContain('is_owned_link()')
    expect(afterInstallScript).toContain('readlink -f -- "$link"')
    expect(afterInstallScript).toContain('[ ! -e "$link" ] && [ ! -L "$link" ]')
    expect(afterInstallScript).not.toContain('[ ! -e "$link" ] || [ -L "$link" ]')
  })

  it('advances only the skill release ledger in a taggable release-cut commit', () => {
    const releaseWorkflow = readFileSync(
      join(projectDir, '.github/workflows/release-cut.yml'),
      'utf8'
    )
    const parsedWorkflow = parse(releaseWorkflow)
    const checkoutStep = parsedWorkflow.jobs.cut.steps.find((step) => step.name === 'Checkout ref')
    const bumpStep = parsedWorkflow.jobs.cut.steps.find(
      (step) => step.name === 'Bump package.json and tag'
    )

    const bumpIndex = bumpStep.run.indexOf(
      'npm version "$VERSION" --no-git-tag-version --allow-same-version'
    )
    const generateIndex = bumpStep.run.indexOf(
      'node config/scripts/generate-skill-bundle-manifest.mjs --release "$VERSION"'
    )
    const commands = bumpStep.run.replace(/^\s*#.*$/gm, '')
    // Unanchored: a `git add` chained after `&&` stages just as effectively.
    const stagedPaths = [...commands.matchAll(/\bgit add (.+)$/gm)].flatMap((match) =>
      match[1].trim().split(/\s+/)
    )
    // Quotes trimmed and deduped: the index guard names the row a second time.
    const mentioned = new Set(commands.match(/resources[/\\]skills[^\s'"]*/g))
    expect(checkoutStep.with['fetch-depth']).toBe(0)
    expect(bumpIndex).toBeGreaterThanOrEqual(0)
    // Why: the cut is the only point that advances the release ledger, so this
    // tag's revision is never rebuilt later — it appends that row, nothing else.
    expect(generateIndex).toBeGreaterThan(bumpIndex)
    expect(bumpStep.run.indexOf('git add package.json')).toBeGreaterThan(generateIndex)
    expect(stagedPaths).toEqual(['package.json', 'resources/skills/release-mapping.json'])
    // Every distinct mention must be staged, so a copy, a redirect, or a path
    // held in a variable cannot reach the content-addressed artifacts. Matched
    // without a trailing slash so `dir="resources/skills"` still counts.
    expect([...mentioned]).toEqual(stagedPaths.slice(1))
    // Regeneration is banned job-wide by the generator suite. Here: `-a`, `-am`,
    // and `--all` sweep unstaged artifacts in; `--allow-empty` below must not.
    expect(commands).not.toMatch(/\bcommit\b[^\n]*(?:\s-[a-z]*a[a-z]*\b|\s--all\b)/)
    expect(bumpStep.run).toContain('git diff --cached --quiet')
    expect(bumpStep.run).toContain('git commit --allow-empty -m "$commit_message"')
  })

  it('keeps release-cut RC retries monotonic across stale attempts', () => {
    const releaseWorkflow = readFileSync(
      join(projectDir, '.github/workflows/release-cut.yml'),
      'utf8'
    )
    const parsedWorkflow = parse(releaseWorkflow)
    const versionStep = parsedWorkflow.jobs.cut.steps.find(
      (step) => step.name === 'Compute next version'
    )

    expect(versionStep.run).toContain('node config/scripts/release-rc-history.mjs "$1"')
    expect(versionStep.run).toContain('tag_matches_current_ref')
    expect(versionStep.run).toContain('cutting the next version instead of reusing stale artifacts')
    expect(versionStep.run).toContain('git rev-parse "$existing_rc_tag"')
  })

  it('bumps separate Homebrew casks for stable and RC desktop tags', () => {
    const releaseWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/release-cut.yml'), 'utf8')
    )
    const homebrewWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/homebrew-bump.yml'), 'utf8')
    )

    expect(releaseWorkflow.jobs['homebrew-bump'].if).toContain(
      "startsWith(needs.cut.outputs.tag, 'v')"
    )
    expect(releaseWorkflow.jobs['homebrew-bump'].if).not.toContain('-rc.')
    expect(releaseWorkflow.jobs['homebrew-bump-published-rc-draft'].with.tag).toBe(
      '${{ needs.cut.outputs.latest_published_rc_tag }}'
    )

    const resolveCaskStep = homebrewWorkflow.jobs['bump-cask'].steps.find(
      (step) => step.name === 'Resolve cask target'
    )
    const renderStep = homebrewWorkflow.jobs['bump-cask'].steps.find(
      (step) => step.name === 'Render updated cask file'
    )
    const copyStep = homebrewWorkflow.jobs['bump-cask'].steps.find(
      (step) => step.name === 'Copy cask into tap and open PR'
    )

    expect(resolveCaskStep.run).toContain('token="kolux@rc"')
    expect(resolveCaskStep.run).toContain('token="kolux"')
    expect(renderStep.env.CASK_PATH).toBe('${{ steps.cask.outputs.path }}')
    expect(copyStep.run).toContain('cp "$CASK_PATH" "tap/$CASK_PATH"')
    expect(copyStep.run).toContain('git add "$CASK_PATH"')
  })

  it('installs the Electron package binary in the shared unit-test workflow', () => {
    const unitTestWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/unit-tests.yml'), 'utf8')
    )
    const installStep = unitTestWorkflow.jobs.test.steps.find(
      (step) => step.name === 'Install Electron package binary for tests'
    )

    expect(installStep.run).toBe('node config/scripts/install-electron-package-binary.mjs')
  })

  it('smokes the packaged CLI from outside the checkout in PR checks', () => {
    const prWorkflow = readFileSync(join(projectDir, '.github/workflows/pr.yml'), 'utf8')
    const parsedWorkflow = parse(prWorkflow)
    const smokeStep = parsedWorkflow.jobs.package.steps.find(
      (step) => step.name === 'Smoke packaged CLI'
    )

    expect(smokeStep.run).toBe(
      'node config/scripts/smoke-packaged-cli.mjs --app-dir=dist/linux-unpacked'
    )
  })

  it('keeps terminal scale perf wired to the report budget gate', () => {
    const packageScripts = packageJson.scripts
    const terminalPerfWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/terminal-perf.yml'), 'utf8')
    )
    const steps = terminalPerfWorkflow.jobs['terminal-perf'].steps
    const runStep = steps.find((step) => step.name === 'Run terminal scale perf report gate')
    const uploadStep = steps.find((step) => step.name === 'Upload terminal perf report')

    expect(packageScripts['test:e2e:terminal-perf:scale:report']).toContain(
      'run-terminal-scale-perf-report-gate.mjs'
    )
    expect(runStep.run).toContain('pnpm run test:e2e:terminal-perf:scale:report')
    expect(runStep.run).toContain('xvfb-run --auto-servernum')
    const manualProfileKnobs = [
      ['KOLUX_TERMINAL_PERF_FRAME_COUNT', 'frame_count', 'KOLUX_E2E_OPENCODE_FRAME_COUNT'],
      [
        'KOLUX_TERMINAL_PERF_FRAME_INTERVAL_MS',
        'frame_interval_ms',
        'KOLUX_E2E_OPENCODE_FRAME_INTERVAL_MS'
      ],
      [
        'KOLUX_TERMINAL_PERF_PRESSURE_OUTPUT_CHARS',
        'pressure_output_chars',
        'KOLUX_E2E_OPENCODE_PRESSURE_OUTPUT_CHARS'
      ],
      ['KOLUX_TERMINAL_PERF_SCALE_PANES', 'scale_panes', 'KOLUX_E2E_OPENCODE_SCALE_PANES'],
      [
        'KOLUX_TERMINAL_PERF_SCALE_CROSS_WORKSPACE_PANES',
        'scale_cross_workspace_panes',
        'KOLUX_E2E_OPENCODE_SCALE_CROSS_WORKSPACE_PANES'
      ],
      [
        'KOLUX_TERMINAL_PERF_SCALE_PRESSURE_PANES',
        'scale_pressure_panes',
        'KOLUX_E2E_OPENCODE_SCALE_PRESSURE_PANES'
      ],
      [
        'KOLUX_TERMINAL_PERF_SCALE_HIDDEN_PRESSURE_PANES',
        'scale_hidden_pressure_panes',
        'KOLUX_E2E_OPENCODE_SCALE_HIDDEN_PRESSURE_PANES'
      ]
    ]
    for (const [workflowEnv, inputName, runnerEnv] of manualProfileKnobs) {
      expect(runStep.env[workflowEnv]).toBe(`\${{ inputs.${inputName} }}`)
      expect(runStep.run).toContain(runnerEnv)
    }
    expect(uploadStep.uses).toBe('actions/upload-artifact@v7')
    expect(uploadStep.with.path).toBe('${{ env.KOLUX_E2E_TERMINAL_PERF_REPORT_PATH }}')
  })

  it('keeps platform golden regressions in the manual and release workflows', () => {
    const packageScripts = packageJson.scripts
    const goldenWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/golden-e2e-experiment.yml'), 'utf8')
    )
    const releaseWorkflow = parse(
      readFileSync(join(projectDir, '.github/workflows/release-cut.yml'), 'utf8')
    )
    const steps = goldenWorkflow.jobs['golden-e2e'].steps
    const goldenPlatformLabels = new Map([
      ['linux', 'Linux'],
      ['mac', 'macOS'],
      ['windows', 'Windows']
    ])
    const goldenMatrix = goldenWorkflow.jobs['golden-e2e'].strategy.matrix.include
    const goldenPlatforms = goldenMatrix.map(({ platform }) => platform).sort()
    const goldenRunSteps = new Map(
      goldenPlatforms.map((platform) => {
        const label = goldenPlatformLabels.get(platform)

        expect(label, platform).toBeDefined()

        return [platform, steps.find((step) => step.name === `Run golden E2E tests on ${label}`)]
      })
    )
    const releaseGoldenJob = releaseWorkflow.jobs['terminal-rendering-golden']
    const releaseGoldenMatrix = releaseGoldenJob.strategy.matrix.include
    const releaseEvidenceJob = releaseWorkflow.jobs['terminal-rendering-release-evidence']
    const releaseBuildNeeds = releaseWorkflow.jobs.build.needs
    const publishReleaseNeeds = releaseWorkflow.jobs['publish-release'].needs
    // Why: Windows release evidence is temporarily paused for CI runner PTY readiness.
    const releaseEvidencePlatforms = ['linux', 'mac']

    expect(packageScripts['test:e2e:terminal-rendering-golden']).toContain(
      '@terminal-rendering-golden'
    )
    expect(packageScripts['test:e2e:terminal-rendering-golden']).toContain(
      'terminal-raw-emoji-table-scroll-restore.spec.ts'
    )
    expect(packageScripts['test:e2e:terminal-rendering-golden']).toContain(
      'terminal-webgl-atlas-budget.spec.ts'
    )
    expect(packageScripts['test:e2e:terminal-rendering-golden']).not.toContain(
      'terminal-long-table-scroll-restore.spec.ts'
    )
    const goldenCommand = packageScripts['test:e2e:terminal-rendering-golden']
    expect(goldenCommand).toContain('--project electron-headless')
    expect(goldenCommand).toContain('--project electron-headful')
    expect(packageScripts['test:e2e:windows-fresh-startup-golden']).toContain(
      'golden-windows-fresh-startup.spec.ts'
    )
    expect(packageScripts['test:e2e:windows-fresh-startup-golden']).toContain(
      '@windows-fresh-startup-golden'
    )
    expect(packageScripts['test:e2e:posix-profile-index-golden']).toContain(
      'golden-posix-profile-index-fsync.spec.ts'
    )
    expect(packageScripts['test:e2e:posix-profile-index-golden']).toContain(
      'golden-posix-fresh-startup.spec.ts'
    )
    expect(packageScripts['test:e2e:posix-profile-index-golden']).toContain(
      '@posix-profile-index-golden'
    )
    expect(packageScripts['test:e2e:terminal-rendering-release-evidence']).toContain(
      'terminal-opencode-emoji-table-rendering.spec.ts'
    )
    expect(packageScripts['test:e2e:terminal-rendering-release-evidence']).toContain(
      'terminal-long-table-scroll-restore.spec.ts'
    )
    expect(goldenMatrix).toEqual([
      { os: 'ubuntu-latest', platform: 'linux' },
      { os: 'macos-15', platform: 'mac' },
      { os: 'windows-2022', platform: 'windows' }
    ])
    expect(goldenRunSteps.get('linux')?.run).toContain(
      'pnpm run test:e2e:terminal-rendering-golden'
    )
    expect(goldenRunSteps.get('linux')?.run).toContain(
      'pnpm run --if-present test:e2e:posix-profile-index-golden'
    )
    expect(goldenRunSteps.get('mac')?.run).toContain('pnpm run test:e2e:terminal-rendering-golden')
    expect(goldenRunSteps.get('mac')?.run).toContain(
      'pnpm run --if-present test:e2e:posix-profile-index-golden'
    )
    expect(goldenRunSteps.get('windows')).toMatchObject({
      if: "runner.os == 'Windows'",
      shell: 'pwsh'
    })
    expect(goldenRunSteps.get('windows').run).toContain(
      'pnpm run --if-present test:e2e:windows-fresh-startup-golden'
    )
    expect(goldenWorkflow.on.pull_request).toBeUndefined()
    expect(goldenWorkflow.on.workflow_dispatch).toBeDefined()
    expect(releaseBuildNeeds).not.toContain('terminal-rendering-golden')
    expect(releaseBuildNeeds).not.toContain('terminal-rendering-release-evidence')
    expect(publishReleaseNeeds).toContain('terminal-rendering-golden')
    expect(publishReleaseNeeds).toContain('build')
    expect(publishReleaseNeeds).not.toContain('terminal-rendering-release-evidence')
    expect(releaseGoldenJob['continue-on-error']).toBeUndefined()
    expect(releaseGoldenMatrix).toEqual(goldenMatrix)
    const releaseLinuxRunStep = releaseGoldenJob.steps.find(
      (step) => step.name === 'Run terminal rendering golden on Linux'
    )
    expect(releaseLinuxRunStep.run).toContain('pnpm run test:e2e:terminal-rendering-golden')
    expect(releaseLinuxRunStep.run).toContain(
      'pnpm run --if-present test:e2e:posix-profile-index-golden'
    )
    const releaseMacRunStep = releaseGoldenJob.steps.find(
      (step) => step.name === 'Run terminal rendering golden on macOS'
    )
    expect(releaseMacRunStep.run).toContain('pnpm run test:e2e:terminal-rendering-golden')
    expect(releaseMacRunStep.run).toContain(
      'pnpm run --if-present test:e2e:posix-profile-index-golden'
    )
    const releaseWindowsRunStep = releaseGoldenJob.steps.find(
      (step) => step.name === 'Run fresh-startup golden on Windows'
    )
    expect(releaseWindowsRunStep).toMatchObject({
      if: "runner.os == 'Windows'",
      shell: 'pwsh'
    })
    expect(releaseWindowsRunStep.run).toContain(
      'pnpm run --if-present test:e2e:windows-fresh-startup-golden'
    )
    expect(releaseWindowsRunStep.run).not.toContain('test:e2e:workspace-session-golden')
    expect(releaseWindowsRunStep.run).not.toContain('test:e2e:source-control-golden')
    expect(releaseEvidenceJob['continue-on-error']).toBe(true)
    expect(
      releaseEvidenceJob.strategy.matrix.include.map(({ platform }) => platform).sort()
    ).toEqual(releaseEvidencePlatforms)
    expect(releaseEvidenceJob.steps.map((step) => step.run ?? '')).toContain(
      'xvfb-run --auto-servernum env SKIP_BUILD=1 KOLUX_E2E_FORWARD_APP_LOGS=1 pnpm run test:e2e:terminal-rendering-release-evidence'
    )
  })
})
