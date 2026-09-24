import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { composeActiveTerminalTheme } from '@/components/terminal-pane/terminal-appearance'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { runTerminalCopy } from '@/components/terminal-pane/terminal-copy-rejection-guards'
import { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { normalizeDesktopTerminalScrollbackRows } from '../../../../shared/terminal-scrollback-policy'
import { useEffectiveMacOptionAsAlt } from '@/lib/keyboard-layout/use-effective-mac-option-as-alt'
import {
  buildPreviewAppearanceOptions,
  buildPreviewTerminalOptions
} from '@/components/dashboard-popout/preview-terminal-options'
import { syncPreviewTerminalLigatures } from '@/components/dashboard-popout/preview-terminal-ligatures'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { useAppStore } from '@/store'
import type { TerminalPreviewDataPayload } from '../../../../shared/terminal-preview'
import { installTerminalWindowInputBindings } from './terminal-window-input-bindings'
import { createTerminalWindowFit } from './terminal-window-fit'
import { replayTerminalWindowConnection } from './terminal-window-snapshot-replay'

// Why 1000: main only ever serializes up to this many rows of history into a
// terminalPreview connection, regardless of what the local buffer below can
// hold going forward — see terminal-preview.ts. Requesting the max keeps a
// freshly opened window's initial backscroll as deep as the transport allows.
const CONNECT_SCROLLBACK_ROWS = 1000
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24
const RESYNC_RETRY_DELAY_MS = 150

export type TerminalWindowTerminalHandle = {
  containerRef: React.RefObject<HTMLDivElement | null>
  ptyGone: boolean
  clearScreen: () => void
  copySelection: () => void
  pasteClipboard: () => void
}

/**
 * Mounts a real, full-owner xterm against a live pty over the same
 * terminalPreview transport the dashboard pop-out preview uses (see
 * AgentTerminalPreview.tsx) — connect/input/data/ack/unsubscribe are already
 * ptyId-scoped and read-write, so nothing here reimplements that plumbing.
 * Unlike the dialog preview this window OWNS the whole grid (no scaling, no
 * grid-claim negotiation with another viewer) — see terminal-window-fit.ts.
 */
export function useTerminalWindowTerminal(ptyId: string): TerminalWindowTerminalHandle {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const pasteRef = useRef<(el: Element | null, source: 'app-menu') => Promise<void>>(
    async () => undefined
  )
  const settings = useAppStore((state) => state.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const macOptionAsAlt = useEffectiveMacOptionAsAlt(settings?.terminalMacOptionAsAlt)
  const settingsRef = useRef(settings)
  const macOptionAsAltRef = useRef(macOptionAsAlt)
  const [ptyGone, setPtyGone] = useState(false)

  const { terminalTheme, terminalMode } = useMemo(() => {
    if (!settings) {
      return { terminalTheme: null, terminalMode: 'dark' as const }
    }
    const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
    const theme = composeActiveTerminalTheme(
      appearance.theme ?? getBuiltinTheme(appearance.themeName),
      settings
    )
    return { terminalTheme: theme, terminalMode: appearance.mode }
  }, [settings, systemPrefersDark])

  useLayoutEffect(() => {
    settingsRef.current = settings
    macOptionAsAltRef.current = macOptionAsAlt
  }, [settings, macOptionAsAlt])

  useEffect(() => {
    setPtyGone(false)
    const container = containerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let terminal: Terminal | null = null
    let offData: (() => void) | null = null
    const kittyKeyboardModes = new TerminalKittyKeyboardModeTracker()
    let refreshInFlight = false
    let refreshAgain = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const pendingLivePayloads: Extract<TerminalPreviewDataPayload, { type: 'data' }>[] = []
    const fitAddon = new FitAddon()
    const fit = createTerminalWindowFit({
      ptyId,
      container,
      fitAddon,
      getTerminal: () => terminal,
      isDisposed: () => disposed
    })
    const io = installTerminalWindowInputBindings({
      ptyId,
      container,
      getTerminal: () => terminal,
      isDisposed: () => disposed,
      getSettings: () => settingsRef.current,
      getMacOptionAsAlt: () => macOptionAsAltRef.current,
      getKeybindings: () => useAppStore.getState().keybindings,
      onInput: (data) => void window.api.terminalPreview.input(ptyId, data)
    })
    pasteRef.current = io.pasteClipboardText

    const writeReplayed = (chunk: string, onDone?: () => void, live = false): void => {
      if (live) {
        kittyKeyboardModes.scan(chunk)
      } else {
        kittyKeyboardModes.scanReplay(chunk)
      }
      terminal?.write(chunk, () => {
        fit.schedule()
        onDone?.()
      })
    }

    const writeLive = (payload: Extract<TerminalPreviewDataPayload, { type: 'data' }>): void => {
      if (!terminal) {
        pendingLivePayloads.push(payload)
        return
      }
      writeReplayed(
        payload.data,
        () => {
          if (!disposed) {
            void window.api.terminalPreview.ack(ptyId, payload.bytes)
          }
        },
        true
      )
    }

    const replayConnection = (
      connection: Awaited<ReturnType<typeof window.api.terminalPreview.connect>>,
      requestRefresh: () => void
    ): void => {
      const snap = connection.snapshot!
      const replaceExisting = terminal !== null
      if (!terminal) {
        terminal = new Terminal(
          buildPreviewTerminalOptions({
            settings: settingsRef.current,
            terminalInput: null,
            macOptionIsMeta: macOptionAsAltRef.current === 'true',
            theme: terminalTheme,
            themeMode: terminalMode,
            cols: Math.max(1, snap.cols ?? FALLBACK_COLS),
            rows: Math.max(1, snap.rows ?? FALLBACK_ROWS),
            scrollback: normalizeDesktopTerminalScrollbackRows(
              settingsRef.current?.terminalScrollbackRows
            )
          })
        )
        try {
          terminal.open(container)
        } catch {
          terminal.dispose()
          terminal = null
          return
        }
        terminal.loadAddon(fitAddon)
        terminalRef.current = terminal
        io.bindTerminal(terminal, kittyKeyboardModes)
      }
      replayTerminalWindowConnection({
        terminal,
        connection: { ...connection, snapshot: snap },
        replaceExisting,
        kittyKeyboardModes,
        write: (chunk, live) => writeReplayed(chunk, undefined, live)
      })
      for (const payload of pendingLivePayloads.splice(0)) {
        writeLive(payload)
      }
      if (connection.resyncRequired) {
        refreshAgain = false
        writeReplayed('', () => {
          if (disposed || retryTimer) {
            return
          }
          retryTimer = setTimeout(() => {
            retryTimer = null
            requestRefresh()
          }, RESYNC_RETRY_DELAY_MS)
        })
      } else if (refreshAgain) {
        refreshAgain = false
        writeReplayed('', requestRefresh)
      }
      // Why: this window owns the whole grid, so its own real size — not
      // whatever the pty happened to be sized to before this window opened it
      // — is authoritative. Nothing else can contend for this claim.
      fit.schedule()
      terminal.focus()
    }

    const setup = async (): Promise<void> => {
      if (refreshInFlight) {
        refreshAgain = true
        return
      }
      refreshInFlight = true
      const connection = await window.api.terminalPreview.connect(ptyId, {
        scrollbackRows: CONNECT_SCROLLBACK_ROWS
      })
      if (disposed) {
        return
      }
      if (!connection.snapshot) {
        refreshInFlight = false
        setPtyGone(true)
        offData?.()
        offData = null
        terminal?.dispose()
        terminal = null
        terminalRef.current = null
        void window.api.terminalPreview.unsubscribe(ptyId)
        return
      }
      refreshInFlight = false
      if (!connection.resyncRequired && retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      replayConnection(connection, () => void setup())
    }

    offData = window.api.terminalPreview.onData((payload) => {
      if (payload.ptyId !== ptyId) {
        return
      }
      if (payload.type === 'resync') {
        void setup()
        return
      }
      writeLive(payload)
    })

    void setup()

    return () => {
      disposed = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
      fit.dispose()
      io.dispose()
      offData?.()
      void window.api.terminalPreview.unsubscribe(ptyId)
      terminal?.dispose()
      terminalRef.current = null
    }
  }, [ptyId, terminalTheme, terminalMode])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    Object.assign(
      terminal.options,
      buildPreviewAppearanceOptions(settings, macOptionAsAlt === 'true')
    )
    syncPreviewTerminalLigatures(terminal, settings)
  }, [settings, macOptionAsAlt])

  return {
    containerRef,
    ptyGone,
    // ponytail: local buffer clear only, not a round-trip reset of the pty's
    // tracked scrollback — reconnecting still replays pre-clear history.
    clearScreen: () => terminalRef.current?.clear(),
    copySelection: () => {
      const terminal = terminalRef.current
      if (!terminal) {
        return
      }
      void runTerminalCopy({
        selection: terminal.getSelection(),
        writeClipboardText: window.api.ui.writeTerminalClipboardText,
        focus: () => terminal.focus()
      })
    },
    pasteClipboard: () => void pasteRef.current(document.activeElement, 'app-menu')
  }
}
