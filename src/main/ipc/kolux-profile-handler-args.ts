/**
 * Argument parsing/validation for the `koluxProfiles:*` IPC handlers, split out of
 * `kolux-profiles.ts` to stay under the file's line budget. Pure move, no behaviour change.
 */
import type {
  CreateCloudLinkedKoluxProfileArgs,
  FindKoluxProfileProjectsByPathArgs,
  SelectKoluxProfileOrgArgs,
  SwitchKoluxProfileArgs,
  TransferKoluxProfileProjectArgs
} from '../../shared/kolux-profiles'
import { normalizeExecutionHostId } from '../../shared/execution-host'

export function profileIdFromArgs(args: unknown): string {
  if (
    !args ||
    typeof args !== 'object' ||
    typeof (args as SwitchKoluxProfileArgs).profileId !== 'string'
  ) {
    throw new Error('invalid_kolux_profile_id')
  }
  const profileId = (args as SwitchKoluxProfileArgs).profileId.trim()
  if (!profileId) {
    throw new Error('invalid_kolux_profile_id')
  }
  return profileId
}

export function transferProjectArgsFromUnknown(args: unknown): TransferKoluxProfileProjectArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_kolux_profile_project_transfer')
  }
  const candidate = args as TransferKoluxProfileProjectArgs
  const sourceProfileId = candidate.sourceProfileId?.trim()
  const targetProfileId = candidate.targetProfileId?.trim()
  const repoId = candidate.repoId?.trim()
  const mode = candidate.mode
  if (!sourceProfileId || !targetProfileId || !repoId || (mode !== 'move' && mode !== 'copy')) {
    throw new Error('invalid_kolux_profile_project_transfer')
  }
  return {
    sourceProfileId,
    targetProfileId,
    repoId,
    mode
  }
}

export function findProjectsByPathArgsFromUnknown(
  args: unknown
): FindKoluxProfileProjectsByPathArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_kolux_profile_project_path')
  }
  const candidate = args as FindKoluxProfileProjectsByPathArgs
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) {
    throw new Error('invalid_kolux_profile_project_path')
  }
  let executionHostId: FindKoluxProfileProjectsByPathArgs['executionHostId'] = null
  if (candidate.executionHostId !== null && candidate.executionHostId !== undefined) {
    if (typeof candidate.executionHostId !== 'string') {
      throw new Error('invalid_kolux_profile_project_path')
    }
    executionHostId = normalizeExecutionHostId(candidate.executionHostId)
    if (!executionHostId) {
      throw new Error('invalid_kolux_profile_project_path')
    }
  }
  return {
    path,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() || null : null,
    executionHostId,
    excludeProfileId:
      typeof candidate.excludeProfileId === 'string'
        ? candidate.excludeProfileId.trim() || null
        : null
  }
}

export function orgIdFromUnknown(args: unknown): string {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_kolux_profile_org_selection')
  }
  const orgId = (args as SelectKoluxProfileOrgArgs).orgId?.trim()
  if (!orgId) {
    throw new Error('invalid_kolux_profile_org_selection')
  }
  return orgId
}

export function createCloudLinkedProfileArgsFromUnknown(
  args: unknown
): CreateCloudLinkedKoluxProfileArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }
  const candidate = args as CreateCloudLinkedKoluxProfileArgs
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId.trim() : undefined
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : undefined
  return {
    ...(orgId ? { orgId } : {}),
    ...(name ? { name } : {})
  }
}
