import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSidebarUpdateButtonModel, runSidebarUpdateAction } from './SidebarUpdateButton'

vi.mock('@/store', () => ({ useAppStore: vi.fn() }))

const updater = {
  check: vi.fn(() => Promise.resolve()),
  download: vi.fn(() => Promise.resolve()),
  quitAndInstall: vi.fn(() => Promise.resolve())
}

beforeEach(() => {
  vi.stubGlobal('window', { api: { updater } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('getSidebarUpdateButtonModel', () => {
  it('offers the download once a newer version is found', () => {
    const model = getSidebarUpdateButtonModel({
      state: 'available',
      version: '0.2.0',
      changelog: null
    })

    expect(model.label).toBe('Update to v0.2.0')
    expect(model.action).toBe('download')
    expect(model.emphasized).toBe(true)
  })

  it('offers a restart once the update is downloaded', () => {
    const model = getSidebarUpdateButtonModel({ state: 'downloaded', version: '0.2.0' })

    expect(model.label).toBe('Restart to update')
    expect(model.action).toBe('install')
  })

  it('disables the button while work is in flight', () => {
    expect(getSidebarUpdateButtonModel({ state: 'checking' }).action).toBeNull()
    const downloading = getSidebarUpdateButtonModel({
      state: 'downloading',
      percent: 41.6,
      version: '0.2.0'
    })
    expect(downloading.action).toBeNull()
    expect(downloading.label).toBe('Downloading 42%')
  })

  it('checks again from idle, up to date, and failure', () => {
    expect(getSidebarUpdateButtonModel({ state: 'idle' }).action).toBe('check')
    expect(getSidebarUpdateButtonModel({ state: 'not-available' }).action).toBe('check')
    expect(getSidebarUpdateButtonModel({ state: 'error', message: 'offline' }).action).toBe('check')
  })
})

describe('runSidebarUpdateAction', () => {
  it('routes each action to the matching updater call', () => {
    runSidebarUpdateAction('check')
    runSidebarUpdateAction('download')
    runSidebarUpdateAction('install')
    runSidebarUpdateAction(null)

    expect(updater.check).toHaveBeenCalledTimes(1)
    expect(updater.download).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})
