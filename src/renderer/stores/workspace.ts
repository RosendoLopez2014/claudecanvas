import { create } from 'zustand'

export type WorkspaceMode = 'terminal-only' | 'terminal-inline' | 'terminal-canvas'
export type SplitViewScope = 'project' | 'session'

interface WorkspaceStore {
  /** @deprecated Use `useTabsStore.getActiveTab().workspaceMode` for per-tab state */
  mode: WorkspaceMode
  canvasSplit: number
  fileExplorerOpen: boolean
  splitViewActive: boolean
  splitViewScope: SplitViewScope
  /** When canvas interrupts split view, remember so we can return on close */
  _returnToSplit: { active: boolean; scope: SplitViewScope }
  /** @deprecated Use `useTabsStore.updateTab(id, { workspaceMode })` */
  setMode: (mode: WorkspaceMode) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { workspaceMode: 'terminal-canvas' })` */
  openCanvas: () => void
  /** @deprecated Use `useTabsStore.updateTab(id, { workspaceMode: 'terminal-only' })` */
  closeCanvas: () => void
  setCanvasSplit: (split: number) => void
  toggleFileExplorer: () => void
  enterSplitView: (scope: SplitViewScope) => void
  exitSplitView: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  mode: 'terminal-only',
  canvasSplit: 50,
  fileExplorerOpen: false,
  splitViewActive: false,
  splitViewScope: 'project',
  _returnToSplit: { active: false, scope: 'project' },
  setMode: (mode) => set({ mode }),
  openCanvas: () => {
    const { splitViewActive, splitViewScope } = get()
    set({
      mode: 'terminal-canvas',
      splitViewActive: false,
      _returnToSplit: { active: splitViewActive, scope: splitViewScope },
    })
  },
  closeCanvas: () => {
    const { _returnToSplit } = get()
    set({
      mode: 'terminal-only',
      splitViewActive: _returnToSplit.active,
      splitViewScope: _returnToSplit.scope,
      _returnToSplit: { active: false, scope: 'project' },
    })
  },
  setCanvasSplit: (canvasSplit) => set({ canvasSplit }),
  toggleFileExplorer: () => set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen })),
  enterSplitView: (scope) => {
    const { mode } = get()
    const updates: Partial<WorkspaceStore> = { splitViewActive: true, splitViewScope: scope }
    if (mode === 'terminal-canvas') updates.mode = 'terminal-only'
    set(updates)
    window.api.window.maximize()
  },
  exitSplitView: () => set({ splitViewActive: false }),
}))
