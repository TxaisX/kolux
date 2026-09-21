/** Return a copy of an inherited environment without Kolux's own build-mode flag. */
export function stripInheritedBuildModeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Why: NODE_ENV in Kolux's process is Kolux's build mode (electron-vite sets
  // `development` in dev runs), not the user's; leaking it makes `next build`
  // and Vitest take the wrong branch. Caller/renderer env and shell rc still win.
  const next = { ...env }
  delete next.NODE_ENV
  return next
}
