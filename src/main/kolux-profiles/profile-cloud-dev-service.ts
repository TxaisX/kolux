import type {
  CreateCloudLinkedKoluxProfileArgs,
  KoluxProfileListState
} from '../../shared/kolux-profiles'
import type { ActiveKoluxProfileState } from './profile-index-store'
import { createCloudLinkedKoluxProfileRecord, linkKoluxProfileToCloud } from './profile-cloud-index'
import { readKoluxCloudSession, saveKoluxCloudSessionExchange } from './profile-cloud-session-store'
import { createDevKoluxCloudSession } from './profile-cloud-dev-auth'

type DevProfileListResult = KoluxProfileListState

type DevCreateProfileResult =
  | {
      status: 'created'
      list: ReturnType<typeof createCloudLinkedKoluxProfileRecord>
    }
  | { status: 'reconnect-required' }

type DevMutationResult =
  | {
      status: 'updated'
      list: DevProfileListResult
    }
  | { status: 'reconnect-required' }

export function connectDevKoluxCloudProfile(
  active: ActiveKoluxProfileState,
  userDataPath: string
): DevProfileListResult {
  const session = createDevKoluxCloudSession({ localProfileId: active.profile.id })
  saveKoluxCloudSessionExchange(active.profile.id, userDataPath, session)
  return linkKoluxProfileToCloud(active.profile.id, session.cloud, userDataPath)
}

export function createDevCloudLinkedKoluxProfile(
  active: ActiveKoluxProfileState,
  userDataPath: string,
  args: CreateCloudLinkedKoluxProfileArgs
): DevCreateProfileResult {
  if (readKoluxCloudSession(active.profile.id, userDataPath).status !== 'found') {
    return { status: 'reconnect-required' }
  }
  const session = createDevKoluxCloudSession({ orgId: args.orgId })
  const list = createCloudLinkedKoluxProfileRecord(session.cloud, { name: args.name }, userDataPath)
  saveKoluxCloudSessionExchange(list.profile.id, userDataPath, session)
  return { status: 'created', list }
}

export function refreshDevKoluxCloudProfile(
  active: ActiveKoluxProfileState,
  userDataPath: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readKoluxCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevKoluxCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId: active.profile.cloud.activeOrgId
  })
  saveKoluxCloudSessionExchange(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkKoluxProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}

export function selectDevKoluxCloudOrg(
  active: ActiveKoluxProfileState,
  userDataPath: string,
  orgId: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readKoluxCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevKoluxCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId
  })
  saveKoluxCloudSessionExchange(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkKoluxProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}
