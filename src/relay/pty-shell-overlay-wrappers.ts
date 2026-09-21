import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getPosixOmpShellWrapper } from '../main/pty/omp-shell-wrapper'
import {
  BASH_FEATURE_CHANNEL_BLOCK,
  BASH_PROMPT_COMMAND_COMPOSITION_BLOCK,
  SHELL_STARTUP_IDENTITY_MARKER_BLOCK,
  BASH_HISTFILE_RESTORE_BLOCK,
  ZSH_WRAPPER_DIR_MARKER_CONTENT,
  ZSH_WRAPPER_DIR_MARKER_FILE
} from '../main/shell-templates'
import { writeShellWrapperFiles } from '../main/shell-wrapper-file-writer'
import { buildZshStartupHook, type ZshStartupHookSpec } from '../main/zsh-startup-wrapper-builder'

/** Writes the zsh/bash overlay wrapper files a relay-spawned shell sources.
 *  Split from pty-shell-launch.ts so the launch-config decisions stay readable
 *  next to each other rather than buried under ~150 lines of shell templates. */

const SHELL_READY_MARKER_ESCAPED = '\\033]777;kolux-shell-ready\\007'

// Why the relay no longer needs its own ZDOTDIR shape: it used to republish the
// inherited value as KOLUX_USER_ZDOTDIR so the later wrapper files could prefer
// it over the spawn-time KOLUX_ORIG_ZDOTDIR. There are no later wrapper files
// now, and ZDOTDIR itself carries the answer, so the relay and desktop bodies
// are one template again.
function getRelayZshWrapperSpec(): ZshStartupHookSpec {
  return {
    headerLabel: 'Kolux relay zsh overlay wrapper',
    readyMarkerEscaped: SHELL_READY_MARKER_ESCAPED,
    osc133CommandMarkers: false,
    startupCommandDelivery: false,
    overlayRestoreComment:
      '# Why: remote startup files can re-export user defaults after relay spawn.',
    restores: {
      agentTeamsPath: false,
      remoteCliBinDir: true,
      codexHome: false,
      codexLaunchPreflight: false
    }
  }
}

