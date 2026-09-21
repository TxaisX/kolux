import { ipcMain } from 'electron'
import type {
  KoluxOrgRole,
  KoluxProfileOrgInviteRevokeArgs,
  KoluxProfileOrgMemberChangeRoleArgs,
  KoluxProfileOrgMemberInviteArgs,
  KoluxProfileOrgMemberMutationResult,
  KoluxProfileOrgMemberRemoveArgs,
  KoluxProfileOrgMembersListArgs,
  KoluxProfileOrgMembersListResult
} from '../../shared/kolux-profiles'
import { getProfileUserDataPath } from '../kolux-profiles/profile-storage-paths'
import {
  changeKoluxProfileOrgMemberRole,
  inviteKoluxProfileOrgMember,
  listKoluxProfileOrgMembers,
  removeKoluxProfileOrgMember,
  revokeKoluxProfileOrgInvite
} from '../kolux-profiles/profile-cloud-org-members-service'

function orgMembersScopedArgs(args: unknown): { orgId: string; record: Record<string, unknown> } {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_kolux_profile_org_selection')
  }
  const record = args as Record<string, unknown>
  const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!orgId) {
    throw new Error('invalid_kolux_profile_org_selection')
  }
  return { orgId, record }
}

function orgRoleFromUnknown(value: unknown): KoluxOrgRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value
  }
  throw new Error('invalid_kolux_org_role')
}

function orgEmailFromUnknown(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''
  if (!email) {
    throw new Error('invalid_kolux_org_member_email')
  }
  return email
}

function orgUserIdFromUnknown(value: unknown): string {
  const userId = typeof value === 'string' ? value.trim() : ''
  if (!userId) {
    throw new Error('invalid_kolux_org_member_user')
  }
  return userId
}

function orgMemberInviteArgsFromUnknown(args: unknown): KoluxProfileOrgMemberInviteArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email), role: orgRoleFromUnknown(record.role) }
}

function orgInviteRevokeArgsFromUnknown(args: unknown): KoluxProfileOrgInviteRevokeArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email) }
}

function orgMemberChangeRoleArgsFromUnknown(args: unknown): KoluxProfileOrgMemberChangeRoleArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return {
    orgId,
    userId: orgUserIdFromUnknown(record.userId),
    role: orgRoleFromUnknown(record.role)
  }
}

function orgMemberRemoveArgsFromUnknown(args: unknown): KoluxProfileOrgMemberRemoveArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, userId: orgUserIdFromUnknown(record.userId) }
}

export function registerKoluxProfileOrgMemberHandlers(): void {
  ipcMain.handle(
    'koluxProfiles:orgMembersList',
    async (
      _event,
      rawArgs: KoluxProfileOrgMembersListArgs
    ): Promise<KoluxProfileOrgMembersListResult> =>
      listKoluxProfileOrgMembers(getProfileUserDataPath(), orgMembersScopedArgs(rawArgs).orgId)
  )

  ipcMain.handle(
    'koluxProfiles:orgMemberInvite',
    async (
      _event,
      rawArgs: KoluxProfileOrgMemberInviteArgs
    ): Promise<KoluxProfileOrgMemberMutationResult> =>
      inviteKoluxProfileOrgMember(getProfileUserDataPath(), orgMemberInviteArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'koluxProfiles:orgInviteRevoke',
    async (
      _event,
      rawArgs: KoluxProfileOrgInviteRevokeArgs
    ): Promise<KoluxProfileOrgMemberMutationResult> =>
      revokeKoluxProfileOrgInvite(getProfileUserDataPath(), orgInviteRevokeArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'koluxProfiles:orgMemberChangeRole',
    async (
      _event,
      rawArgs: KoluxProfileOrgMemberChangeRoleArgs
    ): Promise<KoluxProfileOrgMemberMutationResult> =>
      changeKoluxProfileOrgMemberRole(
        getProfileUserDataPath(),
        orgMemberChangeRoleArgsFromUnknown(rawArgs)
      )
  )

  ipcMain.handle(
    'koluxProfiles:orgMemberRemove',
    async (
      _event,
      rawArgs: KoluxProfileOrgMemberRemoveArgs
    ): Promise<KoluxProfileOrgMemberMutationResult> =>
      removeKoluxProfileOrgMember(getProfileUserDataPath(), orgMemberRemoveArgsFromUnknown(rawArgs))
  )
}
