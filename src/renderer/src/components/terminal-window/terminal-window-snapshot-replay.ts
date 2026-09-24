import type { Terminal } from '@xterm/xterm'
import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import type { TerminalPreviewConnectResult } from '../../../../shared/terminal-preview'
import { replayPreviewConnectionSnapshot } from '../dashboard-popout/preview-terminal-snapshot-replay'

/** Replaces the old grid before replaying an authoritative resync snapshot. */
export function replayTerminalWindowConnection(args: {
  terminal: Pick<Terminal, 'resize' | 'reset'>
  connection: TerminalPreviewConnectResult & {
    snapshot: NonNullable<TerminalPreviewConnectResult['snapshot']>
  }
  replaceExisting: boolean
  kittyKeyboardModes: TerminalKittyKeyboardModeTracker
  write: (chunk: string, live: boolean) => void
}): void {
  const { terminal, connection } = args
  if (args.replaceExisting) {
    terminal.resize(Math.max(1, connection.snapshot.cols), Math.max(1, connection.snapshot.rows))
    terminal.reset()
  }
  replayPreviewConnectionSnapshot({
    snapshot: connection.snapshot,
    replay: connection.replay,
    kittyKeyboardModes: args.kittyKeyboardModes,
    write: args.write
  })
}
