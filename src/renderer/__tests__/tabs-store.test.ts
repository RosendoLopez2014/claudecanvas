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
    updateTab(tabs[0].id, { dev: { status: 'running', url: 'http://localhost:3000', pid: null, lastError: null, lastExitCode: null }, previewUrl: 'http://localhost:3000' })
    updateTab(tabs[1].id, { dev: { status: 'stopped', url: null, pid: null, lastError: null, lastExitCode: null } })
    const state = useTabsStore.getState()
    expect(state.tabs[0].dev.status).toBe('running')
    expect(state.tabs[0].previewUrl).toBe('http://localhost:3000')
    expect(state.tabs[1].dev.status).toBe('stopped')
    expect(state.tabs[1].previewUrl).toBeNull()
  })

  it('new tabs have boot state defaulting to all false', () => {
    const { addTab } = useTabsStore.getState()
    addTab({ name: 'BootTest', path: '/boot-test' })
    const tab = useTabsStore.getState().tabs[0]
    expect(tab.boot).toEqual({ ptyReady: false, mcpReady: false, claudeReady: false })
  })

  it('updateTab can set boot flags independently', () => {
    const { addTab, updateTab } = useTabsStore.getState()
    addTab({ name: 'BootTest', path: '/boot-test' })
    const tab = useTabsStore.getState().tabs[0]
    updateTab(tab.id, { boot: { ...tab.boot, ptyReady: true } })
    const updated = useTabsStore.getState().tabs[0]
    expect(updated.boot.ptyReady).toBe(true)
    expect(updated.boot.mcpReady).toBe(false)
    expect(updated.boot.claudeReady).toBe(false)
  })
})
