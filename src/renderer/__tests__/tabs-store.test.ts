import { describe, it, expect, beforeEach } from 'vitest'
import { useTabsStore } from '../stores/tabs'

describe('TabsStore', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
  })

  it('starts with no tabs', () => {
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs).toEqual([])
    expect(activeTabId).toBeNull()
  })

  it('adds a tab and sets it active', () => {
    const { addTab } = useTabsStore.getState()
    addTab({ name: 'TestCanvas', path: '/Users/test/TestCanvas' })
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs).toHaveLength(1)
    expect(activeTabId).toBe(tabs[0].id)
    expect(tabs[0].project.name).toBe('TestCanvas')
  })

  it('switches active tab', () => {
    const { addTab, setActiveTab } = useTabsStore.getState()
    addTab({ name: 'Project1', path: '/p1' })
    addTab({ name: 'Project2', path: '/p2' })
    const { tabs } = useTabsStore.getState()
    setActiveTab(tabs[1].id)
    expect(useTabsStore.getState().activeTabId).toBe(tabs[1].id)
  })

  it('closes a tab and activates neighbor', () => {
    const { addTab, closeTab } = useTabsStore.getState()
    addTab({ name: 'P1', path: '/p1' })
    addTab({ name: 'P2', path: '/p2' })
    const { tabs } = useTabsStore.getState()
    const id0 = tabs[0].id
    const id1 = tabs[1].id
    useTabsStore.getState().setActiveTab(id0)
    closeTab(id0)
    expect(useTabsStore.getState().activeTabId).toBe(id1)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })

  it('returns to project picker when last tab closed', () => {
    const { addTab, closeTab } = useTabsStore.getState()
    addTab({ name: 'P1', path: '/p1' })
    const { tabs } = useTabsStore.getState()
    closeTab(tabs[0].id)
    expect(useTabsStore.getState().tabs).toHaveLength(0)
    expect(useTabsStore.getState().activeTabId).toBeNull()
  })

  it('tracks per-tab state independently', () => {
    const { addTab, updateTab } = useTabsStore.getState()
    addTab({ name: 'P1', path: '/p1' })
    addTab({ name: 'P2', path: '/p2' })
    const { tabs } = useTabsStore.getState()
    updateTab(tabs[0].id, { isDevServerRunning: true, previewUrl: 'http://localhost:3000' })
    updateTab(tabs[1].id, { isDevServerRunning: false })
    const state = useTabsStore.getState()
    expect(state.tabs[0].isDevServerRunning).toBe(true)
    expect(state.tabs[0].previewUrl).toBe('http://localhost:3000')
    expect(state.tabs[1].isDevServerRunning).toBe(false)
    expect(state.tabs[1].previewUrl).toBeNull()
  })
})
