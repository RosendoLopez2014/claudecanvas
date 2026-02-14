import { create } from 'zustand'
import type { ProjectInfo } from './project'
import type { CanvasTab } from './canvas'
import type { GalleryVariant } from './gallery'
import type { ElementContext } from './canvas'
import type { WorkspaceMode } from './workspace'

export interface TabState {
  id: string
  project: ProjectInfo
  // Terminal
  ptyId: string | null
  // Dev server
  isDevServerRunning: boolean
  // Canvas
  previewUrl: string | null
  activeCanvasTab: CanvasTab
  inspectorActive: boolean
  viewportMode: 'desktop' | 'mobile'
  selectedElements: ElementContext[]
  screenshotMode: boolean
  // Gallery
  galleryVariants: GalleryVariant[]
  gallerySelectedId: string | null
  // Git diff
  diffBeforeHash: string | null
  diffAfterHash: string | null
  // Workspace layout
  workspaceMode: WorkspaceMode
  // MCP
  mcpReady: boolean
  mcpPort: number | null
  // Worktree info (null = main working tree)
  worktreeBranch: string | null
  worktreePath: string | null
}

function createDefaultTabState(project: ProjectInfo): TabState {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    project,
    ptyId: null,
    isDevServerRunning: false,
    previewUrl: null,
    activeCanvasTab: 'preview',
    inspectorActive: false,
    viewportMode: 'desktop',
    selectedElements: [],
    screenshotMode: false,
    galleryVariants: [],
    gallerySelectedId: null,
    diffBeforeHash: null,
    diffAfterHash: null,
    workspaceMode: 'terminal-only',
    mcpReady: false,
    mcpPort: null,
    worktreeBranch: null,
    worktreePath: null,
  }
}

interface TabsStore {
  tabs: TabState[]
  activeTabId: string | null

  addTab: (project: ProjectInfo) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, partial: Partial<TabState>) => void
  getActiveTab: () => TabState | null
  reset: () => void
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (project) => {
    const tab = createDefaultTabState(project)
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    return tab.id
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const newTabs = s.tabs.filter((t) => t.id !== id)
      let newActive = s.activeTabId
      if (s.activeTabId === id) {
        const neighbor = newTabs[idx] || newTabs[idx - 1] || null
        newActive = neighbor?.id || null
      }
      return { tabs: newTabs, activeTabId: newActive }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, partial) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    }))
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) || null
  },

  reset: () => set({ tabs: [], activeTabId: null }),
}))
