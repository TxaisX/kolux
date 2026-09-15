import type { Terminal } from '@xterm/xterm'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { subscribeToTerminalUserInput } from '@/components/terminal-pane/terminal-user-input-signal'
import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import {
  createPreviewClipboardPaster,
  type PreviewTerminalPasteSource
} from '@/components/dashboard-popout/preview-terminal-paste'
import { installPreviewImeBridge } from '@/components/dashboard-popout/preview-terminal-ime-bridge'
import { installPreviewTerminalKeyHandler } from '@/components/dashboard-popout/preview-terminal-key-handler'
import { installPreviewTerminalCompatibility } from '@/components/dashboard-popout/preview-terminal-compatibility'
import { installPreviewTerminalAppMenuClipboard } from '@/components/dashboard-popout/preview-terminal-app-menu-clipboard'
import { installPreviewTerminalRightClickPaste } from '@/components/dashboard-popout/preview-terminal-right-click-paste'
import { isWindowsUserAgent } from '@/components/terminal-pane/pane-helpers'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { KeybindingOverrides } from '../../../../shared/keybindings'
import type { EffectiveMacOptionAsAlt } from '@/lib/keyboard-layout/detect-option-as-alt'

export type TerminalWindowInputBindings = {
  pasteClipboardText: (
    activeElement: Element | null,
    source: PreviewTerminalPasteSource
  ) => Promise<void>
  /** Wires everything that needs the live terminal — call once, right after
   *  it's created. */
  bindTerminal: (terminal: Terminal, kittyKeyboardModes: TerminalKittyKeyboardModeTracker) => void
  dispose: () => void
}

/** Every non-connection xterm input wire the pane header's terminal already
 *  has — clipboard (menu/keyboard/right-click/app-menu), IME, kitty-aware
 *  shortcuts — reused verbatim from the dashboard preview's small installers. */
export function installTerminalWindowInputBindings(args: {
  ptyId: string
  container: HTMLElement
  getTerminal: () => Terminal | null
  isDisposed: () => boolean
  getSettings: () => GlobalSettings | null
  getMacOptionAsAlt: () => EffectiveMacOptionAsAlt
  getKeybindings: () => KeybindingOverrides | undefined
  onInput: (data: string) => void
}): TerminalWindowInputBindings {
  const pasteClipboardText = createPreviewClipboardPaster({
    ptyId: args.ptyId,
    container: args.container,
    getTerminal: args.getTerminal,
    getTerminalInput: () => null,
    isDisposed: args.isDisposed
  })
  const forwardPaste = (activeElement: Element | null, source: PreviewTerminalPasteSource): void =>
    void pasteClipboardText(activeElement, source)

  const disposeAppMenuClipboard = installPreviewTerminalAppMenuClipboard({
    container: args.container,
    getTerminal: args.getTerminal,
    pasteClipboardText: forwardPaste
  })
  const disposeRightClickPaste = installPreviewTerminalRightClickPaste({
    container: args.container,
    getTerminal: args.getTerminal,
    isRightClickToPasteEnabled: () =>
      args.getSettings()?.terminalRightClickToPaste ?? isWindowsUserAgent(),
    pasteClipboardText: forwardPaste
  })

  let disposeBound: (() => void) | null = null

  const bindTerminal = (
    terminal: Terminal,
    kittyKeyboardModes: TerminalKittyKeyboardModeTracker
  ): void => {
    const disposeCompatibility = installPreviewTerminalCompatibility(terminal, {
      getSettings: args.getSettings
    })
    let pendingUserInputSignals = 0
    const userInputDisposable = subscribeToTerminalUserInput(terminal, () => {
      pendingUserInputSignals = Math.min(32, pendingUserInputSignals + 1)
    })
    terminal.onData((data) => {
      // Why: core's signal distinguishes real input from parser replies, so
      // typing survives live replay without forwarding synthetic CPR/DA bytes.
      if (pendingUserInputSignals <= 0) {
        return
      }
      pendingUserInputSignals--
      args.onInput(data)
    })
    const imeBridge = installPreviewImeBridge(terminal, {
      getKittyKeyboardFlags: () => kittyKeyboardModes.flags
    })
    const disposeKeyHandler = installPreviewTerminalKeyHandler({
      terminal,
      claimImeKeyEvent: (event) => imeBridge?.claimKeyEvent(event) ?? false,
      pasteClipboardText: forwardPaste,
      sendInput: (data) => terminal.input(data),
      getShortcutContext: () => ({
        clientPlatform: getShortcutPlatform(),
        macOptionAsAlt: args.getMacOptionAsAlt(),
        keybindings: args.getKeybindings(),
        terminalInput: null,
        getKittyKeyboardFlags: () => kittyKeyboardModes.flags,
        terminalShortcutPolicy: args.getSettings()?.terminalShortcutPolicy
      })
    })
    disposeBound = () => {
      userInputDisposable?.dispose()
      imeBridge?.dispose()
      disposeCompatibility()
      disposeKeyHandler()
    }
  }

  return {
    pasteClipboardText,
    bindTerminal,
    dispose: () => {
      disposeBound?.()
      disposeAppMenuClipboard()
      disposeRightClickPaste()
    }
  }
}
