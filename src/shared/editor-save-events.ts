export const KOLUX_EDITOR_SAVE_DIRTY_FILES_EVENT = 'kolux:editor-save-dirty-files'
export const KOLUX_EDITOR_PREPARE_HOT_EXIT_EVENT = 'kolux:editor-prepare-hot-exit'

export type EditorSaveDirtyFilesDetail = {
  claim: () => void
  resolve: () => void
  reject: (message: string) => void
}

export type EditorPrepareHotExitDetail = EditorSaveDirtyFilesDetail
