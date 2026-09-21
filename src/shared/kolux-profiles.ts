import { KOLUX_BROWSER_PARTITION } from './constants'
import type { ExecutionHostId } from './execution-host'

export const KOLUX_PROFILE_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_LOCAL_KOLUX_PROFILE_ID = 'local-default'
export const DEFAULT_LOCAL_KOLUX_PROFILE_NAME = 'Personal'
/** Main -> renderer push when the stored auth status changed without the renderer asking. */
export const KOLUX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL = 'koluxProfiles:authStatusChanged'
const LEGACY_KOLUX_BROWSER_SESSION_PARTITION_PREFIX = 'persist:kolux-browser-session-'

export type KoluxProfileAvatar = {
  kind: 'initials'
  initials: string
  color: 'neutral'
}

export type KoluxProfileKind = 'local' | 'cloud-linked'

export type KoluxProfileCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type KoluxCloudOrgSummary = {
  orgId: string
  name: string
  role?: string
}

export type KoluxCloudCapabilityFlags = Record<string, boolean>

export type KoluxCloudCapabilities = {
  flags: KoluxCloudCapabilityFlags
  refreshedAt: number
}

export type KoluxCloudSessionPersistence = 'none' | 'encrypted' | 'memory-only' | 'dev-plaintext'

export type KoluxProfileAuthState = 'local' | 'unconfigured' | 'connected' | 'reconnect-required'

export type KoluxProfileAuthStatus = {
  activeProfileId: string
  configured: boolean
  state: KoluxProfileAuthState
  persistence: KoluxCloudSessionPersistence
  cloud?: KoluxProfileCloudSummary
  organizations?: KoluxCloudOrgSummary[]
  capabilities?: KoluxCloudCapabilities
  credentialError?: string
  setupMessage?: string
}

export type KoluxProfileSummary = {
  id: string
  name: string
  avatar: KoluxProfileAvatar
  kind: KoluxProfileKind
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  cloud?: KoluxProfileCloudSummary
}

export type KoluxProfileIndex = {
  schemaVersion: number
  activeProfileId: string
  profiles: KoluxProfileSummary[]
}

export type KoluxProfileListState = {
  activeProfileId: string
  profiles: KoluxProfileSummary[]
}

export type KoluxProfileListResult = KoluxProfileListState & {
  // Why: gates the full multi-profile switcher UI; default builds show a
  // single-profile account menu instead.
  multiProfileUi: boolean
}

export type CreateLocalKoluxProfileArgs = {
  name?: string
}

export type CreateLocalKoluxProfileResult = KoluxProfileListState & {
  profile: KoluxProfileSummary
}

export type CreateCloudLinkedKoluxProfileArgs = {
  orgId?: string
  name?: string
}

export type SwitchKoluxProfileArgs = {
  profileId: string
}

export type SwitchKoluxProfileResult = {
  status: 'already-active' | 'relaunching'
}

export type TransferKoluxProfileProjectMode = 'move' | 'copy'

export type TransferKoluxProfileProjectArgs = {
  sourceProfileId: string
  targetProfileId: string
  repoId: string
  mode: TransferKoluxProfileProjectMode
}

export type FindKoluxProfileProjectsByPathArgs = {
  path: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  excludeProfileId?: string | null
}

export type KoluxProfileProjectPresence = {
  profileId: string
  profileName: string
  profileKind: KoluxProfileKind
  repoId: string
  repoName: string
}

export type FindKoluxProfileProjectsByPathResult = {
  projects: KoluxProfileProjectPresence[]
}

export type TransferKoluxProfileProjectResult =
  | {
      status: 'transferred'
      mode: TransferKoluxProfileProjectMode
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      targetRepoId: string
      targetProjectId: string | null
      willRelaunch?: boolean
    }
  | {
      status: 'duplicate-target'
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      duplicateRepoId: string
    }

export type ConnectCurrentKoluxProfileResult =
  | {
      status: 'connected'
      auth: KoluxProfileAuthStatus
      activeProfileId: string
      profiles: KoluxProfileSummary[]
    }
  | {
      status: 'unconfigured'
      auth: KoluxProfileAuthStatus
    }
  | {
      status: 'cancelled'
      auth: KoluxProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: KoluxProfileAuthStatus
      error: string
    }

export type CreateCloudLinkedKoluxProfileResult =
  | {
      status: 'created'
      auth: KoluxProfileAuthStatus
      activeProfileId: string
      profiles: KoluxProfileSummary[]
      profile: KoluxProfileSummary
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: KoluxProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: KoluxProfileAuthStatus
      error: string
    }

export type SignOutCurrentKoluxProfileResult = {
  status: 'signed-out'
  auth: KoluxProfileAuthStatus
  activeProfileId: string
  profiles: KoluxProfileSummary[]
}

export type SelectKoluxProfileOrgArgs = {
  orgId: string
}

export type SelectKoluxProfileOrgResult =
  | {
      status: 'selected'
      auth: KoluxProfileAuthStatus
      activeProfileId: string
      profiles: KoluxProfileSummary[]
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: KoluxProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: KoluxProfileAuthStatus
      error: string
    }

export type RefreshCurrentKoluxProfileAuthResult =
  | {
      status: 'refreshed'
      auth: KoluxProfileAuthStatus
      activeProfileId: string
      profiles: KoluxProfileSummary[]
    }
  | {
      status: 'local' | 'unconfigured' | 'reconnect-required'
      auth: KoluxProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: KoluxProfileAuthStatus
      error: string
    }

// Why: split into a sibling file to keep this file under the max-lines budget.
export type {
  KoluxOrgRole,
  KoluxOrgMember,
  KoluxOrgPendingInvite,
  KoluxOrgMembersRoster,
  KoluxProfileOrgMembersListArgs,
  KoluxProfileOrgMemberInviteArgs,
  KoluxProfileOrgInviteRevokeArgs,
  KoluxProfileOrgMemberChangeRoleArgs,
  KoluxProfileOrgMemberRemoveArgs,
  KoluxProfileOrgMembersListResult,
  KoluxOrgInviteConflictReason,
  KoluxOrgMutationInvalidReason,
  KoluxProfileOrgMemberMutationResult
} from './kolux-profile-org-members-types'

export function createDefaultLocalKoluxProfile(now: number): KoluxProfileSummary {
  return {
    id: DEFAULT_LOCAL_KOLUX_PROFILE_ID,
    name: DEFAULT_LOCAL_KOLUX_PROFILE_NAME,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

function profilePartitionHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getKoluxProfileBrowserPartitionSegment(profileId: string): string {
  const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'profile'
  return `${safe}-${profilePartitionHash(profileId)}`
}

export function getKoluxProfileBrowserDefaultPartition(profileId: string): string {
  if (profileId === DEFAULT_LOCAL_KOLUX_PROFILE_ID) {
    return KOLUX_BROWSER_PARTITION
  }
  return `persist:kolux-profile-${getKoluxProfileBrowserPartitionSegment(profileId)}-browser-default`
}

export function getKoluxProfileBrowserSessionPartition(
  profileId: string,
  browserSessionProfileId: string
): string {
  if (profileId === DEFAULT_LOCAL_KOLUX_PROFILE_ID) {
    return `${LEGACY_KOLUX_BROWSER_SESSION_PARTITION_PREFIX}${browserSessionProfileId}`
  }
  return `persist:kolux-profile-${getKoluxProfileBrowserPartitionSegment(
    profileId
  )}-browser-session-${browserSessionProfileId}`
}
