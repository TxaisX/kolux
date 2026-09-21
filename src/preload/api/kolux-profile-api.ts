import type {
  ConnectCurrentKoluxProfileResult,
  CreateCloudLinkedKoluxProfileArgs,
  CreateCloudLinkedKoluxProfileResult,
  CreateLocalKoluxProfileArgs,
  CreateLocalKoluxProfileResult,
  FindKoluxProfileProjectsByPathArgs,
  FindKoluxProfileProjectsByPathResult,
  KoluxProfileAuthStatus,
  KoluxProfileListResult,
  KoluxProfileOrgInviteRevokeArgs,
  KoluxProfileOrgMemberChangeRoleArgs,
  KoluxProfileOrgMemberInviteArgs,
  KoluxProfileOrgMemberMutationResult,
  KoluxProfileOrgMemberRemoveArgs,
  KoluxProfileOrgMembersListArgs,
  KoluxProfileOrgMembersListResult,
  RefreshCurrentKoluxProfileAuthResult,
  SelectKoluxProfileOrgArgs,
  SelectKoluxProfileOrgResult,
  SignOutCurrentKoluxProfileResult,
  SwitchKoluxProfileArgs,
  SwitchKoluxProfileResult,
  TransferKoluxProfileProjectArgs,
  TransferKoluxProfileProjectResult
} from '../../shared/kolux-profiles'

export type KoluxProfileApi = {
  list: () => Promise<KoluxProfileListResult>
  authStatus: () => Promise<KoluxProfileAuthStatus>
  /** Fires when main changed the stored auth status on its own (e.g. a revoked session). */
  onAuthStatusChanged: (callback: () => void) => () => void
  createLocal: (args?: CreateLocalKoluxProfileArgs) => Promise<CreateLocalKoluxProfileResult>
  createCloudLinked: (
    args?: CreateCloudLinkedKoluxProfileArgs
  ) => Promise<CreateCloudLinkedKoluxProfileResult>
  switchProfile: (args: SwitchKoluxProfileArgs) => Promise<SwitchKoluxProfileResult>
  transferProject: (
    args: TransferKoluxProfileProjectArgs
  ) => Promise<TransferKoluxProfileProjectResult>
  findProjectProfiles: (
    args: FindKoluxProfileProjectsByPathArgs
  ) => Promise<FindKoluxProfileProjectsByPathResult>
  connectCurrent: () => Promise<ConnectCurrentKoluxProfileResult>
  refreshAuth: () => Promise<RefreshCurrentKoluxProfileAuthResult>
  signOutCurrent: () => Promise<SignOutCurrentKoluxProfileResult>
  selectOrg: (args: SelectKoluxProfileOrgArgs) => Promise<SelectKoluxProfileOrgResult>
  orgMembersList: (
    args: KoluxProfileOrgMembersListArgs
  ) => Promise<KoluxProfileOrgMembersListResult>
  orgMemberInvite: (
    args: KoluxProfileOrgMemberInviteArgs
  ) => Promise<KoluxProfileOrgMemberMutationResult>
  orgInviteRevoke: (
    args: KoluxProfileOrgInviteRevokeArgs
  ) => Promise<KoluxProfileOrgMemberMutationResult>
  orgMemberChangeRole: (
    args: KoluxProfileOrgMemberChangeRoleArgs
  ) => Promise<KoluxProfileOrgMemberMutationResult>
  orgMemberRemove: (
    args: KoluxProfileOrgMemberRemoveArgs
  ) => Promise<KoluxProfileOrgMemberMutationResult>
}
