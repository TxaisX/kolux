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
  refreshKoluxCloudCapabilitiesMock,
  refreshKoluxCloudSessionMock,
  selectKoluxCloudOrgMock,
  KoluxCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginKoluxCloudPkceFlowMock: vi.fn(),
  createKoluxCloudProfileMock: vi.fn(),
  exchangeKoluxCloudAuthCodeMock: vi.fn(),
  refreshKoluxCloudCapabilitiesMock: vi.fn(),
  refreshKoluxCloudSessionMock: vi.fn(),
  selectKoluxCloudOrgMock: vi.fn(),
  KoluxCloudRequestErrorMock: class KoluxCloudRequestError extends Error {
    constructor(public readonly statusCode: number) {
      super(`kolux_cloud_request_failed_${statusCode}`)
      this.name = 'KoluxCloudRequestError'
    }
  },
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
  KoluxCloudRequestError: KoluxCloudRequestErrorMock,
  isAmbiguousCloudRequestFailure: (error: unknown) =>
    !(error instanceof KoluxCloudRequestErrorMock),
  createKoluxCloudProfile: createKoluxCloudProfileMock,
  exchangeKoluxCloudAuthCode: exchangeKoluxCloudAuthCodeMock,
  refreshKoluxCloudCapabilities: refreshKoluxCloudCapabilitiesMock,
  refreshKoluxCloudSession: refreshKoluxCloudSessionMock,
  revokeKoluxCloudSession: vi.fn(),
  selectKoluxCloudOrg: selectKoluxCloudOrgMock
}))

import {
  connectCurrentKoluxProfile,
  createCloudLinkedKoluxProfile,
  getCurrentKoluxProfileAuthStatus,
  refreshCurrentKoluxProfileAuth,
  selectCurrentKoluxProfileOrg
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

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function configureCloudEnv(): void {
  vi.stubEnv('KOLUX_CLOUD_API_URL', 'https://kolux-cloud.example')
  vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', 'desktop-client')
}

function mockSuccessfulConnect(): void {
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
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies KoluxCloudSessionExchangeResponse)
}

function mockSuccessfulSessionRefresh(): void {
  refreshKoluxCloudSessionMock.mockResolvedValue({
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies KoluxCloudSessionExchangeResponse)
}

describe('Kolux cloud profile auth-failure retry', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'kolux-cloud-service-auth-retry-'))
    beginKoluxCloudPkceFlowMock.mockReset()
    createKoluxCloudProfileMock.mockReset()
    exchangeKoluxCloudAuthCodeMock.mockReset()
    refreshKoluxCloudCapabilitiesMock.mockReset()
    refreshKoluxCloudSessionMock.mockReset()
    selectKoluxCloudOrgMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('KOLUX_CLOUD_API_URL', '')
    vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('refreshes and retries cloud profile creation after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentKoluxProfile(userDataPath)
    createKoluxCloudProfileMock
      .mockRejectedValueOnce(new KoluxCloudRequestErrorMock(401))
      .mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: futureExpiresAt(),
        cloud: { ...cloudSummary, cloudProfileId: 'cloud-profile-2' },
        organizations,
        capabilities
      } satisfies KoluxCloudSessionExchangeResponse)

    const result = await createCloudLinkedKoluxProfile(userDataPath, { name: 'Acme' })

    expect(result.status).toBe('created')
    expect(createKoluxCloudProfileMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { name: 'Acme' }
    )
  })

  it('refreshes and retries capability refresh after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentKoluxProfile(userDataPath)
    refreshKoluxCloudCapabilitiesMock
      .mockRejectedValueOnce(new KoluxCloudRequestErrorMock(403))
      .mockResolvedValue({
        capabilities: {
          flags: { share: false },
          refreshedAt: 26
        } satisfies KoluxCloudCapabilities
      })

    const result = await refreshCurrentKoluxProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshKoluxCloudCapabilitiesMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' })
    )
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 26
    })
  })

  it('requires reconnect when a retried capability refresh is still unauthorized', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentKoluxProfile(userDataPath)
    refreshKoluxCloudCapabilitiesMock
      .mockRejectedValueOnce(new KoluxCloudRequestErrorMock(401))
      .mockRejectedValueOnce(new KoluxCloudRequestErrorMock(401))

    const result = await refreshCurrentKoluxProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })

  it('refreshes and retries organization selection after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentKoluxProfile(userDataPath)
    selectKoluxCloudOrgMock
      .mockRejectedValueOnce(new KoluxCloudRequestErrorMock(401))
      .mockResolvedValue({
        cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
        organizations,
        capabilities
      })

    const result = await selectCurrentKoluxProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectKoluxCloudOrgMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      'org-1'
    )
  })
})
