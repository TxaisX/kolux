// Why first, and why the import-free shim: react-dom reads
// __REACT_DEVTOOLS_GLOBAL_HOOK__ once at module evaluation, so the global has to
// exist before it. The observer below only wraps a property react-dom re-reads
// per commit, so its own import graph can evaluate whenever it likes.
import './lib/react-devtools-commit-hook-shim'
import './lib/react-commit-cascade-observer'
import './assets/main.css'

import { StrictMode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { TerminalWindowRoot } from './components/terminal-window/TerminalWindowRoot'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  installRendererCrashDiagnostics,
  recordRendererCrashBreadcrumb
} from './lib/crash-diagnostics'
import { applyDocumentTheme } from './lib/document-theme'
import { buildAppFontFamily } from './lib/app-font-family'
import { I18nProvider } from './i18n/I18nProvider'
import { TooltipProvider } from './components/ui/tooltip'
import { translate } from './i18n/i18n'
import { useAppStore } from './store'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getOrCreateRendererRoot } from './lib/react-renderer-root'
import { setReactCommitCascadeRendererSurface } from './lib/react-commit-cascade-telemetry'

// Why: one BrowserWindow per terminal session (see AGENTS.md's window-per-
// terminal contract) needs the same renderer bootstrap as main.tsx/popout.tsx
// — crash diagnostics, theme, i18n, error boundary — since it shares nothing
// but window.api with either.
recordRendererCrashBreadcrumb('terminal_window_bootstrap_started', { dev: import.meta.env.DEV })
installRendererCrashDiagnostics('terminal-window')
setReactCommitCascadeRendererSurface('terminal-window')

function applyTerminalWindowAppearance(settings: GlobalSettings | null): void {
  applyDocumentTheme(settings?.theme ?? 'system', { disableTransitions: false })
  document.documentElement.style.setProperty(
    '--app-font-family',
    buildAppFontFamily(settings?.appFontFamily)
  )
}

let startupSettings: GlobalSettings | null = null
try {
  startupSettings = window.api.settings.getSync()
} catch {
  // Async hydration below remains available if the startup read fails.
}
if (startupSettings) {
  useAppStore.setState({ settings: startupSettings })
}
applyTerminalWindowAppearance(startupSettings)

const rootElement = document.getElementById('root')
if (!rootElement) {
  recordRendererCrashBreadcrumb('terminal_window_root_missing')
  throw new Error('Terminal window root element not found.')
}

function parseWindowQuery(): {
  sessionKey: string
  worktreeId: string
  tabId: string
  ptyId: string | null
} | null {
  const params = new URLSearchParams(window.location.search)
  const sessionKey = params.get('sessionKey')
  const worktreeId = params.get('worktreeId')
  const tabId = params.get('tabId')
  if (!sessionKey || !worktreeId || !tabId) {
    return null
  }
  return { sessionKey, worktreeId, tabId, ptyId: params.get('ptyId') }
}

function TerminalWindowSettingsSync(): null {
  const settings = useAppStore((state) => state.settings)

  useEffect(() => {
    let disposed = false
    void useAppStore.getState().fetchKeybindings()
    const setSettings = (next: GlobalSettings): void => {
      if (!disposed) {
        useAppStore.setState({ settings: next })
      }
    }
    const offChanged = window.api.settings.onChanged((updates) => {
      const current = useAppStore.getState().settings
      if (current) {
        setSettings({ ...current, ...updates })
      }
    })
    void window.api.settings
      .get()
      .then(setSettings)
      .catch(() => undefined)
    return () => {
      disposed = true
      offChanged()
    }
  }, [])

  useEffect(() => {
    applyTerminalWindowAppearance(settings)
    if (settings?.theme !== 'system') {
      return
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (): void => applyDocumentTheme('system')
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [settings])

  return null
}

function TerminalWindowApp(): React.JSX.Element {
  useTranslation()
  const query = parseWindowQuery()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="terminal-window.root"
      surface="terminal-window"
      title={translate(
        'terminalWindow.recoverableError.title',
        'This terminal window hit an error.'
      )}
      description={translate(
        'terminalWindow.recoverableError.description',
        'The terminal could not finish rendering. Retry to remount it, or close and reopen the window.'
      )}
    >
      {query ? (
        <TerminalWindowRoot
          sessionKey={query.sessionKey}
          worktreeId={query.worktreeId}
          tabId={query.tabId}
          ptyId={query.ptyId}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-background px-6 text-center text-[13px] text-muted-foreground">
          {translate(
            'terminalWindow.missingQuery',
            'This terminal window opened without a session to attach to.'
          )}
        </div>
      )}
    </RecoverableRenderErrorBoundary>
  )
}

getOrCreateRendererRoot(rootElement, import.meta.hot?.data).render(
  <StrictMode>
    <I18nProvider>
      <TerminalWindowSettingsSync />
      {/* Why: pane-header Tooltips throw without a provider; this entry doesn't mount App.tsx's. */}
      <TooltipProvider delayDuration={400}>
        <TerminalWindowApp />
      </TooltipProvider>
    </I18nProvider>
  </StrictMode>
)
recordRendererCrashBreadcrumb('terminal_window_bootstrap_rendered')
