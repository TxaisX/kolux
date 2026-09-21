// Why: OMP 15.x discovers built-in user extensions from ~/.omp/agent, but a
// typed `omp` in an existing terminal still needs Kolux's status extension
// passed explicitly. Do not redirect PI_CODING_AGENT_DIR here: that variable
// is OMP's mutable home, so config/auth/session commands must keep the user's
// normal source of truth.

const OMP_SUBCOMMANDS = [
  '__complete',
  'acp',
  'agents',
  'auth-broker',
  'auth-gateway',
  'bench',
  'commit',
  'completions',
  'config',
  'dry-balance',
  'gallery',
  'grep',
  'grievances',
  'install',
  'join',
  'models',
  'plugin',
  'read',
  'say',
  'search',
  'setup',
  'shell',
  'ssh',
  'stats',
  'tiny-models',
  'token',
  'ttsr',
  'update',
  'usage',
  'worktree',
  'q',
  'wt'
] as const

export function getPosixOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.join('|')
  return `# Why: OMP does not auto-load Kolux's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
__kolux_omp_should_skip_extension() {
  case "\${1:-}" in
    help|--help|-h|--version|-v) return 0 ;;
    ${subcommands}) return 0 ;;
  esac
  return 1
}
__kolux_omp_cwd_is_usable() {
  local __kolux_physical_cwd
  [[ -x . ]] || return 1
  if [[ -n "\${PWD:-}" && -d "\${PWD:-}" ]]; then
    [[ "\${PWD}" -ef . ]]
  else
    # Why compare the path: shell builtins can print a cached path for a deleted cwd.
    __kolux_physical_cwd="$(builtin pwd -P 2>/dev/null)" || return 1
    [[ -d "$__kolux_physical_cwd" && "$__kolux_physical_cwd" -ef . ]]
  fi
}
__kolux_omp_invoke() {
  local __kolux_use_extension="$1"
  shift
  if [[ $__kolux_use_extension -eq 1 && -n "\${KOLUX_OMP_STATUS_EXTENSION:-}" && -f "\${KOLUX_OMP_STATUS_EXTENSION}" ]]; then
    if [[ "\${1:-}" == "launch" ]]; then
      shift
      command omp launch --extension "\${KOLUX_OMP_STATUS_EXTENSION}" "$@"
    else
      command omp --extension "\${KOLUX_OMP_STATUS_EXTENSION}" "$@"
    fi
  else
    command omp "$@"
  fi
}
__kolux_omp() {
  local __kolux_use_extension=1
  __kolux_omp_should_skip_extension "\${1:-}" && __kolux_use_extension=0
  if ! __kolux_omp_cwd_is_usable; then
    local __kolux_logical_cwd="\${PWD:-\${KOLUX_WORKTREE_PATH:-\${KOLUX_ROOT_PATH:-}}}"
    # Why: a restored shell can retain the deleted directory inode after its path is recreated.
    (
      if [[ -z "$__kolux_logical_cwd" ]]; then
        printf 'Kolux: OMP cannot start because no terminal working directory is available. Open a new terminal in an existing directory.\\n' >&2
        return 1
      fi
      if ! builtin cd -P -- "$__kolux_logical_cwd" 2>/dev/null; then
        printf 'Kolux: OMP cannot access the terminal working directory "%s". Open a new terminal in an existing directory.\\n' "$__kolux_logical_cwd" >&2
        return 1
      fi
      __kolux_omp_invoke "$__kolux_use_extension" "$@"
    )
  else
    __kolux_omp_invoke "$__kolux_use_extension" "$@"
  fi
}
if [[ -n "\${KOLUX_OMP_STATUS_EXTENSION:-}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name, which
  # an \`alias omp\` otherwise rewrites at parse time, aborting the rest of the file.
  function omp { __kolux_omp "$@"; }
fi
`
}

export function getPowerShellOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join(', ')
  return `# Why: OMP does not auto-load Kolux's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
function Global:__KoluxOmpShouldSkipExtension {
    param([string]$Name)
    $skip = @("help", "--help", "-h", "--version", "-v") + @(${subcommands})
    return $skip -contains $Name
}
if ($env:KOLUX_OMP_STATUS_EXTENSION) {
    function Global:omp {
        $koluxUseExtension = -not (__KoluxOmpShouldSkipExtension -Name ([string]($args[0])))
        $koluxStatus = 0
        $koluxCommand = Get-Command omp -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $koluxCommand) {
            Write-Error "omp executable not found"
            $koluxStatus = 127
        } elseif ($koluxUseExtension -and $env:KOLUX_OMP_STATUS_EXTENSION -and
            (Test-Path -LiteralPath $env:KOLUX_OMP_STATUS_EXTENSION)) {
            if ($args.Count -gt 0 -and $args[0] -eq "launch") {
                $koluxLaunchArgs = @($args | Select-Object -Skip 1)
                & $koluxCommand.Source launch --extension $env:KOLUX_OMP_STATUS_EXTENSION @koluxLaunchArgs
            } else {
                & $koluxCommand.Source --extension $env:KOLUX_OMP_STATUS_EXTENSION @args
            }
            $koluxStatus = $LASTEXITCODE
        } else {
            & $koluxCommand.Source @args
            $koluxStatus = $LASTEXITCODE
        }

        $global:LASTEXITCODE = $koluxStatus
    }
}
`
}
