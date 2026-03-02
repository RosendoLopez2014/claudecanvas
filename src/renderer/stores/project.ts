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
  setCurrentProject: (project: ProjectInfo | null) => void
  setRecentProjects: (projects: ProjectInfo[]) => void
  setScreen: (screen: AppScreen) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  currentProject: null,
  recentProjects: [],
  screen: 'onboarding',
  setCurrentProject: (currentProject) => set({ currentProject }),
  setRecentProjects: (recentProjects) => set({ recentProjects }),
  setScreen: (screen) => set({ screen })
}))
