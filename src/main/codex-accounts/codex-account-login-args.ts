// Managed accounts require separate auth.json files even when the user's default uses a keyring.
export const CODEX_ACCOUNT_LOGIN_ARGS = [
  'login',
  '-c',
  'cli_auth_credentials_store="file"'
] as const
