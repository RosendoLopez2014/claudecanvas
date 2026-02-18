import { create } from 'zustand'
import type { ProjectInfo } from './project'
import type { CanvasTab } from './canvas'
import type { GalleryVariant } from './gallery'
import type { ElementContext } from './canvas'
import type { WorkspaceMode } from './workspace'

// ── Dev Server State ────────────────────────────────────────────────
export type DevStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface DevServerState {
  status: DevStatus
  url: string | null
  pid: number | null
  lastError: string | null
  lastExitCode: number | null
}

export const DEFAULT_DEV_STATE: DevServerState = {
  status: 'stopped',
  url: null,
  pid: null,
  lastError: null,
  lastExitCode: null,
}

export interface TabState {
  id: string
  project: ProjectInfo
  // Terminal
  ptyId: string | null
  splits: string[]  // array of split IDs, e.g. ['main', 'split-1']
  // Dev server — per-project lifecycle, shared across tabs with same project.path
  dev: DevServerState
  // Canvas
  previewUrl: string | null
  activeCanvasTab: CanvasTab
  inspectorActive: boolean
  viewportMode: 'desktop' | 'mobile'
  viewportWidth: number
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
  // Token tracking
  tokenUsage: { sessionTokens: number; lastUpdated: number } | null
  // Git sync
  gitAhead: number
  gitBehind: number
  gitSyncing: boolean
  gitRemoteConfigured: boolean
  gitFetchError: string | null
  lastPushTime: number | null
  lastFetchTime: number | null
  // Integration cache (persists across tab switches)
  githubRepoName: string | null
  vercelLinkedProject: any | null
  supabaseLinkedProject: any | null
  lastIntegrationFetch: number | null
  // Bootstrap flags — stored in Zustand (not component refs) to survive
  // React StrictMode remounts and conditional re-renders.
  githubBootstrapped: boolean
  vercelBootstrapped: boolean
  supabaseBootstrapped: boolean
  // Boot progress (overlay tracks these to show loading state)
  boot: {
    ptyReady: boolean
    mcpReady: boolean
    claudeReady: boolean
  }
}

function createDefaultTabState(project: ProjectInfo): TabState {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    project,
    ptyId: null,
    splits: ['main'],
    dev: { ...DEFAULT_DEV_STATE },
    previewUrl: null,
    activeCanvasTab: 'preview',
    inspectorActive: false,
    viewportMode: 'desktop',
    viewportWidth: 0,
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
    tokenUsage: null,
    gitAhead: 0,
    gitBehind: 0,
    gitSyncing: false,
    gitRemoteConfigured: false,
    gitFetchError: null,
    lastPushTime: null,
    lastFetchTime: null,
    githubRepoName: null,
    vercelLinkedProject: null,
    supabaseLinkedProject: null,
    lastIntegrationFetch: null,
    githubBootstrapped: false,
    vercelBootstrapped: false,
    supabaseBootstrapped: false,
    boot: { ptyReady: false, mcpReady: false, claudeReady: false },
  }
}

interface TabsStore {
  tabs: TabState[]
  activeTabId: string | null

  addTab: (project: ProjectInfo) => string
  closeTab: (id: string) => void
  closeTabAsync: (id: string) => Promise<void>
  setActiveTab: (id: string) => void
  updateTab: (id: string, partial: Omit<Partial<TabState>, 'id' | 'project'>) => void
  getActiveTab: () => TabState | null
  reorderTabs: (newOrder: TabState[]) => void
  reset: () => void

  /** Update ALL tabs that share a project path. Used for dev server events
   *  where one process serves multiple tabs pointing at the same project. */
  updateTabsByProject: (projectPath: string, partial: Omit<Partial<TabState>, 'id' | 'project'>) => void

  /** Update the dev server state for ALL tabs sharing a project path.
   *  Merges `devPartial` into each matching tab's `dev` field. */
  updateDevForProject: (projectPath: string, devPartial: Partial<DevServerState>) => void

  /** Update the project metadata (devCommand, framework, etc.) for a tab.
   *  Used when framework detection enriches an already-open project. */
  updateProjectInfo: (id: string, partial: Partial<ProjectInfo>) => void

  /** Add a horizontal split to a tab's terminal */
  addSplit: (tabId: string) => void
  /** Remove a split from a tab's terminal. Keeps at least one split ('main'). */
  removeSplit: (tabId: string, splitId: string) => void
}

