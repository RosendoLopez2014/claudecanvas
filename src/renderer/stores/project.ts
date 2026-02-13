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
  isDevServerRunning: boolean
  setCurrentProject: (project: ProjectInfo | null) => void
  setRecentProjects: (projects: ProjectInfo[]) => void
  setScreen: (screen: AppScreen) => void
  setDevServerRunning: (running: boolean) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  currentProject: null,
  recentProjects: [],
  screen: 'onboarding',
  isDevServerRunning: false,
  setCurrentProject: (currentProject) => set({ currentProject }),
  setRecentProjects: (recentProjects) => set({ recentProjects }),
  setScreen: (screen) => set({ screen }),
  setDevServerRunning: (isDevServerRunning) => set({ isDevServerRunning })
}))
