import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  listKoluxProfileOrgMembersMock,
  inviteKoluxProfileOrgMemberMock,
  revokeKoluxProfileOrgInviteMock,
  changeKoluxProfileOrgMemberRoleMock,
  removeKoluxProfileOrgMemberMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  listKoluxProfileOrgMembersMock: vi.fn(),
  inviteKoluxProfileOrgMemberMock: vi.fn(),
  revokeKoluxProfileOrgInviteMock: vi.fn(),
  changeKoluxProfileOrgMemberRoleMock: vi.fn(),
  removeKoluxProfileOrgMemberMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../kolux-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/tmp/kolux-user-data'
}))

vi.mock('../kolux-profiles/profile-cloud-org-members-service', () => ({
  listKoluxProfileOrgMembers: listKoluxProfileOrgMembersMock,
  inviteKoluxProfileOrgMember: inviteKoluxProfileOrgMemberMock,
  revokeKoluxProfileOrgInvite: revokeKoluxProfileOrgInviteMock,
  changeKoluxProfileOrgMemberRole: changeKoluxProfileOrgMemberRoleMock,
  removeKoluxProfileOrgMember: removeKoluxProfileOrgMemberMock
}))

import { registerKoluxProfileOrgMemberHandlers } from './kolux-profile-org-members-handlers'

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler for ${channel}`)
  }
  return handler({}, args)
}

describe('registerKoluxProfileOrgMemberHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    listKoluxProfileOrgMembersMock.mockReset().mockResolvedValue({ status: 'ok', roster: {} })
    inviteKoluxProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    revokeKoluxProfileOrgInviteMock.mockReset().mockResolvedValue({ status: 'ok' })
    changeKoluxProfileOrgMemberRoleMock.mockReset().mockResolvedValue({ status: 'ok' })
    removeKoluxProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    registerKoluxProfileOrgMemberHandlers()
  })

  it('registers all five org-member channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'koluxProfiles:orgInviteRevoke',
        'koluxProfiles:orgMemberChangeRole',
        'koluxProfiles:orgMemberInvite',
        'koluxProfiles:orgMemberRemove',
        'koluxProfiles:orgMembersList'
      ].sort()
    )
  })

  it('forwards a valid invite to the service with a trimmed email', async () => {
    await invoke('koluxProfiles:orgMemberInvite', {
      orgId: 'org-1',
      email: '  new@example.com  ',
      role: 'admin'
    })
    expect(inviteKoluxProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/kolux-user-data', {
      orgId: 'org-1',
      email: 'new@example.com',
      role: 'admin'
    })
  })

  it('rejects an invite with a missing org id', async () => {
    await expect(
      invoke('koluxProfiles:orgMemberInvite', { email: 'a@b.com', role: 'member' })
    ).rejects.toThrow('invalid_kolux_profile_org_selection')
    expect(inviteKoluxProfileOrgMemberMock).not.toHaveBeenCalled()
  })

  it('rejects an invite with an unknown role', async () => {
    await expect(
      invoke('koluxProfiles:orgMemberInvite', {
        orgId: 'org-1',
        email: 'a@b.com',
        role: 'root'
      })
    ).rejects.toThrow('invalid_kolux_org_role')
  })

  it('rejects a role change with a blank user id', async () => {
    await expect(
      invoke('koluxProfiles:orgMemberChangeRole', {
        orgId: 'org-1',
        userId: '  ',
        role: 'admin'
      })
    ).rejects.toThrow('invalid_kolux_org_member_user')
  })

  it('forwards remove and revoke with validated args', async () => {
    await invoke('koluxProfiles:orgMemberRemove', { orgId: 'org-1', userId: 'user-2' })
    expect(removeKoluxProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/kolux-user-data', {
      orgId: 'org-1',
      userId: 'user-2'
    })
    await invoke('koluxProfiles:orgInviteRevoke', { orgId: 'org-1', email: 'gone@b.com' })
    expect(revokeKoluxProfileOrgInviteMock).toHaveBeenCalledWith('/tmp/kolux-user-data', {
      orgId: 'org-1',
      email: 'gone@b.com'
    })
  })
})
