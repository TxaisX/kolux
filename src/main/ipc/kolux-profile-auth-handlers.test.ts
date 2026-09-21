import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  createCloudLinkedKoluxProfileMock,
  connectCurrentKoluxProfileMock,
  getCurrentKoluxProfileAuthStatusMock,
  refreshCurrentKoluxProfileAuthMock,
  selectCurrentKoluxProfileOrgMock,
  signOutCurrentKoluxProfileMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  createCloudLinkedKoluxProfileMock: vi.fn(),
  connectCurrentKoluxProfileMock: vi.fn(),
  getCurrentKoluxProfileAuthStatusMock: vi.fn(),
  refreshCurrentKoluxProfileAuthMock: vi.fn(),
  selectCurrentKoluxProfileOrgMock: vi.fn(),
  signOutCurrentKoluxProfileMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    relaunch: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../tray/system-tray', () => ({
  destroySystemTray: vi.fn()
}))

vi.mock('../kolux-profiles/profile-index-store', () => ({
  createLocalKoluxProfile: vi.fn(),
  getKoluxProfileListState: vi.fn(),
  seedNewKoluxProfileTelemetryConsent: vi.fn(),
  setActiveKoluxProfile: vi.fn()
}))

vi.mock('../kolux-profiles/profile-project-transfer', () => ({
  transferKoluxProfileProject: vi.fn()
}))

vi.mock('../kolux-profiles/profile-cloud-service', () => ({
  createCloudLinkedKoluxProfile: createCloudLinkedKoluxProfileMock,
  connectCurrentKoluxProfile: connectCurrentKoluxProfileMock,
  getCurrentKoluxProfileAuthStatus: getCurrentKoluxProfileAuthStatusMock,
  refreshCurrentKoluxProfileAuth: refreshCurrentKoluxProfileAuthMock,
  selectCurrentKoluxProfileOrg: selectCurrentKoluxProfileOrgMock,
  signOutCurrentKoluxProfile: signOutCurrentKoluxProfileMock
}))

import { registerKoluxProfileHandlers } from './kolux-profiles'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

describe('registerKoluxProfileHandlers auth channels', () => {
  beforeEach(() => {
    // Why the port and per-test: userData resolves through AppEnvironment now, and
    // the global setup's beforeEach reinstates its own fake before this runs.
    installFakeAppEnvironment({ getPath: () => '/tmp/kolux-user-data' })
    handlers.clear()
    createCloudLinkedKoluxProfileMock.mockReset()
    connectCurrentKoluxProfileMock.mockReset()
    getCurrentKoluxProfileAuthStatusMock.mockReset()
    refreshCurrentKoluxProfileAuthMock.mockReset()
    selectCurrentKoluxProfileOrgMock.mockReset()
    signOutCurrentKoluxProfileMock.mockReset()
  })

  it('returns auth status for the current profile', async () => {
    const status = {
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    }
    getCurrentKoluxProfileAuthStatusMock.mockReturnValue(status)
    registerKoluxProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('koluxProfiles:authStatus')?.(null))).resolves.toBe(
      status
    )
    expect(getCurrentKoluxProfileAuthStatusMock).toHaveBeenCalledWith('/tmp/kolux-user-data')
  })

  it('connects and signs out the current profile through the cloud service', async () => {
    const connectResult = { status: 'unconfigured', auth: { activeProfileId: 'local-default' } }
    const signOutResult = { status: 'signed-out', auth: { activeProfileId: 'local-default' } }
    connectCurrentKoluxProfileMock.mockResolvedValue(connectResult)
    signOutCurrentKoluxProfileMock.mockResolvedValue(signOutResult)
    registerKoluxProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('koluxProfiles:connectCurrent')?.(null))
    ).resolves.toBe(connectResult)
    await expect(
      Promise.resolve(handlers.get('koluxProfiles:signOutCurrent')?.(null))
    ).resolves.toBe(signOutResult)
    expect(connectCurrentKoluxProfileMock).toHaveBeenCalledWith('/tmp/kolux-user-data')
    expect(signOutCurrentKoluxProfileMock).toHaveBeenCalledWith('/tmp/kolux-user-data')
  })

  it('refreshes profile auth through the cloud service', async () => {
    const refreshResult = { status: 'refreshed', auth: { activeProfileId: 'local-default' } }
    refreshCurrentKoluxProfileAuthMock.mockResolvedValue(refreshResult)
    registerKoluxProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('koluxProfiles:refreshAuth')?.(null))).resolves.toBe(
      refreshResult
    )
    expect(refreshCurrentKoluxProfileAuthMock).toHaveBeenCalledWith('/tmp/kolux-user-data')
  })

  it('validates organization selection before calling the cloud service', async () => {
    const selectResult = { status: 'selected', auth: { activeProfileId: 'local-default' } }
    selectCurrentKoluxProfileOrgMock.mockResolvedValue(selectResult)
    registerKoluxProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('koluxProfiles:selectOrg')?.(null, { orgId: ' org-1 ' }))
    ).resolves.toBe(selectResult)
    expect(selectCurrentKoluxProfileOrgMock).toHaveBeenCalledWith('/tmp/kolux-user-data', 'org-1')

    await expect(
      Promise.resolve(handlers.get('koluxProfiles:selectOrg')?.(null, { orgId: ' ' }))
    ).rejects.toThrow('invalid_kolux_profile_org_selection')
  })

  it('creates cloud-linked profiles with trimmed optional args', async () => {
    const createResult = {
      status: 'created',
      auth: { activeProfileId: 'local-default' },
      activeProfileId: 'local-default',
      profiles: [],
      profile: { id: 'cloud-1' }
    }
    createCloudLinkedKoluxProfileMock.mockResolvedValue(createResult)
    registerKoluxProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('koluxProfiles:createCloudLinked')?.(null, {
          orgId: ' org-1 ',
          name: ' Acme '
        })
      )
    ).resolves.toBe(createResult)
    expect(createCloudLinkedKoluxProfileMock).toHaveBeenCalledWith('/tmp/kolux-user-data', {
      orgId: 'org-1',
      name: 'Acme'
    })
  })
})