function persistTabs(): void {
  if (typeof window === 'undefined' || !window.api?.settings) return
  const { tabs } = useTabsStore.getState()
  const serialized = tabs.map((t) => ({
    project: t.project,
    worktreeBranch: t.worktreeBranch,
    worktreePath: t.worktreePath,
  }))
  window.api.settings.set('tabs', serialized)
}

/**
 * Full cleanup for a tab: stop dev server, kill PTY, destroy terminal, unwatch files.
 * Shared by TabBar close button and Cmd+W keyboard shortcut.
 * Returns once all resources are released (no UI animation — callers handle that).
 */
export async function cleanupTabResources(tab: TabState): Promise<void> {
  if (tab.dev.status === 'running' || tab.dev.status === 'starting') {
    await window.api.dev.stop(tab.project.path)
  }
  if (tab.ptyId) {
    window.api.pty.kill(tab.ptyId)
  }
  // Stop file watcher for this project
  window.api.fs.unwatch(tab.project.path)
  // Release cached git instance for this project
  window.api.git.cleanup(tab.project.path)
}

/**
 * Restore tabs from persisted settings on app startup.
 * Restores project info and worktree metadata, but NOT runtime state (PTY, dev server).
 */
export async function restoreTabs(): Promise<void> {
  if (typeof window === 'undefined' || !window.api?.settings) return
  const saved = await window.api.settings.get('tabs')
  if (!Array.isArray(saved) || saved.length === 0) return

  const tabs: TabState[] = saved.map((s: { project: ProjectInfo; worktreeBranch?: string; worktreePath?: string }) =>
    ({
      ...createDefaultTabState(s.project),
      worktreeBranch: s.worktreeBranch || null,
      worktreePath: s.worktreePath || null,
    })
  )

  useTabsStore.setState({
    tabs,
    activeTabId: tabs[0].id,
  })
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (project) => {
    const tab = createDefaultTabState(project)
    console.log(`[TAB-DEBUG] addTab: new=${tab.id}, project=${project.name}, existing=${get().tabs.length} tabs`)
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    persistTabs()
    return tab.id
  },

  closeTab: (id) => {
    console.log(`[TAB-DEBUG] closeTab: ${id}`)
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
    persistTabs()
  },

  closeTabAsync: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (tab) {
      await cleanupTabResources(tab)
    }
    get().closeTab(id)
  },

  setActiveTab: (id) => {
    if (id === get().activeTabId) return // no-op: avoid redundant state updates
    const t0 = performance.now()
    console.log(`[TAB-DEBUG] setActiveTab: ${get().activeTabId} → ${id}`)
    set({ activeTabId: id })
    console.log(`[TAB-DEBUG] setActiveTab took ${(performance.now() - t0).toFixed(1)}ms`)
  },

  updateTab: (id, partial) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    }))
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) || null
  },

  reorderTabs: (newOrder) => {
    set({ tabs: newOrder })
    persistTabs()
  },

  reset: () => {
    set({ tabs: [], activeTabId: null })
    persistTabs()
  },

  updateTabsByProject: (projectPath, partial) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.project.path === projectPath ? { ...t, ...partial } : t
      ),
    }))
  },

  updateDevForProject: (projectPath, devPartial) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.project.path === projectPath
          ? { ...t, dev: { ...t.dev, ...devPartial } }
          : t
      ),
    }))
  },

  updateProjectInfo: (id, partial) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, project: { ...t.project, ...partial } } : t
      ),
    }))
    persistTabs()
  },

  addSplit: (tabId) => {
    const splitId = `split-${Date.now()}`
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, splits: [...t.splits, splitId] } : t
      ),
    }))
  },

  removeSplit: (tabId, splitId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        // Must keep at least one split
        if (t.splits.length <= 1) return t
        return { ...t, splits: t.splits.filter((s) => s !== splitId) }
      }),
    }))
  },
}))

/**
 * Stable selector for the active tab. Uses Zustand's built-in selector
 * equality to avoid re-renders when unrelated tabs are updated.
 * Returns the same reference as long as the active tab object hasn't changed.
 */
export const selectActiveTab = (s: { tabs: TabState[]; activeTabId: string | null }) =>
  s.tabs.find((t) => t.id === s.activeTabId) || null
