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
  KoluxCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginKoluxCloudPkceFlowMock: vi.fn(),
  createKoluxCloudProfileMock: vi.fn(),
  exchangeKoluxCloudAuthCodeMock: vi.fn(),
  refreshKoluxCloudCapabilitiesMock: vi.fn(),
  refreshKoluxCloudSessionMock: vi.fn(),
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
  selectKoluxCloudOrg: vi.fn()
}))

import {
  connectCurrentKoluxProfile,
  createCloudLinkedKoluxProfile,
  getCurrentKoluxProfileAuthStatus,
  refreshCurrentKoluxProfileAuth
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

describe('Kolux cloud profile service session refresh', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'kolux-cloud-service-refresh-'))
    beginKoluxCloudPkceFlowMock.mockReset()
    createKoluxCloudProfileMock.mockReset()
    exchangeKoluxCloudAuthCodeMock.mockReset()
    refreshKoluxCloudCapabilitiesMock.mockReset()
    refreshKoluxCloudSessionMock.mockReset()
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

  it('refreshes an expired access token before creating cloud profiles', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentKoluxProfile(userDataPath)
    refreshKoluxCloudSessionMock.mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: cloudSummary,
      organizations,
      capabilities
    } satisfies KoluxCloudSessionExchangeResponse)
    createKoluxCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities
    } satisfies KoluxCloudSessionExchangeResponse)

    const result = await createCloudLinkedKoluxProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    expect(result.status).toBe('created')
    expect(refreshKoluxCloudSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ refreshToken: 'refresh-token' })
    )
    expect(createKoluxCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('refreshes capability flags for the connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentKoluxProfile(userDataPath)
    refreshKoluxCloudCapabilitiesMock.mockResolvedValue({
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 25
      }
    })

    const result = await refreshCurrentKoluxProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshKoluxCloudCapabilitiesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' })
    )
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false, team: true },
      refreshedAt: 25
    })
  })

  it('clears stale active org metadata when capability refresh returns no active org', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    exchangeKoluxCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
      organizations,
      capabilities
    } satisfies KoluxCloudSessionExchangeResponse)
    await connectCurrentKoluxProfile(userDataPath)
    refreshKoluxCloudCapabilitiesMock.mockResolvedValue({
      cloud: cloudSummary,
      organizations: [],
      capabilities: {
        flags: { share: false },
        refreshedAt: 31
      }
    })

    const result = await refreshCurrentKoluxProfileAuth(userDataPath)
    const status = getCurrentKoluxProfileAuthStatus(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(status.cloud?.activeOrgId).toBeUndefined()
    expect(status.cloud?.activeOrgName).toBeUndefined()
    expect(status.organizations).toEqual([])
    expect(status.capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 31
    })
  })

  it('requires reconnect when an expired refresh token is rejected', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentKoluxProfile(userDataPath)
    refreshKoluxCloudSessionMock.mockRejectedValue(new KoluxCloudRequestErrorMock(401))

    const result = await refreshCurrentKoluxProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })
})
