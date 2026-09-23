// Why: the real config lives in config/. Without this, a bare `npx vitest` finds no config, so it
// skips the setup that sandboxes HOME and strips agent-session env — and writes into the
// developer's real ~/.kolux, ~/.claude and ~/.codex.
export { default } from './config/vitest.config'
