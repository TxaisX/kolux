import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { replayTerminalWindowConnection } from './terminal-window-snapshot-replay'

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function visibleHistory(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active
  return Array.from(
    { length: buffer.length },
    (_, index) => buffer.getLine(index)?.translateToString(true) ?? ''
  ).filter(Boolean)
}

describe('replayTerminalWindowConnection', () => {
  it('replaces scrollback when a resize resync replays the authoritative history', async () => {
    const terminal = new Terminal({ cols: 40, rows: 3, scrollback: 100 })
    const kittyKeyboardModes = new TerminalKittyKeyboardModeTracker()
    const replay = (replaceExisting: boolean): void => {
      replayTerminalWindowConnection({
        terminal,
        connection: {
          snapshot: {
            cols: 45,
            rows: 3,
            scrollbackAnsi: 'history-1\r\nhistory-2\r\n',
            data: 'prompt'
          },
          replay: []
        },
        replaceExisting,
        kittyKeyboardModes,
        write: (chunk) => void write(terminal, chunk)
      })
    }

    replay(false)
    await write(terminal, '')
    expect(visibleHistory(terminal)).toEqual(['history-1', 'history-2', 'prompt'])

    replay(true)
    await write(terminal, '')
    expect(visibleHistory(terminal)).toEqual(['history-1', 'history-2', 'prompt'])
    expect(terminal.cols).toBe(45)
    terminal.dispose()
  })
})