/** True when every overlay wrapper file is present and non-empty afterwards. */
export function ensureOverlayRestoreWrappers(root: string): boolean {
  const zshDir = join(root, 'zsh')
  const bashDir = join(root, 'bash')

  const zshenv = buildZshStartupHook(getRelayZshWrapperSpec())
  const bashRc = `# Kolux relay bash overlay wrapper
${BASH_FEATURE_CHANNEL_BLOCK}
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
# Why a plain variable: the channel is consumed and destroyed in these first
# lines, so nothing this shell later spawns can see or inherit the selection.
__kolux_ready_marker=""
__kolux_has_feature ready && __kolux_ready_marker=1
unset _kolux_shell_features
unset -f __kolux_has_feature
[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi
# Why: enable bracketed paste so Kolux can deliver a multiline startup prompt as
# a single literal paste (ESC[200~…ESC[201~); without it, older readline builds
# treat each embedded newline as Enter and mangle the prompt into PS2
# continuation. Modern readline defaults this on; force it for the rest.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
# Why: remote startup files can re-export user defaults after relay spawn.
[[ -n "\${KOLUX_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${KOLUX_OPENCODE_CONFIG_DIR}"
[[ -n "\${KOLUX_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${KOLUX_MIMOCODE_HOME}"
[[ -n "\${KOLUX_REMOTE_CLI_BIN_DIR:-}" ]] && case ":$PATH:" in *:"\${KOLUX_REMOTE_CLI_BIN_DIR}":*) ;; *) export PATH="\${KOLUX_REMOTE_CLI_BIN_DIR}:$PATH" ;; esac
${getPosixOmpShellWrapper()}
${BASH_HISTFILE_RESTORE_BLOCK}
# Why: SSH bash sessions need the same command lifecycle markers as local
# bash so agent rows stop showing "working" when the foreground command exits.
__kolux_initializing_wrapper=1
__kolux_osc133_precmd() {
  local exit_code=$?
  __kolux_in_prompt_command=1
  if [[ -n "\${__kolux_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __kolux_in_command
  fi
  printf "\\033]133;A\\007"
  return "$exit_code"
}
__kolux_osc133_prompt_done() {
  unset __kolux_in_prompt_command; __kolux_adopt_outer_debug_trap
  trap '__kolux_osc133_preexec' DEBUG
}
__kolux_osc133_preexec() {
  if [[ -n "\${__kolux_prompt_status_capture_command:-}" && "$BASH_COMMAND" == "$__kolux_prompt_status_capture_command" ]]; then
    unset __kolux_initial_prompt
    __kolux_in_legacy_prompt_wrapper=1
    return 0
  fi
  if [[ -n "\${__kolux_initializing_wrapper:-}\${__kolux_in_debug_capture:-}\${__kolux_initial_prompt:-}\${__kolux_in_prompt_dispatch:-}\${__kolux_in_legacy_prompt_wrapper:-}\${__kolux_in_prompt_command:-}" ]]; then
    [[ -z "\${__kolux_initializing_wrapper:-}\${__kolux_in_debug_capture:-}" ]] || return 0
    if [[ -n "\${__kolux_initial_prompt:-}" && "$BASH_COMMAND" == "__kolux_osc133_precmd" ]]; then
      unset __kolux_initial_prompt; return 0
    fi
    if [[ -n "\${__kolux_in_prompt_dispatch:-}" ]]; then
      [[ -n "\${__kolux_dispatching_user_prompt_command:-}" ]] || return 0
      if [[ "\${FUNCNAME[1]:-}" == "__kolux_run_prompt_command_array" ]]; then
        case "$BASH_COMMAND" in
          '(( __kolux_exit_code == 0 ))'|'__kolux_restore_prompt_status "$__kolux_exit_code"'|'eval "$__kolux_prompt_part"'|'eval "$__kolux_final_prompt_command"'|__kolux_dispatching_user_prompt_command=*|__kolux_osc133_precmd|__kolux_osc133_prompt_done|__kolux_prompt_mark) return 0 ;;
        esac
      fi
    elif [[ "\${FUNCNAME[1]:-}" == "__kolux_run_prompt_command_array" || "$BASH_COMMAND" == "__kolux_run_prompt_command_array" ]]; then
      return 0
    fi
    [[ -z "\${__kolux_in_legacy_prompt_wrapper:-}" || -n "\${__kolux_dispatching_user_prompt_command:-}" ]] || return 0
    if [[ -n "\${__kolux_in_prompt_command:-}" && "$BASH_COMMAND" == "__kolux_in_debug_capture=1" ]]; then
      return 0
    fi
  fi
  case "\${FUNCNAME[1]:-}" in __kolux_osc133_*|__kolux_prompt_mark|__kolux_restore_prompt_status) return 0 ;; esac
  case "$BASH_COMMAND" in __kolux_osc133_precmd|__kolux_osc133_prompt_done|__kolux_prompt_mark) return 0 ;; esac
  __kolux_run_user_debug_trap
  [[ -z "\${__kolux_in_prompt_command:-}" ]] || return 0
  [[ -z "\${__kolux_in_command:-}" ]] || return 0
  printf "\\033]133;C\\007"
  __kolux_in_command=1
}
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__kolux_prepend_prompt_command "__kolux_osc133_precmd"
# Why: SSH startup commands are renderer-delivered; emit the same internal
# readiness marker as local shells only when that delivery mode asks for it.
if [[ -n "$__kolux_ready_marker" ]]; then
  __kolux_prompt_mark() {
    printf "${SHELL_READY_MARKER_ESCAPED}"
  }
  __kolux_append_prompt_command "__kolux_prompt_mark"
fi
__kolux_append_prompt_command '__kolux_in_debug_capture=1; __kolux_prompt_had_functrace=""; if [[ -o functrace ]]; then __kolux_prompt_had_functrace=1; set +T; fi; __kolux_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__kolux_prompt_had_functrace" ]] || set -T; unset __kolux_prompt_had_functrace __kolux_in_debug_capture'
__kolux_append_prompt_command "__kolux_osc133_prompt_done"
__kolux_had_functrace=""
[[ -o functrace ]] && __kolux_had_functrace=1
set +T
__kolux_debug_trap_spec="$(trap -p DEBUG)"
[[ -z "$__kolux_had_functrace" ]] || set -T
if [[ -n "$__kolux_debug_trap_spec" && "$__kolux_debug_trap_spec" != "trap -- '__kolux_osc133_preexec' DEBUG" ]]; then
  __kolux_debug_trap_command="\${__kolux_debug_trap_spec#trap -- }"
  __kolux_debug_trap_command="\${__kolux_debug_trap_command% DEBUG}"
  eval "__kolux_user_debug_trap=$__kolux_debug_trap_command"
fi
unset __kolux_debug_trap_spec __kolux_debug_trap_command __kolux_had_functrace
unset -f __kolux_normalize_prompt_command_part __kolux_normalize_prompt_command __kolux_prepend_prompt_command __kolux_append_prompt_command
unset __kolux_prompt_command_normalized
# Why: arm DEBUG after wrapper setup so the relay rcfile itself does not emit
# fake command-start/end markers before the first prompt.
__kolux_initial_prompt=1
trap '__kolux_osc133_preexec' DEBUG
unset __kolux_initializing_wrapper
`

  // Only .zshenv: see local-pty-shell-ready-wrapper-generation.ts.
  const files = [
    [join(zshDir, '.zshenv'), zshenv],
    [join(zshDir, ZSH_WRAPPER_DIR_MARKER_FILE), ZSH_WRAPPER_DIR_MARKER_CONTENT],
    [join(bashDir, 'rcfile'), bashRc]
  ] as const

  // Why: relay wrapper files persist under ~/.kolux-relay across app upgrades.
  // Existence alone is not enough; stale wrappers would miss later fixes such
  // as preserving post-.zshenv ZDOTDIR.
  const stale = files.filter(([path, content]) => readFileOrNull(path) !== content)
  if (stale.length > 0 && !writeShellWrapperFiles(stale, '[relay/shell-overlay]')) {
    return false
  }
  return files.every(([path]) => isNonEmptyFile(path))
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function isNonEmptyFile(path: string): boolean {
  try {
    return statSync(path).size > 0
  } catch {
    return false
  }
}
