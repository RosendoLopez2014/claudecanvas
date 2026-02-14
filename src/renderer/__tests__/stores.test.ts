import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTerminalStore } from '@/stores/terminal'
import { useCanvasStore } from '@/stores/canvas'
import { useProjectStore } from '@/stores/project'
import { useGalleryStore } from '@/stores/gallery'
import { useTabsStore } from '@/stores/tabs'

describe('WorkspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      mode: 'terminal-only',
      canvasSplit: 50
    })
  })

  it('initializes with terminal-only mode', () => {
    const { mode } = useWorkspaceStore.getState()
    expect(mode).toBe('terminal-only')
  })

  it('opens canvas mode', () => {
    useWorkspaceStore.getState().openCanvas()
    expect(useWorkspaceStore.getState().mode).toBe('terminal-canvas')
  })

  it('closes canvas mode', () => {
    useWorkspaceStore.getState().openCanvas()
    useWorkspaceStore.getState().closeCanvas()
    expect(useWorkspaceStore.getState().mode).toBe('terminal-only')
  })

  it('sets canvas split percentage', () => {
    useWorkspaceStore.getState().setCanvasSplit(70)
    expect(useWorkspaceStore.getState().canvasSplit).toBe(70)
  })

  it('sets mode directly', () => {
    useWorkspaceStore.getState().setMode('terminal-inline')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-inline')
  })
})

describe('TerminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState({ ptyId: null, isRunning: false })
  })

  it('initializes with null ptyId', () => {
    expect(useTerminalStore.getState().ptyId).toBeNull()
  })

  it('sets ptyId', () => {
    useTerminalStore.getState().setPtyId('pty-1')
    expect(useTerminalStore.getState().ptyId).toBe('pty-1')
  })

  it('tracks running state', () => {
    useTerminalStore.getState().setIsRunning(true)
    expect(useTerminalStore.getState().isRunning).toBe(true)
  })
})

describe('CanvasStore', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      activeTab: 'preview',
      previewUrl: null,
      inspectorActive: false,
      selectedElements: []
    })
  })

  it('initializes with preview tab', () => {
    expect(useCanvasStore.getState().activeTab).toBe('preview')
  })

  it('switches tabs', () => {
    useCanvasStore.getState().setActiveTab('gallery')
    expect(useCanvasStore.getState().activeTab).toBe('gallery')
  })

  it('sets preview URL', () => {
    useCanvasStore.getState().setPreviewUrl('http://localhost:3000')
    expect(useCanvasStore.getState().previewUrl).toBe('http://localhost:3000')
  })

  it('toggles inspector', () => {
    useCanvasStore.getState().setInspectorActive(true)
    expect(useCanvasStore.getState().inspectorActive).toBe(true)
  })

  it('adds and clears selected elements', () => {
    const el1 = { tagName: 'div', componentName: 'Button' }
    const el2 = { tagName: 'span', componentName: 'Label' }
    useCanvasStore.getState().addSelectedElement(el1)
    useCanvasStore.getState().addSelectedElement(el2)
    expect(useCanvasStore.getState().selectedElements).toHaveLength(2)
    expect(useCanvasStore.getState().selectedElements[0]).toEqual(el1)

    useCanvasStore.getState().clearSelectedElements()
    expect(useCanvasStore.getState().selectedElements).toHaveLength(0)
  })
})

describe('ProjectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [],
      screen: 'onboarding',
      isDevServerRunning: false
    })
  })

  it('initializes on onboarding screen', () => {
    expect(useProjectStore.getState().screen).toBe('onboarding')
  })

  it('sets current project', () => {
    const project = { name: 'my-app', path: '/home/user/my-app' }
    useProjectStore.getState().setCurrentProject(project)
    expect(useProjectStore.getState().currentProject).toEqual(project)
  })

  it('navigates screens', () => {
    useProjectStore.getState().setScreen('project-picker')
    expect(useProjectStore.getState().screen).toBe('project-picker')

    useProjectStore.getState().setScreen('workspace')
    expect(useProjectStore.getState().screen).toBe('workspace')
  })

  it('tracks dev server state', () => {
    useProjectStore.getState().setDevServerRunning(true)
    expect(useProjectStore.getState().isDevServerRunning).toBe(true)
  })

  it('manages recent projects', () => {
    const projects = [
      { name: 'app-1', path: '/path/1' },
      { name: 'app-2', path: '/path/2' }
    ]
    useProjectStore.getState().setRecentProjects(projects)
    expect(useProjectStore.getState().recentProjects).toHaveLength(2)
  })
})

describe('GalleryStore', () => {
  beforeEach(() => {
    useGalleryStore.setState({ variants: [], selectedId: null })
  })

  it('adds variants', () => {
    useGalleryStore.getState().addVariant({
      id: 'v1',
      label: 'Primary Button',
      html: '<button>Click</button>'
    })
    expect(useGalleryStore.getState().variants).toHaveLength(1)
  })

  it('removes variants', () => {
    useGalleryStore.getState().addVariant({ id: 'v1', label: 'A', html: '<div>A</div>' })
    useGalleryStore.getState().addVariant({ id: 'v2', label: 'B', html: '<div>B</div>' })
    useGalleryStore.getState().removeVariant('v1')
    expect(useGalleryStore.getState().variants).toHaveLength(1)
    expect(useGalleryStore.getState().variants[0].id).toBe('v2')
  })

  it('selects variant', () => {
    useGalleryStore.getState().setSelectedId('v1')
    expect(useGalleryStore.getState().selectedId).toBe('v1')
  })
})

describe('Tab store timestamp fields', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  it('tracks lastPushTime and lastFetchTime on tabs', () => {
    const id = useTabsStore.getState().addTab({ name: 'test', path: '/tmp/test' })
    const tab = useTabsStore.getState().tabs.find(t => t.id === id)
    expect(tab?.lastPushTime).toBe(null)
    expect(tab?.lastFetchTime).toBe(null)

    const now = Date.now()
    useTabsStore.getState().updateTab(id, { lastPushTime: now })
    const updated = useTabsStore.getState().tabs.find(t => t.id === id)
    expect(updated?.lastPushTime).toBe(now)
  })
})
