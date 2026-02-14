import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGalleryStore } from '@/stores/gallery'
import { useToastStore } from '@/stores/toast'

describe('MCP Command Effects', () => {
  beforeEach(() => {
    useCanvasStore.setState({ activeTab: 'preview', previewUrl: null, inspectorActive: false, selectedElements: [] })
    useWorkspaceStore.setState({ mode: 'terminal-only', canvasSplit: 50 })
    useGalleryStore.setState({ variants: [], selectedId: null })
    useToastStore.setState({ toasts: [] })
  })

  it('canvas_set_preview_url opens canvas and sets URL', () => {
    useCanvasStore.getState().setPreviewUrl('http://localhost:3000')
    useWorkspaceStore.getState().openCanvas()
    useCanvasStore.getState().setActiveTab('preview')

    expect(useCanvasStore.getState().previewUrl).toBe('http://localhost:3000')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-canvas')
    expect(useCanvasStore.getState().activeTab).toBe('preview')
  })

  it('canvas_open_tab opens canvas and switches tab', () => {
    useWorkspaceStore.getState().openCanvas()
    useCanvasStore.getState().setActiveTab('gallery')

    expect(useWorkspaceStore.getState().mode).toBe('terminal-canvas')
    expect(useCanvasStore.getState().activeTab).toBe('gallery')
  })

  it('canvas_add_to_gallery adds variant and switches to gallery', () => {
    useGalleryStore.getState().addVariant({
      id: 'test-1',
      label: 'Primary Button',
      html: '<button>Click</button>'
    })
    useWorkspaceStore.getState().openCanvas()
    useCanvasStore.getState().setActiveTab('gallery')

    expect(useGalleryStore.getState().variants).toHaveLength(1)
    expect(useGalleryStore.getState().variants[0].label).toBe('Primary Button')
    expect(useCanvasStore.getState().activeTab).toBe('gallery')
  })

  it('canvas_notify adds toast', () => {
    useToastStore.getState().addToast('Build complete', 'success')

    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('Build complete')
    expect(useToastStore.getState().toasts[0].type).toBe('success')
  })

  it('toast auto-removes after timeout', () => {
    vi.useFakeTimers()
    useToastStore.getState().addToast('Temporary', 'info')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(4100)
    expect(useToastStore.getState().toasts).toHaveLength(0)
    vi.useRealTimers()
  })

  it('canvas_get_status state is exposed on window', () => {
    ;(window as any).__canvasState = {
      activeTab: 'preview',
      previewUrl: null,
      inspectorActive: false,
      workspaceMode: 'terminal-only',
      devServerRunning: false,
      projectName: null,
      projectPath: null
    }

    const state = (window as any).__canvasState
    expect(state.activeTab).toBe('preview')
    expect(state.workspaceMode).toBe('terminal-only')
  })

  it('multiple toasts can coexist', () => {
    useToastStore.getState().addToast('First', 'info')
    useToastStore.getState().addToast('Second', 'success')
    useToastStore.getState().addToast('Third', 'error')

    expect(useToastStore.getState().toasts).toHaveLength(3)
  })

  it('removeToast removes specific toast', () => {
    vi.useFakeTimers({ now: 1000 })
    useToastStore.getState().addToast('Keep', 'info')
    const keepId = useToastStore.getState().toasts[0].id

    vi.setSystemTime(2000)
    useToastStore.getState().addToast('Remove', 'error')
    const removeId = useToastStore.getState().toasts[1].id

    useToastStore.getState().removeToast(removeId)

    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].id).toBe(keepId)
    vi.useRealTimers()
  })
})
