import { create } from 'zustand'

export interface ProjectInfo {
  name: string
  path: string
  framework?: string
  devCommand?: string
  devPort?: number
  lastOpened?: number
}

export type AppScreen = 'onboarding' | 'project-picker' | 'workspace'

interface ProjectStore {
  currentProject: ProjectInfo | null
  recentProjects: ProjectInfo[]
  screen: AppScreen
  /** @deprecated Use `useTabsStore.getActiveTab().isDevServerRunning` for per-tab state */
  isDevServerRunning: boolean
  /** @deprecated Use `useTabsStore.getActiveTab().mcpReady` for per-tab state */
  mcpReady: boolean
  /** @deprecated Use `useTabsStore.getActiveTab().mcpPort` for per-tab state */
  mcpPort: number | null
  setCurrentProject: (project: ProjectInfo | null) => void
  setRecentProjects: (projects: ProjectInfo[]) => void
  setScreen: (screen: AppScreen) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { isDevServerRunning })` */
  setDevServerRunning: (running: boolean) => void
  /** @deprecated Use `useTabsStore.updateTab(id, { mcpReady, mcpPort })` */
  setMcpReady: (ready: boolean, port?: number) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  currentProject: null,
  recentProjects: [],
  screen: 'onboarding',
  isDevServerRunning: false,
  mcpReady: false,
  mcpPort: null,
  setCurrentProject: (currentProject) => set({ currentProject }),
  setRecentProjects: (recentProjects) => set({ recentProjects }),
  setScreen: (screen) => set({ screen }),
  setDevServerRunning: (isDevServerRunning) => set({ isDevServerRunning }),
  setMcpReady: (mcpReady, port) => set({ mcpReady, mcpPort: port ?? null })
}))
