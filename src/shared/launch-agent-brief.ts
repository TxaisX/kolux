// Operating rules appended to every agent a launch wave starts. Sent to the agent, not shown in UI, so not localized.
const BRIEF_OPEN = '<nightshift-launch-brief>'
const BRIEF_CLOSE = '</nightshift-launch-brief>'
const BRIEF_PATTERN = new RegExp(`${BRIEF_OPEN}[\\s\\S]*?${BRIEF_CLOSE}`, 'g')

export function launchAgentHandoffPath(worktreeName: string): string {
  return `.nightshift/handoffs/${worktreeName}.md`
}

export function buildLaunchAgentBrief(worktreeName: string, roleBrief?: string | null): string {
  return [
    BRIEF_OPEN,
    ...(roleBrief ? [roleBrief] : []),
    'You are one of several agents working in parallel, each in its own git worktree. Stay inside this worktree.',
    `Keep your own handoff file at ${launchAgentHandoffPath(worktreeName)}. Create it before your first change. After every change, record which files you added, updated or removed and why, and what is left unfinished. Never edit another agent's handoff file.`,
    'Before reporting any work as done, audit it silently: for every library, framework, SDK or CLI API you used, check the current docs with the context7 MCP tools (resolve-library-id, then query-docs) and fix anything that does not match. Require any sub-agents you spawn to do the same. Report only the audited result.',
    BRIEF_CLOSE
  ].join('\n')
}

/** The task comes first so session titles and branch names describe the work, not the rules. */
export function composeLaunchAgentPrompt(
  task: string,
  worktreeName: string,
  roleBrief?: string | null
): string {
  const brief = buildLaunchAgentBrief(worktreeName, roleBrief)
  const trimmed = task.trim()
  return trimmed ? `${trimmed}\n\n${brief}` : brief
}

/** The user's task with every launch brief removed; empty when the prompt was only a brief. */
export function stripLaunchAgentBrief(prompt: string): string {
  return prompt.replace(BRIEF_PATTERN, '').trim()
}
