import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { InitialCommitPreviewResult } from '../../../../shared/repo-git-publish-types'

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${size} B`
}

/**
 * Follow-up to the sidebar "Make it a git repo" action: the conversion itself only ever
 * creates an empty commit (never stages the user's files), so this offers the explicit
 * opt-in to actually commit them, with a preview and warnings for secrets/oversized files.
 */
const GitRepoConversionFollowUpDialog = React.memo(function GitRepoConversionFollowUpDialog() {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const isOpen = activeModal === 'git-repo-conversion-followup'
  const repoId = typeof modalData.repoId === 'string' ? modalData.repoId : ''

  const [view, setView] = useState<'summary' | 'preview'>('summary')
  const [preview, setPreview] = useState<InitialCommitPreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [writeGitignore, setWriteGitignore] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)
  const [committing, setCommitting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setView('summary')
      setPreview(null)
      setLoading(false)
      setWriteGitignore(true)
      setAcknowledged(false)
      setCommitting(false)
    }
  }, [isOpen])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeModal()
      }
    },
    [closeModal]
  )

  const handleCommitFilesClick = useCallback(() => {
    if (!repoId) {
      return
    }
    setView('preview')
    setLoading(true)
    void (async () => {
      try {
        const result = await window.api.repos.previewInitialCommit({ repoId })
        setPreview(result)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load the file preview')
        setView('summary')
      } finally {
        setLoading(false)
      }
    })()
  }, [repoId])

  const handleConfirmCommit = useCallback(() => {
    if (!repoId || !preview || 'error' in preview) {
      return
    }
    setCommitting(true)
    void (async () => {
      try {
        const result = await window.api.repos.commitInitialFiles({
          repoId,
          writeDefaultGitignore: writeGitignore,
          acknowledgedWarnings: acknowledged || !preview.hasWarnings
        })
        if ('error' in result) {
          throw new Error(result.error)
        }
        toast.success('Project files committed')
        closeModal()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to commit project files')
      } finally {
        setCommitting(false)
      }
    })()
  }, [repoId, preview, writeGitignore, acknowledged, closeModal])

  const previewError = preview && 'error' in preview ? preview.error : null
  const files = preview && !('error' in preview) ? preview.files : []
  const hasWarnings = preview && !('error' in preview) && preview.hasWarnings
  const truncated = preview && !('error' in preview) ? preview.truncated : false
  const totalCount = preview && !('error' in preview) ? preview.totalCount : 0
  const flaggedCount = preview && !('error' in preview) ? preview.flaggedCount : 0

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        {view === 'summary' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-sm">Git repo created</DialogTitle>
              <DialogDescription className="text-xs">
                This project now has one empty commit. Your existing files haven&apos;t been
                added yet — commit them now, or leave the repo empty and do it later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button onClick={handleCommitFilesClick}>Commit files…</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-sm">Commit project files</DialogTitle>
              <DialogDescription className="text-xs">
                {loading
                  ? 'Scanning the project…'
                  : `${totalCount} file${totalCount === 1 ? '' : 's'} will be added.`}
              </DialogDescription>
            </DialogHeader>
            {previewError ? (
              <p className="text-xs text-destructive">{previewError}</p>
            ) : (
              <>
                {truncated ? (
                  <p className="text-xs text-muted-foreground">
                    Showing first {files.length} of {totalCount} files
                    {flaggedCount > 0 ? ` (${flaggedCount} flagged)` : ''} — all files were checked
                    for secrets.
                  </p>
                ) : null}
                <div className="scrollbar-sleek max-h-64 overflow-y-auto rounded-md border border-border/70">
                  {files.map((file) => {
                    const flagged = Boolean(file.flags.secret || file.flags.large)
                    return (
                      <div
                        key={file.path}
                        className={cn(
                          'flex items-center justify-between gap-2 border-b border-border/40 px-2 py-1 text-xs last:border-b-0',
                          flagged && 'bg-destructive/10 text-destructive'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          {flagged ? <AlertTriangle className="size-3 shrink-0" /> : null}
                          <span className="truncate">{file.path}</span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {!previewError && !loading ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="write-default-gitignore"
                  checked={writeGitignore}
                  onCheckedChange={(checked) => setWriteGitignore(checked === true)}
                />
                <Label htmlFor="write-default-gitignore" className="text-xs font-normal">
                  Add a default .gitignore
                </Label>
              </div>
            ) : null}
            {hasWarnings ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="acknowledge-commit-warnings"
                  checked={acknowledged}
                  onCheckedChange={(checked) => setAcknowledged(checked === true)}
                />
                <Label
                  htmlFor="acknowledge-commit-warnings"
                  className="text-xs font-normal text-destructive"
                >
                  I reviewed the flagged files above and want to commit them anyway
                </Label>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setView('summary')}>
                Back
              </Button>
              <Button
                onClick={handleConfirmCommit}
                disabled={
                  loading || committing || Boolean(previewError) || Boolean(hasWarnings && !acknowledged)
                }
              >
                Commit files
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
})

export default GitRepoConversionFollowUpDialog
