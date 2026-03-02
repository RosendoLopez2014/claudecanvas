import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore, AppScreen } from '@/stores/project'
import { useTabsStore } from '@/stores/tabs'
import { useWorkspaceStore } from '@/stores/workspace'

describe('Screen Routing', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [],
      screen: 'onboarding'
    })
  })

  it('starts at onboarding screen', () => {
    expect(useProjectStore.getState().screen).toBe('onboarding')
  })

  it('routes through full flow: onboarding -> project-picker -> workspace', () => {
    const screens: AppScreen[] = []

    // Simulate onboarding completion
    useProjectStore.getState().setScreen('project-picker')
    screens.push(useProjectStore.getState().screen)

    // Simulate project selection
    useProjectStore.getState().setCurrentProject({
      name: 'test-app',
      path: '/home/test-app'
    })
    useProjectStore.getState().setScreen('workspace')
    screens.push(useProjectStore.getState().screen)

    expect(screens).toEqual(['project-picker', 'workspace'])
    expect(useProjectStore.getState().currentProject?.name).toBe('test-app')
  })

  it('allows returning to project-picker from workspace', () => {
    useProjectStore.getState().setScreen('workspace')
    useProjectStore.getState().setScreen('project-picker')
    useProjectStore.getState().setCurrentProject(null)

    expect(useProjectStore.getState().screen).toBe('project-picker')
    expect(useProjectStore.getState().currentProject).toBeNull()
  })
})

describe('Workspace Mode Transitions', () => {
  let tabId: string

  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    tabId = useTabsStore.getState().addTab({ name: 'test', path: '/tmp/test' })
  })

  it('canvas tabs are all accessible', () => {
    const tabs = ['preview', 'gallery', 'timeline', 'diff'] as const

    tabs.forEach((tab) => {
      useTabsStore.getState().updateTab(tabId, { activeCanvasTab: tab })
      expect(useTabsStore.getState().tabs[0].activeCanvasTab).toBe(tab)
    })
  })

  it('workspace mode transitions are valid', () => {
    // terminal-only -> terminal-canvas
    useWorkspaceStore.getState().setMode('terminal-only')
    useWorkspaceStore.getState().openCanvas()
    expect(useWorkspaceStore.getState().mode).toBe('terminal-canvas')

    // terminal-canvas -> terminal-only
    useWorkspaceStore.getState().closeCanvas()
    expect(useWorkspaceStore.getState().mode).toBe('terminal-only')

    // direct to terminal-inline
    useWorkspaceStore.getState().setMode('terminal-inline')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-inline')
  })
})
