export function getKoluxCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'kolux-ide'
  }
  if (platform === 'win32') {
    return 'kolux.cmd'
  }
  return 'kolux'
}
