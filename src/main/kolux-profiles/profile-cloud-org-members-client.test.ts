import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KoluxCloudAuthConfig } from './profile-cloud-auth-config'
import type { KoluxCloudSession } from './profile-cloud-session-store'
import { KoluxCloudRequestError } from './profile-cloud-client'
import {
  changeKoluxCloudOrgMemberRole,
  inviteKoluxCloudOrgMember,
  listKoluxCloudOrgMembers,
  removeKoluxCloudOrgMember,
  revokeKoluxCloudOrgInvite
} from './profile-cloud-org-members-client'

const fetchMock = vi.fn()

const config: KoluxCloudAuthConfig = {
  apiBaseUrl: 'https://kolux-cloud.example',
  authorizeEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/authorize',
  sessionEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/session',
  refreshEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/refresh',
  capabilitiesEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/capabilities',
  profileEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/profile',
  orgEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/org',
  logoutEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/logout',
  relayTokenEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/relay-token',
  relayDirectorUrl: 'https://relay.example',
  clientId: 'desktop-client',
  scope: 'openid profile email offline_access'
}

const session: KoluxCloudSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 999,
  capabilities: { flags: {}, refreshedAt: 1 }
}

function mockJsonResponse(value: unknown, init: { ok?: boolean; status?: number } = {}): void {
  fetchMock.mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => value
  })
}

describe('Kolux cloud org members client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('normalizes the roster, dropping malformed rows and defaulting the viewer role', async () => {
    mockJsonResponse({
      members: [
        { userId: 'user-1', email: 'nina@example.com', displayName: 'Nina', role: 'admin' },
        { userId: null, email: 'pending-user@example.com', role: 'member' },
        { userId: 'user-3', email: 'weird@example.com', role: 'superadmin' },
        { userId: 'user-4' }
      ],
      pendingInvites: [{ email: 'invitee@example.com', role: 'member', createdAt: 1712000000000 }],
      viewerRole: 'not-a-role',
      canManageMembers: true
    })

    await expect(listKoluxCloudOrgMembers(config, session, 'org-1')).resolves.toEqual({
      members: [
        { userId: 'user-1', email: 'nina@example.com', displayName: 'Nina', role: 'admin' },
        { userId: null, email: 'pending-user@example.com', displayName: undefined, role: 'member' },
        { userId: 'user-3', email: 'weird@example.com', displayName: undefined, role: 'member' }
      ],
      pendingInvites: [{ email: 'invitee@example.com', role: 'member', createdAt: 1712000000000 }],
      viewerRole: 'member',
      canManageMembers: true
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kolux-cloud.example/v1/desktop/orgs/org-1/members',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer access-token' })
      })
    )
  })

  it('percent-encodes the org id in the request URL', async () => {
    mockJsonResponse({
      members: [],
      pendingInvites: [],
      viewerRole: 'owner',
      canManageMembers: true
    })
    await listKoluxCloudOrgMembers(config, session, 'org/with space')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kolux-cloud.example/v1/desktop/orgs/org%2Fwith%20space/members',
      expect.any(Object)
    )
  })

  it('posts invites with an email and role body', async () => {
    mockJsonResponse({ ok: true })
    await inviteKoluxCloudOrgMember(config, session, {
      orgId: 'org-1',
      email: 'new@example.com',
      role: 'admin'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kolux-cloud.example/v1/desktop/orgs/org-1/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', role: 'admin' })
      })
    )
  })

  it('carries the server error code on a 409 conflict', async () => {
    mockJsonResponse({ error: 'already_invited' }, { ok: false, status: 409 })
    await expect(
      inviteKoluxCloudOrgMember(config, session, {
        orgId: 'org-1',
        email: 'dupe@example.com',
        role: 'member'
      })
    ).rejects.toMatchObject({ statusCode: 409, errorCode: 'already_invited' })
  })

  it('surfaces a 403 as a KoluxCloudRequestError without an error code when the body is empty', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => {
        throw new Error('no body')
      }
    })
    await expect(
      changeKoluxCloudOrgMemberRole(config, session, {
        orgId: 'org-1',
        userId: 'user-2',
        role: 'admin'
      })
    ).rejects.toBeInstanceOf(KoluxCloudRequestError)
    await expect(
      removeKoluxCloudOrgMember(config, session, { orgId: 'org-1', userId: 'user-2' })
    ).rejects.toMatchObject({ statusCode: 403, errorCode: undefined })
  })

  it('posts invite revocations by email', async () => {
    mockJsonResponse({ ok: true })
    await revokeKoluxCloudOrgInvite(config, session, {
      orgId: 'org-1',
      email: 'gone@example.com'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kolux-cloud.example/v1/desktop/orgs/org-1/invites/revoke',
      expect.objectContaining({ body: JSON.stringify({ email: 'gone@example.com' }) })
    )
  })
})
