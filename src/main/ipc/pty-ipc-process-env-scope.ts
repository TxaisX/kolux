// Why: the pty IPC suites force darwin and rewrite a dozen agent-home env vars per test;
// this scope captures the real values once and puts them back afterwards.
export function createPtyIpcProcessEnvScope() {
  const savedOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  const savedKoluxOpenCodeConfigDir = process.env.KOLUX_OPENCODE_CONFIG_DIR
  const savedKoluxOpenCodeSourceConfigDir = process.env.KOLUX_OPENCODE_SOURCE_CONFIG_DIR
  const savedPiAgentDir = process.env.PI_CODING_AGENT_DIR
  const savedKoluxPiAgentDir = process.env.KOLUX_PI_CODING_AGENT_DIR
  const savedKoluxPiSourceAgentDir = process.env.KOLUX_PI_SOURCE_AGENT_DIR
  const savedKoluxCodexHome = process.env.KOLUX_CODEX_HOME
  const savedKoluxOmpAgentDir = process.env.KOLUX_OMP_CODING_AGENT_DIR
  const savedKoluxOmpSourceAgentDir = process.env.KOLUX_OMP_SOURCE_AGENT_DIR
  const savedKoluxOmpStatusExtension = process.env.KOLUX_OMP_STATUS_EXTENSION
  const savedPrimeAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR
  const savedKoluxPrimeAgentSourceDir = process.env.KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR
  const savedKoluxPrimeAgentStatusExtension = process.env.KOLUX_PRIME_AGENT_STATUS_EXTENSION
  const savedKoluxClaudeAgentStatusSettings = process.env.KOLUX_CLAUDE_AGENT_STATUS_SETTINGS
  const savedProcessPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const savedDisableMacosLoginShell = process.env.KOLUX_DISABLE_MACOS_LOGIN_SHELL
  const savedKoluxUserDataPath = process.env.KOLUX_USER_DATA_PATH

  function applyTestEnvDefaults() {
    // Why: most PTY spawn tests assert POSIX shell behavior; Windows cases opt into win32 explicitly below.
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    // Why: forced darwin makes the TCC login(1) wrapper rewrite every asserted argv; its own test below re-enables it.
    process.env.KOLUX_DISABLE_MACOS_LOGIN_SHELL = '1'
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.KOLUX_OPENCODE_SOURCE_CONFIG_DIR
    delete process.env.KOLUX_OPENCODE_CONFIG_DIR
    delete process.env.KOLUX_AGENT_HOOK_ENDPOINT
    delete process.env.KOLUX_CLAUDE_AGENT_STATUS_SETTINGS
    delete process.env.PI_CODING_AGENT_DIR
    delete process.env.KOLUX_PI_SOURCE_AGENT_DIR
    delete process.env.KOLUX_PI_CODING_AGENT_DIR
    delete process.env.KOLUX_CODEX_HOME
    delete process.env.KOLUX_OMP_SOURCE_AGENT_DIR
    delete process.env.KOLUX_OMP_CODING_AGENT_DIR
    delete process.env.KOLUX_OMP_STATUS_EXTENSION
    delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    delete process.env.KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR
    delete process.env.KOLUX_PRIME_AGENT_STATUS_EXTENSION
  }

  function restoreProcessEnv() {
    if (savedProcessPlatform) {
      Object.defineProperty(process, 'platform', savedProcessPlatform)
    }
    if (savedDisableMacosLoginShell !== undefined) {
      process.env.KOLUX_DISABLE_MACOS_LOGIN_SHELL = savedDisableMacosLoginShell
    } else {
      delete process.env.KOLUX_DISABLE_MACOS_LOGIN_SHELL
    }
    if (savedKoluxUserDataPath !== undefined) {
      process.env.KOLUX_USER_DATA_PATH = savedKoluxUserDataPath
    } else {
      delete process.env.KOLUX_USER_DATA_PATH
    }
    if (savedOpenCodeConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = savedOpenCodeConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    if (savedKoluxOpenCodeConfigDir !== undefined) {
      process.env.KOLUX_OPENCODE_CONFIG_DIR = savedKoluxOpenCodeConfigDir
    } else {
      delete process.env.KOLUX_OPENCODE_CONFIG_DIR
    }
    if (savedKoluxOpenCodeSourceConfigDir !== undefined) {
      process.env.KOLUX_OPENCODE_SOURCE_CONFIG_DIR = savedKoluxOpenCodeSourceConfigDir
    } else {
      delete process.env.KOLUX_OPENCODE_SOURCE_CONFIG_DIR
    }
    if (savedPiAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = savedPiAgentDir
    } else {
      delete process.env.PI_CODING_AGENT_DIR
    }
    if (savedKoluxPiAgentDir !== undefined) {
      process.env.KOLUX_PI_CODING_AGENT_DIR = savedKoluxPiAgentDir
    } else {
      delete process.env.KOLUX_PI_CODING_AGENT_DIR
    }
    if (savedKoluxPiSourceAgentDir === undefined) {
      delete process.env.KOLUX_PI_SOURCE_AGENT_DIR
    } else {
      process.env.KOLUX_PI_SOURCE_AGENT_DIR = savedKoluxPiSourceAgentDir
    }
    if (savedKoluxCodexHome === undefined) {
      delete process.env.KOLUX_CODEX_HOME
    } else {
      process.env.KOLUX_CODEX_HOME = savedKoluxCodexHome
    }
    if (savedKoluxOmpAgentDir !== undefined) {
      process.env.KOLUX_OMP_CODING_AGENT_DIR = savedKoluxOmpAgentDir
    } else {
      delete process.env.KOLUX_OMP_CODING_AGENT_DIR
    }
    if (savedKoluxOmpSourceAgentDir !== undefined) {
      process.env.KOLUX_OMP_SOURCE_AGENT_DIR = savedKoluxOmpSourceAgentDir
    } else {
      delete process.env.KOLUX_OMP_SOURCE_AGENT_DIR
    }
    if (savedKoluxOmpStatusExtension !== undefined) {
      process.env.KOLUX_OMP_STATUS_EXTENSION = savedKoluxOmpStatusExtension
    } else {
      delete process.env.KOLUX_OMP_STATUS_EXTENSION
    }
    if (savedPrimeAgentDir !== undefined) {
      process.env.PRIME_AGENT_CODING_AGENT_DIR = savedPrimeAgentDir
    } else {
      delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    }
    if (savedKoluxPrimeAgentSourceDir !== undefined) {
      process.env.KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR = savedKoluxPrimeAgentSourceDir
    } else {
      delete process.env.KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR
    }
    if (savedKoluxPrimeAgentStatusExtension !== undefined) {
      process.env.KOLUX_PRIME_AGENT_STATUS_EXTENSION = savedKoluxPrimeAgentStatusExtension
    } else {
      delete process.env.KOLUX_PRIME_AGENT_STATUS_EXTENSION
    }
    if (savedKoluxClaudeAgentStatusSettings === undefined) {
      delete process.env.KOLUX_CLAUDE_AGENT_STATUS_SETTINGS
    } else {
      process.env.KOLUX_CLAUDE_AGENT_STATUS_SETTINGS = savedKoluxClaudeAgentStatusSettings
    }
  }

  return { applyTestEnvDefaults, restoreProcessEnv }
}
