import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  KoluxCloudCapabilities,
  KoluxCloudOrgSummary,
  KoluxProfileCloudSummary
} from '../../shared/kolux-profiles'
import type { KoluxCloudSessionExchangeResponse } from './profile-cloud-session-exchange'

const {
  beginKoluxCloudPkceFlowMock,
  createKoluxCloudProfileMock,
  exchangeKoluxCloudAuthCodeMock,
  revokeKoluxCloudSessionMock,
  selectKoluxCloudOrgMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginKoluxCloudPkceFlowMock: vi.fn(),
  createKoluxCloudProfileMock: vi.fn(),
  exchangeKoluxCloudAuthCodeMock: vi.fn(),
  revokeKoluxCloudSessionMock: vi.fn(),
  selectKoluxCloudOrgMock: vi.fn(),
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginKoluxCloudPkceFlow: beginKoluxCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createKoluxCloudProfile: createKoluxCloudProfileMock,
  exchangeKoluxCloudAuthCode: exchangeKoluxCloudAuthCodeMock,
  revokeKoluxCloudSession: revokeKoluxCloudSessionMock,
  selectKoluxCloudOrg: selectKoluxCloudOrgMock
}))

import {
  connectCurrentKoluxProfile,
  createCloudLinkedKoluxProfile,
  getCurrentKoluxProfileAuthStatus,
  selectCurrentKoluxProfileOrg,
  signOutCurrentKoluxProfile
} from './profile-cloud-service'

const cloudSummary: KoluxProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const capabilities: KoluxCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: KoluxCloudOrgSummary[] = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

function configureCloudEnv(): void {
  vi.stubEnv('KOLUX_CLOUD_API_URL', 'https://kolux-cloud.example')
  vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', 'desktop-client')
}

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function mockSuccessfulConnect(expiresAt = futureExpiresAt()): void {
  beginKoluxCloudPkceFlowMock.mockResolvedValue({
    code: 'auth-code',
    codeVerifier: 'code-verifier',
    nonce: 'nonce',
    redirectUri: 'http://127.0.0.1:4100/auth/callback',
    state: 'state'
  })
  exchangeKoluxCloudAuthCodeMock.mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt,
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies KoluxCloudSessionExchangeResponse)
}

describe('Kolux cloud profile service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'kolux-cloud-service-'))
    beginKoluxCloudPkceFlowMock.mockReset()
    createKoluxCloudProfileMock.mockReset()
    exchangeKoluxCloudAuthCodeMock.mockReset()
    revokeKoluxCloudSessionMock.mockReset()
    selectKoluxCloudOrgMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    revokeKoluxCloudSessionMock.mockResolvedValue(undefined)
    vi.unstubAllEnvs()
    vi.stubEnv('KOLUX_CLOUD_API_URL', '')
    vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports local unconfigured auth without cloud setup', () => {
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    })
  })

  it('connects the active local profile without replacing its local profile ID', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()

    const result = await connectCurrentKoluxProfile(userDataPath)

    if (result.status !== 'connected') {
      throw new Error(`Expected connected result, got ${result.status}`)
    }
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({
      id: 'local-default',
      kind: 'cloud-linked',
      cloud: cloudSummary
    })
    expect(exchangeKoluxCloudAuthCodeMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ localProfileId: 'local-default', nonce: 'nonce' })
    )
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      persistence: 'encrypted',
      cloud: cloudSummary,
      organizations,
      capabilities
    })
  })

  it('treats provider-denied sign-in as a cancelled connect attempt', async () => {
    configureCloudEnv()
    beginKoluxCloudPkceFlowMock.mockRejectedValue(new Error('kolux_cloud_auth_denied'))

    const result = await connectCurrentKoluxProfile(userDataPath)

    expect(result.status).toBe('cancelled')
    expect(exchangeKoluxCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
  })

  it('does not report a saved cloud session as connected when cloud config is unavailable', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentKoluxProfile(userDataPath)
    vi.stubEnv('KOLUX_CLOUD_API_URL', '')
    vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', '')

    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      configured: false,
      state: 'unconfigured',
      persistence: 'encrypted',
      cloud: cloudSummary,
      setupMessage: 'Kolux Cloud sign-in is not configured for this build.'
    })
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).organizations).toBeUndefined()
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).capabilities).toBeUndefined()
  })

  it('signs out by removing cloud metadata while keeping the local profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentKoluxProfile(userDataPath)

    const result = await signOutCurrentKoluxProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({ id: 'local-default', kind: 'local' })
    expect(result.profiles[0]?.cloud).toBeUndefined()
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
    expect(revokeKoluxCloudSessionMock).toHaveBeenCalledOnce()
  })

  it('creates a new empty cloud-linked profile with its own cloud session', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentKoluxProfile(userDataPath)
    createKoluxCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: 1000,
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities: { flags: { share: true, team: true }, refreshedAt: 13 }
    } satisfies KoluxCloudSessionExchangeResponse)

    const result = await createCloudLinkedKoluxProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    if (result.status !== 'created') {
      throw new Error(`Expected created result, got ${result.status}`)
    }
    expect(result.profile).toMatchObject({
      id: expect.stringMatching(/^cloud-/),
      name: 'Acme',
      kind: 'cloud-linked',
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-2' })
    })
    expect(createKoluxCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('selects an organization for a connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentKoluxProfile(userDataPath)
    const orgCloudSummary = {
      ...cloudSummary,
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    }
    selectKoluxCloudOrgMock.mockResolvedValue({
      cloud: orgCloudSummary,
      organizations,
      capabilities: { flags: { share: true, sso: true }, refreshedAt: 12 }
    })

    const result = await selectCurrentKoluxProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectKoluxCloudOrgMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      'org-1'
    )
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    })
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).organizations).toEqual(organizations)
  })
})
