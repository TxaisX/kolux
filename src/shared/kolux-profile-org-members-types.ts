// Why: split out of kolux-profiles.ts to keep that file under the max-lines budget.

// Why: organization roles are a fixed server-side enum; the desktop UI mirrors
// exactly these three so role selects can't drift from what the API accepts.
export type KoluxOrgRole = 'owner' | 'admin' | 'member'

export type KoluxOrgMember = {
  // Why: null for teammates provisioned server-side who never signed into Kolux;
  // mutation actions are disabled for them since the API keys on a real userId.
  userId: string | null
  email: string
  displayName?: string
  role: KoluxOrgRole
}

export type KoluxOrgPendingInvite = {
  email: string
  role: KoluxOrgRole
  createdAt: number
}

export type KoluxOrgMembersRoster = {
  members: KoluxOrgMember[]
  pendingInvites: KoluxOrgPendingInvite[]
  viewerRole: KoluxOrgRole
  canManageMembers: boolean
}

export type KoluxProfileOrgMembersListArgs = {
  orgId: string
}

export type KoluxProfileOrgMemberInviteArgs = {
  orgId: string
  email: string
  role: KoluxOrgRole
}

export type KoluxProfileOrgInviteRevokeArgs = {
  orgId: string
  email: string
}

export type KoluxProfileOrgMemberChangeRoleArgs = {
  orgId: string
  userId: string
  role: KoluxOrgRole
}

export type KoluxProfileOrgMemberRemoveArgs = {
  orgId: string
  userId: string
}

export type KoluxProfileOrgMembersListResult =
  | { status: 'ok'; roster: KoluxOrgMembersRoster }
  | { status: 'unconfigured' | 'reconnect-required' }
  | { status: 'failed'; error: string }

export type KoluxOrgInviteConflictReason = 'already_member' | 'already_invited'
export type KoluxOrgMutationInvalidReason = 'cannot_change_own_role' | 'cannot_remove_self'

export type KoluxProfileOrgMemberMutationResult =
  | { status: 'ok' }
  | { status: 'unconfigured' | 'reconnect-required' | 'forbidden' | 'not-found' }
  | { status: 'conflict'; reason: KoluxOrgInviteConflictReason }
  | { status: 'invalid'; reason: KoluxOrgMutationInvalidReason }
  | { status: 'failed'; error: string }
