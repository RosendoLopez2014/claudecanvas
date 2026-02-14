import { create } from 'zustand'

export type WorkspaceMode = 'terminal-only' | 'terminal-inline' | 'terminal-canvas'

interface WorkspaceStore {
  /** @deprecated Use `useTabsStore.getActiveTab().workspaceMode` for per-tab state */
  mode: WorkspaceMode
  canvasSplit: number
  fileExplorerOpen: boolean
  /** @deprecated Use `useTabsStore.updateTab(id, { workspaceMode })` */
  setMode: (mode: WorkspaceMode) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { workspaceMode: 'terminal-canvas' })` */
  openCanvas: () => void
  /** @deprecated Use `useTabsStore.updateTab(id, { workspaceMode: 'terminal-only' })` */
  closeCanvas: () => void
  setCanvasSplit: (split: number) => void
  toggleFileExplorer: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  mode: 'terminal-only',
  canvasSplit: 50,
  fileExplorerOpen: false,
  setMode: (mode) => set({ mode }),
  openCanvas: () => set({ mode: 'terminal-canvas' }),
  closeCanvas: () => set({ mode: 'terminal-only' }),
  setCanvasSplit: (canvasSplit) => set({ canvasSplit }),
  toggleFileExplorer: () => set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen }))
}))
