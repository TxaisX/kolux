import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KoluxOrgMembersRoster } from '../../shared/kolux-profiles'
import { KoluxCloudRequestError } from './profile-cloud-client'

const {
  runWithFreshKoluxCloudSessionMock,
  listKoluxCloudOrgMembersMock,
  inviteKoluxCloudOrgMemberMock,
  revokeKoluxCloudOrgInviteMock,
  changeKoluxCloudOrgMemberRoleMock,
  removeKoluxCloudOrgMemberMock
} = vi.hoisted(() => ({
  runWithFreshKoluxCloudSessionMock: vi.fn(),
  listKoluxCloudOrgMembersMock: vi.fn(),
  inviteKoluxCloudOrgMemberMock: vi.fn(),
  revokeKoluxCloudOrgInviteMock: vi.fn(),
  changeKoluxCloudOrgMemberRoleMock: vi.fn(),
  removeKoluxCloudOrgMemberMock: vi.fn()
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

vi.mock('./profile-cloud-session-refresh', () => ({
  runWithFreshKoluxCloudSessionMock,
  runWithFreshKoluxCloudSession: runWithFreshKoluxCloudSessionMock
}))

vi.mock('./profile-cloud-org-members-client', () => ({
  listKoluxCloudOrgMembers: listKoluxCloudOrgMembersMock,
  inviteKoluxCloudOrgMember: inviteKoluxCloudOrgMemberMock,
  revokeKoluxCloudOrgInvite: revokeKoluxCloudOrgInviteMock,
  changeKoluxCloudOrgMemberRole: changeKoluxCloudOrgMemberRoleMock,
  removeKoluxCloudOrgMember: removeKoluxCloudOrgMemberMock
}))

import {
  changeKoluxProfileOrgMemberRole,
  inviteKoluxProfileOrgMember,
  listKoluxProfileOrgMembers,
  removeKoluxProfileOrgMember,
  revokeKoluxProfileOrgInvite
} from './profile-cloud-org-members-service'

const fakeSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3_600_000,
  capabilities: { flags: {}, refreshedAt: 1 }
}

// Why: mirror the real contract — invoke the operation with a live session and
// surface its resolved value; business 4xx are returned by the operation as
// values, never thrown, so the session layer never sees them.
function runOperationDirectly(): void {
  runWithFreshKoluxCloudSessionMock.mockImplementation(
    async (
      _config: unknown,
      _active: unknown,
      _path: unknown,
      op: (session: unknown) => unknown
    ) => ({
      status: 'ok',
      value: await op(fakeSession)
    })
  )
}

function configureCloudEnv(): void {
  vi.stubEnv('KOLUX_CLOUD_API_URL', 'https://kolux-cloud.example')
  vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', 'desktop-client')
}

const roster: KoluxOrgMembersRoster = {
  members: [{ userId: 'user-1', email: 'nina@example.com', role: 'owner' }],
  pendingInvites: [],
  viewerRole: 'owner',
  canManageMembers: true
}

describe('Kolux cloud org members service (configured)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'kolux-org-members-'))
    runWithFreshKoluxCloudSessionMock.mockReset()
    listKoluxCloudOrgMembersMock.mockReset()
    inviteKoluxCloudOrgMemberMock.mockReset()
    revokeKoluxCloudOrgInviteMock.mockReset()
    changeKoluxCloudOrgMemberRoleMock.mockReset()
    removeKoluxCloudOrgMemberMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('KOLUX_CLOUD_DEV_AUTH', '')
    vi.stubEnv('KOLUX_CLOUD_API_URL', '')
    vi.stubEnv('KOLUX_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports unconfigured when cloud sign-in is not set up', async () => {
    await expect(listKoluxProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'unconfigured'
    })
    expect(runWithFreshKoluxCloudSessionMock).not.toHaveBeenCalled()
  })

  it('returns the roster from the client', async () => {
    configureCloudEnv()
    runOperationDirectly()
    listKoluxCloudOrgMembersMock.mockResolvedValue(roster)

    await expect(listKoluxProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'ok',
      roster
    })
    expect(listKoluxCloudOrgMembersMock).toHaveBeenCalledWith(
      expect.any(Object),
      fakeSession,
      'org-1'
    )
  })

  it('maps a 409 already_member invite conflict', async () => {
    configureCloudEnv()
    runOperationDirectly()
    inviteKoluxCloudOrgMemberMock.mockRejectedValue(
      new KoluxCloudRequestError(409, 'already_member')
    )

    await expect(
      inviteKoluxProfileOrgMember(userDataPath, {
        orgId: 'org-1',
        email: 'a@b.com',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_member' })
  })

  it('maps a 403 role change to forbidden', async () => {
    configureCloudEnv()
    runOperationDirectly()
    changeKoluxCloudOrgMemberRoleMock.mockRejectedValue(new KoluxCloudRequestError(403))

    await expect(
      changeKoluxProfileOrgMemberRole(userDataPath, {
        orgId: 'org-1',
        userId: 'user-2',
        role: 'admin'
      })
    ).resolves.toEqual({ status: 'forbidden' })
  })

  it('maps a 400 cannot_remove_self to an invalid result', async () => {
    configureCloudEnv()
    runOperationDirectly()
    removeKoluxCloudOrgMemberMock.mockRejectedValue(
      new KoluxCloudRequestError(400, 'cannot_remove_self')
    )

    await expect(
      removeKoluxProfileOrgMember(userDataPath, { orgId: 'org-1', userId: 'user-1' })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_remove_self' })
  })

  it('maps a 404 revoke to not-found', async () => {
    configureCloudEnv()
    runOperationDirectly()
    revokeKoluxCloudOrgInviteMock.mockRejectedValue(new KoluxCloudRequestError(404))

    await expect(
      revokeKoluxProfileOrgInvite(userDataPath, { orgId: 'org-1', email: 'gone@b.com' })
    ).resolves.toEqual({ status: 'not-found' })
  })

  it('reports reconnect-required when the session layer cannot refresh', async () => {
    configureCloudEnv()
    runWithFreshKoluxCloudSessionMock.mockResolvedValue({ status: 'reconnect-required' })

    await expect(listKoluxProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'reconnect-required'
    })
  })
})

describe('Kolux cloud org members service (dev auth)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'kolux-org-members-dev-'))
    runWithFreshKoluxCloudSessionMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('KOLUX_CLOUD_DEV_AUTH', '1')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('serves an in-memory roster the caller can manage', async () => {
    const result = await listKoluxProfileOrgMembers(userDataPath, 'dev-list-org')
    if (result.status !== 'ok') {
      throw new Error(`Expected ok, got ${result.status}`)
    }
    expect(result.roster.canManageMembers).toBe(true)
    expect(result.roster.viewerRole).toBe('owner')
    expect(result.roster.members[0]).toMatchObject({ role: 'owner' })
    expect(result.roster.members.some((member) => member.userId === null)).toBe(true)
    expect(result.roster.pendingInvites.length).toBeGreaterThan(0)
    expect(runWithFreshKoluxCloudSessionMock).not.toHaveBeenCalled()
  })

  it('mutates the dev roster across invite and revoke', async () => {
    const orgId = 'dev-mutate-org'
    await expect(
      inviteKoluxProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@kolux.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'ok' })

    const afterInvite = await listKoluxProfileOrgMembers(userDataPath, orgId)
    if (afterInvite.status !== 'ok') {
      throw new Error('expected ok')
    }
    expect(afterInvite.roster.pendingInvites.some((i) => i.email === 'fresh@kolux.local')).toBe(
      true
    )

    await expect(
      inviteKoluxProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@kolux.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_invited' })

    await expect(
      revokeKoluxProfileOrgInvite(userDataPath, { orgId, email: 'fresh@kolux.local' })
    ).resolves.toEqual({ status: 'ok' })
    await expect(
      revokeKoluxProfileOrgInvite(userDataPath, { orgId, email: 'fresh@kolux.local' })
    ).resolves.toEqual({ status: 'not-found' })
  })

  it('blocks changing the dev owner (self) role', async () => {
    const orgId = 'dev-self-org'
    const list = await listKoluxProfileOrgMembers(userDataPath, orgId)
    if (list.status !== 'ok') {
      throw new Error('expected ok')
    }
    const self = list.roster.members.find((member) => member.role === 'owner')
    await expect(
      changeKoluxProfileOrgMemberRole(userDataPath, {
        orgId,
        userId: self?.userId ?? 'dev-user',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_change_own_role' })
  })
})
