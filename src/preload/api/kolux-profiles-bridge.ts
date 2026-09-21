import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import { KOLUX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL } from '../../shared/kolux-profiles'

export const koluxProfilesApi = {
  list: () => ipcRenderer.invoke('koluxProfiles:list'),
  authStatus: () => ipcRenderer.invoke('koluxProfiles:authStatus'),
  onAuthStatusChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(KOLUX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(KOLUX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
  },
  createLocal: (args) => ipcRenderer.invoke('koluxProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('koluxProfiles:createCloudLinked', args),
  switchProfile: (args) => ipcRenderer.invoke('koluxProfiles:switch', args),
  transferProject: (args) => ipcRenderer.invoke('koluxProfiles:transferProject', args),
  findProjectProfiles: (args) => ipcRenderer.invoke('koluxProfiles:findProjectProfiles', args),
  connectCurrent: () => ipcRenderer.invoke('koluxProfiles:connectCurrent'),
  refreshAuth: () => ipcRenderer.invoke('koluxProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('koluxProfiles:signOutCurrent'),
  selectOrg: (args) => ipcRenderer.invoke('koluxProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('koluxProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('koluxProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('koluxProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('koluxProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('koluxProfiles:orgMemberRemove', args)
} satisfies PreloadApi['koluxProfiles']
