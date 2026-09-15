import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { basename } from 'node:path'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import type { PublishRemoteArgs, PublishRemoteVisibility } from '../../../shared/repo-git-publish-types'
import { gitExecFileAsync, ghExecFileAsync } from '../../git/runner'
import { diagnoseGhAuth } from '../../github/auth-diagnose'
import { notifyReposChanged } from './repos-changed-notification'
import { notifyWorktreesChanged } from '../worktree-remote'
import { resolveLocalRepo } from './local-repo-host-guard'
import { repoHasAnyRemote } from './repo-remote-presence'
import {
  redactUrlUserinfo,
  validateGithubRepoName,
  validateRemoteUrl
} from './publish-remote-input-validation'

type PublishOutcome = { ok: true } | { ok: false; error: string }

/**
 * Creates a private (by default) GitHub repo via `gh repo create --source --push`, which
 * both adds the `origin` remote and pushes in one step. Exported so the argv (including
 * `--private`) can be pinned in a test with `gh` stubbed.
 */
export async function publishToGithub(
  repoPath: string,
  name: string,
  visibility: PublishRemoteVisibility
): Promise<PublishOutcome> {
  const diagnosis = await diagnoseGhAuth()
  if (!diagnosis.ghAvailable) {
    return {
      ok: false,
      error: 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com and try again.'
    }
  }
  if (!diagnosis.activeAccount) {
    return { ok: false, error: 'Sign in to GitHub first: run `gh auth login` in a terminal, then try again.' }
  }
  try {
    await ghExecFileAsync(
      [
        'repo',
        'create',
        name,
        visibility === 'public' ? '--public' : '--private',
        '--source',
        repoPath,
        '--remote',
        'origin',
        '--push'
      ],
      { cwd: repoPath }
    )
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // `gh repo create --push` can create the remote GitHub repo and add the local `origin`
    // remote before the push itself fails — leaving a half-published state. Never delete the
    // GitHub repo automatically (the user may still want it); just undo the local remote.
    if (await repoHasAnyRemote(repoPath)) {
      await gitExecFileAsync(['remote', 'remove', 'origin'], { cwd: repoPath }).catch(() => {})
      return {
        ok: false,
        error: `GitHub repository "${name}" was created but the push failed, so the local "origin" remote was removed: ${message}. The repository still exists on GitHub — push to it manually or delete it there.`
      }
    }
    return { ok: false, error: `Failed to create the GitHub repository: ${message}` }
  }
}

/**
 * `git remote add origin <url>` + `git push -u origin HEAD`, rolling the remote back if
 * the push fails so a half-published repo never lingers. Exported (and takes an
 * already-validated url) so the git plumbing can be proven against a real local bare
 * repo in a test without going through `validateRemoteUrl`'s production scheme allowlist.
 */
export async function publishToRemoteUrl(repoPath: string, url: string): Promise<PublishOutcome> {
  try {
    await gitExecFileAsync(['remote', 'add', 'origin', url], { cwd: repoPath })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to add the remote: ${message}` }
  }
  try {
    await gitExecFileAsync(['push', '-u', 'origin', 'HEAD'], { cwd: repoPath })
    return { ok: true }
  } catch (err) {
    await gitExecFileAsync(['remote', 'remove', 'origin'], { cwd: repoPath }).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to push to the remote: ${message}` }
  }
}

/**
 * `repos:publishRemote` — first push to a brand-new remote, either creating a GitHub
 * repo via `gh` (private by default) or wiring up an arbitrary URL (GitLab/other) with
 * `git remote add` + `git push -u`. Always requires `confirmed: true`: the caller must
 * have shown the commit/file counts from `repos:previewPublish` first. Local repos only;
 * refuses if the repo already has any remote configured.
 */
export function registerRepoPublishRemoteHandler(mainWindow: BrowserWindow, store: Store): void {
  ipcMain.handle(
    'repos:publishRemote',
    async (_event, args: PublishRemoteArgs): Promise<{ repo: Repo } | { error: string }> => {
      const repoId = args?.repoId?.trim() ?? ''
      if (!repoId) {
        return { error: 'repoId is required' }
      }
      if (!args?.confirmed) {
        return { error: 'Confirmation is required before publishing' }
      }

      const resolved = resolveLocalRepo(store, repoId, 'git')
      if ('error' in resolved) {
        return resolved
      }
      const { repo } = resolved

      if (await repoHasAnyRemote(repo.path)) {
        return { error: 'This project is already published — a remote is already configured.' }
      }

      let outcome: PublishOutcome
      if (args.provider === 'github') {
        const name = (args.name?.trim() || basename(repo.path)).trim()
        const nameError = validateGithubRepoName(name)
        if (nameError) {
          return { error: nameError }
        }
        const visibility: PublishRemoteVisibility = args.visibility === 'public' ? 'public' : 'private'
        outcome = await publishToGithub(repo.path, name, visibility)
      } else if (args.provider === 'url') {
        const url = args.url?.trim() ?? ''
        const urlError = validateRemoteUrl(url)
        if (urlError) {
          return { error: urlError }
        }
        outcome = await publishToRemoteUrl(repo.path, url)
      } else {
        return { error: 'Unknown provider' }
      }

      if (!outcome.ok) {
        return { error: redactUrlUserinfo(outcome.error) }
      }

      notifyReposChanged(mainWindow)
      notifyWorktreesChanged(mainWindow, repo.id)
      return { repo }
    }
  )
}
