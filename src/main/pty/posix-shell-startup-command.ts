import { basename, win32 as pathWin32 } from 'node:path'

export const POSIX_SHELL_STARTUP_COMMAND_ENV = 'KOLUX_POSIX_SHELL_STARTUP_COMMAND'

export function supportsPosixShellStartupCommand(shellPath: string): boolean {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' || shellName === 'fish'
}

export function getBashStartupCommandPromptBlock(): string {
  return `if [[ \${${POSIX_SHELL_STARTUP_COMMAND_ENV}+present} == present ]]; then
  __kolux_remove_startup_command_prompt_hook() {
    local __kolux_item
    local -a __kolux_remaining=()
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
      for __kolux_item in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
        [[ "$__kolux_item" == "__kolux_run_startup_command" ]] || __kolux_remaining+=("$__kolux_item")
      done
      PROMPT_COMMAND=("\${__kolux_remaining[@]+"\${__kolux_remaining[@]}"}")
    else
      for __kolux_item in "\${__kolux_prompt_command_suffix[@]+"\${__kolux_prompt_command_suffix[@]}"}"; do
        [[ "$__kolux_item" == "__kolux_run_startup_command" ]] || __kolux_remaining+=("$__kolux_item")
      done
      __kolux_prompt_command_suffix=("\${__kolux_remaining[@]+"\${__kolux_remaining[@]}"}")
    fi
  }
  __kolux_run_startup_command() {
    local __kolux_command="$${POSIX_SHELL_STARTUP_COMMAND_ENV}" __kolux_status
    unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    __kolux_remove_startup_command_prompt_hook
    unset -f __kolux_remove_startup_command_prompt_hook
    builtin history -s "$__kolux_command" 2>/dev/null || true
    builtin printf '%s\n' "$__kolux_command"
    eval "$__kolux_command"
    __kolux_status=$?
    unset -f __kolux_run_startup_command
    return "$__kolux_status"
  }
  __kolux_append_prompt_command "__kolux_run_startup_command"
fi`
}
