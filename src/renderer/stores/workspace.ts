import { create } from 'zustand'

export type WorkspaceMode = 'terminal-only' | 'terminal-inline' | 'terminal-canvas'

interface WorkspaceStore {
  mode: WorkspaceMode
  canvasSplit: number
  setMode: (mode: WorkspaceMode) => void
  openCanvas: () => void
  closeCanvas: () => void
  setCanvasSplit: (split: number) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  mode: 'terminal-only',
  canvasSplit: 50,
  setMode: (mode) => set({ mode }),
  openCanvas: () => set({ mode: 'terminal-canvas' }),
  closeCanvas: () => set({ mode: 'terminal-only' }),
  setCanvasSplit: (canvasSplit) => set({ canvasSplit })
}))
