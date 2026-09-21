import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  beginKoluxCloudPkceFlowMock,
  exchangeKoluxCloudAuthCodeMock,
  revokeKoluxCloudSessionMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginKoluxCloudPkceFlowMock: vi.fn(),
  exchangeKoluxCloudAuthCodeMock: vi.fn(),
  revokeKoluxCloudSessionMock: vi.fn(),
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
  createKoluxCloudProfile: vi.fn(),
  exchangeKoluxCloudAuthCode: exchangeKoluxCloudAuthCodeMock,
  refreshKoluxCloudCapabilities: vi.fn(),
  refreshKoluxCloudSession: vi.fn(),
  revokeKoluxCloudSession: revokeKoluxCloudSessionMock,
  selectKoluxCloudOrg: vi.fn()
}))

import {
  connectCurrentKoluxProfile,
  createCloudLinkedKoluxProfile,
  getCurrentKoluxProfileAuthStatus,
  selectCurrentKoluxProfileOrg,
  signOutCurrentKoluxProfile
} from './profile-cloud-service'

describe('Kolux cloud dev auth service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'kolux-cloud-dev-auth-'))
    beginKoluxCloudPkceFlowMock.mockReset()
    exchangeKoluxCloudAuthCodeMock.mockReset()
    revokeKoluxCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('KOLUX_CLOUD_DEV_AUTH', '1')
    vi.stubEnv('KOLUX_CLOUD_API_URL', '')
    vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('connects the active profile without PKCE or cloud endpoints', async () => {
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local'
    })

    const result = await connectCurrentKoluxProfile(userDataPath)

    expect(result.status).toBe('connected')
    expect(beginKoluxCloudPkceFlowMock).not.toHaveBeenCalled()
    expect(exchangeKoluxCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'connected',
      persistence: 'encrypted',
      cloud: {
        cloudProfileId: 'dev-cloud-local-default',
        email: 'dev@kolux.local'
      },
      capabilities: {
        flags: expect.objectContaining({ 'share.create': true })
      }
    })
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).organizations).toHaveLength(2)
  })

  it('selects dev organizations and creates org-scoped cloud profiles locally', async () => {
    await connectCurrentKoluxProfile(userDataPath)

    const selected = await selectCurrentKoluxProfileOrg(userDataPath, 'dev-acme')
    const created = await createCloudLinkedKoluxProfile(userDataPath, {
      orgId: 'dev-acme',
      name: 'Acme Dev'
    })

    expect(selected.status).toBe('selected')
    expect(getCurrentKoluxProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'dev-acme',
      activeOrgName: 'Acme Dev'
    })
    expect(created.status).toBe('created')
    if (created.status === 'created') {
      expect(created.profile).toMatchObject({
        name: 'Acme Dev',
        kind: 'cloud-linked',
        cloud: expect.objectContaining({
          activeOrgId: 'dev-acme',
          activeOrgName: 'Acme Dev'
        })
      })
    }
  })

  it('signs out locally without calling the cloud logout endpoint', async () => {
    await connectCurrentKoluxProfile(userDataPath)

    const result = await signOutCurrentKoluxProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(revokeKoluxCloudSessionMock).not.toHaveBeenCalled()
    expect(getCurrentKoluxProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local',
      persistence: 'none'
    })
  })
})
